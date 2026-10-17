/**
 * 充值循环奖励活动 —— 每日造数据 k6 脚本（配合 cycleRunner.js 使用）
 *
 * 每天的人群一律来自当天（站点日期）的奖励记录表 /api/RechargeCycleReward/GetRecordPageList（全站全部人，记录表最准）：
 *   1. 查今天全部奖励记录 → userId → /api/Users/GetUserAccount 取账号
 *        没有权限(msgCode=2 / No operation permission) → 放弃整个列表（醒目提示）；网络/其他错误 → 只跳过这个人
 *   2. 补新注册：DAY=1 → 传入人数 N 大于列表有效人数 M 时补 N−M 人，否则不补；DAY≥2 → 每天随机补 3~5 人
 *   3. 列表里的人按比例分组（人数 = 全部人数 × 比例，四舍五入）：
 *        10% 完全不登录 / 5% 登录不充值 / 其余登录并充值；
 *        85% 领免费（从已登录的人里抽）；75% 冲付费（从充值的人里抽）；冲付费的人里 60% 领付费
 *   4. 逐人：登录(密码 → 失败改验证码登录 → 再失败跳过) → 领免费 → 充值 → 等 5s → 领付费(失败每 5s 重试，最多 3 次)
 *        充值金额同时决定「今天付费是否满足」和「明天档位」，见 cycleRewardService.planDailyRecharge
 *   5. 新注册的人：今天没有奖励资格，只注册 + 按明天档位充值，不领取
 *
 * 时间保护（站点时区）：00:10 前（奖励记录约 00:05 才生成）或 23:30 后拒绝启动；23:50 后不再处理新的人。
 *
 * 输出（k6 写不了文件，由 cycleRunner.js 从 stderr 收集）：
 *   ##ACCT##<账号>      当天操作过的账号 → dayNN.txt（仅作记录，不再作为第二天的输入）
 *   ##RPT##key=value    汇总统计 → runner 美化打印
 *   ##ACT## <base64>    每人一条操作明细 → runner 存 reports/seed_*.json
 *
 * 正式运行（推荐）：
 *    node cycleRunner.js --day 1 --count 15 --levels 2 --root 7VA3VCN --tenant 3004
 *    node cycleRunner.js --day 2 --tenant 3004
 *
 * 参数（-e，由 cycleRunner.js 组装）：
 *    TENANT_ID / DAY / USER_COUNT(仅 DAY=1) / LEVELS / ROOT_INVITE_CODE / COUNTRY_CODE / USER_GAP / PASSWORD
 *    比例：NO_LOGIN_RATIO(0.10) LOGIN_ONLY_RATIO(0.05) FREE_CLAIM_RATIO(0.85) PAID_RATIO(0.75) PAID_CLAIM_RATIO(0.60)
 *    SUP_MIN / SUP_MAX   DAY≥2 每天补充新注册人数（默认 3~5）
 *    CLAIM_WAIT          充值成功后等几秒再领付费 / 领取失败重试间隔（默认 5）
 *    CLAIM_RETRY         领取失败重试次数（默认 3）
 *    SKIP_TIME_GUARD=1   跳过时间保护（仅调试）
 */

import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { autoLoginByAccount } from '../user/userAccountApi.js';
import { loginWithPassword } from '../recharge/rechargeLevel.service.js';
import { getCycleRewardConfig, getCycleRewardSettings } from './cycleRewardApi.js';
import { assignDailyRoles, buildTierSequence, planDailyRecharge, distributePeople, randomPick, rechargeToTarget } from './cycleRewardService.js';
import { extractToken, fetchAllPages, getTzOffset, randInt } from '../../../libs/common/index.js';

// ================= 参数（init 上下文） =================

const TAG = 'CycleReward';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const DAY = parseInt(__ENV.DAY || '1', 10);
const USER_COUNT = parseInt(__ENV.USER_COUNT || '10', 10);
const LEVELS = parseInt(__ENV.LEVELS || '4', 10);
const ROOT_INVITE_CODE = __ENV.ROOT_INVITE_CODE || 'W5LU89N';
const USER_GAP = __ENV.USER_GAP ? parseFloat(__ENV.USER_GAP) : 2;
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);

const envRatio = (k, d) => (__ENV[k] !== undefined && __ENV[k] !== '' ? parseFloat(__ENV[k]) : d);
const RATIOS = {
    noLogin: envRatio('NO_LOGIN_RATIO', 0.10),
    loginOnly: envRatio('LOGIN_ONLY_RATIO', 0.05),
    freeClaim: envRatio('FREE_CLAIM_RATIO', 0.85),
    paid: envRatio('PAID_RATIO', 0.75),
    paidClaim: envRatio('PAID_CLAIM_RATIO', 0.60)
};
const SUP_MIN = parseInt(__ENV.SUP_MIN || '3', 10);
const SUP_MAX = parseInt(__ENV.SUP_MAX || '5', 10);
const CLAIM_WAIT = parseFloat(__ENV.CLAIM_WAIT || '5');
const CLAIM_RETRY = parseInt(__ENV.CLAIM_RETRY || '3', 10);
const SKIP_TIME_GUARD = __ENV.SKIP_TIME_GUARD === '1';
const DRY_RUN = __ENV.DRY_RUN === '1';     // 演练：只读查询 + 打印计划，不登录/领取/充值/注册

const TOKEN_REFRESH_SEC = 40;              // 前台 token 约 55s 失效：距上次登录超过 40s 再用就先重登
const START_AFTER_MIN = 10;                // 站点 00:10 后才允许启动（奖励记录约 00:05 生成）
const NO_START_AFTER_MIN = 23 * 60 + 30;   // 站点 23:30 后拒绝启动
const STOP_NEW_AFTER_MIN = 23 * 60 + 50;   // 站点 23:50 后不再处理新的人
const FOREST_RATIO = 0.8;                  // 新注册里走根邀请码进森林的占比
const PAGE_SIZE = 500;
const ACCT_PREFIX = '##ACCT##';            // cycleRunner.js 据此提取账号写入 dayNN.txt

const FREE_STATE = { 0: '待领取', 1: '已领取', 2: '已过期' };
const PAID_STATE = { 0: '未达成', 1: '待领取', 2: '已领取', 3: '已过期' };

export const options = {
    scenarios: {
        cycle_reward_seed: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '180m'
        }
    }
};

// ================= 时间 / 金额工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

/** 站点时区的当前日期与分钟数 */
function siteNow(tzMs) {
    const t = new Date(Date.now() + tzMs);
    const h = t.getUTCHours(), m = t.getUTCMinutes();
    return {
        date: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
        minutes: h * 60 + m,
        hhmm: `${pad2(h)}:${pad2(m)}`
    };
}

function dayRange(dateStr, tzMs) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startTime = Date.UTC(y, m - 1, d) - tzMs;
    return { startTime, endTime: startTime + 86400000 - 1 };
}

function orderAmt(o) { return Number(o.actualAmount != null ? o.actualAmount : o.amount) || 0; }
function orderTime(o) { return Number(o.rechargeSuccessTime || o.lastUpdateTime || o.createTime) || 0; }
function tierStr(t) { return t ? `[${t.minAmount}-${t.maxAmount}]` : '无档位'; }

function emitAccount(account) { console.log(`${ACCT_PREFIX}${account}`); }
function emitAction(act) { console.log(`##ACT## ${encoding.b64encode(JSON.stringify(act))}`); }

// ================= 数据拉取 =================

/** 今天全部奖励记录（翻页；同一会员多条保留最新一条） */
function fetchTodayRecords(adminToken, date) {
    const api = '/api/RechargeCycleReward/GetRecordPageList';
    const list = fetchAllPages(pageNo => sendRequest(
        { startRewardDate: date, endRewardDate: date, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc' },
        api, TAG, false, adminToken), { maxPages: 200, pause: 0.3 });
    const byUser = {};
    for (const r of list) {
        const uid = Number(r.userId);
        if (!byUser[uid] || Number(r.createTime) > Number(byUser[uid].createTime)) byUser[uid] = r;
    }
    return Object.values(byUser);
}

/** 今天全站 Payed 订单按 userId 分组（重复跑 / 别人已充的金额要计入付费进度和明天档位） */
function fetchTodayOrdersByUser(adminToken, date, tzMs) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const { startTime, endTime } = dayRange(date, tzMs);
    const list = fetchAllPages(pageNo => sendRequest(
        { rechargeState: 'Payed', startTime, endTime, pageNo, pageSize: PAGE_SIZE, dateType: 1, orderBy: 'Desc' },
        api, TAG, false, adminToken), { maxPages: 200, pause: 0.3 });
    const seen = {}, byUser = {};
    for (const o of list) {
        if (o.orderNo && seen[o.orderNo]) continue;
        if (o.orderNo) seen[o.orderNo] = true;
        (byUser[Number(o.userId)] = byUser[Number(o.userId)] || []).push(o);
    }
    return byUser;
}

/**
 * userId → 账号。区分三种结果：
 *   {account}          成功
 *   {noPermission}     管理员对 GetUserAccount 无权限（msgCode=2 / No operation permission）→ 调用方放弃整个列表
 *   {error}            网络 / 空响应 / 其他错误码 → 调用方只跳过这个人
 */
function fetchAccount(adminToken, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserAccount', TAG, false, adminToken);
    if (typeof res === 'string' && res) return { account: res };
    if (res && typeof res === 'object') {
        const msg = String(res.msg || '');
        if (Number(res.msgCode) === 2 || /permission/i.test(msg)) return { noPermission: true, msg };
        if (typeof res.data === 'string' && res.data) return { account: res.data };
        return { error: `msgCode=${res.msgCode} ${msg}` };
    }
    return { error: '空响应/网络错误' };
}

// ================= 登录 / 领取 =================

/** 密码登录 → 失败改验证码登录（项目现成 autoLoginByAccount，手机号/邮箱都支持）；都失败返回 null */
function loginMember(account, adminToken) {
    const pwd = loginWithPassword(account, PASSWORD);
    if (pwd) return { token: pwd, method: 'password', at: Date.now() };
    console.warn(`[${TAG}] ${account} 密码登录失败，改用验证码登录`);
    const sms = autoLoginByAccount(String(account), adminToken);
    if (typeof sms === 'string' && sms.length > 10) return { token: sms, method: 'sms', at: Date.now() };
    return null;
}

/** token 距上次登录超过 TOKEN_REFRESH_SEC（或 force）就用同一种方式重登 */
function freshToken(sess, account, adminToken, force) {
    if (!force && Date.now() - sess.at < TOKEN_REFRESH_SEC * 1000) return sess.token;
    const t = sess.method === 'password' ? loginWithPassword(account, PASSWORD) : autoLoginByAccount(String(account), adminToken);
    if (typeof t === 'string' && t.length > 10) { sess.token = t; sess.at = Date.now(); }
    return sess.token;
}

/** 领取一次  /api/Activity/ReceiveRechargeCycleReward  rewardType 1=免费 2=付费 */
function claimOnce(token, rewardType) {
    const res = sendRequest({ rewardType }, '/api/Activity/ReceiveRechargeCycleReward', TAG, true, token);
    if (res && typeof res === 'object' && res.rewardAmount !== undefined) return { ok: true, amount: Number(res.rewardAmount) };
    if (res && typeof res === 'object') return { ok: false, msgCode: res.msgCode, msg: res.msg };
    return { ok: false, msgCode: null, msg: '空响应（可能 token 失效）' };
}

/** 领取 + 失败每 CLAIM_WAIT 秒重试，最多 CLAIM_RETRY 次；空响应时强制重登再试 */
function claimWithRetry(sess, account, adminToken, rewardType) {
    let last = null;
    for (let attempt = 0; attempt <= CLAIM_RETRY; attempt++) {
        if (attempt > 0) sleep(CLAIM_WAIT);
        const token = freshToken(sess, account, adminToken, !!last && last.msgCode === null);
        last = claimOnce(token, rewardType);
        if (last.ok) return { ...last, attempts: attempt + 1 };
        console.warn(`[${TAG}] 领取${rewardType === 1 ? '免费' : '付费'}失败(第${attempt + 1}次) ${account}: msgCode=${last.msgCode} ${last.msg}`);
    }
    return { ...last, attempts: CLAIM_RETRY + 1 };
}

// ================= 注册 =================

/**
 * 注册单个用户并补齐 userId/inviteCode（带换号重试）
 * @param {string} kind - 'forest' | 'retail'
 * @returns {{phone, token, userId, inviteCode}|null}
 */
function registerWithRetry(kind, parentCode, ctx) {
    const { countryCode, adminData, customUrls } = ctx;
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
        const phone = generateRandomPhone(countryCode);
        const res = (kind === 'forest')
            ? phoneRegisterByInvite(phone, parentCode, adminData, PASSWORD, '', customUrls)
            : phoneRegister(phone, adminData, PASSWORD, '');

        const token = extractToken(res);
        if (token) {
            const info = getFrontUserInfo(token);
            if (info && info.userId) {
                return { phone, token, userId: info.userId, inviteCode: info.inviteCode || '' };
            }
        }
        sleep(1 + attempt); // 退避后换号重试（缓解限流/重复）
    }
    return null;
}

// ================= 统计 =================

function recordTier(stats, tier, isPayer) {
    if (!tier) { stats.noTierTomorrow++; return; }
    const h = stats.tierHit[tier.id] || (stats.tierHit[tier.id] = { free: 0, paid: 0 });
    if (isPayer) h.paid++; else h.free++;
}

/** 按计划金额充值并记录 */
function doRecharge(adminToken, userToken, userId, plan, isPayer, remark, stats) {
    recordTier(stats, plan.tier, isPayer);
    if (plan.amount <= 0) { stats.rechargeSkip++; return { planned: 0, actual: 0, success: false, tier: tierStr(plan.tier), note: plan.note }; }
    const rr = rechargeToTarget({ adminToken, userToken, userId, amount: plan.amount, remark });
    const ok = rr.successCount > 0;
    if (ok) { stats.rechargeUsers++; stats.totalAmount += rr.totalAmount; } else stats.rechargeFailUsers++;
    return { planned: plan.amount, actual: rr.totalAmount, success: ok, tier: tierStr(plan.tier), note: plan.note };
}

// ================= 列表里的人（今天有奖励资格） =================

/** 列表里的人今天充多少：计入今天已有充值（重复跑 / 别人充的）；演练与正式跑共用 */
function planForMember(m, ctx, stats) {
    const r = m.record;
    const orders = ctx.todayOrders[m.userId] || [];
    const after = orders.filter(o => orderTime(o) >= (Number(r.createTime) || 0));
    const existingToday = orders.reduce((s, o) => s + orderAmt(o), 0);
    const plan = planDailyRecharge({
        tiers: ctx.tiers, plannedTier: m.plannedTier, record: r, isPayer: m.isPayer,
        existingToday,
        progressToday: after.reduce((s, o) => s + orderAmt(o), 0),
        maxSingleToday: after.reduce((mx, o) => Math.max(mx, orderAmt(o)), 0)
    });
    if (existingToday > 0) {
        stats.existingTodayUsers++;
        plan.note = `今天已有充值 ${existingToday}（重复跑或别人充的，已计入）${plan.note ? '；' + plan.note : ''}`;
    }
    if (m.isPayer && !plan.tier && plan.amount > 0) stats.payerNoTier++;
    return plan;
}

function processListMember(m, ctx, stats) {
    const { adminToken } = ctx;
    const r = m.record;
    const act = {
        source: 'list', userId: m.userId, account: m.account, role: m.role,
        claimFreePlanned: m.claimFree, isPayer: m.isPayer, claimPaidPlanned: m.claimPaid,
        todayTier: `[${r.hitTierMin}-${r.hitTierMax}]`, paidRequire: Number(r.paidRechargeRequire),
        paidMode: Number(r.paidUseCumulative) === 1 ? '累计' : '单笔',
        freeStateBefore: FREE_STATE[r.freeState], paidStateBefore: PAID_STATE[r.paidState]
    };
    if (m.role === 'noLogin') { act.result = '按计划不登录'; return act; }

    const sess = loginMember(m.account, adminToken);
    if (!sess) { stats.loginFail++; act.result = '登录失败（密码 + 验证码），跳过'; return act; }
    if (sess.method === 'password') stats.loginPwd++; else stats.loginSms++;
    act.loginMethod = sess.method === 'password' ? '密码' : '验证码';

    const info = getFrontUserInfo(sess.token);
    if (!info || Number(info.userId) !== Number(m.userId)) {
        stats.userMismatch++;
        act.result = `登录后 userId=${info ? info.userId : '取不到'} 与记录 ${m.userId} 不一致，跳过`;
        return act;
    }
    emitAccount(m.account);

    // 1. 领免费
    if (m.claimFree) {
        if (Number(r.freeState) !== 0) {
            stats.freeSkip++;
            act.free = { result: `跳过：已是${FREE_STATE[r.freeState] || r.freeState}` };
        } else {
            const c = claimWithRetry(sess, m.account, adminToken, 1);
            if (c.ok) stats.freeOk++; else stats.freeFail++;
            act.free = c.ok ? { result: '领取成功', amount: c.amount, attempts: c.attempts } : { result: '领取失败', msgCode: c.msgCode, msg: c.msg };
        }
    }
    if (m.role === 'loginOnly') { act.result = '登录不充值'; return act; }

    // 2. 充值（金额同时决定今天付费是否满足 + 明天档位）
    const plan = planForMember(m, ctx, stats);
    if (plan.note) console.warn(`[${TAG}] userId=${m.userId} ${plan.note}`);
    act.recharge = doRecharge(adminToken, freshToken(sess, m.account, adminToken, false), m.userId, plan, m.isPayer, `CycleD${DAY}-List`, stats);

    // 3. 领付费：充值成功后等 CLAIM_WAIT 秒
    if (m.isPayer && m.claimPaid) {
        if (Number(r.paidState) === 2) {
            stats.paidClaimSkip++;
            act.paid = { result: '跳过：已领取' };
        } else if (!act.recharge.success && plan.amount > 0) {
            stats.paidClaimSkip++;
            act.paid = { result: '跳过：充值失败' };
        } else {
            sleep(CLAIM_WAIT);
            const c = claimWithRetry(sess, m.account, adminToken, 2);
            if (c.ok) stats.paidClaimOk++; else stats.paidClaimFail++;
            act.paid = c.ok ? { result: '领取成功', amount: c.amount, attempts: c.attempts } : { result: '领取失败', msgCode: c.msgCode, msg: c.msg };
        }
    }
    act.result = '完成';
    return act;
}

// ================= 新注册的人（今天无奖励资格，只充值落明天档位） =================

function registerNewMembers(newCount, plannedTiers, ctx, stats, timeUp) {
    const { adminToken, tiers, envConfig, countryCode } = ctx;
    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    const regCtx = { countryCode, adminData, customUrls };

    const forestCount = Math.floor(newCount * FOREST_RATIO);
    const levelCounts = distributePeople(forestCount, LEVELS);
    const codesByLevel = Array.from({ length: LEVELS }, () => []);
    const jobs = [];
    levelCounts.forEach((c, lv) => { for (let i = 0; i < c; i++) jobs.push({ kind: 'forest', lv }); });
    for (let i = 0; i < newCount - forestCount; i++) jobs.push({ kind: 'retail', lv: -1 });
    console.log(`[${TAG}] 新注册 ${newCount} 人：森林 ${forestCount}（分层 ${JSON.stringify(levelCounts)}）+ 散户 ${newCount - forestCount}`);

    jobs.forEach((job, i) => {
        const act = { source: 'new', kind: job.kind };
        if (timeUp()) { stats.timeStopped++; act.result = '站点 23:50 后不再处理'; emitAction(act); return; }

        const parentCode = job.kind === 'forest'
            ? (job.lv === 0 ? ROOT_INVITE_CODE : (randomPick(codesByLevel[job.lv - 1]) || ROOT_INVITE_CODE))
            : null;
        const u = registerWithRetry(job.kind, parentCode, regCtx);
        if (!u) { stats.regFail++; act.result = '注册失败'; emitAction(act); return; }
        stats.regSuccess++;
        if (job.kind === 'forest' && u.inviteCode) codesByLevel[job.lv].push(u.inviteCode);
        emitAccount(u.phone);
        Object.assign(act, { userId: u.userId, account: u.phone });

        const plan = planDailyRecharge({ tiers, plannedTier: plannedTiers[i], record: null, isPayer: false });
        act.recharge = doRecharge(adminToken, u.token, u.userId, plan, false, `CycleD${DAY}-New`, stats);
        act.result = '完成';
        emitAction(act);
        sleep(USER_GAP);
    });
}

// ================= 演练（DRY_RUN=1）：只打印计划 =================

function dryRunPlan(members, newTiers, ctx, stats) {
    const { tiers } = ctx;
    console.log(`[${TAG}] 🧪 演练模式：以下为计划，不登录 / 不领取 / 不充值 / 不注册`);
    for (const m of members) {
        const r = m.record;
        const act = {
            source: 'list', userId: m.userId, account: m.account, role: m.role, dryRun: true,
            claimFreePlanned: m.claimFree, isPayer: m.isPayer, claimPaidPlanned: m.claimPaid,
            todayTier: `[${r.hitTierMin}-${r.hitTierMax}]`, paidRequire: Number(r.paidRechargeRequire),
            paidMode: Number(r.paidUseCumulative) === 1 ? '累计' : '单笔',
            freeStateBefore: FREE_STATE[r.freeState], paidStateBefore: PAID_STATE[r.paidState]
        };
        if (m.role === 'recharge') {
            const plan = planForMember(m, ctx, stats);
            recordTier(stats, plan.tier, m.isPayer);
            act.recharge = { planned: plan.amount, plannedTier: tierStr(m.plannedTier), tier: tierStr(plan.tier), note: plan.note };
        }
        const freeSkip = m.claimFree && Number(r.freeState) !== 0 ? `(${FREE_STATE[r.freeState]}，会跳过)` : '';
        const paidSkip = m.claimPaid && Number(r.paidState) === 2 ? '(已领取，会跳过)' : '';
        console.log(`[${TAG}] 🧪 userId=${m.userId} ${m.role}${m.claimFree ? ' 领免费' + freeSkip : ''}${m.isPayer ? ' 冲付费' : ''}${m.claimPaid ? ' 领付费' + paidSkip : ''}` +
            ` 今天档位${act.todayTier} 付费要求${act.paidRequire}(${act.paidMode})` +
            (act.recharge ? ` → 充 ${act.recharge.planned} 明天落${act.recharge.tier}${act.recharge.note ? '（' + act.recharge.note + '）' : ''}` : ''));
        emitAction(act);
    }
    newTiers.forEach((t) => {
        const plan = planDailyRecharge({ tiers, plannedTier: t, record: null, isPayer: false });
        recordTier(stats, plan.tier, false);
        console.log(`[${TAG}] 🧪 新注册 → 充 ${plan.amount} 明天落${tierStr(plan.tier)}`);
        emitAction({ source: 'new', dryRun: true, recharge: { planned: plan.amount, tier: tierStr(plan.tier) } });
    });
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[${TAG}] ========== 充值循环奖励造数据 DAY=${DAY} 租户=${TENANT_ID} ==========`);

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    // 时间保护（站点时区）
    const tzMs = getTzOffset(TENANT_ID) * 3600000;
    const now = siteNow(tzMs);
    if (!SKIP_TIME_GUARD && (now.minutes < START_AFTER_MIN || now.minutes >= NO_START_AFTER_MIN)) {
        throw new Error(`[${TAG}] ❌ 站点时间 ${now.date} ${now.hhmm}：00:10 前（奖励记录约 00:05 才生成）或 23:30 后（跑到一半会过零点）不允许启动`);
    }

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功  站点时间 ${now.date} ${now.hhmm}`);

    // 档位配置（失败在此抛错 → 终止程序）
    const tiers = getCycleRewardConfig({ token: adminToken });
    console.log(`[${TAG}] ✅ 获取到档位配置 ${tiers.length} 档：${tiers.map(t => `${tierStr(t)}付费要求${t.paidRechargeRequire}`).join('  ')}`);

    try {
        const settings = getCycleRewardSettings({ token: adminToken });
        console.log(`[${TAG}] 活动总开关=${settings.switchOn ? '开' : '关'} | 付费采用累计=${settings.paidUseCumulative ? '是(累计)' : '否(单笔)'}（实际以每条奖励记录上的 paidUseCumulative 为准）`);
    } catch (e) { /* 忽略：开关查询失败不影响造数 */ }

    return { token: adminToken, tiers, envConfig };
}

export default function (data) {
    const { token: adminToken, tiers, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const tzMs = getTzOffset(TENANT_ID) * 3600000;
    const today = siteNow(tzMs).date;
    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const timeUp = () => !SKIP_TIME_GUARD && siteNow(tzMs).minutes >= STOP_NEW_AFTER_MIN;

    const stats = {
        siteDate: today, listTotal: 0, listAbandoned: 0, accountOk: 0, accountFail: 0,
        roleNoLogin: 0, roleLoginOnly: 0, roleRecharge: 0,
        loginPwd: 0, loginSms: 0, loginFail: 0, userMismatch: 0,
        freePlanned: 0, freeOk: 0, freeFail: 0, freeSkip: 0,
        payerPlanned: 0, payerNoTier: 0, paidClaimPlanned: 0, paidClaimOk: 0, paidClaimFail: 0, paidClaimSkip: 0,
        newPlanned: 0, regSuccess: 0, regFail: 0,
        rechargeUsers: 0, rechargeFailUsers: 0, rechargeSkip: 0, totalAmount: 0, existingTodayUsers: 0,
        noTierTomorrow: 0, timeStopped: 0, tierHit: {}
    };

    // 1. 今天的奖励记录 → 账号
    const records = fetchTodayRecords(adminToken, today);
    stats.listTotal = records.length;
    console.log(`[${TAG}] 今天(${today}) 奖励记录 ${records.length} 人（全站）`);

    let listMembers = [];
    for (const r of records) {
        const a = fetchAccount(adminToken, Number(r.userId));
        if (a.noPermission) {
            stats.listAbandoned = 1;
            listMembers = [];
            console.error(`[${TAG}] ❗❗ 管理员对 GetUserAccount 没有权限（${a.msg}）→ 放弃整个列表，全部改为新注册`);
            break;
        }
        if (a.error) { stats.accountFail++; console.warn(`[${TAG}] userId=${r.userId} 取账号失败(${a.error})，跳过这个人`); continue; }
        listMembers.push({ userId: Number(r.userId), account: a.account, record: r });
        sleep(0.2);
    }
    stats.accountOk = listMembers.length;

    // 2. 新注册人数
    const newCount = DAY === 1 ? Math.max(0, USER_COUNT - listMembers.length) : randInt(SUP_MIN, SUP_MAX);
    stats.newPlanned = newCount;

    // 3. 分组 + 明天档位（每人每天重新分）
    const members = assignDailyRoles(listMembers, RATIOS);
    const rechargers = members.filter(m => m.role === 'recharge');
    const tierSeq = buildTierSequence(rechargers.length + newCount, tiers);
    rechargers.forEach((m, i) => { m.plannedTier = tierSeq[i]; });
    const newTiers = tierSeq.slice(rechargers.length);

    stats.roleNoLogin = members.filter(m => m.role === 'noLogin').length;
    stats.roleLoginOnly = members.filter(m => m.role === 'loginOnly').length;
    stats.roleRecharge = rechargers.length;
    stats.freePlanned = members.filter(m => m.claimFree).length;
    stats.payerPlanned = members.filter(m => m.isPayer).length;
    stats.paidClaimPlanned = members.filter(m => m.claimPaid).length;

    const estMin = Math.ceil((members.length * 25 + newCount * 15) / 60);
    console.log(`[${TAG}] 列表有效 ${members.length} 人：不登录 ${stats.roleNoLogin} / 登录不充值 ${stats.roleLoginOnly} / 充值 ${stats.roleRecharge}；` +
        `领免费 ${stats.freePlanned}，冲付费 ${stats.payerPlanned}，领付费 ${stats.paidClaimPlanned}；新注册 ${newCount} 人；预计约 ${estMin} 分钟`);

    // 4. 今天已有充值（重复跑 / 别人充的）
    const todayOrders = members.length ? fetchTodayOrdersByUser(adminToken, today, tzMs) : {};

    const ctx = { adminToken, tiers, envConfig, countryCode, todayOrders };
    if (DRY_RUN) {
        dryRunPlan(members, newTiers, ctx, stats);
        emitReportData(stats);
        return;
    }

    // 5. 逐人处理列表里的人（领取有时效，先处理）
    members.forEach((m, i) => {
        if (timeUp()) {
            stats.timeStopped++;
            emitAction({ source: 'list', userId: m.userId, account: m.account, role: m.role, result: '站点 23:50 后不再处理' });
            return;
        }
        console.log(`[${TAG}] ── [${i + 1}/${members.length}] userId=${m.userId} ${m.role}${m.claimFree ? ' 领免费' : ''}${m.isPayer ? ' 冲付费' : ''}${m.claimPaid ? ' 领付费' : ''}`);
        emitAction(processListMember(m, ctx, stats));
        if (m.role !== 'noLogin') sleep(USER_GAP);
    });

    // 6. 新注册
    if (newCount > 0) registerNewMembers(newCount, newTiers, ctx, stats, timeUp);

    emitReportData(stats);

    if (!__ENV.VIA_RUNNER) {
        console.log(`\n⚠️  你是直接用 k6 run 运行的：账号不会写入 day${String(DAY).padStart(2, '0')}.txt，操作明细也不会存 JSON（k6 无法写本地文件）。`);
        console.log(`   请改用 Node 包装器：node cycleRunner.js --day ${DAY}${DAY === 1 ? ` --count ${USER_COUNT} --levels ${LEVELS} --root ${ROOT_INVITE_CODE}` : ''} --tenant ${TENANT_ID}`);
    }
}

// ================= 报表数据输出（k6 只吐 ##RPT## 标记行，由 cycleRunner.js 收集后美化打印） =================
// 原因：k6 日志格式化器会把单条 console.log 里的 \n 转义成字面 "\n" 挤成一行；
//       改由 Node 端(runner)打印，换行正常、无 k6 前缀。

function emitReportData(stats) {
    const kv = { day: DAY, tenant: TENANT_ID };
    Object.keys(stats).forEach(k => { if (k !== 'tierHit') kv[k] = stats[k]; });
    kv.totalAmount = stats.totalAmount.toFixed(2);
    for (const k in kv) console.log(`##RPT##${k}=${kv[k]}`);
    Object.keys(stats.tierHit).sort((a, b) => Number(a) - Number(b)).forEach(id => {
        const h = stats.tierHit[id];
        console.log(`##RPT##tier_${id}=${h.free},${h.paid}`);
    });
}
