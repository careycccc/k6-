/**
 * 集团充提报表核对 —— 验证·本地查询半边(配合 verifyReportRunner.js 使用)
 *
 * ⚠️ 单进程只处理一个商户(env TENANT_ID)，原因同 accountSeed.day.js 顶部注释
 * ——项目请求层(sendRequest→getApiUrl→resolveTenant())在同进程内绑定单一商户。
 *
 * 聚合逻辑结构参照 rptDashboard/sourceMetrics.js 的 srcRecharge/srcWithdraw
 * (同样的 fetchAllPages 翻页 + sendRequest 模式，这个函数已经证明了底层查询
 * 接口本身不强制要求 userId，能查"全商户所有订单")，但不像它们那样只查
 * 单一状态(Payed/Pass)——这次需要同时统计发起/成功/失败，所以不加状态过滤，
 * 拿到全部订单后自己在本地分桶。
 *
 * 失败状态的真实字符串值没有被任何现成代码验证过，不猜测具体值，改用
 * "排除法"：已知的"处理中"状态(Wait/PendingReview/Submitted)之外、
 * 非成功(Payed/Pass)的，都算失败——这样不依赖"失败状态到底叫什么"这个
 * 未确认的细节也能得出正确的失败数。
 *
 * 不能用 withdraw/withdrawApi.js 的 getWithdrawHistory——已确认它有 bug，
 * 读错了响应层级(response.list 应为 response.data.list)，永远返回 null。
 *
 * ⚠️ 2026-10-26 多天衰减系列专用改造——按"成功时间"而非"创建时间"统计：
 * 报表口径是"查询日期内充值成功的订单数量，按成功时间统计。昨天发起、
 * 今天成功的订单，成功笔数算在今天"，而原来的实现只是把dateType=0/1传给
 * 查询接口、相信返回结果本身就落在[startTs,endTs]区间——但这个"dateType
 * 到底是按创建时间还是成功时间过滤"的真实语义从未被验证过。策略：查询
 * 窗口往前多拉WINDOW_PAD_MS(2天，覆盖补单最多跨1天的场景)，拿到订单后
 * 用successTimeOf()精确判断订单的真实成功时间是否落在[startTs,endTs]——
 * 这个策略在dateType无论是哪种真实语义下都正确，不用赌。
 *
 * successTimeOf候选字段链：rechargeSuccessTime已实测确认(2026-10-26用
 * 真实"发起→等待5-6分钟变Cancel→补单变Payed"的订单验证过)——createTime
 * 保持订单最初创建时间不变，rechargeSuccessTime精确变成补单发生的那一刻，
 * 和lastUpdateTime几乎同时(相差不到20ms)。其余字段是未验证的兜底，仅在
 * rechargeSuccessTime缺失时才会用到。
 *
 * ⚠️ 2026-10-27 已知问题(未解决，不影响下面的通道汇总结论)：3004/3007在
 * "商户明细"维度存在残留差异——充值成功人数/成功订单数/失败订单数，本地
 * 和集团对不上(3004差1/1/19，3007差15)。3006完全吻合，不是普遍性的bug。
 * 已排除的假设：
 *   ①失败按lastUpdateTime统计——证伪，createTime在窗口外但lastUpdateTime
 *     在窗口内的失败订单数=0
 *   ②backfillAudit的left-cancelled订单(故意不批准的那一半)造成遗漏——
 *     证伪，逐笔查过后台真实状态，这些订单createTime本就落在窗口内、
 *     且几毫秒内就变Cancel(不是backfill机制本身造成的延迟)，已经被
 *     本地正确统计，不是缺失的那部分
 *   ③报表刷新延迟——证伪，用--retry等15分钟重新查集团数据，本地(276)
 *     和集团(295)的数字完全没变，不是查询时间点不同导致的瞬时现象
 * 已知事实：集团的"订单数/成功数/失败数"是三个独立时间口径的查询(发起按
 * 下单时间、成功按成功时间、失败按失败时间)，集团自己的 成功+失败(388) >
 * 订单数(387) ——不满足简单加总关系，所以差异不代表查询范围漏单，是同一批
 * 订单里有少量(3004是19笔/387笔)的成功/失败归类跟集团不一致，根因未知，
 * 需要更多数据或者确认后端真实统计口径才能继续排查。
 *
 * 用法（在本目录内运行，推荐走 Runner）：
 *   k6 run -e TENANT_ID=3004 -e START=2026-10-01 -e END=2026-10-26 verifyLocalTenant.day.js
 */

import { sendRequest } from '../common/request.js';
import { fetchAllPages } from '../../../libs/common/paging.js';
import { dateStartTs, dateEndTs, formatTs } from '../../../libs/common/time.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

const TENANT_ID = __ENV.TENANT_ID;
const START = __ENV.START;
const END = __ENV.END;
if (!TENANT_ID || !START || !END) throw new Error('[VerifyLocalTenant] 必须传 TENANT_ID/START/END');

export const options = {
    scenarios: { s: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '60m' } }
};

const RECHARGE_PENDING_STATES = new Set(['Wait', 'PendingReview']);

// 查询窗口放宽2天，本地按真实成功时间精确重新过滤——不管dateType服务端
// 真实语义是按创建时间还是成功时间过滤，这个策略都成立(多查到的历史已
// 完结订单会被下面的successTimeOf精确判断排除掉，不会污染结果)。
const WINDOW_PAD_MS = 2 * 24 * 60 * 60 * 1000;

// 分桶按UTC自然日(offsetMs=0)，和现有 dateStartTs(START,0)/dateEndTs(END,0)
// 的查询边界口径保持一致，不引入新的时区不一致。
function dayKeyOf(ts) {
    return formatTs(ts, 0).slice(0, 10); // 'YYYY-MM-DD'
}

/** 充值订单的真实成功时间——rechargeSuccessTime已实测确认，其余为未验证兜底 */
function rechargeSuccessTimeOf(o) {
    const v = Number(o.rechargeSuccessTime || o.payTime || o.auditTime || o.lastUpdateTime || o.updateTime || 0);
    return v > 0 ? v : null;
}

/** 提现订单的真实成功时间——withdraw侧没有"SuccessTime"同名字段，lastUpdateTime是sourceMetrics.js里已验证过的报表口径 */
function withdrawSuccessTimeOf(o) {
    const v = Number(o.lastUpdateTime || o.payTime || o.auditTime || o.updateTime || 0);
    return v > 0 ? v : null;
}

function emit(tag, obj) {
    console.log(`##${tag}##${JSON.stringify(obj)}`);
}

function aggregateRechargeOrders(adminToken, startTs, endTs) {
    const userIds = new Set();
    const successByDay = new Map(); // 'YYYY-MM-DD' -> Set<userId>，按天去重，查多天时累加(和提现口径一致)
    let orderCount = 0, successCount = 0, failCount = 0;
    let successAmount = 0, usdtSuccessAmount = 0;
    // 集团"充值通道汇总"表只统计走第三方的充值(rechargeChannelType==='ThirdRecharge')，
    // LocalBankCard/LocalEWallet/LocalUSDT/LocalBankQR等本地确认类型订单即使有自己的
    // channelId，也天然不出现在那张表里——2026-10-27用真实请求确认过(tenant 3006/BDT：
    // 本地452笔=三方318笔+Local103笔+Local31笔，集团汇总表恰好=318笔，完全吻合)。
    // 这几个"third"字段只统计三方类型，才能跟那张表做strict对比；全量字段(含Local)
    // 仍然保留给"商户明细"维度用，两套字段统计范围不同，不要混用。
    let thirdOrderCount = 0, thirdSuccessCount = 0, thirdFailCount = 0, thirdSuccessAmount = 0;

    const orders = fetchAllPages(page => sendRequest({
        startTime: startTs - WINDOW_PAD_MS, endTime: endTs, pageNo: page, pageSize: 500, dateType: 0, orderBy: 'Desc'
    }, '/api/RechargeOrder/GetRechargeOrderPageList', 'AggregateRecharge', false, adminToken), { maxPages: 200, pause: 0.3 });

    for (const o of orders) {
        const isThird = o.rechargeChannelType === 'ThirdRecharge';

        // "订单数/发起人数/失败数"统一按创建时间(下单时间)判断是否属于本窗口，
        // 不管订单最终是否成功、成功发生在哪天——报表口径"发起订单按下单时间
        // 统计"对所有状态一视同仁。2026-10-27用真实数据抓到过bug：之前Payed
        // 订单错误地用"成功时间"判断是否计入orderCount，导致"10-26创建、
        // backfill补单要到10-27才审核成功"的14笔订单被整笔漏算(本地438 vs
        // 集团452，差值精确对应这14笔)。
        if (o.createTime >= startTs && o.createTime <= endTs) {
            orderCount++;
            userIds.add(o.userId);
            if (isThird) thirdOrderCount++;
            if (o.rechargeState !== 'Payed' && !RECHARGE_PENDING_STATES.has(o.rechargeState)) {
                failCount++;
                if (isThird) thirdFailCount++;
            }
        }

        // "成功订单数/成功金额"独立按成功时间判断，和上面的窗口判断互不耦合——
        // 同一笔订单的"发起"和"成功"完全可能落在不同的自然日。
        if (o.rechargeState === 'Payed') {
            const st = rechargeSuccessTimeOf(o);
            if (st != null && st >= startTs && st <= endTs) {
                successCount++;
                const dayKey = dayKeyOf(st);
                if (!successByDay.has(dayKey)) successByDay.set(dayKey, new Set());
                successByDay.get(dayKey).add(o.userId);
                const amt = parseFloat(o.actualAmount || 0);
                successAmount += amt;
                if (o.rechargeType === 'LocalUSDT' || o.rechargeType === 'USDT') usdtSuccessAmount += amt;
                if (isThird) { thirdSuccessCount++; thirdSuccessAmount += amt; }
            }
        }
    }
    const successUserCount = Array.from(successByDay.values()).reduce((sum, set) => sum + set.size, 0);
    return {
        rechargeOrderUserCount: userIds.size, rechargeOrderCount: orderCount,
        rechargeSuccessUserCount: successUserCount, rechargeSuccessCount: successCount,
        rechargeFailCount: failCount, rechargeSuccessAmount: successAmount, rechargeUsdtSuccessAmount: usdtSuccessAmount,
        rechargeThirdOrderCount: thirdOrderCount, rechargeThirdSuccessCount: thirdSuccessCount,
        rechargeThirdFailCount: thirdFailCount, rechargeThirdSuccessAmount: thirdSuccessAmount
    };
}

function aggregateWithdrawOrders(adminToken, startTs, endTs) {
    const userIds = new Set();
    const successByDay = new Map(); // 'YYYY-MM-DD' -> Set<userId>，每个会员每天只算1人，查多天时累加每天人数
    let orderCount = 0, successCount = 0;
    let successAmount = 0, usdtSuccessAmount = 0;
    // 集团"提现通道汇总"表同理只统计有真实三方渠道归属(withdrawChannelId!=0)的提现——
    // 2026-10-27用真实请求确认过：这批造数的提现全部靠"人工确认"兜底完成(因为
    // GetCanWithdrawChannelByOrder查不到可用提现通道)，样本订单withdrawChannelId=0、
    // thirdMessage="artificial confirm"，集团提现通道汇总表对应币种直接是空的(0行)。
    // 这不是bug，是这批数据压根没产生"该表能统计到"的记录——用"attributed"字段只统计
    // 有渠道归属的部分去对比，双方都是0时天然判定一致，不需要单独写"断言为空"的分支；
    // 如果以后真的有提现走通了三方，这套字段依然能做精确的strict数字对比。
    let attributedOrderCount = 0, attributedSuccessCount = 0, attributedSuccessAmount = 0;

    const orders = fetchAllPages(page => sendRequest({
        startTime: startTs - WINDOW_PAD_MS, endTime: endTs, pageNo: page, pageSize: 500, dateType: 1, orderBy: 'Desc'
    }, '/api/WithdrawOrder/GetWithdrawOrderPageList', 'AggregateWithdraw', false, adminToken), { maxPages: 200, pause: 0.3 });

    for (const o of orders) {
        const hasChannel = o.withdrawChannelId != null && o.withdrawChannelId !== 0;

        // "订单数/发起人数"统一按创建时间判断，和充值侧同样的修复——不让
        // "成功时间落在窗口外"的已成功订单被整笔漏算。
        if (o.createTime >= startTs && o.createTime <= endTs) {
            orderCount++;
            userIds.add(o.userId);
            if (hasChannel) attributedOrderCount++;
        }
        // 提现没有failCount对应字段(GetTenantPageList本身就没提供)，这里不统计失败数

        // "成功订单数/成功金额"独立按成功时间判断。
        if (o.withdrawState === 'Pass') {
            const st = withdrawSuccessTimeOf(o);
            if (st != null && st >= startTs && st <= endTs) {
                successCount++;
                const dayKey = dayKeyOf(st);
                if (!successByDay.has(dayKey)) successByDay.set(dayKey, new Set());
                successByDay.get(dayKey).add(o.userId);
                const amt = parseFloat(o.actualAmount || 0);
                successAmount += amt;
                if (o.withdrawType === 'USDT') usdtSuccessAmount += amt;
                if (hasChannel) { attributedSuccessCount++; attributedSuccessAmount += amt; }
            }
        }
    }
    const successUserCount = Array.from(successByDay.values()).reduce((sum, set) => sum + set.size, 0);
    return {
        withdrawOrderUserCount: userIds.size, withdrawOrderCount: orderCount,
        withdrawSuccessUserCount: successUserCount, withdrawSuccessCount: successCount,
        withdrawSuccessAmount: successAmount, withdrawUsdtSuccessAmount: usdtSuccessAmount,
        withdrawAttributedOrderCount: attributedOrderCount, withdrawAttributedSuccessCount: attributedSuccessCount,
        withdrawAttributedSuccessAmount: attributedSuccessAmount
    };
}

export default function () {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) { console.error(`[VerifyLocalTenant] 租户${TENANT_ID}管理员登录失败`); return; }

    // 集团报表按 'YYYY-MM-DD' 查询，统计口径里充值按dateType=0、提现按dateType=1，
    // 对应的毫秒时间戳边界沿用 libs/common/time.js 既有的 dateStartTs/dateEndTs
    const startTs = dateStartTs(START, 0);
    const endTs = dateEndTs(END, 0);

    const rechargeStat = aggregateRechargeOrders(adminToken, startTs, endTs);
    const withdrawStat = aggregateWithdrawOrders(adminToken, startTs, endTs);

    emit('LOCAL', { tenantId: TENANT_ID, ...rechargeStat, ...withdrawStat });
    console.log(`[VerifyLocalTenant] 租户${TENANT_ID}本地聚合完成: ${JSON.stringify({ ...rechargeStat, ...withdrawStat })}`);
}
