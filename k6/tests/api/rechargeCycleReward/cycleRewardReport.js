/**
 * 充值循环奖励 —— 活动报表验证（按会员查后台真实数据 → 与报表接口逐字段对比）
 *
 * 报表接口：/api/RechargeCycleReward/GetReportPageList {startRewardDate, endRewardDate, pageNo, pageSize}
 *   list = 每个奖励日期一行；sumTotal = 总计（只比总计，不比 sumPage 页面总计）。
 *   接口不返回今天，也不返回获奖 0 人的日期 → 奖励日期最多验到昨天。
 *
 * 期望值一律从活动记录表出发、按会员逐个查后台真实数据（不用造数脚本的计划值）。对每个奖励日期 D：
 *   获奖会员        活动记录表 GetRecordPageList(rewardDate=D)，按会员去重
 *   活动充值金额    每人 D−1 的成功订单实际到账之和（GetRechargeOrderPageList userId + Payed + 按成功时间）
 *   当日登录        每人 D 的登录日志（GetUserLoginLogPageList memberIdType=1 + memberId）
 *   免费 / 付费领取 记录 freeState=1 / paidState=2，彩金取记录上的 freeReward / paidReward
 *   付费达成        每人 D 当天、资格生成(createTime)之后的成功订单：累计模式累计 ≥ 要求，单笔模式某笔 ≥ 要求
 *   付费金额        只算付费达成的会员，取「为完成付费条件产生的充值」：累计模式按到账先后累加到刚达标为止，
 *                   单笔模式取第一笔达标的那一笔（达标后再充的不算）；累计模式会与记录上的付费进度核对
 *   充值达标未领取  活动记录表按 freeState=2(免费已过期) 和 paidState=3(付费已过期) 各查一次，按会员去重计数；
 *                   付费已过期里只算充值进度满足的（paidProgressAmount ≥ 付费要求），进度没满足是没资格领、不算没领
 *   次日/3日/7日留存 和平台原有留存报表一致（retentionVerify.js 同口径）：D 领过任一奖励的会员中，
 *                   第 N 天（D+1 / D+2 / D+6）有登录日志的人数，中间几天不管。留存率分母 = 总领取人数
 *                   连续留存（中间每天都领奖 + 第 N 天登录）作参考一并打印，不参与对比
 *                   目标日 = 今天 → 接口给的是实时数，照样比并标注；目标日 > 今天 → 未到（接口为 null）
 *   比率            四舍五入保留 2 位小数（百分数）；分母为 0 → null（页面展示 --）
 *   总计            活动充值金额 / 总发放彩金 / 免费领取彩金 / 付费金额 / 付费领取彩金 求和，彩金占充值比例用汇总值重算；其余为空
 *   参考值（不参与对比，方便提 bug）：付费要求之和、达成会员当天全部充值、全部获奖会员当天充值
 *   只验报表功能上线日（默认 2026-10-08，-e SINCE 可改）之后的奖励日期，之前的历史数据不验
 *   未领取会员名单  对应页面「下载未领取会员名单」，只打印不对比：上面「充值达标未领取」那批会员，
 *                   逐个标出免费 / 付费哪项没领（过期 = 当天没领），附带付费充值进度
 *
 * 运行（推荐 Node runner：美化打印 + 存 JSON 快照）：
 *   node cycleReportRunner.js --tenant 3004                          # 默认验昨天（PRD 默认查询前一日）
 *   node cycleReportRunner.js --start 2026-10-05 --end 2026-10-08    # 奖励日期范围（超过昨天的截到昨天）
 *   node cycleReportRunner.js --days 8                               # 昨天往前共 8 个奖励日期
 *   node cycleReportRunner.js --start 2026-10-05 --end 2026-10-09 --tenant 3004
 *
 * 参数（-e）：TENANT_ID（默认 3004） / START_DATE / END_DATE / DAYS / SINCE（功能上线日，默认 2026-10-08）
 *            / MAX_SCAN（单次翻页保护上限，默认 200 页）
 */

import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';
import { extractList, fetchAllPages, getTzOffset } from '../../../libs/common/index.js';

const TAG = 'CycleReportVerify';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const START_DATE = __ENV.START_DATE || '';
const END_DATE = __ENV.END_DATE || START_DATE;
const DAYS = parseInt(__ENV.DAYS || '0', 10);
const FEATURE_START = __ENV.SINCE || '2026-10-08';   // 活动报表功能上线日，之前的历史数据不验
const MAX_SCAN_PAGES = parseInt(__ENV.MAX_SCAN || '200', 10);
const PAGE_SIZE = 100;
const TOL = 0.01;

// 留存档：奖励日期 = 第 1 日
const RETENTION = [
    { key: 'retention1', name: '次日', offset: 1 },
    { key: 'retention3', name: '3日', offset: 2 },
    { key: 'retention7', name: '7日', offset: 6 }
];

// 金额类总计字段（PRD 第五节：求和）；彩金占充值比例用汇总值重算；其余字段总计应为空
const SUM_FIELDS = ['activityRechargeAmount', 'totalBonusAmount', 'freeReceiveAmount', 'paidRechargeAmount', 'paidReceiveAmount'];

export const options = {
    scenarios: {
        cycle_reward_report_verify: {
            executor: 'per-vu-iterations',
            vus: 1,          // 单 VU 串行（后台查询并发会软降级返空）
            iterations: 1,
            maxDuration: '120m'
        }
    }
};

// ================= 日期 / 数值工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function dateRangeList(start, end) {
    const list = [];
    let cur = start, guard = 0;
    while (cur <= end && guard < 400) { list.push(cur); cur = addDays(cur, 1); guard++; }
    return list;
}

/** 租户时区下某自然日的 UTC 毫秒范围 */
function dayRange(dateStr, tzMs) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const startTime = Date.UTC(y, m - 1, d) - tzMs;
    return { startTime, endTime: startTime + 86400000 - 1 };
}

function todayStr(tzMs) {
    const t = new Date(Date.now() + tzMs);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function money(x) { return Math.round((Number(x) || 0) * 100) / 100; }

/** 百分比：四舍五入 2 位；分母为 0 → null */
function rate(n, d) { return d > 0 ? Math.round(n * 10000 / d + 1e-7) / 100 : null; }

function orderAmt(o) { return Number(o.actualAmount != null ? o.actualAmount : o.amount) || 0; }
function orderTime(o) { return Number(o.rechargeSuccessTime || o.lastUpdateTime || o.createTime) || 0; }

// ================= 后台查询（单 VU 串行；取不到列表的重试，仍失败记入 queryErrors） =================

const queryErrors = [];

/** 发一页查询，响应里没有 list 就重试；3 次都失败返回 null 并记录 */
function queryPage(token, api, payload) {
    for (let i = 0; i < 3; i++) {
        const res = sendRequest(payload, api, TAG, false, token);
        if (res && (Array.isArray(res.list) || (res.data && Array.isArray(res.data.list)))) return res;
        sleep(1 + i);
    }
    queryErrors.push(`${api} ${JSON.stringify(payload).slice(0, 160)}`);
    return null;
}

/** 某奖励日期的活动记录（extra 可带 freeState / paidState 筛选） */
function fetchRecords(token, date, extra) {
    return fetchAllPages(p => queryPage(token, '/api/RechargeCycleReward/GetRecordPageList',
        { ...(extra || {}), startRewardDate: date, endRewardDate: date, pageNo: p, pageSize: PAGE_SIZE, orderBy: 'Desc' }),
    { maxPages: MAX_SCAN_PAGES, pause: 0.3 });
}

const claimerMemo = {};
/** 某奖励日期在活动记录表里领过奖（免费已领取 或 付费已领取）的会员集合；连续留存判断中间几天用 */
function claimersOn(token, date) {
    if (claimerMemo[date]) return claimerMemo[date];
    const set = new Set(fetchRecords(token, date)
        .filter(r => Number(r.freeState) === 1 || Number(r.paidState) === 2)
        .map(r => Number(r.userId)));
    claimerMemo[date] = set;
    return set;
}

const orderMemo = {};
/** 某会员某自然日的成功订单（按成功时间，去重，时间升序） */
function memberOrders(token, uid, date, tzMs) {
    const key = `${uid}|${date}`;
    if (orderMemo[key]) return orderMemo[key];
    const { startTime, endTime } = dayRange(date, tzMs);
    const list = fetchAllPages(p => queryPage(token, '/api/RechargeOrder/GetRechargeOrderPageList',
        { userId: uid, rechargeState: 'Payed', startTime, endTime, pageNo: p, pageSize: PAGE_SIZE, dateType: 1, orderBy: 'Desc' }),
    { maxPages: 20, pause: 0.2 });
    const seen = {};
    const out = [];
    for (const o of list) {
        if (Number(o.userId) !== uid || (o.orderNo && seen[o.orderNo])) continue;
        if (o.orderNo) seen[o.orderNo] = true;
        out.push(o);
    }
    out.sort((a, b) => orderTime(a) - orderTime(b));
    orderMemo[key] = out;
    return out;
}

const loginMemo = {};
/** 某会员某自然日是否有登录记录（登录日志按 memberId 精确查，时间用站点日期字符串） */
function memberLogged(token, uid, date) {
    const key = `${uid}|${date}`;
    if (loginMemo[key] !== undefined) return loginMemo[key];
    const res = queryPage(token, '/api/RptUserInfo/GetUserLoginLogPageList',
        { memberIdType: 1, memberId: uid, startTime: `${date} 00:00:00`, endTime: `${date} 23:59:59`, pageNo: 1, pageSize: 10, orderBy: 'Desc' });
    const hit = extractList(res).some(x => Number(x.userId) === uid && (!x.loginDate || x.loginDate === date));
    loginMemo[key] = hit;
    return hit;
}

/** 报表接口：全部页的 list + 总计 sumTotal */
function fetchReport(token, start, end) {
    let sumTotal = null;
    const list = fetchAllPages(p => queryPage(token, '/api/RechargeCycleReward/GetReportPageList',
        { startRewardDate: start, endRewardDate: end, pageNo: p, pageSize: 20 }),
    { maxPages: 50, pause: 0.3, onPage: res => { const d = res.sumTotal ? res : res.data; if (d && d.sumTotal) sumTotal = d.sumTotal; } });
    const byDate = {};
    list.forEach(r => { byDate[r.rewardDate] = r; });
    return { byDate, sumTotal };
}

// ================= 单个奖励日期：按会员算期望值 =================

function computeDay(D, ctx) {
    const { token, tzMs, today } = ctx;
    const prevDate = addDays(D, -1);
    const dRange = dayRange(D, tzMs);

    const recs = fetchRecords(token, D);
    const byUser = {};
    const dupUsers = [];
    for (const r of recs) {
        const uid = Number(r.userId);
        if (byUser[uid]) {
            dupUsers.push(uid);
            if (Number(r.createTime) < Number(byUser[uid].createTime)) continue;
        }
        byUser[uid] = r;
    }
    const uids = Object.keys(byUser).map(Number).sort((a, b) => a - b);
    const winners = uids.length;
    if (!winners) return { rewardDate: D, rechargeDate: prevDate, winners: 0 };
    console.log(`[${TAG}] ── 奖励日期 ${D}：获奖 ${winners} 人，逐个查后台...`);

    // 充值达标未领取：活动记录表按过期状态各查一次，按会员去重。
    // 付费「已过期」里混着充值进度没满足的人（没资格领，不算没领）→ 只算进度 ≥ 付费要求的
    const progressMet = r => Number(r.paidProgressAmount) >= (Number(r.paidRechargeRequire) || 0) - TOL;
    const freeExpired = fetchRecords(token, D, { freeState: 2 }).map(r => Number(r.userId));
    const paidExpired = fetchRecords(token, D, { paidState: 3 }).filter(progressMet).map(r => Number(r.userId));
    const unclaimedIds = Array.from(new Set(freeExpired.concat(paidExpired))).sort((a, b) => a - b);

    const members = [];
    const diag = { dupUsers, notFinal: [], prevMismatch: [], receivedOutOfDay: [], claimedNotAchieved: [], preQualifyOrders: [], progressVsOrders: [] };
    for (const uid of uids) {
        const r = byUser[uid];
        const freeState = Number(r.freeState), paidState = Number(r.paidState);
        const require = Number(r.paidRechargeRequire) || 0;
        const cumulative = Number(r.paidUseCumulative) === 1;

        const prev = memberOrders(token, uid, prevDate, tzMs);
        const prevRecharge = prev.reduce((s, o) => s + orderAmt(o), 0);

        const dayAll = memberOrders(token, uid, D, tzMs);
        const after = dayAll.filter(o => orderTime(o) >= (Number(r.createTime) || 0));
        const dayRecharge = after.reduce((s, o) => s + orderAmt(o), 0);
        // 为完成付费条件产生的充值：累计模式=按到账先后累加到刚达标为止；单笔模式=第一笔达标的那一笔
        let condAmount = 0;
        if (cumulative) {
            let cum = 0;
            for (const o of after) { cum += orderAmt(o); if (cum >= require - TOL) { condAmount = cum; break; } }
        } else {
            const hit = after.find(o => orderAmt(o) >= require - TOL);
            condAmount = hit ? orderAmt(hit) : 0;
        }
        const achieved = condAmount > 0;

        const m = {
            userId: uid, freeState, paidState, mode: cumulative ? '累计' : '单笔', require,
            prevRecharge: money(prevRecharge), recordPrevRecharge: money(r.prevDayRechargeAmount),
            dayRecharge: money(dayRecharge), dayOrders: after.map(o => orderAmt(o)), achieved, condAmount: money(condAmount),
            progress: money(r.paidProgressAmount), progressMet: progressMet(r),
            logged: memberLogged(token, uid, D),
            freeClaimed: freeState === 1, paidClaimed: paidState === 2,
            freeReward: money(r.freeReward), paidReward: money(r.paidReward)
        };
        members.push(m);

        if (freeState === 0 || paidState === 0 || paidState === 1) diag.notFinal.push(uid);
        if (Math.abs(prevRecharge - Number(r.prevDayRechargeAmount)) >= TOL) diag.prevMismatch.push(`${uid}(订单${m.prevRecharge}≠记录${m.recordPrevRecharge})`);
        if (m.freeClaimed && !(Number(r.freeReceivedTime) >= dRange.startTime && Number(r.freeReceivedTime) <= dRange.endTime)) diag.receivedOutOfDay.push(`${uid}(免费)`);
        if (m.paidClaimed && !(Number(r.paidReceivedTime) >= dRange.startTime && Number(r.paidReceivedTime) <= dRange.endTime)) diag.receivedOutOfDay.push(`${uid}(付费)`);
        if (m.paidClaimed && !achieved) diag.claimedNotAchieved.push(uid);
        if (m.progressMet !== achieved) diag.progressVsOrders.push(`${uid}(记录进度${m.progress}/${require}${m.progressMet ? '满足' : '未满足'}，订单${m.dayRecharge}${achieved ? '达成' : '未达成'})`);
        else if (achieved && cumulative && Math.abs(m.condAmount - m.progress) >= TOL) diag.progressVsOrders.push(`${uid}(记录进度${m.progress}，订单充到达标为止${m.condAmount})`);
        if (dayAll.length > after.length) diag.preQualifyOrders.push(`${uid}(${dayAll.length - after.length}笔)`);
    }

    const pick = f => members.filter(f).map(m => m.userId);
    const ids = {
        loginCount: pick(m => m.logged),
        totalReceiveCount: pick(m => m.freeClaimed || m.paidClaimed),
        unclaimedCount: unclaimedIds,
        freeReceiveCount: pick(m => m.freeClaimed),
        paidReachCount: pick(m => m.achieved),
        paidReceiveCount: pick(m => m.paidClaimed)
    };
    const sum = (f, list) => money((list || members).reduce((s, m) => s + f(m), 0));
    const claimers = members.filter(m => m.freeClaimed || m.paidClaimed);

    const exp = {
        loginCount: ids.loginCount.length,
        loginRate: rate(ids.loginCount.length, winners),
        winnerCount: winners,
        activityRechargeAmount: sum(m => m.prevRecharge),
        totalBonusAmount: money(sum(m => (m.freeClaimed ? m.freeReward : 0)) + sum(m => (m.paidClaimed ? m.paidReward : 0))),
        totalReceiveCount: claimers.length,
        totalReceiveRate: rate(claimers.length, winners),
        unclaimedCount: unclaimedIds.length,
        bonusRechargeRate: null,
        freeReceiveCount: ids.freeReceiveCount.length,
        freeReceiveRate: rate(ids.freeReceiveCount.length, winners),
        freeReceiveAmount: sum(m => (m.freeClaimed ? m.freeReward : 0)),
        paidReachCount: ids.paidReachCount.length,
        paidReachRate: rate(ids.paidReachCount.length, winners),
        paidRechargeAmount: sum(m => (m.achieved ? m.condAmount : 0)),
        paidReceiveCount: ids.paidReceiveCount.length,
        paidReceiveRate: rate(ids.paidReceiveCount.length, winners),
        paidReceiveAmount: sum(m => (m.paidClaimed ? m.paidReward : 0)),
        paidConvertRate: rate(ids.paidReceiveCount.length, ids.paidReachCount.length)
    };
    exp.bonusRechargeRate = rate(exp.totalBonusAmount, exp.activityRechargeAmount);

    // 留存：领过奖的会员 ∩ 目标日登录
    const retention = {};
    for (const rt of RETENTION) {
        const target = addDays(D, rt.offset);
        if (target > today) {
            exp[`${rt.key}Count`] = null;
            exp[`${rt.key}Rate`] = null;
            retention[rt.key] = { name: rt.name, targetDate: target, state: 'future' };
            continue;
        }
        // 主口径（和平台原有留存报表 / retentionVerify.js 一致）：D 领过奖的会员中，第 N 天有登录的；中间几天不管
        const hit = claimers.filter(m => memberLogged(token, m.userId, target)).map(m => m.userId);
        // 参考（不对比）：连续留存 = D+1 ~ 第 N−1 天每天都在活动记录表里领过奖，且第 N 天登录
        let chain = claimers.map(m => m.userId);
        for (let k = 1; k < rt.offset; k++) {
            const claimed = claimersOn(token, addDays(D, k));
            chain = chain.filter(uid => claimed.has(uid));
        }
        const chainHit = chain.filter(uid => hit.includes(uid));
        exp[`${rt.key}Count`] = hit.length;
        exp[`${rt.key}Rate`] = rate(hit.length, claimers.length);
        ids[`${rt.key}Count`] = hit;
        retention[rt.key] = {
            name: rt.name, targetDate: target, state: target === today ? 'realtime' : 'final',
            chain, chainHit, chainRate: rate(chainHit.length, claimers.length)
        };
    }

    // 未领取会员名单（对应页面「下载未领取会员名单」，只打印不对比）：过期 = 当天没领
    const freeSet = new Set(freeExpired), paidSet = new Set(paidExpired);
    const unclaimedList = unclaimedIds.map(uid => {
        const m = members.find(x => x.userId === uid) || { userId: uid };
        return {
            userId: uid,
            freeUnclaimed: freeSet.has(uid), paidUnclaimed: paidSet.has(uid),
            freeReward: m.freeReward, paidReward: m.paidReward,
            progress: m.progress, progressMet: m.progressMet, require: m.require, mode: m.mode
        };
    });

    const refs = {
        paidRequireSum: sum(m => m.require),
        paidAmountAchieversAllDay: sum(m => (m.achieved ? m.dayRecharge : 0)),
        paidAmountAllWinners: sum(m => m.dayRecharge)
    };

    return { rewardDate: D, rechargeDate: prevDate, winners, expected: exp, ids, retention, refs, diag, unclaimedList, members };
}

// ================= 对比 =================

function sameValue(a, b) {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    return Math.abs(Number(a) - Number(b)) < TOL;
}

/** 逐字段比较 expected 与接口行；返回 [{key, api, exp, ok}] */
function compareFields(exp, apiRow) {
    return Object.keys(exp).map(k => ({ key: k, api: apiRow ? apiRow[k] : undefined, exp: exp[k], ok: !!apiRow && sameValue(exp[k], apiRow[k]) }));
}

function computeTotals(rows) {
    const withData = rows.filter(r => r.winners > 0);
    const exp = {};
    SUM_FIELDS.forEach(k => { exp[k] = money(withData.reduce((s, r) => s + Number(r.expected[k]), 0)); });
    exp.bonusRechargeRate = rate(exp.totalBonusAmount, exp.activityRechargeAmount);
    return exp;
}

// ================= Setup / VU =================

export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);
    return { token, envConfig };
}

export default function (data) {
    const { token, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const tzMs = getTzOffset(TENANT_ID) * 3600000;
    const today = todayStr(tzMs);
    const yesterday = addDays(today, -1);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;

    // 奖励日期范围：DAYS > START/END > 默认昨天；接口不返回今天，最多验到昨天
    let start, end, capped = false;
    if (DAYS > 0) { start = addDays(yesterday, -(DAYS - 1)); end = yesterday; }
    else if (START_DATE) {
        if (!dateRe.test(START_DATE) || !dateRe.test(END_DATE)) throw new Error(`[${TAG}] ❌ START_DATE/END_DATE 格式应为 YYYY-MM-DD`);
        start = START_DATE;
        end = END_DATE;
        if (end > yesterday) { end = yesterday; capped = true; }
    } else { start = yesterday; end = yesterday; }
    const clippedStart = start < FEATURE_START;
    if (clippedStart) start = FEATURE_START;

    const meta = { tenant: TENANT_ID, today, yesterday, tzOffsetHours: tzMs / 3600000, start, end, capped, featureStart: FEATURE_START, clippedStart };
    if (start > end) {
        meta.error = `奖励日期范围 ${start}~${end} 无效（报表功能 ${FEATURE_START} 上线，之前不验；接口不返回今天，最多验到昨天 ${yesterday}）`;
        console.log(`##CRPT_META## ${encoding.b64encode(JSON.stringify(meta))}`);
        return;
    }

    console.log(`[${TAG}] ========== 活动报表验证 奖励日期 ${start} ~ ${end}  租户=${TENANT_ID}  今天=${today} ==========`);
    const api = fetchReport(token, start, end);
    console.log(`[${TAG}] 报表接口返回 ${Object.keys(api.byDate).length} 行，总计 ${api.sumTotal ? '有' : '无'}`);

    const ctx = { token, tzMs, today };
    const rows = [];
    // PRD：按奖励日期倒序
    for (const D of dateRangeList(start, end).reverse()) {
        const row = computeDay(D, ctx);
        const apiRow = api.byDate[D] || null;
        row.api = apiRow;
        row.compare = row.winners > 0 ? compareFields(row.expected, apiRow) : [];
        rows.push(row);
        console.log(`##CRPT## ${encoding.b64encode(JSON.stringify(row))}`);
    }
    // 接口返回了、但不在范围内日期列表里的行（理论上不会有）
    meta.apiExtraDates = Object.keys(api.byDate).filter(d => !rows.some(r => r.rewardDate === d));

    // 总计：金额求和 + 比例重算；其余字段应为空
    const totalsExp = computeTotals(rows);
    const st = api.sumTotal;
    meta.totals = {
        apiMissing: !st,
        compare: Object.keys(totalsExp).map(k => ({ key: k, api: st ? st[k] : undefined, exp: totalsExp[k], ok: !!st && sameValue(totalsExp[k], st[k]) })),
        shouldBeNull: st ? Object.keys(st).filter(k => k !== 'rewardDate' && !(k in totalsExp) && st[k] !== null && st[k] !== undefined) : []
    };
    meta.queryErrors = queryErrors;
    console.log(`##CRPT_META## ${encoding.b64encode(JSON.stringify(meta))}`);
}
