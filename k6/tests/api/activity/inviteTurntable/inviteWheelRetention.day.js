/**
 * 邀请转盘 - 每日造数 k6 脚本（配合 inviteWheelRunner.js 使用）
 *
 * ⚠️ 账号状态由 Node 包装器 inviteWheelRunner.js 落盘（k6 沙箱无法写文件）：
 *    - 账号打成标记行走 stdout/stderr：`##ACCT##<完整JSON记录>`
 *    - runner 收集后用 ndjsonStore 按 account 覆盖合并写入 state/accounts_<tenantId>.ndjson
 *    - 本脚本 init 阶段用 open() 读取的是全量累计状态表（不是"上一天"文件，不按天分文件）
 *
 * 一条命令每天跑两件事（默认都做，不是像旧版 DAY1/DAY2 那样二选一）：
 *   ① 新注册 AGENTS 个总代（不传时 1~3 随机），每个走完整流程：开礼物盒→转盘→
 *      拿邀请码→并发邀请 SUBS 个下级（http.batch 并发发送注册请求，失败的用
 *      现状退避重试补足）→下级充值成功后按 FISSION_RATE 概率自己转一次轮盘
 *      （不递归）→满足条件提现。共 ROUNDS 轮。
 *   ② 本地状态里全部 registerDate < today 的老账号（总代和下级一视同仁，不再
 *      像旧版分治成"总代池固定抽30%"+"下级洗牌分段70/20/5/5"）：每个账号独立
 *      按 LOGIN_RATE 概率登录，登录成功的再独立按 REPARTICIPATE_RATE 概率重新
 *      走一遍①同款的完整流程（即该账号变成新一轮的邀请发起人）。
 *
 * 运行（推荐，经 runner）：
 *    node inviteWheelRunner.js --tenant 3004 --agents 2 --subs 3 --rounds 2
 *    node inviteWheelRunner.js --tenant 3004                      # agents 不传则 1~3 随机
 *    node inviteWheelRunner.js --tenant 3004 --skip-register      # 只做老账号留存检查
 *    node inviteWheelRunner.js --tenant 3004 --skip-retention     # 只做新总代造数
 *
 * 参数（-e，由 runner 组装）：
 *    TENANT_ID / AGENTS(可选，不传随机1~3) / SUBS / ROUNDS / RETENTION_VUS / COUNTRY_CODE
 *    LOGIN_RATE / REPARTICIPATE_RATE / FISSION_RATE / SKIP_REGISTER / SKIP_RETENTION / VIA_RUNNER
 */

/* global open */

import http from 'k6/http';
import { sleep } from 'k6';
import { httpClient } from '../../../../libs/http/client.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { getDayRange } from '../../../../libs/common/time.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString, getTimeRandom } from '../../../utils/utils.js';
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
import { extractToken } from '../../../../libs/common/index.js';

// ================= 参数（init 上下文） =================

const TENANT_ID = __ENV.TENANT_ID || '3004';
const AGENTS = __ENV.AGENTS ? parseInt(__ENV.AGENTS, 10) : (1 + Math.floor(Math.random() * 3)); // 不传时 1~3 随机
const SUBS = parseInt(__ENV.SUBS || '3', 10);       // 每轮每总代邀请下级数
const ROUNDS = parseInt(__ENV.ROUNDS || '2', 10);   // 轮数
const RETENTION_VUS = parseInt(__ENV.RETENTION_VUS || '5', 10); // 老账号留存检查并发 VU 数
const VU_GAP = parseFloat(__ENV.VU_GAP || '1');     // VU 启动错峰秒
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);
const SKIP_REGISTER = __ENV.SKIP_REGISTER === '1';
const SKIP_RETENTION = __ENV.SKIP_RETENTION === '1';

const RECHARGE_AMOUNT = 1000;
const BET_UNIT = 20, BET_MULTIPLE = 10; // 投注 200
const LOGIN_RATE = parseFloat(__ENV.LOGIN_RATE || '0.72');
const REPARTICIPATE_RATE = parseFloat(__ENV.REPARTICIPATE_RATE || '0.20');
const FISSION_RATE = parseFloat(__ENV.FISSION_RATE || '0.5'); // 原 SUB_PARTICIPATE_RATE，语义不变：下级只转一次轮盘，不递归

const today = getDayRange(0, TENANT_ID).dateStr;

// init 阶段读全量状态表（累计表，不按天分文件；runner 保证首次运行前文件已存在，哪怕是空文件）
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';
let ALL_RECORDS = [];
try {
    ALL_RECORDS = open(STATE_FILE).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => JSON.parse(line));
} catch (e) {
    console.warn(`[InviteWheel] ⚠️ 状态文件 ${STATE_FILE} 不存在或读取失败，视为首次运行(无老账号)：${e.message}`);
}
const OLD_RECORDS = ALL_RECORDS.filter(r => r.registerDate && r.registerDate < today);

const RUN_RETENTION_VUS = Math.max(1, Math.min(RETENTION_VUS, OLD_RECORDS.length || 1));

export const options = {
    scenarios: {
        ...(SKIP_REGISTER ? {} : {
            new_agents: {
                executor: 'per-vu-iterations',
                vus: Math.max(1, AGENTS),
                iterations: 1,
                exec: 'runNewAgents',
                maxDuration: '180m'
            }
        }),
        ...(SKIP_RETENTION ? {} : {
            old_accounts_retention: {
                executor: 'per-vu-iterations',
                vus: RUN_RETENTION_VUS,
                iterations: 1,
                exec: 'runRetention',
                maxDuration: '180m'
            }
        })
    }
};

// ================= 工具 =================

/** 把一条完整账号记录打成标记行给 runner 落盘；记录须自带读旧值+追加新值后的最终状态 */
function emitAcct(record) { console.log(`##ACCT##${JSON.stringify(record)}`); }

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
 * 并发批量注册 count 个下级：用 k6 原生 http.batch 并发发送 /api/Home/Register
 * 请求（绕开 httpClient.post 的逐个同步封装，手动复刻 phoneRegisterByInvite 的
 * payload 结构——该函数内部没有手动签名，是靠 httpClient.post 的 _signIfNeeded
 * 自动签名；这里要自己调 signData 补上 signature/timestamp 再发送）。
 *
 * 返回成功的下级列表 [{phone, token, userId}]；失败的（包括网络错误、业务失败）
 * 不出现在返回值里，调用方用 registerWithRetry 顺序补足差额，不丢失现状的重试保护。
 */
function registerSubsBatch(count, parentCode, ctx) {
    const { countryCode, customUrls } = ctx;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;
    const api = '/api/Home/Register';
    const baseUrl = customRegisterUrl || ENV_CONFIG.BASE_DESK_URL;
    const fullUrl = baseUrl + api;

    const plans = [];
    for (let i = 0; i < count; i++) {
        const phone = generateRandomPhone(countryCode);
        const timeData = getTimeRandom();
        const deviceId = generateCryptoRandomString(16);
        const browserId = generateCryptoRandomString(32);
        const payload = {
            userName: phone,
            inviteCode: parentCode,
            loginType: 'Mobile',
            turnstileToken: '',
            password: 'qwer1234',
            code: '',
            deviceId: deviceId,
            browserId: browserId,
            language: timeData.language,
            random: timeData.random,
            signature: '',
            timestamp: timeData.timestamp
        };
        // 签名：照抄 facebookRegister.js 的手动签名范式（新建一个 signClient 实例，避免影响全局单例状态）
        const signClient = new httpClient.constructor();
        const signed = signClient.signData(payload);
        payload.signature = signed.signature;
        payload.timestamp = signed.timestamp;
        plans.push({ phone, payload });
    }

    const headers = { ...httpClient.defaultHeaders, Domainurl: baseUrl, Referrer: baseUrl };
    const requests = plans.map(p => ({
        method: 'POST',
        url: fullUrl,
        body: JSON.stringify(p.payload),
        params: { headers }
    }));

    let responses;
    try {
        responses = http.batch(requests);
    } catch (e) {
        console.error(`[InviteWheel][VU${__VU}] 并发批量注册请求失败: ${e.message}`);
        return [];
    }

    const results = [];
    responses.forEach((res, idx) => {
        const phone = plans[idx].phone;
        if (!res || !res.body) return;
        let parsed;
        try {
            parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        } catch (e) {
            console.warn(`[InviteWheel][VU${__VU}] 下级${phone}注册响应解析失败: ${e.message}`);
            return;
        }
        const statusCode = parsed.code !== undefined ? parsed.code : parsed.msgCode;
        if (statusCode !== 0) return;
        const token = parsed.data && parsed.data.token;
        const userId = parsed.data && parsed.data.userId;
        if (token && userId) results.push({ phone, token, userId });
    });
    return results;
}

/**
 * 完整"邀请转盘"轮次：共 ROUNDS 轮，每轮都完整走一遍（照 verifySameDeviceInvite 的 cross_round）：
 *   点礼物盒 + 转盘 → 拿最新邀请码 → 并发邀请 SUBS 个下级(充1000 + FISSION_RATE参与) → 满足就提现。
 * 这样 2 轮 = 2 次转盘 + 2 次提现（修复"两轮只提现一次"）。
 * @param {string} agentToken
 * @param {string} agentPhone
 * @param {object} ctx
 * @param {object} agentRecord - 发起人的完整状态记录(供 emitAcct 写回 participatedDates)
 */
function runWheelRounds(agentToken, agentPhone, ctx, agentRecord) {
    const adminToken = ctx.adminData.token;
    let marked = false;
    for (let round = 1; round <= ROUNDS; round++) {
        // 1) 参与转盘：点礼物盒 + 转盘
        const spin = clickSpinInvitedWheel(agentToken);
        if (!spin || !spin.success) { console.error(`[InviteWheel][VU${__VU}] 第${round}轮点礼物盒失败`); continue; }
        sleep(5);
        clickSpinningTurntable(agentToken);
        if (!marked) {
            marked = true;
            agentRecord.participatedDates = (agentRecord.participatedDates || []).concat([today]);
            emitAcct(agentRecord); // 本人参与一次即记入完整流程参与记录
        }

        // 2) 拿最新邀请码
        const share = clickShareLink(agentToken);
        if (!share || !share.success || !share.inviteCode) { console.error(`[InviteWheel][VU${__VU}] 第${round}轮拿邀请码失败`); continue; }
        const wheelCode = share.inviteCode.slice(0, -1) + 'W';

        // 3) 并发注册 SUBS 个下级，失败的用顺序退避重试补足
        const subs = registerSubsBatch(SUBS, wheelCode, ctx);
        if (subs.length < SUBS) {
            console.warn(`[InviteWheel][VU${__VU}] 第${round}轮并发注册仅成功${subs.length}/${SUBS}个，顺序重试补足`);
            for (let i = subs.length; i < SUBS; i++) {
                const sub = registerWithRetry('sub', wheelCode, ctx);
                if (sub) subs.push(sub);
            }
        }

        // 4) 逐个下级：落状态 + 充1000 + FISSION_RATE 概率裂变参与(只转一次轮盘，不递归)
        for (const sub of subs) {
            const subRecord = { account: sub.phone, password: 'qwer1234', userId: sub.userId, tenantId: TENANT_ID, registerDate: today, role: 'sub' };
            emitAcct(subRecord);
            hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: RECHARGE_AMOUNT, frontendFirst: true, remark: `InviteWheelSub-${today}` });
            if (Math.random() < FISSION_RATE) {
                if (participateWheel(sub.token)) {
                    subRecord.fissionDates = [today];
                    emitAcct(subRecord);
                }
            }
            sleep(1);
        }

        // 5) 本轮下级充值后，转盘金额累积 → 满足就提现（每轮一次）
        sleep(3);
        tryWithdraw(agentToken);
    }
}

// ================= Scenario①：新总代造数 =================

export function runNewAgents(data) {
    const ctx = buildCtx(data);
    // VU 启动错峰，缓解注册写库限流
    if (VU_GAP > 0 && __VU > 1) sleep((__VU - 1) * VU_GAP);

    const agent = registerWithRetry('agent', null, ctx);
    if (!agent) { console.error(`[InviteWheel][NewAgent][VU${__VU}] 总代注册失败`); return; }
    const agentRecord = { account: agent.phone, password: 'qwer1234', userId: agent.userId, tenantId: TENANT_ID, registerDate: today, role: 'agent' };
    emitAcct(agentRecord);
    console.log(`[InviteWheel][NewAgent][VU${__VU}] 总代 ${agent.phone} 注册成功，开始 ${ROUNDS} 轮邀请转盘`);

    runWheelRounds(agent.token, agent.phone, ctx, agentRecord);
}

// ================= Scenario②：老账号留存检查（总代+下级一视同仁） =================

export function runRetention(data) {
    const ctx = buildCtx(data);
    if (VU_GAP > 0 && __VU > 1) sleep((__VU - 1) * VU_GAP);

    const myRecords = OLD_RECORDS.filter((_, i) => i % RUN_RETENTION_VUS === (__VU - 1));
    if (myRecords.length === 0) return;

    console.log(`[InviteWheel][Retention][VU${__VU}] 本片老账号 ${myRecords.length} 个，LOGIN_RATE=${LOGIN_RATE} REPARTICIPATE_RATE=${REPARTICIPATE_RATE}`);

    for (const record of myRecords) {
        if (Math.random() >= LOGIN_RATE) continue; // 未命中登录概率，今天不登录，不 emit(状态不变)

        const token = loginWithPassword(record.account, record.password || 'qwer1234');
        if (!token) { sleep(1); continue; }

        record.loginDates = (record.loginDates || []).concat([today]);
        emitAcct(record); // 登录成功即留存，先写回登录记录

        if (Math.random() < REPARTICIPATE_RATE) {
            // 重新走一遍完整流程：开礼物盒→转盘→拿邀请码→并发邀请新下级→满足就提现
            runWheelRounds(token, record.account, ctx, record);
        } else {
            // 不重新参与时也顺带让投注行为更贴近真实留存用户(照旧版 betFixed 行为，非必需但保留现状习惯)
            const info = getFrontUserInfo(token);
            if (info && info.userId) betFixed(token, BET_UNIT, BET_MULTIPLE, record.account);
        }
        sleep(1);
    }
}

// ================= Setup / 公共上下文 =================

export function setup() {
    console.log(`[InviteWheel] ========== 邀请转盘每日造数 租户=${TENANT_ID} 今日=${today} ==========`);
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[InviteWheel] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log('[InviteWheel] ✅ 管理员登录成功');

    ensureWheelConfig(adminToken); // 确保活动开启
    console.log(`[InviteWheel] ${SKIP_REGISTER ? '(跳过新总代造数)' : `新总代=${AGENTS} × 每轮${SUBS}下级 × ${ROUNDS}轮`} | ${SKIP_RETENTION ? '(跳过老账号留存检查)' : `老账号=${OLD_RECORDS.length}个，${RUN_RETENTION_VUS} VU分片`}`);
    if (!__ENV.VIA_RUNNER) console.warn(`[InviteWheel] ⚠️ 直接 k6 run 不会落盘状态(沙箱限制)，请用：node inviteWheelRunner.js --tenant ${TENANT_ID}`);

    return { token: adminToken, envConfig };
}

function buildCtx(data) {
    const { token: adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    return { countryCode, adminData, customUrls };
}
