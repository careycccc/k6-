/**
 * 总代全链路造数(为触发后台「自动通知」)
 *
 * 一个脚本跑完总代的完整链路,依次触发多种自动通知:
 *   1. 注册总代                         → 会员注册
 *   2. 激活邀请转盘(点礼物盒 + 转转盘)
 *   3. 拿转盘邀请码 → 邀请 SUB_COUNT 个下级 + 下级充值   → 会员注册 ×N、账号充值 ×N
 *   4. 转盘提现(SumitInvitedWheelWithdraw)→ 等待自动审核  → 邀请转盘审核通过(取决于后台风控规则)
 *   5. 总代充值                          → 账号充值
 *   6. 总代投注(100~600)
 *   7. 总代提现申请                      → 申请提现
 *   8. 后台审核出款                      → 提现到账
 *
 * 关键说明:
 *   - 普通提现要求「剩余打码量=0」,所以【总代自己的充值默认走免打码后台充值】(manualRecharge, amountOfCode=0),
 *     保证提现能成功;【下级充值走前台真实充值】(hybridRecharge),用于产生转盘奖金 + 满足转盘审核数据。
 *   - 「邀请转盘审核通过」是否通过由后台风控规则决定(轮次×本人充值×下级充值×渠道),脚本不保证一定通过,
 *     会打印实际审核结果(2通过/3拒绝)。
 *   - 「提现到账」需要后台确认出款(真实操作),默认开启;只想测「申请提现」用 -e ENABLE_BACKEND_APPROVAL=0。
 *
 * 用法:
 *   k6 run -e TENANT_ID=3004 agentFullNotifyFlow.test.js
 *   k6 run -e TENANT_ID=3004 -e SUB_COUNT=3 -e SELF_RECHARGE=500 -e SUB_RECHARGE=1000 -e ENABLE_BACKEND_APPROVAL=1 agentFullNotifyFlow.test.js
 *   k6 run -e DRY=1 agentFullNotifyFlow.test.js   # 只做加载/编译预检,不执行真实流程
 *
 * 环境变量:
 *   TENANT_ID                 租户ID(默认 3004)
 *   SUB_COUNT                 邀请下级数(默认 3)
 *   SELF_RECHARGE             总代转盘本轮充值额(默认 500,满足转盘审核「本人充值」)
 *   SUB_RECHARGE              每个下级充值额(默认 1000)
 *   WD_RECHARGE               总代提现前的免打码充值额(默认 1000,保证有余额可提现)
 *   BET_MIN / BET_MAX         总代投注随机范围(默认 100~600,取 10 的倍数)
 *   SELF_RECHARGE_METHOD      总代本人充值方式: manual(免打码,默认,保提现) | front(前台,利于转盘审核但可能卡打码)
 *   SUB_RECHARGE_METHOD       下级充值方式: front(默认,产生转盘奖金) | manual
 *   ENABLE_BACKEND_APPROVAL   总代提现后是否后台出款(默认 1 开;=0 只申请不出款)
 *   AUDIT_WAIT                转盘提现后等待自动审核的秒数(默认 60)
 *   STEP_INTERVAL             主要步骤之间的间隔秒数(默认 3,便于在线观看)
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { manualRecharge } from '../../recharge/manualRecharge.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';
import { addAllWallets } from '../../withdraw/addWalletApi.js';
import { setWithdrawPassword, getWithdrawBasicInfo } from '../../withdraw/withdrawApi.js';
import { executeWithdrawCase } from '../../withdraw/withdraw.test.js';
import { runBackendWithdrawApproval } from '../../withdraw/backendWithdrawApi.js';
import { getAccountBalance } from '../../balance/balance.test.js';
// 投注底层(复用 runbet,不改动)
import { getBetToken } from '../../runbet/betToken.js';
import { betWingo } from '../../runbet/bet.js';
import { isBet } from '../../runbet/issueNumber.js';

const TAG = 'AgentFullNotify';

const TENANT_ID = __ENV.TENANT_ID || __ENV.TENANT || '3004';
const SUB_COUNT = parseInt(__ENV.SUB_COUNT, 10) || 3;
const SELF_RECHARGE = parseInt(__ENV.SELF_RECHARGE, 10) || 500;
const SUB_RECHARGE = parseInt(__ENV.SUB_RECHARGE, 10) || 1000;
const WD_RECHARGE = parseInt(__ENV.WD_RECHARGE, 10) || 1000;
const BET_MIN = parseInt(__ENV.BET_MIN, 10) || 100;
const BET_MAX = parseInt(__ENV.BET_MAX, 10) || 600;
const SELF_RECHARGE_METHOD = (__ENV.SELF_RECHARGE_METHOD || 'manual').toLowerCase();
const SUB_RECHARGE_METHOD = (__ENV.SUB_RECHARGE_METHOD || 'front').toLowerCase();
const ENABLE_BACKEND_APPROVAL = __ENV.ENABLE_BACKEND_APPROVAL !== '0';
const AUDIT_WAIT = parseInt(__ENV.AUDIT_WAIT, 10) || 60;
const STEP = parseInt(__ENV.STEP_INTERVAL, 10) || 3;
const PWD = 'qwer1234';

export const options = {
    scenarios: {
        agent_full_flow: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        }
    }
};

// ================= 工具 =================

function getEnv() {
    return getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    if (res.headers) {
        const a = res.headers['Authorization'] || res.headers['authorization'];
        if (a) return a.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

/** 充值: method=manual 走免打码后台充值 / front 走前台真实充值 */
function doRecharge(method, userToken, adminToken, userId, amount, remark) {
    if (method === 'manual') {
        const r = manualRecharge(adminToken, userId, amount, 0, remark); // amountOfCode=0 免打码
        return !!(r && r.success !== false);
    }
    const r = hybridRecharge({ userToken, adminToken, userId, amount, frontendFirst: true, remark });
    return !!(r && r.success !== false);
}

/** 固定金额投注(复用 runbet 底层,多游戏重试);投注额 = unit × multiple */
function betFixed(loginToken, unit, multiple, userName) {
    if (!loginToken) return false;
    const target = unit * multiple;

    const balanceInfo = getAccountBalance(loginToken);
    if (!balanceInfo || balanceInfo.balance < target) {
        console.error(`[${TAG}] 投注前余额不足(${balanceInfo ? balanceInfo.balance : 'N/A'} < ${target}): ${userName}`);
        return false;
    }

    const games = ['WinGo_5M', 'WinGo_30S', 'TrxWinGo_10M'];
    const contents = ['BigSmall_Big', 'BigSmall_Small', 'Color_Green', 'Color_Red'];

    for (let i = 0; i < games.length; i++) {
        const gameCode = games[i];
        const tokenInfo = getBetToken(loginToken, gameCode);
        if (!tokenInfo || !tokenInfo.token) continue;

        const betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (!betInfo || !betInfo.canBet) continue;

        const betContent = contents[Math.floor(Math.random() * contents.length)];
        const r = betWingo(gameCode, unit, multiple, betContent, betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);
        if (r && r.code === 0 && r.msgCode === 0 && r.msg === 'Succeed') {
            console.log(`[${TAG}] ✅ 投注成功 ${userName}: ${gameCode} ${betContent} 金额=${target}`);
            return { amount: target, gameCode };
        }
    }
    console.error(`[${TAG}] ❌ 投注失败(所有游戏均不可投): ${userName}`);
    return false;
}

/** 确保邀请转盘活动开启 */
function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) {
        console.warn(`[${TAG}] ⚠️ 获取转盘配置失败,继续尝试`);
        return;
    }
    const updates = [];
    if (!cfg.isOpen) updates.push(['IsOpenInvitedWheel', '1']);
    if (!cfg.cashToMainWallet) updates.push(['IsInvitedWheelCashToMainWallet', '1']);
    if (!cfg.autoRotate) updates.push(['InviteAutoRotate', '1']);
    for (const [k, v] of updates) updateInvitedWheelConfig(adminToken, k, v);
    if (updates.length) {
        console.log(`[${TAG}] 已开启转盘配置项: ${updates.map((u) => u[0]).join(', ')}`);
        sleep(10);
    }
}

// ================= Setup =================

export function setup() {
    console.log(`\n${'='.repeat(72)}`);
    console.log(`[${TAG}] 总代全链路造数  租户=${TENANT_ID}  下级数=${SUB_COUNT}`);
    console.log(`[${TAG}] 总代充值=${SELF_RECHARGE}(${SELF_RECHARGE_METHOD}) 下级充值=${SUB_RECHARGE}(${SUB_RECHARGE_METHOD}) 提现前充值=${WD_RECHARGE}(免打码)`);
    console.log(`[${TAG}] 投注=${BET_MIN}~${BET_MAX}  后台出款=${ENABLE_BACKEND_APPROVAL ? '开' : '关'}  审核等待=${AUDIT_WAIT}s`);
    console.log('='.repeat(72));

    if (__ENV.DRY === '1') {
        console.log(`[${TAG}] ✅ DRY 预检: 脚本加载/编译成功(未执行真实流程)`);
        throw new Error(`[${TAG}] DRY 预检通过`);
    }

    const env = getEnv();
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    ensureWheelConfig(adminToken);

    return { adminToken, envConfig: env };
}

// ================= 主流程 =================

export default function (data) {
    const adminToken = data.adminToken;
    const env = data.envConfig || getEnv();
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    const countryCode = env.COUNTRY_CODE || '91';
    const customUrls = {
        registerUrl: env.INVITE_REGISTER_URL || env.BASE_DESK_URL,
        frontUrl: env.INVITE_REGISTER_URL || env.BASE_DESK_URL,
        adminUrl: env.BASE_ADMIN_URL
    };
    const adminData = { token: adminToken, envConfig: env };

    const summary = {
        agent: null, subs: [],
        wheelWithdraw: null, selfRecharge: false, selfBet: 0,
        withdrawApply: null, backendPayout: null
    };

    // ========== 1. 注册总代 ==========
    console.log(`\n[${TAG}] ===== 1. 注册总代 =====`);
    const phone = generateRandomPhone(countryCode);
    const agentDevice = generateCryptoRandomString(16);
    const regRes = phoneRegister(phone, adminData, PWD, '', null, agentDevice, '');
    const agentToken = extractToken(regRes);
    if (!agentToken) throw new Error(`[${TAG}] ❌ 总代注册失败: ${phone}`);
    sleep(1);
    const agentInfo = getFrontUserInfo(agentToken);
    if (!agentInfo || !agentInfo.userId) throw new Error(`[${TAG}] ❌ 取总代 userId 失败`);
    const agent = { phone, token: agentToken, userId: agentInfo.userId, deviceId: agentDevice };
    summary.agent = agent;
    console.log(`[${TAG}] ✅ 总代: ${phone} userId=${agent.userId}`);
    sleep(STEP);

    // ========== 2. 激活邀请转盘 ==========
    console.log(`\n[${TAG}] ===== 2. 激活邀请转盘 =====`);
    const spin = clickSpinInvitedWheel(agent.token);
    if (!spin || !spin.success) console.warn(`[${TAG}] ⚠️ 点击礼物盒失败,继续尝试后续`);
    sleep(5);
    clickSpinningTurntable(agent.token);
    sleep(STEP);

    // ========== 3. 总代本轮充值(转盘审核用) ==========
    console.log(`\n[${TAG}] ===== 3. 总代本轮充值 ${SELF_RECHARGE}(${SELF_RECHARGE_METHOD}) =====`);
    if (SELF_RECHARGE > 0) {
        summary.selfRecharge = doRecharge(SELF_RECHARGE_METHOD, agent.token, adminToken, agent.userId, SELF_RECHARGE, `${TAG}-self`);
        console.log(`[${TAG}] 总代充值 ${summary.selfRecharge ? '✅ 成功' : '❌ 失败'}`);
    }
    sleep(STEP);

    // ========== 4. 拿转盘邀请码 + 邀请下级 ==========
    console.log(`\n[${TAG}] ===== 4. 邀请 ${SUB_COUNT} 个下级(邀请转盘方式) =====`);
    const share = clickShareLink(agent.token);
    if (!share || !share.success || !share.inviteCode) throw new Error(`[${TAG}] ❌ 获取转盘邀请码失败`);
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';
    console.log(`[${TAG}] 🎡 转盘邀请码: ${share.inviteCode} → ${wheelCode}`);

    for (let i = 1; i <= SUB_COUNT; i++) {
        const subPhone = generateRandomPhone(countryCode);
        const subDevice = generateCryptoRandomString(16); // 每个下级独立设备,保证有效邀请
        const subRes = phoneRegisterByInvite(subPhone, wheelCode, adminData, PWD, '', customUrls, subDevice, '');
        const subToken = extractToken(subRes);
        if (!subToken) {
            console.warn(`[${TAG}] ⚠️ 下级${i} 注册失败: ${subPhone}`);
            summary.subs.push({ phone: subPhone, ok: false, recharged: false });
            continue;
        }
        const subInfo = getFrontUserInfo(subToken);
        const subUserId = subInfo && subInfo.userId ? subInfo.userId : null;
        console.log(`[${TAG}] ✅ 下级${i}: ${subPhone} userId=${subUserId || '-'}`);

        let recharged = false;
        if (SUB_RECHARGE > 0 && subUserId) {
            recharged = doRecharge(SUB_RECHARGE_METHOD, subToken, adminToken, subUserId, SUB_RECHARGE, `${TAG}-sub${i}`);
            console.log(`[${TAG}] 下级${i} 充值 ${recharged ? '✅ 成功' : '❌ 失败'}`);
        }
        summary.subs.push({ phone: subPhone, userId: subUserId, ok: true, recharged });
        sleep(STEP);
    }

    // ========== 5. 转盘提现 → 等待自动审核 ==========
    console.log(`\n[${TAG}] ===== 5. 邀请转盘提现 =====`);
    sleep(3);
    const wheelInfo = getUserInvitedWheelInfo(agent.token);
    if (wheelInfo && wheelInfo.success && wheelInfo.totalPrizeAmount > 0) {
        console.log(`[${TAG}] 转盘可提金额: ${wheelInfo.totalPrizeAmount}`);
        const wd = clickWheelWithdraw(wheelInfo.totalPrizeAmount, agent.token);
        summary.wheelWithdraw = { amount: wheelInfo.totalPrizeAmount, submitted: !!(wd && wd.success), msg: wd ? wd.msg : '' };
        if (wd && wd.success) {
            console.log(`[${TAG}] ✅ 转盘提现已提交,等待 ${AUDIT_WAIT}s 自动审核...`);
            sleep(AUDIT_WAIT);
            console.log(`[${TAG}] ⏳ 审核等待结束(审核结果请在后台「邀请转盘提现记录」查看 auditState: 2通过/3拒绝)`);
        } else {
            console.error(`[${TAG}] ❌ 转盘提现提交失败: ${wd ? wd.msg : '未知'}`);
        }
    } else {
        console.warn(`[${TAG}] ⚠️ 无转盘奖金可提现(totalPrizeAmount=${wheelInfo ? wheelInfo.totalPrizeAmount : 'N/A'}),跳过转盘提现`);
        summary.wheelWithdraw = { amount: 0, submitted: false, msg: '无奖金' };
    }
    sleep(STEP);

    // ========== 6. 总代自己: 充值(免打码) ==========
    console.log(`\n[${TAG}] ===== 6. 总代提现前充值 ${WD_RECHARGE}(免打码) =====`);
    if (WD_RECHARGE > 0) {
        const ok = doRecharge('manual', agent.token, adminToken, agent.userId, WD_RECHARGE, `${TAG}-wd-recharge`);
        console.log(`[${TAG}] 总代提现前充值 ${ok ? '✅ 成功' : '❌ 失败'}`);
    }
    sleep(STEP);

    // ========== 7. 总代投注 ==========
    console.log(`\n[${TAG}] ===== 7. 总代投注 =====`);
    const betLo = Math.max(1, Math.floor(BET_MIN / 10));
    const betHi = Math.max(betLo, Math.floor(BET_MAX / 10));
    const multiple = randInt(betLo, betHi);
    const bet = betFixed(agent.token, 10, multiple, `总代${agent.phone}`);
    summary.selfBet = bet ? bet.amount : 0;
    sleep(STEP);

    // ========== 8. 总代提现申请 ==========
    console.log(`\n[${TAG}] ===== 8. 总代提现(绑卡 → 设密码 → 申请) =====`);
    addAllWallets(adminToken, agent.userId, agent.token);
    sleep(2);
    setWithdrawPassword(agent.token);
    sleep(1);
    const allWithdraw = getWithdrawBasicInfo(agent.token);
    const balInfo = getAccountBalance(agent.token);
    const balance = balInfo ? balInfo.balance : 0;
    console.log(`[${TAG}] 总代余额: ${balance}`);

    if (!allWithdraw) {
        console.error(`[${TAG}] ❌ 获取提现基础信息失败,跳过提现`);
    } else {
        const wdResult = executeWithdrawCase(agent.token, balance, allWithdraw);
        if (wdResult) {
            summary.withdrawApply = wdResult;
            console.log(`[${TAG}] ✅ 提现申请成功: 金额=${wdResult.withDrawaAmont} 通道=${wdResult.withDrawaType}`);

            // ========== 9. 后台审核出款(提现到账) ==========
            if (ENABLE_BACKEND_APPROVAL) {
                console.log(`\n[${TAG}] ===== 9. 后台审核出款(提现到账) =====`);
                sleep(2);
                const payout = runBackendWithdrawApproval(adminToken, agent.userId, wdResult.withDrawaType, wdResult.withDrawaAmont);
                summary.backendPayout = !!payout;
                console.log(`[${TAG}] 后台出款 ${payout ? '✅ 完成(提现到账)' : '⚠️ 未完成'}`);
            } else {
                console.log(`[${TAG}] ℹ️ 跳过后台出款(ENABLE_BACKEND_APPROVAL=0)`);
            }
        } else {
            console.error(`[${TAG}] ❌ 提现申请未通过(可能余额不足/今日次数用尽/剩余打码量≠0)`);
        }
    }

    printSummary(summary);
}

// ================= 打印汇总 =================

function printSummary(s) {
    const dline = '═'.repeat(72);
    console.log('\n' + dline);
    console.log(`  📊 总代全链路造数结果    租户 ${TENANT_ID}`);
    console.log(dline);
    if (s.agent) {
        console.log(`  🧑 总代: ${s.agent.phone}  userId=${s.agent.userId}`);
        console.log(`     本轮充值: ${s.selfRecharge ? '✅' : '❌'}   投注: ${s.selfBet || '❌'}`);
    }
    console.log(`  👥 下级(${s.subs.length}):`);
    s.subs.forEach((sub, i) => {
        console.log(`     [${i + 1}] ${sub.ok ? '✅' : '❌'} ${sub.phone} | userId=${sub.userId || '-'} | 充值=${sub.recharged ? '✅' : '❌'}`);
    });
    console.log(`  🎡 转盘提现: ${s.wheelWithdraw ? (s.wheelWithdraw.submitted ? `已提交 金额=${s.wheelWithdraw.amount}(审核结果见后台)` : `未提交(${s.wheelWithdraw.msg})`) : '未执行'}`);
    console.log(`  💸 总代提现申请: ${s.withdrawApply ? `✅ 金额=${s.withdrawApply.withDrawaAmont} 通道=${s.withdrawApply.withDrawaType}` : '❌ 未成功'}`);
    if (s.withdrawApply) {
        console.log(`  🏦 后台出款(到账): ${s.backendPayout === null ? '未执行' : (s.backendPayout ? '✅ 完成' : '⚠️ 未完成')}`);
    }
    console.log(dline);
    console.log(`  触发的通知: 会员注册(总代+下级) / 账号充值(总代+下级) / 邀请转盘提现(审核) / 申请提现 / 提现到账`);
    console.log(dline);
}
