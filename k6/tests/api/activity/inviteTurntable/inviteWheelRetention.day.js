/**
 * 邀请转盘 - 多天留存造数 k6 脚本（配合 inviteWheelRunner.js 使用）
 *
 * ⚠️ 账号落盘由 Node 包装器 inviteWheelRunner.js 完成（k6 沙箱无法写文件）：
 *    - 账号打成标记行走 stderr：`##ALL##<账号>`（所有相关账号）、`##PART##<账号>`（参与过转盘的）
 *    - runner 收集后写入 retention/all_dayNN.txt 与 retention/participants_dayNN.txt
 *    - DAY>=2 用 open() 读上一天 all_dayNN.txt
 *
 * D1（造数）：起 AGENTS 个总代（每 VU 一个，并发），每总代 参与转盘 → ROUNDS 轮 × SUBS 下级
 *            （下级充值1000 + 50%参与）→ 满足提现就提现。
 * D2/D3（留存+行为）：读上一天账号，70%充投 / 20%只充 / 5%只登录 / 5%不登录，另独立 30% 额外参与转盘并邀请。
 *            登录即留存；除 5% 不登录外都写当天 all，供下一天。
 *
 * 运行（推荐）：
 *    node inviteWheelRunner.js --day 1 --agents 3 --subs 3 --rounds 2 --tenant 3004
 *    node inviteWheelRunner.js --day 2 --tenant 3004
 *
 * 参数（-e，由 runner 组装）：
 *    TENANT_ID / DAY / AGENTS / SUBS / ROUNDS / VUS / VU_GAP / COUNTRY_CODE / VIA_RUNNER
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';
// 投注底层（自写 betFixed，固定 20×10=200）
import { getBetToken } from '../../runbet/betToken.js';
import { betWingo } from '../../runbet/bet.js';
import { isBet } from '../../runbet/issueNumber.js';
import { getAccountBalance } from '../../balance/balance.test.js';

// ================= 参数（init 上下文） =================

const TENANT_ID = __ENV.TENANT_ID || '3004';
const DAY = parseInt(__ENV.DAY || '1', 10);
const AGENTS = parseInt(__ENV.AGENTS || '3', 10);   // D1 总代数（=VU 数）
const SUBS = parseInt(__ENV.SUBS || '3', 10);       // 每轮每总代邀请下级数
const ROUNDS = parseInt(__ENV.ROUNDS || '2', 10);   // 轮数
const VUS = parseInt(__ENV.VUS || '5', 10);         // D2/D3 并发 VU 数
const VU_GAP = parseFloat(__ENV.VU_GAP || '1');     // VU 启动错峰秒
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);

const RECHARGE_AMOUNT = 1000;
const BET_UNIT = 20, BET_MULTIPLE = 10; // 投注 200
const SUB_PARTICIPATE_RATE = 0.5;       // 下级 50% 参与

// DAY>=2：init 阶段读上一天 all 账号（open 相对本脚本目录）
let PREV_ACCOUNTS = [];
if (DAY >= 2) {
    const prevFile = `./retention/all_day${String(DAY - 1).padStart(2, '0')}.txt`;
    try {
        PREV_ACCOUNTS = open(prevFile).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch (e) {
        throw new Error(`[InviteWheel] ❌ DAY=${DAY} 读上一天文件 ${prevFile} 失败：${e.message}（请确认已生成且 runner 在脚本目录运行）`);
    }
}

const D2_VUS = Math.max(1, Math.min(VUS, PREV_ACCOUNTS.length || 1));
const RUN_VUS = DAY === 1 ? Math.max(1, AGENTS) : D2_VUS;

export const options = {
    scenarios: {
        invite_wheel_retention: {
            executor: 'per-vu-iterations',
            vus: RUN_VUS,
            iterations: 1,
            maxDuration: '180m'
        }
    }
};

// ================= 工具 =================

function emitAll(acct) { console.log(`##ALL##${acct}`); }
function emitPart(acct) { console.log(`##PART##${acct}`); }

function extractToken(response) {
    if (!response) return null;
    if (typeof response === 'string' && response.length > 10) return response;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

/** 固定金额投注（复用 runbet 底层，多游戏重试）；投注额 = unit×multiple */
function betFixed(loginToken, unit, multiple, userName) {
    if (!loginToken) return false;
    const target = unit * multiple;
    const balanceInfo = getAccountBalance(loginToken);
    if (!balanceInfo || balanceInfo.balance < target) return false;

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
        if (r && r.code === 0 && r.msgCode === 0 && r.msg === 'Succeed') return { amount: target };
    }
    return false;
}

// ================= 邀请转盘动作（复用 inviteTurntableApi） =================

/** 参与邀请转盘 = 点礼物盒 + 转一次转盘 */
function participateWheel(token) {
    const s = clickSpinInvitedWheel(token);
    if (!s || !s.success) return false;
    sleep(2);
    clickSpinningTurntable(token);
    return true;
}

/** 满足提现条件（总奖金>0 且 全部可提）就提现，照 verifySameDeviceInvite */
function tryWithdraw(token) {
    const info = getUserInvitedWheelInfo(token);
    if (info && info.success && info.totalPrizeAmount > 0 && info.totalPrizeAmount === info.userWheelAmount) {
        clickWheelWithdraw(info.totalPrizeAmount, token);
    }
}

/** 确保邀请转盘活动开启（活动/主钱包提现/自动旋转） */
function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) return false;
    const updates = [];
    if (!cfg.isOpen) updates.push(['IsOpenInvitedWheel', '1']);
    if (!cfg.cashToMainWallet) updates.push(['IsInvitedWheelCashToMainWallet', '1']);
    if (!cfg.autoRotate) updates.push(['InviteAutoRotate', '1']);
    for (const [k, v] of updates) updateInvitedWheelConfig(adminToken, k, v);
    if (updates.length > 0) sleep(10);
    return true;
}

// ================= 注册（带退避重试，缓解写库限流） =================

function registerWithRetry(kind, parentCode, ctx) {
    const { countryCode, adminData, customUrls } = ctx;
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
        const phone = generateRandomPhone(countryCode);
        const res = (kind === 'agent')
            ? phoneRegister(phone, adminData, 'qwer1234', '', null, generateCryptoRandomString(16), '')
            : phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
        const token = extractToken(res);
        if (token) {
            const info = getFrontUserInfo(token);
            if (info && info.userId) return { phone, token, userId: info.userId, inviteCode: info.inviteCode || '' };
        }
        sleep(1 + attempt);
    }
    return null;
}

/**
 * 完整“邀请转盘”轮次：共 ROUNDS 轮，每轮都完整走一遍（照 verifySameDeviceInvite 的 cross_round）：
 *   点礼物盒 + 转盘 → 拿最新邀请码 → 邀请 SUBS 个下级(充1000 + 50%参与) → 满足就提现。
 * 这样 2 轮 = 2 次转盘 + 2 次提现（修复“两轮只提现一次”）。
 */
function runWheelRounds(agentToken, agentPhone, ctx) {
    const adminToken = ctx.adminData.token;
    let marked = false;
    for (let round = 1; round <= ROUNDS; round++) {
        // 1) 参与转盘：点礼物盒 + 转盘
        const spin = clickSpinInvitedWheel(agentToken);
        if (!spin || !spin.success) { console.error(`[InviteWheel][VU${__VU}] 第${round}轮点礼物盒失败`); continue; }
        sleep(5);
        clickSpinningTurntable(agentToken);
        if (!marked) { emitPart(agentPhone); marked = true; } // 本人参与一次即计入 participants

        // 2) 拿最新邀请码
        const share = clickShareLink(agentToken);
        if (!share || !share.success || !share.inviteCode) { console.error(`[InviteWheel][VU${__VU}] 第${round}轮拿邀请码失败`); continue; }
        const wheelCode = share.inviteCode.slice(0, -1) + 'W';

        // 3) 邀请 SUBS 个下级：注册 + 充1000 + 50%参与
        for (let s = 0; s < SUBS; s++) {
            const sub = registerWithRetry('sub', wheelCode, ctx);
            if (!sub) continue;
            emitAll(sub.phone);
            hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: RECHARGE_AMOUNT, frontendFirst: true, remark: `InviteWheelSub-D${DAY}` });
            if (Math.random() < SUB_PARTICIPATE_RATE) {
                if (participateWheel(sub.token)) emitPart(sub.phone);
            }
            sleep(1);
        }

        // 4) 本轮下级充值后，转盘金额累积 → 满足就提现（每轮一次）
        sleep(3);
        tryWithdraw(agentToken);
    }
}

// ================= D1：造数 =================

function runDay1(ctx) {
    const agent = registerWithRetry('agent', null, ctx);
    if (!agent) { console.error(`[InviteWheel][D1][VU${__VU}] 总代注册失败`); return; }
    emitAll(agent.phone);
    console.log(`[InviteWheel][D1][VU${__VU}] 总代 ${agent.phone} 注册成功，开始 ${ROUNDS} 轮邀请转盘`);

    runWheelRounds(agent.token, agent.phone, ctx); // 每轮：参与转盘 + 邀请 SUBS 下级 + 提现
}

// ================= D2/D3：读账号 → 行为分层 + 30% 参与 =================

function runDayN(myAccounts, ctx) {
    if (myAccounts.length === 0) return;
    const accounts = shuffle(myAccounts);
    const n = accounts.length;
    const n70 = Math.floor(n * 0.70);
    const n90 = n70 + Math.floor(n * 0.20);
    const n95 = n90 + Math.floor(n * 0.05);
    // [0,n70) 充投 | [n70,n90) 只充 | [n90,n95) 只登录 | [n95,n) 不登录
    const partSet = new Set(shuffle(accounts).slice(0, Math.floor(n * 0.30))); // 独立 30% 参与转盘

    console.log(`[InviteWheel][D${DAY}][VU${__VU}] 本片 ${n} 人：充投${n70} 只充${n90 - n70} 只登录${n95 - n90} 不登录${n - n95}，参与转盘${partSet.size}`);

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const behavior = i < n70 ? 'both' : i < n90 ? 'recharge' : i < n95 ? 'login' : 'skip';
        if (behavior === 'skip') continue; // 5% 不登录：不写 all

        const token = loginWithPassword(account, 'qwer1234'); // 登录=留存
        if (!token) { sleep(1); continue; }
        const info = getFrontUserInfo(token);
        const userId = info && info.userId;

        if ((behavior === 'both' || behavior === 'recharge') && userId) {
            hybridRecharge({ userToken: token, adminToken: ctx.adminData.token, userId, amount: RECHARGE_AMOUNT, frontendFirst: true, remark: `InviteWheelD${DAY}` });
        }
        if (behavior === 'both') { sleep(1); betFixed(token, BET_UNIT, BET_MULTIPLE, account); }

        if (partSet.has(account)) {
            runWheelRounds(token, account, ctx); // 额外参与转盘：每轮 参与 + 邀请 SUBS 下级 + 提现
        }

        emitAll(account); // 登录成功（非不登录）→ 写当天 all，供下一天
        sleep(1);
    }
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[InviteWheel] ========== 邀请转盘留存造数 DAY=${DAY} 租户=${TENANT_ID} ==========`);
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[InviteWheel] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[InviteWheel] ✅ 管理员登录成功`);

    ensureWheelConfig(adminToken); // 确保活动开启
    console.log(`[InviteWheel] DAY=${DAY} | ${DAY === 1 ? `总代 ${AGENTS} × 每轮 ${SUBS} 下级 × ${ROUNDS} 轮` : `上一天账号 ${PREV_ACCOUNTS.length} 人，${RUN_VUS} VU 分片`}`);
    if (!__ENV.VIA_RUNNER) console.warn(`[InviteWheel] ⚠️ 直接 k6 run 不会写 txt（沙箱限制），请用：node inviteWheelRunner.js --day ${DAY} --tenant ${TENANT_ID}`);

    return { token: adminToken, envConfig };
}

export default function (data) {
    const { token: adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    const ctx = { countryCode, adminData, customUrls };

    // VU 启动错峰，缓解注册写库限流
    if (VU_GAP > 0 && __VU > 1) sleep((__VU - 1) * VU_GAP);

    if (DAY === 1) {
        runDay1(ctx);
    } else {
        const myAccounts = PREV_ACCOUNTS.filter((_, i) => i % RUN_VUS === (__VU - 1));
        runDayN(myAccounts, ctx);
    }
}
