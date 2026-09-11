/**
 *  代理邀请任务调整-同设备ID不计算有效邀请
 * 同设备 · 两种邀请方式 造数脚本
 *
 * 一次跑完：
 *   1. 注册 2 个总代（手机号，各自独立 deviceId：devA / devB），注册失败直接报错
 *   2. 总代A 走「注册邀请」邀请 SUB_COUNT 个一级下级 —— 用【总代A原始邀请码】注册
 *   3. 总代B 走「邀请转盘」邀请 SUB_COUNT 个一级下级 —— 总代B先点礼物盒→转盘→拿邀请码(末位补W)，
 *      下级用【转盘邀请码】注册；不提现
 *      （可选）两条线各自用开关 A_L2 / B_L2（默认开）在【第一个一级下级】下再挂一层 2 级代理
 *      （L2_COUNT 个，默认2；均走注册邀请=用该一级下级邀请码 + 本线设备 devA/devB，同样充值投注）
 *   4. 每个下级：充值 RECHARGE_AMOUNT(默认1000) + 投注 BET_UNIT×BET_MULTIPLE(默认20×10=200)
 *   5. 末尾打印 2 个总代（含各自 deviceId / userId / inviteCode 及其下级明细）
 *
 * 说明：
 *   - 只用手机号注册（设备靠 deviceId，邮箱注册后端不支持固定 deviceId），注册失败即抛错终止。
 *   - 设备分配 DEVICE_MODE（默认 split）：
 *       split = 每条线：总代一个设备，其下级(1级+2级)共用另一个设备（总代≠下级，下级之间相同）
 *       chain = 每条线：总代与所有下级同一个设备（原“同设备链”）
 *   - betRun 是随机金额，为满足"投注200"这里用固定金额投注 betFixed（复用 runbet 底层）。
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 runSameDeviceInviteTwoWays.test.js
 *   k6 run -e TENANT_ID=3006 -e SUB_COUNT=4 -e RECHARGE_AMOUNT=1000  runSameDeviceInviteTwoWays.test.js
 *   k6 run -e TENANT_ID=3101 -e SUB_COUNT=2 -e RECHARGE_AMOUNT=1000 -e B_L2=0 runSameDeviceInviteTwoWays.test.js   // 只A挂，B不挂
 *   k6 run -e TENANT_ID=3101 -e DEVICE_MODE=split -e B_L2=0 runSameDeviceInviteTwoWays.test.js   // 总代与所有下级不同设备
 *
 * 环境变量：
 *   TENANT_ID        租户ID（默认 3004）
 *   SUB_COUNT        每个总代邀请的下级数（默认 2）
 *   RECHARGE_AMOUNT  每个下级充值金额（默认 1000）
 *   BET_UNIT         单注金额（默认 20）
 *   BET_MULTIPLE     投注倍数（默认 10）  → 实际投注额 = BET_UNIT × BET_MULTIPLE
 *   L2_COUNT         第一个一级下级下的 2 级代理数（默认 2）
 *   A_L2             总代A 是否加 2 级代理（默认 1 开，=0 关）  （注册邀请）
 *   B_L2             总代B 是否加 2 级代理（默认 1 开，=0 关） （邀请转盘）
 *   DEVICE_MODE      设备分配：split(默认,总代独立/下级共用) | chain(总代与下级全同设备)
 */

import { sleep } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../utils/utils.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import {
    getInvitedWheelConfig,
    updateInvitedWheelConfig,
    clickSpinInvitedWheel,
    clickSpinningTurntable,
    clickShareLink,
} from '../activity/inviteTurntable/inviteTurntableApi.js';
// 投注底层（复用，不改动 betRun.js）
import { getBetToken } from '../runbet/betToken.js';
import { betWingo } from '../runbet/bet.js';
import { isBet } from '../runbet/issueNumber.js';
import { getAccountBalance } from '../balance/balance.test.js';

const TAG = 'SameDeviceTwoWays';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const SUB_COUNT = parseInt(__ENV.SUB_COUNT, 10) || 2;
const RECHARGE_AMOUNT = parseInt(__ENV.RECHARGE_AMOUNT, 10) || 1000;
const BET_UNIT = parseInt(__ENV.BET_UNIT, 10) || 20;
const BET_MULTIPLE = parseInt(__ENV.BET_MULTIPLE, 10) || 10;
const L2_COUNT = parseInt(__ENV.L2_COUNT, 10) || 2; // 第一个一级下级下面新增的 2 级代理数
const A_L2_ON = __ENV.A_L2 !== '0'; // 总代A(注册邀请)是否加 2 级代理（默认开，-e A_L2=0 关）
const B_L2_ON = __ENV.B_L2 !== '0'; // 总代B(邀请转盘)是否加 2 级代理（默认开，-e B_L2=0 关）
// 设备分配模式：split=总代独立设备、其下级(1级+2级)共用另一个设备；chain=总代与所有下级同一个设备
const DEVICE_MODE = (__ENV.DEVICE_MODE || 'split').toLowerCase();
const DEVICE_SPLIT = DEVICE_MODE === 'split';

export const options = {
    scenarios: {
        same_device_two_ways: {
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

/** 邀请注册用的自定义域名（邀请注册专用地址优先） */
function buildCustomUrls(env) {
    const inviteUrl = env.INVITE_REGISTER_URL || env.BASE_DESK_URL || null;
    return {
        frontUrl: inviteUrl,
        adminUrl: env.BASE_ADMIN_URL || null,
        registerUrl: inviteUrl
    };
}

/** 固定金额投注（复用 runbet 底层，多游戏重试）；投注额 = unit × multiple */
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

/** 下级充值 + 投注（充值/投注失败只记录不抛错，注册失败才抛错） */
function rechargeAndBet(subToken, adminToken, label) {
    const info = getFrontUserInfo(subToken);
    const userId = info && info.userId ? info.userId : null;
    if (!userId) {
        console.error(`[${TAG}] 取下级 userId 失败: ${label}`);
        return { userId: null, recharged: false, rechargeAmount: 0, betted: false, betAmount: 0 };
    }

    // 充值
    const rc = hybridRecharge({
        userToken: subToken, adminToken, userId,
        amount: RECHARGE_AMOUNT, frontendFirst: true, remark: `SameDeviceTwoWays-${label}`
    });
    const recharged = !!(rc && rc.success);
    if (recharged) console.log(`[${TAG}] ✅ 充值成功 ${label}: ${rc.amount}(${rc.method || '-'})`);
    else console.error(`[${TAG}] ❌ 充值失败 ${label}: ${rc && rc.message ? rc.message : '未知'}`);

    // 投注（充值成功才投）
    let bet = false;
    if (recharged) {
        sleep(2);
        bet = betFixed(subToken, BET_UNIT, BET_MULTIPLE, label);
    }

    return {
        userId,
        inviteCode: info.inviteCode || null, // 供在其下再挂一级（2级代理）用
        recharged,
        rechargeAmount: recharged ? (rc.amount || RECHARGE_AMOUNT) : 0,
        betted: !!bet,
        betAmount: bet ? bet.amount : 0
    };
}

// ================= 注册 =================

/** 注册总代（手机号，固定 deviceId），失败抛错；成功后取 inviteCode/userId */
function registerAgent(data, env, label) {
    const phone = generateRandomPhone(env.COUNTRY_CODE || '91');
    const deviceId = generateCryptoRandomString(16);

    console.log(`\n[${TAG}] 注册总代 ${label}: ${phone} (deviceId=${deviceId})`);
    const res = phoneRegister(phone, data, 'qwer1234', '', null, deviceId, '');
    if (!res || res.code !== 0 || !res.data || !res.data.token) {
        throw new Error(`[${TAG}] ❌ 总代 ${label} 注册失败: ${phone}`);
    }
    const token = res.data.token;

    // 取邀请码 / userId（注册邀请方式需要总代原始 inviteCode）
    sleep(1);
    const info = getFrontUserInfo(token);
    if (!info || !info.userId || !info.inviteCode) {
        throw new Error(`[${TAG}] ❌ 总代 ${label} 取 userId/inviteCode 失败: ${phone}`);
    }

    console.log(`[${TAG}] ✅ 总代 ${label}: account=${phone} userId=${info.userId} inviteCode=${info.inviteCode}`);
    return { label, account: phone, token, deviceId, userId: info.userId, inviteCode: info.inviteCode, subs: [] };
}

/** 注册一个下级（手机号，用指定 inviteCode + 指定 deviceId=同设备），失败抛错 */
function registerSub(inviteCode, deviceId, data, env, label) {
    const phone = generateRandomPhone(env.COUNTRY_CODE || '91');
    const customUrls = buildCustomUrls(env);

    console.log(`[${TAG}] 注册下级 ${label}: ${phone} (inviteCode=${inviteCode}, deviceId=${deviceId})`);
    const res = phoneRegisterByInvite(phone, inviteCode, data, 'qwer1234', '', customUrls, deviceId, '');
    if (!res || res.code !== 0 || !res.data || !res.data.token) {
        throw new Error(`[${TAG}] ❌ 下级 ${label} 注册失败: ${phone} -> ${inviteCode}`);
    }
    return { account: phone, token: res.data.token, deviceId };
}

/** 在指定上级（其 rechargeAndBet 结果 rb 含 inviteCode）下，用注册邀请挂 L2_COUNT 个 2 级代理（同设备 deviceId） */
function attachL2(parentRb, parentAccount, deviceId, data, env, adminToken, label) {
    if (!parentRb || !parentRb.inviteCode) {
        console.warn(`[${TAG}] ⚠️ ${label} 无邀请码，跳过 2 级代理`);
        return [];
    }
    console.log(`\n[${TAG}] === 在 ${label}(${parentAccount}) 下新增 ${L2_COUNT} 个 2 级代理（同设备 ${deviceId}）===`);
    const list = [];
    for (let j = 0; j < L2_COUNT; j++) {
        sleep(1);
        const l2 = registerSub(parentRb.inviteCode, deviceId, data, env, `${label}-L2-${j + 1}`);
        sleep(2);
        const l2rb = rechargeAndBet(l2.token, adminToken, `${label}-L2-${j + 1}`);
        list.push({ account: l2.account, deviceId: l2.deviceId, ...l2rb });
    }
    return list;
}

// ================= 转盘活动前置 =================

/** 确保邀请转盘活动开启（供总代B使用） */
function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) throw new Error(`[${TAG}] ❌ 获取邀请转盘配置失败`);

    const updates = [];
    if (!cfg.isOpen) updates.push({ key: 'IsOpenInvitedWheel', value: '1' });
    if (!cfg.cashToMainWallet) updates.push({ key: 'IsInvitedWheelCashToMainWallet', value: '1' });
    if (!cfg.autoRotate) updates.push({ key: 'InviteAutoRotate', value: '1' });

    for (const u of updates) {
        const r = updateInvitedWheelConfig(adminToken, u.key, u.value);
        if (!r || !r.success) throw new Error(`[${TAG}] ❌ 更新转盘配置失败: ${u.key}`);
    }
    if (updates.length > 0) sleep(10);
}

/** 总代B激活转盘并拿到转盘邀请码（末位补W） */
function getWheelInviteCode(agentToken) {
    console.log(`[${TAG}] 总代B 点击礼物盒...`);
    const spin = clickSpinInvitedWheel(agentToken);
    if (!spin || !spin.success) throw new Error(`[${TAG}] ❌ 点击礼物盒失败`);
    sleep(5);

    console.log(`[${TAG}] 总代B 旋转转盘...`);
    const turntable = clickSpinningTurntable(agentToken);
    if (!turntable || !turntable.success) throw new Error(`[${TAG}] ❌ 旋转转盘失败`);

    console.log(`[${TAG}] 总代B 获取邀请码...`);
    const share = clickShareLink(agentToken);
    if (!share || !share.success || !share.inviteCode) throw new Error(`[${TAG}] ❌ 获取转盘邀请码失败`);

    // 转盘邀请码 = 原码去掉末位补 W
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';
    console.log(`[${TAG}] 转盘邀请码: ${share.inviteCode} → ${wheelCode}`);
    return wheelCode;
}

// ================= Setup / VU =================

export function setup() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${TAG}] 同设备·两种邀请方式造数  租户=${TENANT_ID}  每总代下级数=${SUB_COUNT}`);
    console.log(`[${TAG}] 充值=${RECHARGE_AMOUNT}  投注=${BET_UNIT}×${BET_MULTIPLE}=${BET_UNIT * BET_MULTIPLE}`);
    console.log(`${'='.repeat(70)}`);

    const env = getEnv();
    if (TENANT_ID !== '3004') {
        Object.assign(ENV_CONFIG, env);
        console.log(`[${TAG}] ✅ ENV_CONFIG 切换为租户 ${TENANT_ID}`);
    }

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error(`[${TAG}] ❌ 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    return { token: adminToken, envConfig: env };
}

export default function (data) {
    const adminToken = data.token;
    const env = data.envConfig || getEnv();
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);

    // ---- 总代A：注册邀请 ----
    const agentA = registerAgent(data, env, 'A(注册邀请)');
    // 下级设备：split → 一级/二级共用一个新设备（与总代不同）；chain → 复用总代设备
    const subDevA = DEVICE_SPLIT ? generateCryptoRandomString(16) : agentA.deviceId;
    console.log(`\n[${TAG}] === 总代A【注册邀请】邀请 ${SUB_COUNT} 个下级  总代设备=${agentA.deviceId}  下级设备=${subDevA}${DEVICE_SPLIT ? ' (1级/2级共用)' : ' (=总代,同设备链)'} ===`);
    for (let i = 0; i < SUB_COUNT; i++) {
        sleep(1);
        const sub = registerSub(agentA.inviteCode, subDevA, data, env, `A-sub${i + 1}`);
        sleep(2);
        const rb = rechargeAndBet(sub.token, adminToken, `A-sub${i + 1}`);
        const subRecord = { account: sub.account, deviceId: sub.deviceId, ...rb, subs: [] };
        agentA.subs.push(subRecord);

        // 开关控制：在第一个 1 级下级下加一层 2 级代理（下级设备 subDevA，与一级相同）
        if (i === 0 && A_L2_ON) {
            subRecord.subs = attachL2(rb, sub.account, subDevA, data, env, adminToken, 'A-sub1');
        }
    }

    // ---- 总代B：邀请转盘 ----
    const agentB = registerAgent(data, env, 'B(邀请转盘)');
    // 下级设备：split → 一级/二级共用一个新设备（与总代不同）；chain → 复用总代设备
    const subDevB = DEVICE_SPLIT ? generateCryptoRandomString(16) : agentB.deviceId;
    console.log(`\n[${TAG}] === 总代B【邀请转盘】邀请 ${SUB_COUNT} 个下级  总代设备=${agentB.deviceId}  下级设备=${subDevB}${DEVICE_SPLIT ? ' (1级/2级共用)' : ' (=总代,同设备链)'} ===`);
    ensureWheelConfig(adminToken);
    const wheelCode = getWheelInviteCode(agentB.token);
    for (let i = 0; i < SUB_COUNT; i++) {
        sleep(1);
        const sub = registerSub(wheelCode, subDevB, data, env, `B-sub${i + 1}`);
        sleep(2);
        const rb = rechargeAndBet(sub.token, adminToken, `B-sub${i + 1}`);
        const subRecord = { account: sub.account, deviceId: sub.deviceId, ...rb, subs: [] };
        agentB.subs.push(subRecord);

        // 开关控制：在第一个 1 级下级下加一层 2 级代理（下级设备 subDevB，与一级相同）
        if (i === 0 && B_L2_ON) {
            subRecord.subs = attachL2(rb, sub.account, subDevB, data, env, adminToken, 'B-sub1');
        }
    }

    // ---- 打印 2 个总代 ----
    printAgents([agentA, agentB]);
}

// ================= 打印 =================

function printAgents(agents) {
    const dline = '═'.repeat(70);
    const sline = '─'.repeat(70);
    console.log('\n' + dline);
    console.log(`  📊 同设备·两种邀请方式 造数结果    租户 ${TENANT_ID}`);
    console.log(dline);

    for (const a of agents) {
        console.log(`\n  🧑 总代 ${a.label}`);
        console.log(`     账号     : ${a.account}`);
        console.log(`     userId   : ${a.userId}`);
        console.log(`     邀请码   : ${a.inviteCode}`);
        console.log(`     deviceId : ${a.deviceId}   （总代设备；下级设备见下方每人的“设备=”）`);
        console.log(sline);
        console.log(`     下级（${a.subs.length}）:`);
        a.subs.forEach((s, i) => {
            console.log(`       [${i + 1}] ${s.account} | userId=${s.userId || 'N/A'} | 设备=${s.deviceId}`);
            console.log(`           充值=${s.recharged ? s.rechargeAmount : '❌失败'} | 投注=${s.betted ? s.betAmount : '❌失败'}`);
            if (s.subs && s.subs.length) {
                console.log(`           └─ 2级代理（${s.subs.length}）:`);
                s.subs.forEach((g, j) => {
                    console.log(`              [${i + 1}.${j + 1}] ${g.account} | userId=${g.userId || 'N/A'} | 设备=${g.deviceId}`);
                    console.log(`                  充值=${g.recharged ? g.rechargeAmount : '❌失败'} | 投注=${g.betted ? g.betAmount : '❌失败'}`);
                });
            }
        });
        console.log(dline);
    }
}
