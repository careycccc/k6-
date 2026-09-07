/**
 * 充值循环奖励 —— 验证脚本（独立，与造数据/团队脚本完全分开）
 *
 * 验证时机：D+1 运行，校验 rewardDate=D 的奖励记录是否正确。需查【两天】充值：
 *   ① D-1(前一自然日) 的 Payed 充值 → 按 userId 汇总 = 前日累计充值 → 验命中档位 + 免费奖励
 *   ② D  (奖励当日)   的 Payed 充值 → 按 userId 累计/单笔 → 验付费奖励是否达标(paidState)
 *
 * 自然日边界：按租户 COUNTRY_CODE 映射的时区偏移计算（印度91→+05:30 …）。
 *
 * 验证项（以奖励记录为准，验自洽）：
 *   - prevDayRechargeAmount == D-1 累计
 *   - prevDayRechargeAmount ∈ [hitTierMin, hitTierMax] 且该档位 free/paid 各字段 == GetConfig 配置
 *   - 付费达标：paidUseCumulative=1 累计→D当日累计≥require；=0 单笔→D当日某单笔≥require
 *              达标→paidState!=0，未达标→paidState==0
 *   - paidProgressAmount：仅累计模式校验 == D当日累计；单笔模式不校验
 *   - 异常：D-1 无充值却生成了奖励记录 → 报出
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e REWARD_DATE=2026-09-02 cycleRewardVerify.js
 *
 * 参数：
 *   TENANT_ID    租户ID（默认 3004）
 *   REWARD_DATE  奖励日期 D，格式 YYYY-MM-DD（必需）
 *   TZ_OFFSET_MIN 覆盖时区偏移(分钟)，不传则按 COUNTRY_CODE 映射
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';
import { getCycleRewardConfig } from './cycleRewardApi.js';

const TAG = 'CycleVerify';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const REWARD_DATE = __ENV.REWARD_DATE; // D 日
const TOL = 0.01; // 金额比较容差

// COUNTRY_CODE → UTC 偏移分钟（自然日边界用）
const TZ_OFFSET_MIN = {
    '91': 330,   // 印度   UTC+5:30
    '92': 300,   // 巴基斯坦 UTC+5:00
    '880': 360,  // 孟加拉 UTC+6:00
    '52': -360,  // 墨西哥 UTC-6:00
    '55': -180,  // 巴西   UTC-3:00
    '63': 480    // 菲律宾 UTC+8:00
};
const DEFAULT_OFFSET_MIN = 330;

export const options = {
    scenarios: {
        cycle_reward_verify: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '60m'
        }
    }
};

// ================= 时间/时区工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

/** 某自然日 [00:00:00, 23:59:59.999] 在给定时区偏移下的 UTC 毫秒范围 */
function dayRangeUtc(dateStr, offsetMin) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMin * 60000;
    const end = Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMin * 60000;
    return { startTime: start, endTime: end };
}

/** rewardDate 的前一自然日（YYYY-MM-DD） */
function prevDateStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) - 86400000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function numEq(a, b) { return Math.abs(Number(a) - Number(b)) < TOL; }

// ================= 数据拉取（翻页） =================

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
function extractTotalCount(res) {
    if (!res) return null;
    if (res.totalCount != null) return res.totalCount;
    if (res.data && res.data.totalCount != null) return res.data.totalCount;
    return null;
}

/** 查某时间范围内所有 Payed 充值订单（不限 userId，按成功时间 dateType=1，自动翻页） */
function fetchAllPayedOrders(adminToken, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const byOrderNo = {};
    let pageNo = 1;
    let totalCount = null;
    while (true) {
        const payload = {
            rechargeState: 'Payed',
            startTime, endTime,
            pageNo, pageSize: 2000,
            dateType: 1,
            orderBy: 'Desc'
        };
        const res = sendRequest(payload, api, TAG, false, adminToken);
        const list = extractList(res);
        for (const o of list) { if (o.orderNo) byOrderNo[o.orderNo] = o; } // 按 orderNo 去重(防翻页边界重叠)
        if (totalCount == null) totalCount = extractTotalCount(res);
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    const got = Object.keys(byOrderNo).length;
    if (totalCount != null && got !== totalCount) {
        console.warn(`[${TAG}] ⚠️ 充值订单去重后 ${got} 笔 ≠ 后台 totalCount ${totalCount}，可能翻页遗漏，建议再加大 pageSize`);
    }
    return Object.values(byOrderNo);
}

/** 查某 rewardDate 的活动奖励记录（自动翻页） */
function fetchAllRewardRecords(adminToken, rewardDate) {
    const api = '/api/RechargeCycleReward/GetRecordPageList';
    const byOrderNo = {};
    let pageNo = 1;
    let totalCount = null;
    while (true) {
        const payload = { startRewardDate: rewardDate, endRewardDate: rewardDate, pageNo, pageSize: 2000, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, adminToken);
        const list = extractList(res);
        for (const r of list) { if (r.orderNo) byOrderNo[r.orderNo] = r; } // 按 orderNo 去重(防翻页边界重叠)
        if (totalCount == null) totalCount = extractTotalCount(res);
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    const got = Object.keys(byOrderNo).length;
    if (totalCount != null && got !== totalCount) {
        console.warn(`[${TAG}] ⚠️ 奖励记录去重后 ${got} 条 ≠ 后台 totalCount ${totalCount}，可能翻页遗漏，建议再加大 pageSize`);
    }
    return Object.values(byOrderNo);
}

// ================= 聚合工具 =================

/** 按 userId 累计 amount */
function sumByUser(orders) {
    const map = {};
    for (const o of orders) {
        const uid = Number(o.userId);
        map[uid] = (map[uid] || 0) + (Number(o.amount) || 0);
    }
    return map;
}

/** 按 userId 取最大单笔 amount */
function maxSingleByUser(orders) {
    const map = {};
    for (const o of orders) {
        const uid = Number(o.userId);
        const amt = Number(o.amount) || 0;
        if (!map[uid] || amt > map[uid]) map[uid] = amt;
    }
    return map;
}

/** 按 userId 取注册时间（订单里的 userRegisterTime） */
function regTimeByUser(orders) {
    const map = {};
    for (const o of orders) {
        const uid = Number(o.userId);
        if (o.userRegisterTime && !map[uid]) map[uid] = o.userRegisterTime;
    }
    return map;
}

/** UTC 毫秒 → 指定时区偏移下的 "YYYY-MM-DD HH:mm" */
function fmtDateTime(ms, offsetMin) {
    const dt = new Date(Number(ms) + offsetMin * 60000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
}

/** 按 userId 分组订单，并按 lastUpdateTime 升序（付费进度按后台「最后更新时间」先后累计） */
function groupByUser(orders) {
    const map = {};
    for (const o of orders) {
        const uid = Number(o.userId);
        if (!map[uid]) map[uid] = [];
        map[uid].push(o);
    }
    Object.keys(map).forEach(u => map[u].sort((a, b) => Number(a.lastUpdateTime) - Number(b.lastUpdateTime)));
    return map;
}

/** 按充值先后累加，累计 >= require 即停，返回「刚达标那一刻」的累计；未达标返回全部之和 */
function cumUntilReach(userOrders, require) {
    let cum = 0;
    for (const o of userOrders) {
        cum += Number(o.amount) || 0;
        if (cum >= require - TOL) return cum;
    }
    return cum;
}

/** 打印某天充值汇总：充值会员数 + 总额（明细不打，正常数据太多） */
function printRechargeDetail(label, dateStr, sumMap) {
    const uids = Object.keys(sumMap);
    let total = 0;
    uids.forEach(u => { total += sumMap[u]; });
    console.log(`[${TAG}] ── ${label} ${dateStr}：充值会员 ${uids.length} 人，总额 ${total.toFixed(2)} ──`);
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[${TAG}] ========== 充值循环奖励验证 rewardDate=${REWARD_DATE} 租户=${TENANT_ID} ==========`);

    if (!REWARD_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(REWARD_DATE)) {
        throw new Error(`[${TAG}] ❌ 必须提供 -e REWARD_DATE=YYYY-MM-DD（奖励日 D）`);
    }

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    const tiers = getCycleRewardConfig({ token: adminToken });
    console.log(`[${TAG}] ✅ 获取到档位配置 ${tiers.length} 档`);

    return { token: adminToken, tiers, envConfig };
}

export default function (data) {
    const { token: adminToken, tiers, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const offsetMin = __ENV.TZ_OFFSET_MIN
        ? parseInt(__ENV.TZ_OFFSET_MIN, 10)
        : (TZ_OFFSET_MIN[String(envConfig.COUNTRY_CODE)] != null ? TZ_OFFSET_MIN[String(envConfig.COUNTRY_CODE)] : DEFAULT_OFFSET_MIN);

    const rewardDate = REWARD_DATE;
    const prevDate = prevDateStr(rewardDate);
    const d1Range = dayRangeUtc(prevDate, offsetMin);   // D-1
    const dRange = dayRangeUtc(rewardDate, offsetMin);   // D

    console.log(`[${TAG}] 时区偏移 ${offsetMin} 分钟 | 前日(D-1)=${prevDate} | 当日(D)=${rewardDate}`);
    console.log(`[${TAG}] D-1 范围 UTC: ${d1Range.startTime} ~ ${d1Range.endTime}`);
    console.log(`[${TAG}] D   范围 UTC: ${dRange.startTime} ~ ${dRange.endTime}`);

    // 1. 拉两天充值
    console.log(`[${TAG}] 拉取 D-1 充值订单...`);
    const d1Orders = fetchAllPayedOrders(adminToken, d1Range.startTime, d1Range.endTime);
    console.log(`[${TAG}] D-1 Payed 订单 ${d1Orders.length} 笔`);

    console.log(`[${TAG}] 拉取 D 当日充值订单...`);
    const dOrders = fetchAllPayedOrders(adminToken, dRange.startTime, dRange.endTime);
    console.log(`[${TAG}] D 当日 Payed 订单 ${dOrders.length} 笔`);

    const d1Sum = sumByUser(d1Orders);
    const dSum = sumByUser(dOrders);
    const dMaxSingle = maxSingleByUser(dOrders);
    const d1RegTime = regTimeByUser(d1Orders);
    const dByUser = groupByUser(dOrders);   // D 当日订单按 userId 分组(充值时间升序)，算付费进度用

    // 打印两天充值明细（前一天 D-1 / 今天 D）
    printRechargeDetail('前一天(D-1)', prevDate, d1Sum);
    printRechargeDetail('今天(D )', rewardDate, dSum);

    // 2. 拉奖励记录
    console.log(`[${TAG}] 拉取奖励记录...`);
    const records = fetchAllRewardRecords(adminToken, rewardDate);
    console.log(`[${TAG}] 奖励记录 ${records.length} 条`);

    // 诊断：奖励记录唯一会员数（若 < 记录条数，说明后台/翻页有重复 userId）
    const recordUidSet = new Set(records.map(r => Number(r.userId)));
    console.log(`[${TAG}] 奖励记录唯一会员 ${recordUidSet.size} 人（若少于记录条数=有重复）`);

    // 诊断重复来源：orderNo 唯一数 + 哪些会员出现多条
    const orderNoSet = new Set(records.map(r => r.orderNo));
    console.log(`[${TAG}] 奖励记录唯一 orderNo ${orderNoSet.size} 个（=条数→订单号不重复,重复在userId层；<条数→翻页抓重了同一条）`);
    const uidCount = {};
    records.forEach(r => { const u = Number(r.userId); uidCount[u] = (uidCount[u] || 0) + 1; });
    const dupUids = Object.keys(uidCount).filter(u => uidCount[u] > 1);
    if (dupUids.length) {
        console.log(`[${TAG}] ⚠️ 同一会员出现多条奖励记录 ${dupUids.length} 个: [${dupUids.map(u => `${u}×${uidCount[u]}`).join(', ')}]`);
    }

    // 反向诊断：有奖励记录但前一天(D-1)未查到充值 → 时间错位或数据异常
    const noRecharge = [];
    recordUidSet.forEach(uid => { if (d1Sum[uid] === undefined) noRecharge.push(uid); });
    if (noRecharge.length > 0) {
        console.log(`[${TAG}] ⚠️ 有奖励记录但前一天(${prevDate})未查到充值 ${noRecharge.length} 人: [${noRecharge.sort((a, b) => a - b).join(', ')}]`);
    }

    // 前一天有充值但未生成奖励记录的会员（未命中档位）——只打印这些异常，正常的不打
    const noReward = [];
    Object.keys(d1Sum).forEach(u => {
        if (!recordUidSet.has(Number(u))) noReward.push({ userId: Number(u), amount: d1Sum[u] });
    });
    if (noReward.length > 0) {
        console.log(`[${TAG}] ⚠️ 前一天有充值但未生成奖励记录 ${noReward.length} 人：`);
        noReward.sort((a, b) => a.userId - b.userId).forEach(x => {
            const hit = tiers.find(t => x.amount >= Number(t.minAmount) - TOL && x.amount <= Number(t.maxAmount) + TOL);
            const regT = d1RegTime[x.userId];
            const isNewToday = regT && regT >= d1Range.startTime && regT <= d1Range.endTime;
            const regInfo = regT ? `注册于 ${fmtDateTime(regT, offsetMin)}${isNewToday ? ' ⚑当天注册' : ''}` : '注册时间未知';
            if (hit) {
                console.log(`[${TAG}]     ❌ userId=${x.userId} 前一天充值 ${x.amount.toFixed(2)} 落档[${hit.minAmount}-${hit.maxAmount}] 无奖励记录 | ${regInfo}`);
            } else {
                console.log(`[${TAG}]     userId=${x.userId} 前一天充值 ${x.amount.toFixed(2)} 未落档位(正常无奖励) | ${regInfo}`);
            }
        });
    }

    // 3. 逐条验证
    const stats = { total: records.length, pass: 0, fail: 0 };
    const failDetails = [];

    for (const r of records) {
        const uid = Number(r.userId);
        const fails = [];

        const prevRecharge = d1Sum[uid] || 0;

        // A. 前日累计充值金额
        if (!numEq(prevRecharge, r.prevDayRechargeAmount)) {
            fails.push(`前日累计不符: 记录=${r.prevDayRechargeAmount} 实查=${prevRecharge}`);
        }
        // Q4 异常：D-1 无充值却有记录
        if (prevRecharge === 0) {
            fails.push(`⚠️前一天(${prevDate})无充值却生成了奖励资格`);
        }

        // B. 命中档位自洽
        const tier = tiers.find(t => numEq(t.minAmount, r.hitTierMin) && numEq(t.maxAmount, r.hitTierMax));
        if (!tier) {
            fails.push(`命中档位[${r.hitTierMin}-${r.hitTierMax}]在配置中不存在`);
        } else {
            if (!(prevRecharge >= Number(r.hitTierMin) - TOL && prevRecharge <= Number(r.hitTierMax) + TOL)) {
                fails.push(`前日累计${prevRecharge}不在命中档位[${r.hitTierMin}-${r.hitTierMax}]内`);
            }
            // C. 档位配置字段
            if (!numEq(r.freeReward, tier.freeReward)) fails.push(`免费奖励不符: 记录=${r.freeReward} 配置=${tier.freeReward}`);
            if (!numEq(r.freeCodingMultiple, tier.freeCodingMultiple)) fails.push(`免费打码倍数不符: 记录=${r.freeCodingMultiple} 配置=${tier.freeCodingMultiple}`);
            if (!numEq(r.paidRechargeRequire, tier.paidRechargeRequire)) fails.push(`付费要求不符: 记录=${r.paidRechargeRequire} 配置=${tier.paidRechargeRequire}`);
            if (!numEq(r.paidReward, tier.paidReward)) fails.push(`付费奖励不符: 记录=${r.paidReward} 配置=${tier.paidReward}`);
            if (!numEq(r.paidCodingMultiple, tier.paidCodingMultiple)) fails.push(`付费打码倍数不符: 记录=${r.paidCodingMultiple} 配置=${tier.paidCodingMultiple}`);
        }

        // D. 付费达标 + paidState
        const cumulative = Number(r.paidUseCumulative) === 1;
        const require = Number(r.paidRechargeRequire) || 0;
        let paidSatisfied;
        if (cumulative) {
            const dCum = dSum[uid] || 0;
            paidSatisfied = dCum >= require - TOL;
            // 付费进度 = 按充值先后累加到「刚满足要求」为止的累计（达标后的充值不计入）
            const progress = cumUntilReach(dByUser[uid] || [], require);
            if (!numEq(r.paidProgressAmount, progress)) {
                fails.push(`付费进度不符(累计到达标即停): 记录=${r.paidProgressAmount} 应=${progress}`);
            }
        } else {
            const dMax = dMaxSingle[uid] || 0;
            paidSatisfied = dMax >= require - TOL;
            // 单笔模式不校验 paidProgressAmount
        }
        const paidDone = Number(r.paidState) !== 0;
        if (paidSatisfied && !paidDone) {
            fails.push(`付费应达标(${cumulative ? '累计' : '单笔'}≥${require})但 paidState=0(待完成)`);
        }
        if (!paidSatisfied && paidDone) {
            fails.push(`付费未达标但 paidState=${r.paidState}(非待完成)`);
        }

        if (fails.length === 0) {
            stats.pass++;
        } else {
            stats.fail++;
            failDetails.push({ userId: uid, prevRecharge, fails });
        }
    }

    printReport(stats, failDetails, prevDate, rewardDate);
}

// ================= 报表（逐行 console.log） =================

function printReport(stats, failDetails, prevDate, rewardDate) {
    const dline = '═'.repeat(60);
    const sline = '─'.repeat(60);
    console.log('');
    console.log(dline);
    console.log(`  📊 充值循环奖励验证报表   rewardDate=${rewardDate}   租户=${TENANT_ID}`);
    console.log(`  前日(D-1)=${prevDate}   当日(D)=${rewardDate}`);
    console.log(dline);
    console.log(`  奖励记录总数 : ${stats.total}`);
    console.log(`  ✅ 验证通过  : ${stats.pass}`);
    console.log(`  ❌ 验证失败  : ${stats.fail}`);
    console.log(sline);
    if (failDetails.length > 0) {
        console.log('  失败明细:');
        for (const d of failDetails) {
            console.log(`    userId=${d.userId} (前日累计=${d.prevRecharge}):`);
            for (const f of d.fails) console.log(`        - ${f}`);
        }
    } else {
        console.log('  🎉 全部验证通过');
    }
    console.log(dline);
    console.log('');
}
