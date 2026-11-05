/**
 * FB广告分析 Tab3「充值分析」核对 —— k6脚本（配合 verifyRechargeRunner.js 使用）
 *
 * 权威数据源：后端 /api/RptFbAd/GetRechargePageList(被测报表)，期望值从"广告归因记录表"
 * GetAttributionPageList 出发自算，不读本地造数状态——做法和 verifyRetention.day.js(Tab2)
 * 一致，人群/取数工具大量复用它已验证过的写法。
 *
 * 2026-11-05 用一次性只读探测拿到的真实响应 + 真实数字反推验证过的口径(四套人群+窗口完全
 * 不同，混用一套会系统性算错)：
 *
 *   1) 新增付费(newPayUserCount/Amount/Rate/Arppu)：人群=regGroups(当天注册的人,同Tab2)，
 *      窗口=当天。实测 newPayRate = newPayUserCount/registerCount*100(100%/66.67%/50%三行
 *      全部吻合)，newPayArppu = newPayAmount/newPayUserCount(4275/3900/10500吻合)——两个字段
 *      公式已验证，按判定处理，不是只展示。
 *   2) 首充(firstRechargeCount)：人群=firstGroups(首充日=当天的人,同Tab2)，窗口=当天。人数
 *      能判定(直接从归因表算)。firstRechargeRate 也能判定——2026-11-05 用k6-go独立交叉验证过
 *      (5个campaign逐一精确吻合)：真实分母 = UnpaidBeforeCount(该campaign组合里，注册时间<
 *      当天开始 且 "从未首充或首充日>=当天"的历史人数，可从归因表本地算) + 当天注册数(reg.length)。
 *      firstRechargeArppu 仍然只展示不判定(公式未独立验证过)。
 *   2b) 当日ARPPU(dayArppu)：2026-11-05 同样用k6-go交叉验证过能判定——人群不是"当天注册"也
 *      不是"当天首充"，是**该campaign/adset/ad组合全部历史归因会员**(含从未充值过的)，当天
 *      有充值记录的那部分人，dayArppu=这些人当天充值总额/当天有充值的人数。
 *   3) D0复充档位(d0Recharge{2,3,4,5,10}Count/Rate)：人群=firstGroups(同组2)，窗口=首充当天
 *      (=reportDate自己)，和Tab2的 reRecharge1(=d0Recharge2Count) 同一套查询方式，只是展开
 *      成5个阈值。
 *   4) 累计复充档位(cumRecharge1/{2,3,4,5,10}Count/Rate)：人群=**该campaign/adset/ad组合全部
 *      历史首充会员**(不限哪天首充，不是组2那种"仅reportDate当天"的局部人群！)，窗口=从各自
 *      首充日起到**这一行的reportDate为止**(不是运行脚本那一刻的today)。用真实数据反证过：
 *      11-03~11-05范围 d0Recharge2Count(sumPage)=11，cumRecharge2Count(sumPage)=85，差近8倍，
 *      说明人群是全部历史首充会员的累积，不是当天那一小撮人。
 *
 *   只展示不判定：firstRechargeArppu——公式没有独立验证过，强行判定会制造假异常。
 *
 * 数据起点/止点：[START_DATE, END_DATE] 闭区间语义和 Tab1/Tab2 完全一致——只验证基准日
 * (注册日/首充日/reportDate)落在区间内的行。但"累计复充"的历史会员池不受此区间限制，要用
 * 归因表全量回溯范围(LOOKBACK_DAYS)，否则区间前首充的老会员会被漏掉，累计数算少。
 *
 * 用法（在本目录内运行，推荐走 Runner 拿汇总报表）：
 *   node verifyRechargeRunner.js --tenant 3004
 *   k6p -e TENANT_ID=3004 verifyRecharge.js
 *   k6p -e TENANT_ID=3004 -e START_DATE=2026-11-03 -e END_DATE=2026-11-03 verifyRecharge.js
 *   node verifyRechargeRunner.js --tenant 3004 --start-date 2026-11-03 --end-date 2026-11-03
 */

import { sleep } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getDayRange, getTzOffsetMs } from '../../../libs/common/time.js';
import { RECHARGE_REPEAT_TIER_MARKS, FBAD_DATA_START_DATE, addDays } from './fbAdConfig.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const START_DATE = __ENV.START_DATE || FBAD_DATA_START_DATE;
const LOOKBACK_DAYS = 365; // 归因表/累计复充历史会员池都回溯这么久，不受 START_DATE 限制
const RATE_EPS = 0.005 + 1e-9;
const AMOUNT_EPS = 0.01 + 1e-6; // 金额/ARPPU 两边舍入顺序不同导致的最后一位分歧，留一点余量

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '120m' } }
};

// ================= 取数工具（照抄 verifyRetention.day.js，已验证好用） =================

function callApi(token, api, payload, what) {
    let last = null;
    for (let i = 0; i < 3; i++) {
        const r = tenantRequest(api, payload, { token, isDesk: false });
        if (r && r.msgCode === 0 && r.data) return r.data;
        last = r;
        sleep(1);
    }
    throw new Error(`[VerifyRecharge] 查询失败 ${what}: msgCode=${last && last.msgCode} msg=${last && last.msg}`);
}

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

function groupKey(date, campaignId, adsetId, adId) {
    return `${date}|${campaignId}|${adsetId}|${adId}`;
}
function campKey(campaignId, adsetId, adId) {
    return `${campaignId}|${adsetId}|${adId}`;
}

const round2 = x => Math.round(x * 100) / 100;

function cmp(expCount, expRate, actCount, actRate) {
    const actNull = actCount === null || actCount === undefined;
    if (expCount === null) return actNull ? 'MATCH' : 'MISMATCH';
    if (actNull) return 'MISMATCH';
    const rateOk = expRate === null || (actRate !== null && actRate !== undefined && Math.abs(round2(expRate) - actRate) <= RATE_EPS);
    return (expCount === actCount && rateOk) ? 'MATCH' : 'MISMATCH';
}

const f = v => (v === null || v === undefined) ? '' : String(v);
const safe = s => String(s === null || s === undefined ? '' : s).replace(/\|/g, '/');

export function setup() {
    const today = getDayRange(0, TENANT_ID).dateStr;
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[VerifyRecharge] 租户 ${TENANT_ID} 管理员登录失败`);
    return { today, adminToken };
}

export default function (data) {
    const { today, adminToken } = data;
    const END_DATE = __ENV.END_DATE || today;
    const tzMs = getTzOffsetMs(TENANT_ID);
    const dayOf = ms => new Date(ms + tzMs).toISOString().slice(0, 10);
    const dayStartMs = d => Date.parse(d + 'T00:00:00Z') - tzMs;

    // ---- 1) 归因记录表(全量回溯) ----
    const attrStart = addDays(today, -LOOKBACK_DAYS);
    const attr = fetchAllRows(adminToken, '/api/RptFbAd/GetAttributionPageList', { startTime: attrStart, endTime: today }, 100, '广告归因记录');
    const attrs = attr.rows;
    console.log(`##R## 租户=${TENANT_ID} 今天=${today} 时区偏移=${tzMs / 3600000}h 归因记录=${attrs.length}条`);
    if (attrs.length === 0) {
        console.log('##R## 归因记录表为空，没有可验证的数据');
        return;
    }

    // ---- 2) 分群体 ----
    const regGroups = new Map();     // date|camp|adset|ad(区间内) -> [userId]  注册日群体
    const firstGroups = new Map();   // date|camp|adset|ad(区间内) -> [userId]  首充日群体
    const historyFirst = new Map();  // camp|adset|ad(不含日期,不受区间限制) -> [{userId, fDate}]  累计复充用的全部历史首充会员
    const campAllMembers = new Map(); // camp|adset|ad(不含日期,不受区间限制) -> [{userId,regDate,fDate}] 该组合全部历史归因会员(含从未充值过的)，首充率分母(UnpaidBeforeCount)和当日ARPPU人群要用
    const meta = new Map();
    let skippedOutOfRange = 0;

    function touchMeta(key, date, a) {
        if (!meta.has(key)) meta.set(key, { date, campaignName: a.campaignName, adsetName: a.adsetName, adName: a.adName, channels: {} });
        return meta.get(key);
    }

    for (const a of attrs) {
        const regDate = dayOf(a.registerTime);
        const fDateAll = a.firstRechargeTime ? dayOf(a.firstRechargeTime) : null;
        const ckAll = campKey(a.campaignId, a.adsetId, a.adId);
        if (!campAllMembers.has(ckAll)) campAllMembers.set(ckAll, []);
        campAllMembers.get(ckAll).push({ userId: a.userId, regDate, fDate: fDateAll });

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
            }
            // 累计复充的历史会员池：不受 [START_DATE,END_DATE] 限制，只要有首充时间就记——
            // 否则区间前首充的老会员会被漏掉，cumRecharge 会系统性算少。
            const ck = campKey(a.campaignId, a.adsetId, a.adId);
            if (!historyFirst.has(ck)) historyFirst.set(ck, []);
            historyFirst.get(ck).push({ userId: a.userId, fDate });
        }
        if (!regInRange && !fInRange) skippedOutOfRange++;
    }
    console.log(`##R## 数据区间=${START_DATE}~${END_DATE}(区间外的数据不参与注册/首充判定，但累计复充的历史会员池不受此限制)，区间外且与区间内无关的记录 ${skippedOutOfRange} 条已忽略；区间内注册日群体=${regGroups.size}组 首充日群体=${firstGroups.size}组`);
    if (regGroups.size === 0 && firstGroups.size === 0) {
        console.log(`##R## 区间 ${START_DATE}~${END_DATE} 内没有任何归因记录，没有可验证的数据`);
        return;
    }

    // ---- 3) 被测报表 ----
    const rep = fetchAllRows(adminToken, '/api/RptFbAd/GetRechargePageList', { startTime: START_DATE, endTime: END_DATE }, 100, '充值分析报表');
    const backend = new Map();
    for (const r of rep.rows) backend.set(groupKey(r.reportDate, r.campaignId, r.adsetId, r.adId), r);
    const sumTotal = (rep.first && rep.first.sumTotal) || {};
    console.log(`##R## 报表范围=${START_DATE}~${END_DATE} 报表行=${rep.rows.length} 注册日群体=${regGroups.size}组 首充日群体=${firstGroups.size}组`);

    // ---- 4) 逐用户按需查订单(带缓存，笔数+金额按天分桶) ----
    // 起点必须回溯到 attrStart(覆盖全部历史首充会员可能的首充日)，不能只到 START_DATE，
    // 否则区间前首充、区间内才有累计复充贡献的老会员订单会查漏。
    const orderMemo = {};
    let softDegradeWarn = 0;
    function ordersByDay(uid, isFirstPayer) {
        if (orderMemo[uid]) return orderMemo[uid];
        const startMs = dayStartMs(attrStart);
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
                if (!byDay[day]) byDay[day] = { count: 0, amount: 0 };
                byDay[day].count++;
                byDay[day].amount += Number(o.actualAmount || o.amount || 0);
                total++;
            }
            if (total > 0 || !isFirstPayer) break;
            sleep(1);
        }
        if (total === 0 && isFirstPayer) softDegradeWarn++;
        orderMemo[uid] = byDay;
        sleep(0.1);
        return byDay;
    }

    const dayOrders = (byDay, date) => byDay[date] || { count: 0, amount: 0 };
    /** 从 fromDate(含) 到 toDate(含) 的累计笔数 —— 按已缓存的"有订单那几天"遍历，不逐天循环 */
    function cumCount(byDay, fromDate, toDate) {
        let c = 0;
        for (const d in byDay) { if (d >= fromDate && d <= toDate) c += byDay[d].count; }
        return c;
    }

    // ---- 5) 逐行比对 ----
    const allKeys = new Set(Array.from(regGroups.keys()).concat(Array.from(firstGroups.keys()), Array.from(backend.keys())));
    const sortedKeys = Array.from(allKeys).sort();

    let expReg = 0, expFirst = 0, missingRows = 0, missingReg = 0, missingFirst = 0;
    // 合计累计器：newPay(count/amount)、d0/cum 各阈值的 count 之和 + 分母之和
    const sumAcc = {
        newPayCount: 0, newPayAmount: 0, regBase: 0,
        d0: {}, cum: {}, firstBase: 0, cumBase: 0
    };
    RECHARGE_REPEAT_TIER_MARKS.forEach(n => { sumAcc.d0[n] = 0; sumAcc.cum[n] = 0; });

    for (const key of sortedKeys) {
        const [date, cId, sId, aId] = key.split('|');
        const ck = campKey(cId, sId, aId);
        const campMembers = campAllMembers.get(ck) || [];
        const reg = regGroups.get(key) || [];
        const first = firstGroups.get(key) || [];
        const row = backend.get(key);
        const mt = meta.get(key) || { campaignName: row && row.campaignName, adsetName: row && row.adsetName, adName: row && row.adName, channels: {} };
        expReg += reg.length;
        expFirst += first.length;
        if (!row && (reg.length + first.length) > 0) { missingRows++; missingReg += reg.length; missingFirst += first.length; }

        const channelInfo = Object.keys(mt.channels).map(c => `${c}:${mt.channels[c]}`).join(',');
        console.log(`##GROUP##${key}|${safe(mt.campaignName)}|${safe(mt.adsetName)}|${safe(mt.adName)}|${reg.length}|${first.length}|${row ? 1 : 0}|${row ? row.registerCount : ''}|${row ? row.firstRechargeCount : ''}|${(reg.length + first.length) > 0 ? 1 : 0}|${channelInfo}`);

        // ---- 组1：新增付费(当天注册的人，当天的充值行为) ----
        // 统一用"每个指标一行"(metric|expVal|bVal|status)，别和 D0/CUM 的多字段行混用格式，减少解析出错的机会。
        {
            // 分母(reg.length)为0时，人数/金额明确是0(不是"无法判定")；只有比率/ARPPU这种
            // 除法字段在分母为0时才该是 null——别把两类情况混在一起用同一个 null 表达。
            let expCount = 0, expAmount = 0, expRate = null, expArppu = null;
            if (reg.length > 0) {
                for (const uid of reg) {
                    const o = dayOrders(ordersByDay(uid, false), date);
                    if (o.count > 0) { expCount++; expAmount += o.amount; }
                }
                expRate = 100 * expCount / reg.length;
                expArppu = expCount > 0 ? expAmount / expCount : null;
                sumAcc.newPayCount += expCount; sumAcc.newPayAmount += expAmount; sumAcc.regBase += reg.length;
            }
            const emit = (metric, expVal, bVal, matchFn) => {
                if (!row) {
                    // 没有新注册的人、这一行纯粹因为首充/累计复充才出现时，"新增付费"本来就不适用，不占行
                    if (reg.length > 0) console.log(`##NEWPAY##${key}|${metric}|${f(expVal)}|${f(bVal)}|NO_BACKEND`);
                    return;
                }
                console.log(`##NEWPAY##${key}|${metric}|${f(expVal)}|${f(bVal)}|${matchFn(expVal, bVal) ? 'MATCH' : 'MISMATCH'}`);
            };
            const numEq = (a, b, eps) => (a === null) ? (b === null || b === undefined) : (b !== null && b !== undefined && Math.abs(a - b) <= eps);
            // AMOUNT/ARPPU 的 0.01 误差：两边可能用不同的除法/四舍五入顺序算出 xx.13 vs xx.12 这种
            // 最后一位分歧(浮点精度+舍入顺序，不是真实数据错误)，照 RATE_EPS 的思路多留一点余量。
            emit('COUNT', expCount, row ? row.newPayUserCount : undefined, (a, b) => numEq(a, b, 0));
            emit('AMOUNT', expAmount === null ? null : round2(expAmount), row ? row.newPayAmount : undefined, (a, b) => numEq(a, b, AMOUNT_EPS));
            emit('RATE', expRate === null ? null : round2(expRate), row ? row.newPayRate : undefined, (a, b) => numEq(a, b, RATE_EPS));
            emit('ARPPU', expArppu === null ? null : round2(expArppu), row ? row.newPayArppu : undefined, (a, b) => numEq(a, b, AMOUNT_EPS));
        }

        // ---- 组2：首充人数 + 首充率(新判定) + 当日ARPPU(新判定) ----
        {
            const bFirst = row ? row.firstRechargeCount : undefined;
            if (row) console.log(`##FIRST##${key}|${first.length}|${f(bFirst)}|${first.length === bFirst ? 'MATCH' : 'MISMATCH'}`);
            else if (first.length > 0) console.log(`##FIRST##${key}|${first.length}||NO_BACKEND`);

            // 首充率：真实分母=UnpaidBeforeCount(该组合里，注册<当天开始 且 "从未首充或首充日>=
            // 当天"的历史人数) + 当天注册数。2026-11-05 用k6-go独立交叉验证过，5个campaign逐一吻合。
            const unpaidBefore = campMembers.filter(m => m.regDate < date && (!m.fDate || m.fDate >= date)).length;
            const rateBase = unpaidBefore + reg.length;
            const expFirstRate = rateBase > 0 ? 100 * first.length / rateBase : null;
            const bFirstRate = row ? row.firstRechargeRate : undefined;
            if (row) {
                const rateOk = expFirstRate === null
                    ? (bFirstRate === null || bFirstRate === undefined)
                    : (bFirstRate !== null && bFirstRate !== undefined && Math.abs(round2(expFirstRate) - bFirstRate) <= RATE_EPS);
                console.log(`##FIRSTRATE##${key}|${f(expFirstRate === null ? null : round2(expFirstRate))}|${f(bFirstRate)}|${rateOk ? 'MATCH' : 'MISMATCH'}`);
            }

            // 当日ARPPU：人群=该组合全部历史归因会员(含从未充值过的)，当天有充值记录的那部分人。
            let dayPayCount = 0, dayPayAmount = 0;
            for (const m of campMembers) {
                const o = dayOrders(ordersByDay(m.userId, false), date);
                if (o.count > 0) { dayPayCount++; dayPayAmount += o.amount; }
            }
            const expDayArppu = dayPayCount > 0 ? dayPayAmount / dayPayCount : null;
            const bDayArppu = row ? row.dayArppu : undefined;
            if (row) {
                const ok = expDayArppu === null
                    ? (bDayArppu === null || bDayArppu === undefined)
                    : (bDayArppu !== null && bDayArppu !== undefined && Math.abs(round2(expDayArppu) - bDayArppu) <= AMOUNT_EPS);
                console.log(`##DAYARPPU##${key}|${f(expDayArppu === null ? null : round2(expDayArppu))}|${f(bDayArppu)}|${ok ? 'MATCH' : 'MISMATCH'}`);
            }

            // firstRechargeArppu 公式没有独立验证过，继续只展示不判定
            if (row) console.log(`##REF##${key}|firstRechargeArppu|${f(row.firstRechargeArppu)}`);
        }

        // ---- 组3：D0复充档位(首充日=reportDate当天的订单数) ----
        // 分母(first.length)为0时，人数明确是0(实测后端对这种情况也返回0，不是null)；
        // 比率才是除法字段，分母为0才该是null——和"新增付费"那组同一个坑，别再踩一次。
        for (const n of RECHARGE_REPEAT_TIER_MARKS) {
            let expCount = 0, expRate = null;
            if (first.length > 0) {
                expCount = first.filter(uid => dayOrders(ordersByDay(uid, true), date).count >= n).length;
                expRate = 100 * expCount / first.length;
                sumAcc.d0[n] += expCount; if (n === RECHARGE_REPEAT_TIER_MARKS[0]) sumAcc.firstBase += first.length;
            }
            const bCount = row ? row[`d0Recharge${n}Count`] : undefined;
            const bRate = row ? row[`d0Recharge${n}Rate`] : undefined;
            if (!row) {
                if (first.length > 0) console.log(`##D0##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|||NO_BACKEND`);
                continue;
            }
            const status = cmp(expCount, expRate, bCount, bRate);
            console.log(`##D0##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|${f(bCount)}|${f(bRate)}|${status}`);
        }

        // ---- 组4：累计复充档位(该campaign组合全部历史首充会员，窗口=首充日~reportDate本行日期) ----
        {
            const pool = (historyFirst.get(ck) || []).filter(x => x.fDate && x.fDate <= date);
            const base = pool.length;
            console.log(`##CUMBASE##${key}|${base}|${f(row ? row.cumRecharge1Count : undefined)}|${row && base === row.cumRecharge1Count ? 'MATCH' : (row ? 'MISMATCH' : 'NO_BACKEND')}`);
            if (base > 0) sumAcc.cumBase += base;
            for (const n of RECHARGE_REPEAT_TIER_MARKS) {
                let expCount = 0, expRate = null; // 同上：分母(base)为0时人数是0，比率才是null
                if (base > 0) {
                    expCount = pool.filter(p => cumCount(ordersByDay(p.userId, true), p.fDate, date) >= n).length;
                    expRate = 100 * expCount / base;
                    sumAcc.cum[n] += expCount;
                }
                const bCount = row ? row[`cumRecharge${n}Count`] : undefined;
                const bRate = row ? row[`cumRecharge${n}Rate`] : undefined;
                if (!row) {
                    if (base > 0) console.log(`##CUM##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|||NO_BACKEND`);
                    continue;
                }
                const status = cmp(expCount, expRate, bCount, bRate);
                console.log(`##CUM##${key}|${n}|${f(expCount)}|${expRate === null ? '' : round2(expRate).toFixed(2)}|${f(bCount)}|${f(bRate)}|${status}`);
            }
        }
    }

    // ---- 6) 合计行(sumTotal) ----
    console.log(`##SUM##REG|0|${expReg}||${f(sumTotal.registerCount)}||${expReg === sumTotal.registerCount ? 'MATCH' : 'MISMATCH'}|`);
    console.log(`##SUM##FIRST|0|${expFirst}||${f(sumTotal.firstRechargeCount)}||${expFirst === sumTotal.firstRechargeCount ? 'MATCH' : 'MISMATCH'}|`);
    console.log(`##SUM##MISSING|${missingRows}|${missingReg}||${missingFirst}||INFO|`);

    if (sumAcc.regBase > 0) {
        const expRate = 100 * sumAcc.newPayCount / sumAcc.regBase;
        const expArppu = sumAcc.newPayCount > 0 ? sumAcc.newPayAmount / sumAcc.newPayCount : null;
        console.log(`##SUM##NEWPAY_COUNT|0|${sumAcc.newPayCount}|${round2(expRate).toFixed(2)}|${f(sumTotal.newPayUserCount)}|${f(sumTotal.newPayRate)}|${cmp(sumAcc.newPayCount, expRate, sumTotal.newPayUserCount, sumTotal.newPayRate)}|`);
        console.log(`##SUM##NEWPAY_AMOUNT|0|${round2(sumAcc.newPayAmount)}||${f(sumTotal.newPayAmount)}||${Math.abs(sumAcc.newPayAmount - (sumTotal.newPayAmount || 0)) <= AMOUNT_EPS ? 'MATCH' : 'MISMATCH'}|`);
        console.log(`##SUM##NEWPAY_ARPPU|0|${f(expArppu === null ? null : round2(expArppu))}||${f(sumTotal.newPayArppu)}||${expArppu !== null && sumTotal.newPayArppu !== undefined && Math.abs(round2(expArppu) - sumTotal.newPayArppu) <= AMOUNT_EPS ? 'MATCH' : 'MISMATCH'}|`);
    }
    if (sumAcc.firstBase > 0) {
        for (const n of RECHARGE_REPEAT_TIER_MARKS) {
            const expRate = 100 * sumAcc.d0[n] / sumAcc.firstBase;
            console.log(`##SUM##D0|${n}|${sumAcc.d0[n]}|${round2(expRate).toFixed(2)}|${f(sumTotal[`d0Recharge${n}Count`])}|${f(sumTotal[`d0Recharge${n}Rate`])}|${cmp(sumAcc.d0[n], expRate, sumTotal[`d0Recharge${n}Count`], sumTotal[`d0Recharge${n}Rate`])}|`);
        }
    }
    if (sumAcc.cumBase > 0) {
        for (const n of RECHARGE_REPEAT_TIER_MARKS) {
            const expRate = 100 * sumAcc.cum[n] / sumAcc.cumBase;
            console.log(`##SUM##CUM|${n}|${sumAcc.cum[n]}|${round2(expRate).toFixed(2)}|${f(sumTotal[`cumRecharge${n}Count`])}|${f(sumTotal[`cumRecharge${n}Rate`])}|${cmp(sumAcc.cum[n], expRate, sumTotal[`cumRecharge${n}Count`], sumTotal[`cumRecharge${n}Rate`])}|`);
        }
    }

    if (softDegradeWarn > 0) console.log(`##R## ⚠️ ${softDegradeWarn} 个首充用户订单查回0条(疑似后台软降级，重试后仍为0)，相关复充期望可能偏低`);
    console.log(`##R## 用户订单缓存=${Object.keys(orderMemo).length}人`);
}
