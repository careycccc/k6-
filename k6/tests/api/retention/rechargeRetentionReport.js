/**
 * 复充查询报表（留存分析）—— 独立脚本
 *
 * 传入一个日期 D，统计（自然日按租户 COUNTRY_CODE 时区）：
 *   ── 按「注册日 = D」──
 *     当日注册首充   = D 日注册 且 人生首充(firstRechargeTime)也在 D 日
 *     当日注册未首充 = D 日注册 且 从未充值(firstRechargeTime=0)
 *   ── 按「首充日 = D」（留存基准群体 = 当日首充；所有复充率分母都是它）──
 *     当日首充   = D 日发生人生首充的玩家（注册日不限）
 *     当日复充   = 当日首充群体里 D 日充值 ≥2 次的      → %/当日首充
 *     当日无复充 = 当日首充 − 当日复充
 *     N日复充    = 当日首充群体里 D+(N-1) 那天也充值的  → %/当日首充
 *                  次日=D+1、3日=D+2、…、15日=D+14；D+(N-1) 超过今天则显示 --
 *
 * 首充判定：逐个调 /api/Users/GetUserDetail 取 userDepositWithdrawInfo.firstRechargeTime（准确）。
 *
 * 运行（推荐用 Node runner，多天并发 + 按天统一打印）：
 *   node retentionRunner.js --date 2026-09-05 --tenant 3004
 *   （REPORT_DATE 到租户时区"今天"之间的每一天各起 1 个 VU 并发查询，
 *    每个 VU 把当天结果 base64 编码成 ##RETRPT## 行输出，runner 收集后按天依次打印）
 *
 * 也可直接跑（单天看数据即可；多天会日志交错、不汇总）：
 *   k6 run -e TENANT_ID=3004 -e REPORT_DATE=2026-09-07 rechargeRetentionReport.js
 *
 * 参数：
 *   TENANT_ID         租户ID（默认 3004）
 *   REPORT_DATE       统计起始日 D0，YYYY-MM-DD（必需）；到"今天"之间每天各出一份报表
 *   EXCLUDE_MANUAL=1  排除人工充值(ManualRecharge)；默认都算
 *   DEBUG_UIDS        逗号分隔 userId，打印其判定明细
 *   MAX_REG           注册数保护上限（默认 3000）
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';
import { getTzOffset } from './rechargeRetentionApi.js';
import encoding from 'k6/encoding';

const TAG = 'RetentionReport';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const REPORT_DATE = __ENV.REPORT_DATE;
const DEBUG_UIDS = (__ENV.DEBUG_UIDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number); // 打印这些 userId 的 D 日订单明细，定位复充判定分歧
const EXCLUDE_MANUAL = __ENV.EXCLUDE_MANUAL === '1'; // 默认都算(人工+前台充值)；=1 才排除人工充值(ManualRecharge)以匹配后台口径

// N日复充的档位（截图列）：N → 偏移天数 D+(N-1)
const N_DAY_COLUMNS = [
    { label: '次日复充', n: 2, field: 'nextDayRechargeUserCount' },
    { label: '3日复充', n: 3, field: 'isretention3' },
    { label: '4日复充', n: 4, field: 'isretention4' },
    { label: '5日复充', n: 5, field: 'isretention5' },
    { label: '6日复充', n: 6, field: 'isretention6' },
    { label: '7日复充', n: 7, field: 'isretention7' },
    { label: '10日复充', n: 10, field: 'isretention10' },
    { label: '15日复充', n: 15, field: 'isretention15' }
];

// 从 REPORT_DATE 到租户时区"今天"的日期列表（含两端）；每天分配 1 个 VU 并发查询
function buildDayList(start, end) {
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
    const list = [];
    let cur = start, guard = 0;
    while (cur <= end && guard < 400) { list.push(cur); cur = addDays(cur, 1); guard++; }
    return list.length ? list : [start];
}
const _tzInit = getTzOffset(TENANT_ID);
const TODAY = todayStr(_tzInit);
const DAY_LIST = buildDayList(REPORT_DATE, TODAY);
const DAY_COUNT = Math.max(1, DAY_LIST.length);

export const options = {
    scenarios: {
        retention_report: {
            executor: 'per-vu-iterations',
            vus: DAY_COUNT,      // 每天一个 VU，并发查询
            iterations: 1,       // 每个 VU 只跑 1 次（负责它那一天）
            maxDuration: '90m'
        }
    }
};

// ================= 日期/时区工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

/** 指定日期字符串在租户时区下的自然日 [00:00:00, 23:59:59.999] 的 UTC 毫秒范围 */
function dayRangeByDate(dateStr, tzOffsetHours) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const tzMs = tzOffsetHours * 3600 * 1000;
    const localMidnight = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
    const startTime = localMidnight - tzMs;
    const endTime = startTime + 86400000 - 1;
    return { startTime, endTime };
}

/** 日期字符串 + n 天 → 新日期字符串 */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 租户时区下的“今天” YYYY-MM-DD */
function todayStr(tzOffsetHours) {
    const nowLocal = new Date(Date.now() + tzOffsetHours * 3600 * 1000);
    return `${nowLocal.getUTCFullYear()}-${pad2(nowLocal.getUTCMonth() + 1)}-${pad2(nowLocal.getUTCDate())}`;
}

/** dateStr <= today ? */
function notFuture(dateStr, today) {
    return dateStr <= today; // YYYY-MM-DD 字符串可直接比较
}

// ================= 数据拉取 =================

function extractList(res) {
    if (!res) return [];
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.list)) return res.list;
    return [];
}
function extractTotalPage(res) {
    if (!res) return 1;
    if (res.totalPage) return res.totalPage;
    if (res.data && res.data.totalPage) return res.data.totalPage;
    return 1;
}

/** 查某时间范围内所有 Payed 充值订单（全站、不限渠道，dateType=1 按成功时间，翻页 + orderNo 去重） */
function fetchPayedOrders(adminToken, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const byOrderNo = {};
    let pageNo = 1;
    while (true) {
        const payload = { rechargeState: 'Payed', startTime, endTime, pageNo, pageSize: 2000, dateType: 1, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, adminToken);
        const list = extractList(res);
        for (const o of list) { if (o.orderNo) byOrderNo[o.orderNo] = o; }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return Object.values(byOrderNo);
}

/** 查某时间范围内注册的玩家 userId（Users/GetPageList 按注册时间，翻页） */
function fetchRegisteredUserIds(adminToken, startTime, endTime) {
    const api = '/api/Users/GetPageList';
    const set = {};
    let pageNo = 1;
    while (true) {
        // 后台按注册时间查会员：registerBeginTime / registerEndTime（毫秒）
        const payload = { registerBeginTime: startTime, registerEndTime: endTime, pageNo, pageSize: 2000, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, adminToken);
        const list = extractList(res);
        for (const u of list) { if (u.userId != null) set[Number(u.userId)] = true; }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return Object.keys(set).map(Number);
}

/** userId → 首充时间(firstRechargeTime, 毫秒)；未充值返回 0 */
function getFirstRechargeTime(adminToken, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, adminToken);
    const d = (res && res.userDepositWithdrawInfo) ? res : (res && res.data ? res.data : null);
    if (!d || !d.userDepositWithdrawInfo) return 0;
    return Number(d.userDepositWithdrawInfo.firstRechargeTime) || 0;
}

/** 拉取后台复充留存报表（GetUserRptFirstRechargeRetentionPageList），返回 list[0] 或 null */
function fetchBackendReport(adminToken, dateStr) {
    const api = '/api/RptDataAnalysis/GetUserRptFirstRechargeRetentionPageList';
    const payload = { startTime: dateStr, endTime: dateStr, pageNo: 1, pageSize: 20, orderBy: 'Desc' };
    const res = sendRequest(payload, api, TAG, false, adminToken);
    const list = extractList(res);
    return (list && list.length) ? list[0] : null;
}

// ================= 聚合 =================

/** 是否计入复充（默认都算：人工+前台；-e EXCLUDE_MANUAL=1 才排除人工充值 ManualRecharge 以匹配后台口径） */
function isRealRecharge(o) {
    return !EXCLUDE_MANUAL || o.rechargeType !== 'ManualRecharge';
}

/** 订单按 userId 计数 → { userId: count } */
function countByUser(orders) {
    const map = {};
    for (const o of orders) {
        const uid = Number(o.userId);
        map[uid] = (map[uid] || 0) + 1;
    }
    return map;
}

/** 订单 → 充值过的 userId 集合(Set) */
function userSet(orders) {
    const s = new Set();
    for (const o of orders) s.add(Number(o.userId));
    return s;
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[${TAG}] ========== 复充查询报表 REPORT_DATE=${REPORT_DATE} 租户=${TENANT_ID} ==========`);

    if (!REPORT_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(REPORT_DATE)) {
        throw new Error(`[${TAG}] ❌ 必须提供 -e REPORT_DATE=YYYY-MM-DD`);
    }

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);
    console.log(`[${TAG}] 多天并发：${DAY_LIST.join(', ')}（共 ${DAY_COUNT} 天，${DAY_COUNT} 个 VU 并发；起始 ${REPORT_DATE} → 今天 ${TODAY}）`);
    if (__ENV.VIA_RUNNER !== '1') {
        console.warn(`[${TAG}] ⚠️ 直接用 k6 run 多天时日志会交错、不会按天汇总；建议改用：node retentionRunner.js --date ${REPORT_DATE} --tenant ${TENANT_ID}`);
    }

    return { token: adminToken, envConfig };
}

export default function (data) {
    const { token: adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const tzOffset = getTzOffset(TENANT_ID);
    // 每个 VU 负责一天（并发查询）：VU1→DAY_LIST[0]、VU2→DAY_LIST[1]…
    const _list = DAY_LIST.length ? DAY_LIST : [REPORT_DATE];
    const D = _list[(__VU - 1) % _list.length];
    const today = TODAY;
    const dRange = dayRangeByDate(D, tzOffset);

    console.log(`[${TAG}] [VU${__VU}/${_list.length}] 统计日 D=${D} | 今天=${today} | 时区 ${tzOffset}h`);

    // 1. D 日充值订单 + D 日注册玩家
    console.log(`[${TAG}] 拉取 D 日充值订单...`);
    const dOrders = fetchPayedOrders(adminToken, dRange.startTime, dRange.endTime);
    const dCount = countByUser(dOrders);
    const dPayers = Object.keys(dCount).map(Number);
    console.log(`[${TAG}] D 日充值玩家 ${dPayers.length} 人（订单 ${dOrders.length} 笔）`);

    // DEBUG：打印指定 userId 的 D 日订单明细（定位当日复充判定分歧）
    if (DEBUG_UIDS.length) {
        for (const uid of DEBUG_UIDS) {
            const os = dOrders.filter(o => Number(o.userId) === uid).sort((a, b) => Number(a.createTime) - Number(b.createTime));
            console.log(`[DEBUG] userId=${uid} D日订单 ${os.length} 笔 (脚本计数=${dCount[uid] || 0}):`);
            os.forEach(o => console.log(`  orderNo=${o.orderNo} amount=${o.amount} state=${o.rechargeState} rechargeType=${o.rechargeType} rechargeCount=${o.rechargeCount} create=${new Date(Number(o.createTime)).toISOString()} success=${o.rechargeSuccessTime ? new Date(Number(o.rechargeSuccessTime)).toISOString() : '-'}`));
        }
    }

    console.log(`[${TAG}] 拉取 D 日注册玩家...`);
    const regUserIds = fetchRegisteredUserIds(adminToken, dRange.startTime, dRange.endTime);
    console.log(`[${TAG}] D 日注册玩家 ${regUserIds.length} 人`);

    // 保护：注册数异常偏多说明 Users/GetPageList 的注册时间过滤没生效（返回了全量玩家），
    // 立即中止，避免对全量玩家逐个 GetUserDetail 空跑几小时
    const SANE_MAX = parseInt(__ENV.MAX_REG || '3000', 10);
    if (regUserIds.length > SANE_MAX) {
        throw new Error(`[${TAG}] ❌ D日注册玩家 ${regUserIds.length} 人异常偏多（疑似返回全量）——Users/GetPageList 的注册时间过滤参数未生效。请把后台「按注册日期查会员」的 payload 发我修正；确需继续可 -e MAX_REG=99999 跳过（会很慢）。`);
    }

    // 2. 候选玩家（D日充值 ∪ D日注册）逐个查首充时间
    const candidates = Array.from(new Set([].concat(dPayers, regUserIds)));
    console.log(`[${TAG}] 逐个查询 ${candidates.length} 个玩家的首充时间(GetUserDetail)...`);
    const firstRt = {}; // userId → firstRechargeTime
    for (let i = 0; i < candidates.length; i++) {
        firstRt[candidates[i]] = getFirstRechargeTime(adminToken, candidates[i]);
        if ((i + 1) % 20 === 0) console.log(`[${TAG}]   ...已查 ${i + 1}/${candidates.length}`);
        sleep(0.2);
    }

    const isFirstInD = (uid) => {
        const t = firstRt[uid] || 0;
        return t >= dRange.startTime && t <= dRange.endTime;
    };

    // 3. 按注册日 D 的指标
    const regFirst = regUserIds.filter(uid => isFirstInD(uid));            // 当日注册首充
    const regNoFirst = regUserIds.filter(uid => (firstRt[uid] || 0) === 0); // 当日注册未首充

    // 4. 当日首充群体（留存基准）= D 日充值玩家里首充在 D 日的
    const firstPayers = dPayers.filter(uid => isFirstInD(uid));
    const firstPayerSet = new Set(firstPayers);
    const denom = firstPayers.length; // 所有复充率分母

    // 5. 当日复充 = 「当日首充」群体(firstPayers)里 当日充值≥2次
    //    口径：不限注册日，只要人生首充发生在 D 日、且 D 日当天充值≥2笔即算复充；
    //    昨天/更早注册但今天才首充的老会员同样计入（复充只看首充日，不看注册日）。
    //    无复充 = 当日首充(firstPayers)里的非复充者（今天首充但只充1笔）
    const dRealCount = countByUser(dOrders.filter(isRealRecharge));
    const sameDayRepay = firstPayers.filter(uid => (dRealCount[uid] || 0) >= 2);
    const sameDayRepaySet = new Set(sameDayRepay);
    const sameDayNoRepayIds = firstPayers.filter(uid => !sameDayRepaySet.has(uid));

    // DEBUG：打印指定 userId 的完整复充判定（排查归属）
    if (DEBUG_UIDS.length) {
        const regSet = new Set(regUserIds);
        for (const uid of DEBUG_UIDS) {
            console.log(`[DEBUG判定] userId=${uid}: 当日注册=${regSet.has(uid)} | 首充时间=${firstRt[uid] ? new Date(firstRt[uid]).toISOString() : '0(未充)'} | 首充在D日=${isFirstInD(uid)} | 当日充值笔数=${dRealCount[uid] || 0} | 当日首充(firstPayers)=${firstPayerSet.has(uid)} | 判为复充=${sameDayRepaySet.has(uid)}`);
        }
    }

    // 6. N 日复充 = 当日首充群体里，D+(N-1) 那天也充值的（保留会员id用于对比）
    const nDayResults = [];
    for (const col of N_DAY_COLUMNS) {
        const targetDate = addDays(D, col.n - 1);
        if (!notFuture(targetDate, today)) {
            nDayResults.push({ label: col.label, date: targetDate, field: col.field, ids: null }); // 未到 → --
            continue;
        }
        const tRange = dayRangeByDate(targetDate, tzOffset);
        console.log(`[${TAG}] 拉取 ${col.label}(${targetDate}) 充值订单...`);
        const tOrders = fetchPayedOrders(adminToken, tRange.startTime, tRange.endTime);
        const tSet = userSet(tOrders.filter(isRealRecharge));
        const ids = firstPayers.filter(uid => tSet.has(uid));
        nDayResults.push({ label: col.label, date: targetDate, field: col.field, ids });
        sleep(0.3);
    }

    // 7. 与后台报表对比 + 汇总为结构化结果（呈现交给 runner，按天统一打印）
    console.log(`[${TAG}] [${D}] 拉取后台报表对比...`);
    const backend = fetchBackendReport(adminToken, D);
    const cmpData = { regFirst, regNoFirst, firstPayers, sameDayRepay, sameDayNoRepayIds, denom, nDayResults };
    const result = {
        date: D, today, tenant: TENANT_ID, vu: __VU,
        counts: {
            regFirst: regFirst.length,
            regNoFirst: regNoFirst.length,
            firstPay: denom,
            sameDayRepay: sameDayRepay.length,
            sameDayNoRepay: sameDayNoRepayIds.length,
            denom
        },
        nDay: nDayResults.map(nd => ({
            label: nd.label, date: nd.date, field: nd.field,
            count: nd.ids === null ? null : nd.ids.length,
            reached: nd.ids !== null
        })),
        backendMissing: !backend,
        compare: buildCompare(backend, cmpData)
    };
    // base64 编码后输出：避免 k6 日志 msg="…" 把 JSON 里的引号转义，runner 解码即可
    console.log(`##RETRPT## ${encoding.b64encode(JSON.stringify(result))}`);
    console.log(`[${TAG}] [${D}] ✅ 完成`);
}

// ================= 与后台报表对比（产出结构化数据，呈现交给 runner） =================

/**
 * 逐指标对比脚本值 vs 后台值，返回数组供 runner 打印。
 * 每项：{ name, script(数量), backend(数量|null), match, diff, ids(不一致时=脚本算出的id升序) }
 * 复充率项额外带 isRate:true，script/backend 为 4 位小数比率。
 */
function buildCompare(backend, s) {
    const out = [];
    if (!backend) return out; // 无后台数据 → 空数组，runner 显示"未取到后台数据"
    const cmp = (name, ids, backendVal) => {
        const n = ids.length;
        const bv = (backendVal === undefined || backendVal === null) ? null : Number(backendVal);
        const match = bv !== null && n === bv;
        out.push({
            name, script: n, backend: bv, match,
            diff: bv === null ? null : (n - bv),
            ids: match ? null : ids.slice().sort((a, b) => a - b)
        });
    };
    cmp('当日注册首充', s.regFirst, backend.dayRegisterRechargeUserCount);
    cmp('当日注册未首充', s.regNoFirst, backend.dayRegisterNoRechargeUserCount);
    cmp('当日首充', s.firstPayers, backend.dayFirstRechargeUserCount);
    cmp('当日复充', s.sameDayRepay, backend.dayReRechargeUserCount);
    cmp('当日无复充', s.sameDayNoRepayIds, backend.dayNoReRechargeUserCount);

    const scriptRate = s.denom ? (s.sameDayRepay.length / s.denom) : 0;
    const backendRate = Number(backend.dayReRechargeRate) || 0;
    out.push({
        name: '当日复充率', isRate: true,
        script: Number(scriptRate.toFixed(4)), backend: Number(backendRate.toFixed(4)),
        match: Math.abs(scriptRate - backendRate) < 0.001
    });

    for (const nd of s.nDayResults) {
        if (nd.ids === null) continue; // 未到的天不比
        const bv = backend[nd.field];
        if (bv === undefined || bv === null || Number(bv) === -1) continue;
        cmp(nd.label, nd.ids, bv);
    }
    return out;
}
