/**
 * FB广告分析 Tab2「留存分析」(登录留存 + 复充留存) 核对 —— k6脚本（配合 verifyRetentionRunner.js 使用）
 *
 * 权威数据源：后端 /api/RptFbAd/GetRetentionPageList(被测报表)，期望值全部从"广告归因
 * 记录表" GetAttributionPageList 出发自算，不读本地造数状态——这样存量数据(别人造的、
 * 历史的)也能验，而且人群和后端报表同源(照 k6-go pkg/fbad/population.go 的做法)。
 *
 * 流程：
 *   1) 拉归因记录表(宽范围、翻页取全)：每行有 userId/registerTime/firstRechargeTime/
 *      packageName(渠道)/campaignId/adsetId/adId。
 *   2) 按"租户时区自然日 + campaignId + adsetId + adId"分两种群体：
 *        注册日群体(registerTime 落当天)  → registerCount、登录留存 retentionN 的基准
 *        首充日群体(firstRechargeTime 落当天) → firstRechargeCount、复充留存 reRechargeN 的基准
 *   3) 逐用户查后端真实行为自算期望：
 *        登录：登录日志 GetUserLoginLogPageList(memberId+单日)，按 目标日=基准日+(N-1)
 *        充值：该用户全部 Payed 订单，按 rechargeSuccessTime 分租户时区自然日
 *   4) 拉被测报表行，按四元组逐行比对 + 合计行(sumTotal)比对，输出标记行给 runner。
 *
 * 口径(2026-11-03 用真实报表响应+后端订单反推，15组数据全部吻合；与 retentionVerify.js
 * 7张留存报表的"isretentionN=第N天=D+(N-1)"一致)——统一定义在 fbAdConfig.js：
 *   - 目标日=基准日+(N-1)；到期=目标日<今天；未到期后端应为 null。
 *   - retentionN：基准=注册日群体，分母=registerCount，档位 LOGIN_RETENTION_DAY_MARKS。
 *   - reRecharge1：首充日当天 Payed 订单>=2笔的人(=d0Recharge2Count，不跨天)。
 *   - reRechargeN(N>=2)：首充日+(N-1)当天有 Payed 订单的人，分母=firstRechargeCount。
 *   - registerCount=0 时登录留存为 null；firstRechargeCount=0 时复充留存为 null。
 *
 * 数据起点/止点：只验证基准日(注册日/首充日)落在 [START_DATE, END_DATE] 闭区间内的行——
 * 默认 START_DATE=fbAdConfig.FBAD_DATA_START_DATE(2026-11-03)，END_DATE=今天；可用 -e 覆盖，
 * 和后台 UI「注册时间」筛选框含义一致，想只核对某一天就传 START_DATE=END_DATE=那天。
 * 注意"到期判断"(目标日<今天)永远用真实的今天，不受 END_DATE 影响——END_DATE 只收窄
 * "基准群体落在哪天"，不改变"这个档位到没到期"。归因表仍回溯取全，因为区间前注册、
 * 区间内才首充的会员属于区间内的首充群体。
 *
 * 取数失败直接抛错、不当成"数据为空"(验证脚本宁缺毋滥)；首充用户订单查回0条视为疑似
 * 软降级(后台查询接口偶发 200/msgCode0 但 data 空)，重试后仍0则记警告。全程单线程串行。
 *
 * 用法（在本目录内运行，推荐走 Runner 拿汇总报表）：
 *   node verifyRetentionRunner.js --tenant 3004
 *   k6p -e TENANT_ID=3004 verifyRetention.day.js
 *   k6p -e TENANT_ID=3004 -e START_DATE=2026-11-03 -e END_DATE=2026-11-03 verifyRetention.day.js  # 只看11-03一天
 *   node verifyRetentionRunner.js --tenant 3004 --start-date 2026-11-03 --end-date 2026-11-03     #查看具体的那一天的留存数据+报表
 */

import { sleep } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getDayRange, getTzOffsetMs } from '../../../libs/common/time.js';
import {
    LOGIN_RETENTION_DAY_MARKS, RECHARGE_RETENTION_DAY_MARKS, FBAD_DATA_START_DATE,
    addDays, targetDateOf, isReached
} from './fbAdConfig.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
// 数据起点：只验证报表日期>=起点的行，更早的数据不管(约定见 fbAdConfig.FBAD_DATA_START_DATE)
const START_DATE = __ENV.START_DATE || FBAD_DATA_START_DATE;
// 归因表仍回溯取全：起点前注册、起点后才首充的会员属于起点后的首充群体，不能漏
const LOOKBACK_DAYS = 365;
const RATE_EPS = 0.005 + 1e-9; // 后端率保留两位小数，本地四舍五入到两位后允许半个末位的误差

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '120m' } }
};

// ================= 取数工具 =================

function callApi(token, api, payload, what) {
    let last = null;
    for (let i = 0; i < 3; i++) {
        const r = tenantRequest(api, payload, { token, isDesk: false });
        if (r && r.msgCode === 0 && r.data) return r.data;
        last = r;
        sleep(1);
    }
    throw new Error(`[VerifyRetention] 查询失败 ${what}: msgCode=${last && last.msgCode} msg=${last && last.msg}`);
}

/** 翻页取全，返回 { rows, first(第一页data，里面有 sumTotal 等合计字段) } */
function fetchAllRows(token, api, payload, pageSize, what) {
    const rows = [];
    let first = null;
    for (let pageNo = 1; pageNo <= 500; pageNo++) {
        const d = callApi(token, api, Object.assign({}, payload, { pageNo, pageSize }), `${what} 第${pageNo}页`);
        if (pageNo === 1) first = d;
        const list = d.list || [];
        rows.push(...list);
        if (list.length === 0 || pageNo >= (d.totalPage || 1)) break;
        sleep(0.2);
    }
    return { rows, first };
}

// ================= 自算期望 =================

function groupKey(date, campaignId, adsetId, adId) {
    return `${date}|${campaignId}|${adsetId}|${adId}`;
}

const round2 = x => Math.round(x * 100) / 100;

function cmp(expCount, expRate, actCount, actRate) {
    const actNull = actCount === null || actCount === undefined;
    if (expCount === null) return actNull ? 'MATCH' : 'MISMATCH';
    if (actNull) return 'MISMATCH';
    const rateOk = actRate !== null && actRate !== undefined && Math.abs(round2(expRate) - actRate) <= RATE_EPS;
    return (expCount === actCount && rateOk) ? 'MATCH' : 'MISMATCH';
}

const f = v => (v === null || v === undefined) ? '' : String(v);
// 标记行用 | 分隔，名称里万一带 | 会错位，统一替换掉
const safe = s => String(s === null || s === undefined ? '' : s).replace(/\|/g, '/');

export function setup() {
    const today = getDayRange(0, TENANT_ID).dateStr;
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[VerifyRetention] 租户 ${TENANT_ID} 管理员登录失败`);
    return { today, adminToken };
}

export default function (data) {
    const { today, adminToken } = data;
    const END_DATE = __ENV.END_DATE || today;
    const tzMs = getTzOffsetMs(TENANT_ID);
    const dayOf = ms => new Date(ms + tzMs).toISOString().slice(0, 10);
    const dayStartMs = d => Date.parse(d + 'T00:00:00Z') - tzMs;

    // ---- 1) 归因记录表 ----
    const attrStart = addDays(today, -LOOKBACK_DAYS);
    const attr = fetchAllRows(adminToken, '/api/RptFbAd/GetAttributionPageList', { startTime: attrStart, endTime: today }, 100, '广告归因记录');
    const attrs = attr.rows;
    console.log(`##R## 租户=${TENANT_ID} 今天=${today} 时区偏移=${tzMs / 3600000}h 归因记录=${attrs.length}条`);
    if (attrs.length === 0) {
        console.log('##R## 归因记录表为空，没有可验证的数据');
        return;
    }

    // ---- 2) 分群体 ----
    const regGroups = new Map();   // key -> [userId]   注册日群体
    const firstGroups = new Map(); // key -> [userId]   首充日群体
    const meta = new Map();        // key -> { date, campaignName, adsetName, adName, channels:{} }
    const firstDateOf = new Map(); // userId -> 首充日(仅起点及之后)
    const minDate = START_DATE;
    let skippedOutOfRange = 0;

    function touchMeta(key, date, a) {
        if (!meta.has(key)) meta.set(key, { date, campaignName: a.campaignName, adsetName: a.adsetName, adName: a.adName, channels: {} });
        return meta.get(key);
    }
    for (const a of attrs) {
        const regDate = dayOf(a.registerTime);
        // 注册日群体、首充日群体各自按"报表日期落在[START_DATE,END_DATE]"独立过滤：
        // 同一个人可能注册在区间前、首充在区间内（或反过来）
        const regInRange = regDate >= START_DATE && regDate <= END_DATE;
        if (regInRange) {
            const rk = groupKey(regDate, a.campaignId, a.adsetId, a.adId);
            if (!regGroups.has(rk)) regGroups.set(rk, []);
            regGroups.get(rk).push(a.userId);
            const m = touchMeta(rk, regDate, a);
            m.channels[a.packageName] = (m.channels[a.packageName] || 0) + 1;
        }

        let fDate = null, fInRange = false;
        if (a.firstRechargeTime) {
            fDate = dayOf(a.firstRechargeTime);
            fInRange = fDate >= START_DATE && fDate <= END_DATE;
            if (fInRange) {
                const fk = groupKey(fDate, a.campaignId, a.adsetId, a.adId);
                if (!firstGroups.has(fk)) firstGroups.set(fk, []);
                firstGroups.get(fk).push(a.userId);
                touchMeta(fk, fDate, a);
                firstDateOf.set(a.userId, fDate);
            }
        }
        if (!regInRange && !fInRange) skippedOutOfRange++;
    }
    console.log(`##R## 数据区间=${START_DATE}~${END_DATE}(区间外的数据不参与验证)，归因表里区间外且与区间内无关的记录 ${skippedOutOfRange} 条已忽略；区间内注册日群体=${regGroups.size}组 首充日群体=${firstGroups.size}组`);
    if (regGroups.size === 0 && firstGroups.size === 0) {
        console.log(`##R## 区间 ${START_DATE}~${END_DATE} 内没有任何归因记录，没有可验证的数据`);
        return;
    }

    // ---- 3) 被测报表 ----
    const rep = fetchAllRows(adminToken, '/api/RptFbAd/GetRetentionPageList', { startTime: minDate, endTime: END_DATE }, 100, '留存分析报表');
    const backend = new Map();
    for (const r of rep.rows) backend.set(groupKey(r.reportDate, r.campaignId, r.adsetId, r.adId), r);
    const sumTotal = (rep.first && rep.first.sumTotal) || {};
    console.log(`##R## 报表范围=${minDate}~${END_DATE} 报表行=${rep.rows.length} 注册日群体=${regGroups.size}组 首充日群体=${firstGroups.size}组`);
    const repDates = rep.rows.map(r => r.reportDate).sort();
    console.log(`##R## 报表行日期范围=${repDates.length ? repDates[0] : '无'}~${repDates.length ? repDates[repDates.length - 1] : '无'}`);

    // ---- 4) 逐用户按需查后端行为(带缓存) ----
    const loginMemo = {};
    function loggedIn(uid, date) {
        const k = `${uid}|${date}`;
        if (loginMemo[k] !== undefined) return loginMemo[k];
        const d = callApi(adminToken, '/api/RptUserInfo/GetUserLoginLogPageList',
            { memberIdType: 1, memberId: uid, startTime: `${date} 00:00:00`, endTime: `${date} 23:59:59`, pageNo: 1, pageSize: 10, orderBy: 'Desc' },
            `登录日志 uid=${uid} ${date}`);
        const hit = (d.list || []).some(x => Number(x.userId) === uid && (!x.loginDate || x.loginDate === date));
        loginMemo[k] = hit;
        sleep(0.1);
        return hit;
    }

    const orderMemo = {};
    let softDegradeWarn = 0;
    function ordersByDay(uid) {
        if (orderMemo[uid]) return orderMemo[uid];
        const startMs = dayStartMs(minDate);
        const endMs = dayStartMs(addDays(today, 1)) - 1;
        let byDay = {}, total = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
            const got = fetchAllRows(adminToken, '/api/RechargeOrder/GetRechargeOrderPageList',
                { userId: uid, rechargeState: 'Payed', startTime: startMs, endTime: endMs, dateType: 1, minActualAmount: '', maxActualAmount: '', orderBy: 'Desc' },
                200, `充值订单 uid=${uid}`);
            byDay = {}; total = 0;
            for (const o of got.rows) {
                const ms = o.rechargeSuccessTime || o.createTime;
                const day = dayOf(ms);
                byDay[day] = (byDay[day] || 0) + 1;
                total++;
            }
            // 首充用户必然至少有一笔 Payed 订单；查回0条是后台偶发软降级，重试
            if (total > 0 || !firstDateOf.has(uid)) break;
            sleep(1);
        }
        if (total === 0 && firstDateOf.has(uid)) softDegradeWarn++;
        orderMemo[uid] = byDay;
        sleep(0.1);
        return byDay;
    }

    // ---- 5) 逐行比对 ----
    const allKeys = new Set(Array.from(regGroups.keys()).concat(Array.from(firstGroups.keys()), Array.from(backend.keys())));
    const sortedKeys = Array.from(allKeys).sort();

    // 合计行累计：acc[kind][n] = { hasBase, anyReached, baseReached, countReached }
    // 两点口径：
    //  1) 只累计"后端报表里有这一行"的组——后端缺行单独报告(缺行数/缺行人数)，不能再把合计的
    //     分母污染一遍(实测：缺的那1行有1个注册，含它则登录留存合计率 34.41%，排除后 34.78%=后端)。
    //  2) 合计率的分母=仅"已到期"行的基准人数之和，分子=这些行的人数之和(登录留存基准=注册数，
    //     复充留存基准=首充数)。2026-11-04 用 92/93、73/74 这类分母逐档反推并实证：登录留存
    //     N2/3/5/7/15 与复充留存 N2~7/15 共12个档位的合计率全部吻合；需求文档里没写这条。
    const acc = { LOGIN: {}, RECHARGE: {} };
    LOGIN_RETENTION_DAY_MARKS.forEach(n => { acc.LOGIN[n] = { hasBase: false, anyReached: false, baseReached: 0, countReached: 0 }; });
    RECHARGE_RETENTION_DAY_MARKS.forEach(n => { acc.RECHARGE[n] = { hasBase: false, anyReached: false, baseReached: 0, countReached: 0 }; });
    let expReg = 0, expFirst = 0, missingRows = 0, missingReg = 0, missingFirst = 0;

    function accumulate(kind, n, row, base, reached, count) {
        if (!row || base === 0) return;
        const a = acc[kind][n];
        a.hasBase = true;
        if (reached) { a.anyReached = true; a.baseReached += base; a.countReached += count; }
    }

    for (const key of sortedKeys) {
        const reg = regGroups.get(key) || [];
        const first = firstGroups.get(key) || [];
        const row = backend.get(key);
        const date = key.split('|')[0];
        const mt = meta.get(key) || { campaignName: row && row.campaignName, adsetName: row && row.adsetName, adName: row && row.adName, channels: {} };
        expReg += reg.length;
        expFirst += first.length;
        if (!row && (reg.length + first.length) > 0) { missingRows++; missingReg += reg.length; missingFirst += first.length; }

        const channelInfo = Object.keys(mt.channels).map(c => `${c}:${mt.channels[c]}`).join(',');
        console.log(`##GROUP##${key}|${safe(mt.campaignName)}|${safe(mt.adsetName)}|${safe(mt.adName)}|${reg.length}|${first.length}|${row ? 1 : 0}|${row ? row.registerCount : ''}|${row ? row.firstRechargeCount : ''}|${(reg.length + first.length) > 0 ? 1 : 0}|${channelInfo}`);

        // 登录留存：基准=注册日群体
        for (const n of LOGIN_RETENTION_DAY_MARKS) {
            const reached = isReached(date, n, today);
            const bCount = row ? row[`retention${n}`] : undefined;
            const bRate = row ? row[`retention${n}Rate`] : undefined;
            if (!reached) {
                accumulate('LOGIN', n, row, reg.length, false, 0);
                if (row && bCount !== null && bCount !== undefined) {
                    console.log(`##LOGIN##${key}|${n}|||${f(bCount)}|${f(bRate)}|UNREACHED_HAS_VALUE`);
                }
                continue;
            }
            let expCount = null, expRate = null;
            if (reg.length > 0) {
                const target = targetDateOf(date, n);
                expCount = reg.filter(uid => loggedIn(uid, target)).length;
                expRate = 100 * expCount / reg.length;
            }
            accumulate('LOGIN', n, row, reg.length, true, expCount || 0);
            if (!row) {
                if (reg.length > 0) console.log(`##LOGIN##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|||NO_BACKEND`);
                continue;
            }
            const status = cmp(expCount, expRate, bCount, bRate);
            console.log(`##LOGIN##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|${f(bCount)}|${f(bRate)}|${status}`);
        }

        // 复充留存：基准=首充日群体
        for (const n of RECHARGE_RETENTION_DAY_MARKS) {
            const reached = isReached(date, n, today);
            const bCount = row ? row[`reRecharge${n}`] : undefined;
            const bRate = row ? row[`reRecharge${n}Rate`] : undefined;
            if (!reached) {
                accumulate('RECHARGE', n, row, first.length, false, 0);
                if (row && bCount !== null && bCount !== undefined) {
                    console.log(`##RECHARGE##${key}|${n}|||${f(bCount)}|${f(bRate)}|UNREACHED_HAS_VALUE`);
                }
                continue;
            }
            let expCount = null, expRate = null;
            if (first.length > 0) {
                const target = targetDateOf(date, n);
                expCount = first.filter(uid => {
                    const cnt = ordersByDay(uid)[target] || 0;
                    return n === 1 ? cnt >= 2 : cnt >= 1;
                }).length;
                expRate = 100 * expCount / first.length;
            }
            accumulate('RECHARGE', n, row, first.length, true, expCount || 0);
            if (!row) {
                if (first.length > 0) console.log(`##RECHARGE##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|||NO_BACKEND`);
                continue;
            }
            const status = cmp(expCount, expRate, bCount, bRate);
            console.log(`##RECHARGE##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|${f(bCount)}|${f(bRate)}|${status}`);
        }
    }

    // ---- 6) 合计行(sumTotal) ----
    // 注册数/首充数合计期望包含"后端缺行"的人，差额如实暴露；缺行另输出一行 MISSING(n=缺行数，
    // expCount=缺行注册数之和，bCount=缺行首充数之和)，runner 据此判断差额是否已被缺行解释，
    // 避免同一个根因重复报两次。
    console.log(`##SUM##REG|0|${expReg}||${f(sumTotal.registerCount)}||${expReg === sumTotal.registerCount ? 'MATCH' : 'MISMATCH'}|`);
    console.log(`##SUM##FIRST|0|${expFirst}||${f(sumTotal.firstRechargeCount)}||${expFirst === sumTotal.firstRechargeCount ? 'MATCH' : 'MISMATCH'}|`);
    console.log(`##SUM##MISSING|${missingRows}|${missingReg}||${missingFirst}||INFO|`);

    for (const [kind, prefix, nList] of [['LOGIN', 'retention', LOGIN_RETENTION_DAY_MARKS], ['RECHARGE', 'reRecharge', RECHARGE_RETENTION_DAY_MARKS]]) {
        for (const n of nList) {
            const a = acc[kind][n];
            const bCount = sumTotal[`${prefix}${n}`];
            const bRate = sumTotal[`${prefix}${n}Rate`];
            if (!a.hasBase) continue;
            if (!a.anyReached) {
                // 所有行都没到期：后端合计应为 null
                console.log(`##SUM##${kind}|${n}|||${f(bCount)}|${f(bRate)}|${(bCount === null || bCount === undefined) ? 'MATCH' : 'UNREACHED_HAS_VALUE'}|`);
            } else {
                const expRate = 100 * a.countReached / a.baseReached;
                console.log(`##SUM##${kind}|${n}|${a.countReached}|${round2(expRate).toFixed(2)}|${f(bCount)}|${f(bRate)}|${cmp(a.countReached, expRate, bCount, bRate)}|`);
            }
        }
    }

    if (softDegradeWarn > 0) console.log(`##R## ⚠️ ${softDegradeWarn} 个首充用户订单查回0条(疑似后台软降级，重试后仍为0)，相关复充期望可能偏低`);
    console.log(`##R## 登录日志查询缓存=${Object.keys(loginMemo).length}条 用户订单缓存=${Object.keys(orderMemo).length}人`);
}
