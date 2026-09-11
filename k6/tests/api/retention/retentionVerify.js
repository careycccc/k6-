/**
 * 7 张「留存报表」验证脚本 —— 独立脚本（不改动现有任何逻辑，全部集合运算 + 复用现成查询）
 *
 * 传入注册/报表日范围 [START_DATE, END_DATE] + 租户（默认全站），对范围内每个自然日
 * 自算 7 张后台留存报表并逐字段与后台对比。数据统计不实时：只有某天结束后（第二天）才有
 * 完整数据，故「最新完整日 = 昨天」，脚本自动把 END_DATE 收敛到昨天，今天不参与对比。
 *
 * 留存日偏移（两套接口一致）：isretention2=次日=D+1、isretention3=3日=D+2、…、
 * isretentionN = 第N天 = D+(N-1)。targetDate>昨天 → 未到（后台给 -1，脚本跳过不比）。
 *
 * ── 两套后台接口 / 七张表（差异已收敛为「群体 + 判定动作」）──
 *   A. 新增系列 GetPlatRptRetentionPageList（列：registerDate + 当日新增注册/登录/首充 + isretentionN）
 *      群体统一 = 当日新增注册；判定动作按 retainType 变：
 *        表1 新增活跃留存 retainType=0  第N日「总投注 ≥ 阈值」（阈值=RetentionBetAmount.value1）
 *        表2 新增充值留存 retainType=1  第N日「有成功充值」
 *        表3 新增登录留存 retainType=2  第N日「登录」
 *   B. 行为系列 GetPlatRptBehaviorRetentionPageList（列：reportDate + baseUserCount + isretentionN）
 *      判定动作统一 = 第N日「登录」（回访）；群体按 retainType 变：
 *        表4 登录留存       retainType=1  群体=当日登录用户
 *        表5 投注留存       retainType=2  群体=当日投注用户（有投注即算，不看金额）
 *        表6 首充留存       retainType=3  群体=当日首充用户（人生首充在当日）
 *        表7 老用户付费留存 retainType=4  群体=当日充值用户里注册日≠充值日的（= 充值集 − 当日全部注册集，不限 userType）
 *
 * ── 口径要点（均已与需求方确认）──
 *   · 当日新增登录 = 当日新增注册（注册即登录，后台 dayLoginUserCount==dayAddRegisterUserCount）
 *   · 当日新增首充 = 当日注册用户里 firstRechargeTime 落在当日的（逐个 GetUserDetail 取）
 *   · 充值一律算成功单（Payed），含人工充值（ManualRecharge 也算）
 *   · 投注：表1「活跃」看总投注 betAmount ≥ 阈值；表5「投注用户」只要有投注（≥1 笔）即算
 *   · 老用户付费 = 当日充值用户里注册时间与充值日不在同一天（GetUserDetail 无注册时间字段，改用「充值集 − 当日全部注册集(不限 userType)」等价实现，比只按新增注册 userType[0,2] 更准）
 *   · 默认全站（不传渠道来源 channelPackageId）
 *
 * ── 性能 / 稳定性 ──
 *   平台后台查询接口高并发（http.batch）会软降级返空，故本脚本单 VU 串行、逐页翻页，
 *   对每个相关日期只全站预取一次（登录集/充值集/注册集/投注按人聚合），再纯集合运算。
 *
 * 运行（推荐 Node runner，收集 marker 后按表/按天打印对比）：
 *   node retentionVerifyRunner.js --start 2026-09-07 --end 2026-09-08 --tenant 3004
 * 也可直接跑（日志交错、不汇总；仅调试看数据）：
 *   k6 run -e TENANT_ID=3004 -e START_DATE=2026-09-07 -e END_DATE=2026-09-08 retentionVerify.js
 *
 * 参数：
 *   TENANT_ID    租户ID（默认 3004）
 *   START_DATE   注册/报表日范围起 YYYY-MM-DD（必需）
 *   END_DATE     注册/报表日范围止 YYYY-MM-DD（可选，默认=START_DATE）；会被收敛到「昨天」
 *   MAX_SCAN     单日全站翻页保护上限（默认 200 页 × 500 = 10 万条），防异常空跑
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';
import { getTzOffset } from './rechargeRetentionApi.js';
import encoding from 'k6/encoding';

const TAG = 'RetentionVerify';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const START_DATE = __ENV.START_DATE;
const END_DATE = __ENV.END_DATE || START_DATE;
const MAX_SCAN_PAGES = parseInt(__ENV.MAX_SCAN || '200', 10);
const PAGE_SIZE = 500;

// N 日档位（两套接口同款）：字段名 isretentionN，N → 偏移 D+(N-1)
const N_LIST = [2, 3, 4, 5, 6, 7, 10, 14, 15, 30, 60, 90, 120, 180];

// 七张表配置（差异收敛）：series=接口，retainType，group=群体口径，judge=第N日判定动作
const TABLES = [
    { idx: 1, name: '新增活跃留存', series: 'retention', retainType: 0, group: 'register', judge: 'bet_ge' },
    { idx: 2, name: '新增充值留存', series: 'retention', retainType: 1, group: 'register', judge: 'recharge' },
    { idx: 3, name: '新增登录留存', series: 'retention', retainType: 2, group: 'register', judge: 'login' },
    { idx: 4, name: '登录留存', series: 'behavior', retainType: 1, group: 'login', judge: 'login' },
    { idx: 5, name: '投注留存', series: 'behavior', retainType: 2, group: 'bet', judge: 'login' },
    { idx: 6, name: '首充留存', series: 'behavior', retainType: 3, group: 'firstpay', judge: 'login' },
    { idx: 7, name: '老用户付费留存', series: 'behavior', retainType: 4, group: 'oldpay', judge: 'login' }
];

export const options = {
    scenarios: {
        retention_verify: {
            executor: 'per-vu-iterations',
            vus: 1,          // 单 VU 串行（并发查询会软降级返空）
            iterations: 1,
            maxDuration: '180m'
        }
    }
};

// ================= 日期 / 时区工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

/** 指定日期字符串在租户时区下的自然日 [00:00, 23:59:59.999] 的 UTC 毫秒范围 */
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

/** [start, end] 闭区间的日期字符串列表 */
function dateRangeList(start, end) {
    const list = [];
    let cur = start, guard = 0;
    while (cur <= end && guard < 400) { list.push(cur); cur = addDays(cur, 1); guard++; }
    return list;
}

// ================= 通用响应解包 =================

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

// ================= 全站按天预取（单 VU 串行翻页） =================

/** 某自然日全站「登录用户」userId 集：/api/RptUserInfo/GetUserLoginLogPageList（时间用字符串） */
function fetchLoginUsers(token, dateStr) {
    const api = '/api/RptUserInfo/GetUserLoginLogPageList';
    const set = new Set();
    let pageNo = 1;
    while (pageNo <= MAX_SCAN_PAGES) {
        const payload = {
            memberIdType: 1,
            startTime: `${dateStr} 00:00:00`,
            endTime: `${dateStr} 23:59:59`,
            pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc'
        };
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const it of list) {
            // 只认 loginDate == 当日的记录（保险；正常传单天范围即当日）
            if (it.userId != null && (!it.loginDate || it.loginDate === dateStr)) set.add(Number(it.userId));
        }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return set;
}

/** 第二口径：某自然日「最后登录时间落当日」的用户（交叉验证登录）：GetPageList loginBeginTime/loginEndTime
 *  lastLoginTime 落当日 → 那天肯定登录过（但当日之后又登录的会因 lastLoginTime 被刷新而漏，属下界）。
 *  返回 { all: Set 全部, type02: Set 仅 userType∈[0,2] 正式会员 }（后台登录统计疑似剔除非正式账号） */
function fetchLoginUsersByLastLogin(token, startTime, endTime) {
    const api = '/api/Users/GetPageList';
    const all = new Set(), type02 = new Set();
    let pageNo = 1;
    while (pageNo <= MAX_SCAN_PAGES) {
        const payload = { loginBeginTime: startTime, loginEndTime: endTime, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const u of list) {
            if (u.userId == null) continue;
            const uid = Number(u.userId);
            all.add(uid);
            if (u.userType === 0 || u.userType === 2) type02.add(uid);
        }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return { all, type02 };
}

/** 某自然日全站「成功充值(Payed)用户」userId 集（含人工充值）：GetRechargeOrderPageList，dateType=1 按成功时间 */
function fetchRechargeUsers(token, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const set = new Set();
    let pageNo = 1;
    while (pageNo <= MAX_SCAN_PAGES) {
        const payload = { rechargeState: 'Payed', startTime, endTime, pageNo, pageSize: PAGE_SIZE, dateType: 1, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const o of list) { if (o.userId != null) set.add(Number(o.userId)); }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return set;
}

/** 某自然日全站注册 userId 列表：Users/GetPageList（按注册时间毫秒翻页）
 *  withType=true → userType[0,2]（当日新增注册，表1-3口径）；false → 不限 userType（当日全部注册，表7 老用户排除用） */
function fetchRegisterUsers(token, startTime, endTime, withType) {
    const api = '/api/Users/GetPageList';
    const set = {};
    let pageNo = 1;
    while (pageNo <= MAX_SCAN_PAGES) {
        const payload = { registerBeginTime: startTime, registerEndTime: endTime, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc' };
        if (withType) payload.userType = [0, 2];
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const u of list) { if (u.userId != null) set[Number(u.userId)] = true; }
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return Object.keys(set).map(Number);
}

/**
 * 某自然日全站「投注按人聚合总额」Map(userId → 总投注 betAmount)。
 * GetBetRecordPageList 分 categoryType 0-4 全站翻页（不传 userId），按 userId 累加 betAmount。
 * keys 即当日投注用户集（表5）；betAmount≥阈值 即活跃（表1）。
 */
function fetchBetSumByUser(token, startTime, endTime) {
    const api = '/api/ThirdGame/GetBetRecordPageList';
    const map = new Map();
    for (let type = 0; type < 5; type++) {
        let pageNo = 1;
        while (pageNo <= MAX_SCAN_PAGES) {
            const payload = {
                categoryType: type, queryTimeType: 'BetTime',
                beginTimeUnix: startTime, endTimeUnix: endTime,
                pageNo, pageSize: PAGE_SIZE, sortField: 'BetTime'
            };
            const res = sendRequest(payload, api, TAG, false, token);
            const list = extractList(res);
            for (const b of list) {
                if (b.userId == null) continue;
                const uid = Number(b.userId);
                const amt = parseFloat(b.betAmount) || 0;
                map.set(uid, (map.get(uid) || 0) + amt);
            }
            const totalPage = extractTotalPage(res);
            if (pageNo >= totalPage || list.length === 0) break;
            pageNo++;
            sleep(0.3);
        }
    }
    return map;
}

/** userId → 人生首充时间(firstRechargeTime, 毫秒)；未充值返回 0 */
function getFirstRechargeTime(token, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, token);
    const d = (res && res.userDepositWithdrawInfo) ? res : (res && res.data ? res.data : null);
    if (!d || !d.userDepositWithdrawInfo) return 0;
    return Number(d.userDepositWithdrawInfo.firstRechargeTime) || 0;
}

/** userId → userType（GetUserDetail.usersBaseRsp.userType）；查不到返回 -1 */
function getUserType(token, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, token);
    const d = (res && res.usersBaseRsp) ? res : (res && res.data ? res.data : res);
    const base = d && d.usersBaseRsp ? d.usersBaseRsp : {};
    return (base.userType === undefined || base.userType === null) ? -1 : Number(base.userType);
}

// ================= 后台报表 & 阈值 =================

/** 活跃阈值：/api/RptUserActivity/GetRetentionBetAmountConfig → retentionBetAmount.value1 */
function fetchActiveThreshold(token) {
    const res = sendRequest({}, '/api/RptUserActivity/GetRetentionBetAmountConfig', TAG, false, token);
    const d = (res && res.retentionBetAmount) ? res : (res && res.data ? res.data : null);
    const v = d && d.retentionBetAmount ? d.retentionBetAmount.value1 : undefined;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

/** 新增系列后台报表：GetPlatRptRetentionPageList（时间带时分秒）→ list（按 registerDate） */
function fetchRetentionReport(token, startDate, endDate, retainType) {
    const api = '/api/RptUserActivity/GetPlatRptRetentionPageList';
    const payload = {
        startTime: `${startDate} 00:00:00`, endTime: `${endDate} 23:59:59`,
        retainType, orderBy: 'Desc', pageNo: 1, pageSize: 200
    };
    const res = sendRequest(payload, api, TAG, false, token);
    return extractList(res);
}

/** 行为系列后台报表：GetPlatRptBehaviorRetentionPageList（时间纯日期）→ list（按 reportDate） */
function fetchBehaviorReport(token, startDate, endDate, retainType) {
    const api = '/api/RptUserActivity/GetPlatRptBehaviorRetentionPageList';
    const payload = {
        startTime: startDate, endTime: endDate,
        retainType, orderBy: 'Desc', pageNo: 1, pageSize: 200
    };
    const res = sendRequest(payload, api, TAG, false, token);
    return extractList(res);
}

// ================= Setup =================

export function setup() {
    console.log(`[${TAG}] ========== 留存报表验证 ${START_DATE}~${END_DATE} 租户=${TENANT_ID} ==========`);
    if (!START_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(START_DATE)) {
        throw new Error(`[${TAG}] ❌ 必须提供 -e START_DATE=YYYY-MM-DD`);
    }
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    if (__ENV.VIA_RUNNER !== '1') {
        console.warn(`[${TAG}] ⚠️ 直接 k6 run 日志会交错、不汇总；建议：node retentionVerifyRunner.js --start ${START_DATE} --end ${END_DATE} --tenant ${TENANT_ID}`);
    }
    return { token, envConfig };
}

// ================= VU：预取 + 计算 + 对比 + 输出 =================

export default function (data) {
    const { token, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const tz = getTzOffset(TENANT_ID);
    const today = todayStr(tz);
    const yesterday = addDays(today, -1);

    // 统计不实时：最新完整日 = 昨天；把 END_DATE 收敛到昨天，今天不参与
    const effEnd = END_DATE <= yesterday ? END_DATE : yesterday;
    if (START_DATE > effEnd) {
        console.log(`##RETV_META## ${encoding.b64encode(JSON.stringify({ error: `范围 ${START_DATE}~${END_DATE} 内无「已完整」日期（最新完整日=昨天 ${yesterday}），无可对比数据。`, today, yesterday, tenant: TENANT_ID }))}`);
        return;
    }
    const baseDates = dateRangeList(START_DATE, effEnd); // 每个 D（注册/报表日）

    // 阈值（表1）
    const threshold = fetchActiveThreshold(token);
    console.log(`[${TAG}] 活跃阈值 value1 = ${threshold} | 今天=${today} 最新完整日=${yesterday} | 待算日: ${baseDates.join(', ')}`);

    // ---- 1) 汇总所有「相关日期」：D 日 + 各 targetDate(=D+N-1, ≤昨天) ----
    const targetSet = new Set();
    for (const D of baseDates) {
        for (const n of N_LIST) {
            const t = addDays(D, n - 1);
            if (t <= yesterday) targetSet.add(t);
        }
    }
    const relevantDates = Array.from(new Set([].concat(baseDates, Array.from(targetSet)))).sort();

    // ---- 2) 全站按天预取：登录集 / 充值集 / 投注按人聚合；注册集只对 D 日 ----
    const loginByDate = {};      // date → Set(userId)
    const rechargeByDate = {};   // date → Set(userId)
    const betSumByDate = {};     // date → Map(userId → 总投注)
    const registerByDate = {};    // D → [userId]（userType[0,2]，当日新增注册，表1-3）
    const registerAllByDate = {}; // D → Set(userId)（不限 userType，当日全部注册，表7 老用户排除用）
    const loginLastByDate = {};   // D → { all, type02 }（lastLoginTime 落当日，第二口径，表4 交叉诊断）

    for (const date of relevantDates) {
        const { startTime, endTime } = dayRangeByDate(date, tz);
        console.log(`[${TAG}] 预取 ${date}：登录/充值/投注 ...`);
        loginByDate[date] = fetchLoginUsers(token, date);
        rechargeByDate[date] = fetchRechargeUsers(token, startTime, endTime);
        betSumByDate[date] = fetchBetSumByUser(token, startTime, endTime);
        console.log(`[${TAG}]   ${date} 登录${loginByDate[date].size} 充值${rechargeByDate[date].size} 投注${betSumByDate[date].size}`);
    }
    for (const D of baseDates) {
        const { startTime, endTime } = dayRangeByDate(D, tz);
        registerByDate[D] = fetchRegisterUsers(token, startTime, endTime, true);
        registerAllByDate[D] = new Set(fetchRegisterUsers(token, startTime, endTime, false));
        loginLastByDate[D] = fetchLoginUsersByLastLogin(token, startTime, endTime);
        console.log(`[${TAG}]   ${D} 新增注册(userType0,2)${registerByDate[D].length} · 全部注册${registerAllByDate[D].size} · 末登当日${loginLastByDate[D].all.size}(会员${loginLastByDate[D].type02.size})`);
    }

    // ---- 3) 逐个查 firstRechargeTime（候选=各 D 的 注册集 ∪ 充值集）----
    const firstRt = {};
    const candSet = new Set();
    for (const D of baseDates) {
        for (const uid of registerByDate[D]) candSet.add(uid);
        for (const uid of rechargeByDate[D]) candSet.add(uid);
    }
    const candidates = Array.from(candSet);
    console.log(`[${TAG}] 逐个查首充时间 ${candidates.length} 人 ...`);
    for (let i = 0; i < candidates.length; i++) {
        firstRt[candidates[i]] = getFirstRechargeTime(token, candidates[i]);
        if ((i + 1) % 30 === 0) { console.log(`[${TAG}]   ...首充 ${i + 1}/${candidates.length}`); }
        sleep(0.15);
    }
    const firstInDay = (uid, D) => {
        const t = firstRt[uid] || 0;
        const { startTime, endTime } = dayRangeByDate(D, tz);
        return t >= startTime && t <= endTime;
    };

    // ---- 4) 逐表逐天计算群体+分子+留存，对比后台，输出 marker ----
    for (const T of TABLES) {
        // 后台报表一次拉整段范围
        const backendList = T.series === 'retention'
            ? fetchRetentionReport(token, START_DATE, effEnd, T.retainType)
            : fetchBehaviorReport(token, START_DATE, effEnd, T.retainType);
        const backendByDate = {};
        for (const row of backendList) {
            const key = row.registerDate || row.reportDate;
            if (key) backendByDate[key] = row;
        }

        for (const D of baseDates) {
            // 群体
            let groupSet;
            if (T.group === 'register') groupSet = new Set(registerByDate[D]);
            else if (T.group === 'login') groupSet = loginByDate[D];
            else if (T.group === 'bet') groupSet = new Set(betSumByDate[D].keys());
            else if (T.group === 'firstpay') groupSet = new Set([...rechargeByDate[D]].filter(uid => firstInDay(uid, D)));
            else if (T.group === 'oldpay') groupSet = new Set([...rechargeByDate[D]].filter(uid => !registerAllByDate[D].has(uid)));
            const groupArr = Array.from(groupSet);

            // 前置列
            let base;
            if (T.series === 'retention') {
                const reg = registerByDate[D].length;
                const firstRecharge = registerByDate[D].filter(uid => firstInDay(uid, D)).length;
                base = { reg, login: reg, firstRecharge };
            } else {
                base = { baseUserCount: groupArr.length };
            }

            // N 日留存分子
            const nDay = [];
            for (const n of N_LIST) {
                const t = addDays(D, n - 1);
                const reached = t <= yesterday;
                let count = null, ids = null;
                if (reached) {
                    let hit;
                    if (T.judge === 'login') hit = groupArr.filter(uid => loginByDate[t] && loginByDate[t].has(uid));
                    else if (T.judge === 'recharge') hit = groupArr.filter(uid => rechargeByDate[t] && rechargeByDate[t].has(uid));
                    else if (T.judge === 'bet_ge') hit = groupArr.filter(uid => betSumByDate[t] && (betSumByDate[t].get(uid) || 0) >= threshold);
                    count = hit.length;
                    ids = hit.slice().sort((a, b) => a - b);
                }
                nDay.push({ n, field: `isretention${n}`, targetDate: t, reached, count, ids });
            }

            // 与后台对比
            const backendRow = backendByDate[D] || null;
            const compare = buildCompare(T, base, nDay, backendRow, groupArr.length);

            // 表4 登录留存：登录日志 vs lastLoginTime 两口径交叉诊断（排查 179 vs 后台 153）
            let crossLogin = null;
            if (T.idx === 4 && loginLastByDate[D] && __ENV.DIAG_LOGIN === '1') {
                const ll = loginLastByDate[D];
                // 诊断：对登录日志用户逐个查 userType 数正式会员[0,2]（lastLoginTime 会漏今天又登录的，故直接查最准）
                let memberReal = 0;
                const typeDist = {};
                console.log(`[${TAG}] 表4诊断：对登录日志 ${groupArr.length} 人逐个查 userType ...`);
                for (let k = 0; k < groupArr.length; k++) {
                    const ut = getUserType(token, groupArr[k]);
                    typeDist[ut] = (typeDist[ut] || 0) + 1;
                    if (ut === 0 || ut === 2) memberReal++;
                    if ((k + 1) % 40 === 0) console.log(`[${TAG}]   表4 userType ${k + 1}/${groupArr.length}`);
                    sleep(0.1);
                }
                crossLogin = {
                    logA: groupArr.length,      // 登录日志(GetUserLoginLogPageList) 全部
                    lastAll: ll.all.size,       // lastLoginTime 落当日 全部
                    lastType02: ll.type02.size, // lastLoginTime 落当日 且 userType[0,2]
                    memberReal,                 // 登录日志里 userType[0,2] 正式会员数（逐个查，准确）
                    typeDist                    // 登录日志 userType 分布
                };
            }
            const result = {
                idx: T.idx, name: T.name, series: T.series, retainType: T.retainType,
                date: D, today, yesterday, tenant: TENANT_ID, threshold,
                base, nDay: nDay.map(x => ({ n: x.n, targetDate: x.targetDate, reached: x.reached, count: x.count })),
                backendMissing: !backendRow, compare, crossLogin
            };
            console.log(`##RETV## ${encoding.b64encode(JSON.stringify(result))}`);
        }
    }
    console.log(`[${TAG}] ✅ 全部完成`);
}

// ================= 对比构建（脚本值 vs 后台值） =================

/**
 * 逐字段对比，返回数组供 runner 打印。
 * 每项：{ name, script, backend, match, diff, ids(不一致且有id时=脚本算出的id升序) }
 * Rate 项 isRate:true（后台 Rate 是百分数，脚本自算 count/denom×100 两位小数比，容差 0.05）
 */
function buildCompare(T, base, nDay, backend, denom) {
    const out = [];
    if (!backend) return out; // 后台无该表数据 → 空，runner 显示“未取到后台数据”

    const cmpInt = (name, script, backendVal) => {
        const bv = (backendVal === undefined || backendVal === null) ? null : Number(backendVal);
        const match = bv !== null && Number(script) === bv;
        out.push({ name, script: Number(script), backend: bv, match, diff: bv === null ? null : (Number(script) - bv), ids: null });
    };

    // 前置列
    if (T.series === 'retention') {
        cmpInt('当日新增注册', base.reg, backend.dayAddRegisterUserCount);
        cmpInt('当日新增登录', base.login, backend.dayLoginUserCount);
        cmpInt('当日新增首充', base.firstRecharge, backend.isFirstRecharge);
    } else {
        cmpInt('当日群体(baseUserCount)', base.baseUserCount, backend.baseUserCount);
    }

    // N 日留存（-1/未到 跳过）
    for (const nd of nDay) {
        if (!nd.reached) continue;
        const bv = backend[`isretention${nd.n}`];
        if (bv === undefined || bv === null || Number(bv) === -1) continue;
        const match = Number(nd.count) === Number(bv);
        out.push({
            name: `${nd.n === 2 ? '次日' : nd.n + '日'}留存`,
            script: Number(nd.count), backend: Number(bv), match,
            diff: Number(nd.count) - Number(bv),
            ids: match ? null : (nd.ids || []).slice(0, 200)
        });
        // 留存率对比（后台百分数）
        const brate = backend[`isretention${nd.n}Rate`];
        if (brate !== undefined && brate !== null) {
            const srate = denom ? Number((nd.count / denom * 100).toFixed(2)) : 0;
            out.push({
                name: `${nd.n === 2 ? '次日' : nd.n + '日'}留存率`, isRate: true,
                script: srate, backend: Number(Number(brate).toFixed(2)),
                match: Math.abs(srate - Number(brate)) <= 0.05
            });
        }
    }
    return out;
}
