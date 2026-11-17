/**
 * 数据分析总览 / 渠道来源分析 —— 新增字段验证（需求#2240）
 *
 * 需求背景（Jira #2240）：
 *   报表管理→数据分析 下的「数据分析总览」「渠道来源分析」两个页面，
 *   充值金额字段后新增：
 *     多次充值人数         当日充值次数≥2次的会员数量
 *     多充会员充值总额     当日多次充值(≥2次)的会员充值的总金额
 *     多充会员充值金额占比 多充会员充值总额 / 充值金额
 *   有效投注字段后新增：
 *     投注金额   当日所有会员的投注金额总和
 *     派奖金额   当日派发给会员的奖金总和
 *     会员盈亏   派奖金额 - 投注金额（正数=会员赢/平台亏，负数=会员输/平台赢）
 *
 * 2026-11-13实测确认的关键事实：
 *   1) 这次需求当前只部署在SIT环境(项目里即TENANT_ID=3004这套TEST配置，口头上
 *      "SIT"="TEST"是同一个环境)，UAT(3101)环境这两个报表接口响应里完全没有
 *      这6个新字段(已实测确认)，不要拿去UAT验证。
 *   2) 充值类字段的真值来源：/api/RechargeOrder/GetRechargeOrderPageList(Payed)，
 *      按userId分组统计当日充值次数+金额，筛出次数>=2的即为"多充会员"。
 *   3) 投注类字段的真值来源：/api/ThirdGame/GetBetRecordGameSummary——这是后台
 *      "游戏投注订单→查询游戏汇总"按钮背后的接口，实测确认不需要传userId/categoryType/
 *      vendorCode等筛选字段，只传beginTimeUnix/endTimeUnix就能拿到全站范围的汇总，
 *      返回的betAmount/winAmount/winLoseAmount正好对应这次新增的投注金额/派奖金额/
 *      会员盈亏——不需要像查注单明细那样逐用户/逐游戏类型查了再手动累加。
 *      【2026-11-14修正】queryTimeType必须传'SettleTime'(按结算时间)，不能传
 *      'BetTime'(按投注时间)——按投注时间查会把"投注时间落在范围内、但还没结算"
 *      的注单也计入betAmount，而报表(GetDataAnalysis/GetPackageAnalysis)的投注
 *      类字段只统计已结算的注单，导致本地统计虚高(实测某天差了8.5万+，派奖/盈亏
 *      差距很小，因为那两个字段本身就只在结算后才有值，受影响不大，唯独betAmount
 *      两种口径天然不同)。改用SettleTime后未结算的注单没有落在结算时间窗口内，
 *      自然被排除，不需要再额外传orderState=1过滤(orderState=1代表已结算，见
 *      agentL3/inviteCondition/api.js等多处脚本的验证)。
 *   4) 【2026-11-13重要修正】渠道来源分析(GetPackageAnalysis)不传任何过滤条件时，
 *      返回的那一行并不是"自动列出的某个渠道"，而是全站合计(packageName固定显示
 *      为"合计"，覆盖了真实包名)——这一点之前理解错了，一度以为"后台没配置渠道包
 *      导致查不到拆分数据"，实际原因是接口参数传错了：按渠道查询必须显式传
 *      `packageIds`(注意是复数+s，不是packageId)这个数组参数，比如
 *      `packageIds:[100058]`，返回的那一行才是这个具体渠道自己的统计（哪怕只传
 *      一个包，也必须用数组包起来）。实测确认的5个渠道真实packageId(本租户下)：
 *        官网official  → packageId=0   (跟"不传参数时的合计"撞了同一个0，容易混淆)
 *        转盘wheel     → packageId=2
 *        adjust        → packageId=100058 (carey_adjust_001)
 *        facebook      → packageId=100055 (fb419)
 *        tiktok        → packageId=100054 (testing_tiktok_40，注册时必须带上
 *                         k6/config/eventRegisterConfig.js里配置的registerDomain
 *                         专属域名，否则请求走默认域名，账号会被打上packageId=0，
 *                         而不是预期的tiktok渠道包)
 *      这些packageId本身可以在 /api/Package/GetPageList 接口(后台"渠道包管理"
 *      列表，项目里之前没有脚本用过)里查到完整配置，也可以用account/userId查
 *      /api/Users/GetPageList 直接看某个会员身上的packageId/packageName字段。
 *   5) 这是共享测试环境，查询有先后时间差，其它人/进程可能同时在产生新数据——
 *      比对时允许小的绝对误差，不强求逐分毫完全相等。
 *   6) 【2026-11-14更正】之前(2026-11-13)这里写过"用'今天'验证投注类3个字段对不上，
 *      怀疑是报表定时任务未及时刷新的数据新鲜度问题，建议只用已结束的历史日期"——
 *      这个归因是错的，已验证并更正：真正原因是第3条里说的queryTimeType用错了
 *      ('BetTime'而非'SettleTime')，跟日期是"今天"还是"历史"无关(用2026-11-13这个
 *      当时判定为"不稳定"的历史日期重新验证，改用SettleTime后15项检查全部PASS，
 *      包括之前差了8.5万+的投注金额，分毫不差)。不过验证投注类字段时仍建议避开
 *      "当前还没过完的今天"——不是因为报表不准，是因为当天投注还在持续产生，两次
 *      查询之间(本地统计 vs 报表接口)难免有几秒时间差导致的小幅波动(本节第5条提过
 *      的共享环境查询时间差，跟这里是两回事)，已结束的历史日期没有这个变量。
 *   7) 全部用 sendRequest 调后台查询接口都必须显式传 forceTenant=true（第6个参数），
 *      否则默认走集团路由，拿单租户token去访问会报"Account type does not match
 *      the admin site"(msgCode=13208)。
 *
 * 【本脚本与造数脚本完全独立，不要耦合】multiChannelAudienceSeed.test.js(造数)只管
 * 执行、不做验证；本脚本只管验证、不做任何造数动作，两者可以分开跑、隔很久再跑，
 * 互不依赖对方的运行时状态——这是应用户要求明确的设计原则(2026-11-13)。
 *
 * 运行（在 k6/tests/api/rptDashboard/ 目录下执行）：
 *   k6p -e TENANT_ID=3004 dataAnalysisNewFieldsVerify.js
 *     不传PACKAGE_IDS：第5步"按渠道求和"会自动发现当天出现过的所有渠道(可能连其
 *     它人造的数据一起扫到，更慢但不挑)。
 *   k6p -e TENANT_ID=3004 -e DATE=2026-11-12 dataAnalysisNewFieldsVerify.js
 *     指定日期（默认今天，按租户时区；建议用已结束的历史日期，见上面第6条）
 *   k6p -e TENANT_ID=3004 -e DATE=2026-11-13 -e PACKAGE_IDS=0,2,100054,100055,100058 dataAnalysisNewFieldsVerify.js
 *   uat(3101)验证
 *  k6p -e TENANT_ID=3004 -e DATE=2026-11-13 -e PACKAGE_IDS=0,2 dataAnalysisNewFieldsVerify.js
 *     手动指定只验证这几个渠道(数字从造数脚本跑完打印的"渠道→packageId映射"那行
 *     抄过来即可)——更快、更精确，适合"我只想单独核对上次那批测试账号对不对"的场景。
 */

import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTzOffsetMs, getDayRange, dateStartTs, dateEndTs } from '../../../libs/common/time.js';
import { fetchAllPages } from '../../../libs/common/paging.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'DataAnalysisNewFields';

export const options = {
    scenarios: {
        verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' }
    }
};

// ============================================================
// 日期/时间范围
// ============================================================
function resolveDateAndRange() {
    const tzOffsetMs = getTzOffsetMs(TENANT_ID);
    if (__ENV.DATE) {
        const dateStr = __ENV.DATE;
        return { dateStr, startTs: dateStartTs(dateStr, tzOffsetMs), endTs: dateEndTs(dateStr, tzOffsetMs) };
    }
    const r = getDayRange(0, TENANT_ID);
    return { dateStr: r.dateStr, startTs: r.startTime, endTs: r.endTime };
}

// ============================================================
// 真值 1：充值明细 → 多次充值统计
// ============================================================
function calcRechargeStats(adminToken, startTs, endTs) {
    const byUser = new Map(); // userId -> {count, amount}
    fetchAllPages(
        (pageNo) => sendRequest(
            { rechargeState: 'Payed', startTime: startTs, endTime: endTs, pageNo, pageSize: 500, dateType: 0, orderBy: 'Desc' },
            '/api/RechargeOrder/GetRechargeOrderPageList', TAG, false, adminToken, true
        ),
        { pause: 0.2 }
    ).forEach(o => {
        const amt = parseFloat(o.actualAmount || 0);
        const cur = byUser.get(o.userId) || { count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += amt;
        byUser.set(o.userId, cur);
    });

    let totalRechargeAmount = 0, totalRechargeUsers = 0;
    let multiRechargeMemberCount = 0, multiRechargeAmount = 0;
    for (const { count, amount } of byUser.values()) {
        totalRechargeAmount += amount;
        totalRechargeUsers += 1;
        if (count >= 2) { multiRechargeMemberCount += 1; multiRechargeAmount += amount; }
    }
    const multiRechargeAmountRate = totalRechargeAmount > 0 ? (multiRechargeAmount / totalRechargeAmount) * 100 : 0;
    return { totalRechargeAmount, totalRechargeUsers, multiRechargeMemberCount, multiRechargeAmount, multiRechargeAmountRate };
}

// ============================================================
// 真值 2：游戏投注汇总（全站，不筛用户/渠道/游戏类型）
//
// 2026-11-14修正：之前用 queryTimeType:'BetTime' 按投注时间查，会把"投注时间落在
// 当天、但还没结算"的注单也计入 betAmount，而报表(GetDataAnalysis)的投注类字段
// 只统计已结算的——导致本地统计虚高(实测某天差了8万+)，派奖/盈亏差距很小(因为那
// 两个字段本身就只在结算后才有值)。改成 queryTimeType:'SettleTime' 按结算时间查，
// 未结算的注单没有结算时间、自然不会落在这个时间窗口里，不需要再额外传
// orderState=1 过滤(用户2026-11-14用后台抓包确认，这套接口参数已经被
// inviteCondition/api.js 等多处脚本验证过 orderState=1 代表已结算)。
// ============================================================
function getBetSummary(adminToken, startTs, endTs) {
    const res = sendRequest(
        { queryTimeType: 'SettleTime', beginTimeUnix: startTs, endTimeUnix: endTs },
        '/api/ThirdGame/GetBetRecordGameSummary', TAG, false, adminToken, true
    );
    // sendRequest 返回的就是响应体的 data 字段本身(已被 testCommonRequest 解包一层)，不是 {data:{...}}
    const total = (res && res.total) || {};
    return {
        betAmount: parseFloat(total.betAmount || 0),
        validAmount: parseFloat(total.validAmount || 0),
        payoutAmount: parseFloat(total.winAmount || 0),
        memberWinLoseAmount: parseFloat(total.winLoseAmount || 0)
    };
}

// ============================================================
// 报表接口
// ============================================================
function getDataAnalysisReport(adminToken, dateStr) {
    const res = sendRequest(
        { startTime: dateStr, endTime: dateStr, pageNo: 1, pageSize: 20, orderBy: 'Desc' },
        '/api/RptDataAnalysis/GetDataAnalysis', TAG, false, adminToken, true
    );
    const list = (res && res.list) || [];
    return list[0] || null;
}

function getPackageAnalysisTotal(adminToken, dateStr) {
    const res = sendRequest(
        { startTime: dateStr, endTime: dateStr, pageNo: 1, pageSize: 20, orderBy: 'Desc', sortField: 'reportDate' },
        '/api/RptDataAnalysis/GetPackageAnalysis', TAG, false, adminToken, true
    );
    const summary = (res && res.summary) || [];
    return summary.find(s => s.packageId === 0 && s.packageName === '合计') || summary[0] || null;
}

/** 按具体渠道(packageIds，复数数组，哪怕只查一个包也要用数组)查渠道来源分析 */
function getPackageAnalysisByPackageIds(adminToken, dateStr, packageIds) {
    const res = sendRequest(
        { startTime: dateStr, endTime: dateStr, pageNo: 1, pageSize: 20, orderBy: 'Desc', sortField: 'reportDate', packageIds },
        '/api/RptDataAnalysis/GetPackageAnalysis', TAG, false, adminToken, true
    );
    const summary = (res && res.summary) || [];
    return summary[0] || null;
}

// ============================================================
// 按渠道核验：发现"今天实际出现过的渠道"，分别查各渠道的GetPackageAnalysis，
// 求和后与总览比对——这是用户要求的核心关系："渠道来源分析"各渠道的值，加起来
// 应该等于"数据分析总览"的全站值。不在这里重新计算每个渠道的本地真值(充值明细
// 可以按userId→packageId关联统计，但投注汇总接口GetBetRecordGameSummary不支持
// 按用户/渠道过滤，没法本地复算投注类字段的分渠道真值)，只信任并核对"分渠道求和
// = 总览"这层内部一致性，这跟文件开头已经验证过的"全站口径100%正确"结合起来，
// 能间接推出"分渠道的值八九不离十"，但不是对每个渠道口径的独立证明。
// ============================================================
function discoverActivePackageIds(adminToken, startTs, endTs) {
    const ids = new Set();
    fetchAllPages(
        (pageNo) => sendRequest(
            { registerBeginTime: startTs, registerEndTime: endTs, pageNo, pageSize: 500, orderBy: 'Desc' },
            '/api/Users/GetPageList', TAG, false, adminToken, true
        ),
        { pause: 0.2 }
    ).forEach(u => ids.add(u.packageId));
    return Array.from(ids);
}

// ============================================================
// 比对工具
// ============================================================
const results = [];
function check(label, expected, actual, tolerance) {
    const e = Number(expected), a = Number(actual);
    const diff = Math.abs(e - a);
    const pass = Number.isFinite(e) && Number.isFinite(a) && diff <= tolerance;
    const line = `${pass ? '✅' : '❌'} ${label}: 本地真值=${e} | 报表返回=${a} | 差值=${diff.toFixed ? diff.toFixed(4) : diff} | 容差=${tolerance}`;
    results.push(line);
    console.log(`[${TAG}] ${line}`);
    return pass;
}

// ============================================================
// 主流程
// ============================================================
export default function () {
    const { dateStr, startTs, endTs } = resolveDateAndRange();
    console.log(`[${TAG}] 租户=${TENANT_ID} 验证日期=${dateStr} 时间范围=[${startTs}, ${endTs}]`);

    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error(`[${TAG}] 后台登录失败，终止`); return; }
    console.log(`[${TAG}] ✅ 后台登录成功`);

    // 1) 本地真值：充值多次统计
    const rechargeStats = calcRechargeStats(adminToken, startTs, endTs);
    console.log(`[${TAG}] 本地充值统计: ${JSON.stringify(rechargeStats)}`);
    sleep(0.5);

    // 2) 本地真值：投注汇总
    const betSummary = getBetSummary(adminToken, startTs, endTs);
    console.log(`[${TAG}] 本地投注汇总: ${JSON.stringify(betSummary)}`);
    sleep(0.5);

    // 3) 数据分析总览
    const overview = getDataAnalysisReport(adminToken, dateStr);
    if (!overview) { console.error(`[${TAG}] GetDataAnalysis 没有返回当日数据，终止`); return; }
    //console.log(`[${TAG}] 数据分析总览原始返回: ${JSON.stringify(overview)}`);

    console.log(`\n${'='.repeat(70)}\n  数据分析总览 —— 新增字段验证（需求#2240）\n${'='.repeat(70)}`);
    console.log(`[${TAG}] 旧字段交叉核对(增强可信度，非本次新增)：`);
    check('充值金额(旧字段，核对本地统计是否吻合)', rechargeStats.totalRechargeAmount, overview.rechargeAmount, 0.01);
    check('充值人数(旧字段)', rechargeStats.totalRechargeUsers, overview.rechargeMemberCount != null ? overview.rechargeMemberCount : overview['rechargeMemberCount'], 0);
    console.log(`[${TAG}] 本次新增字段：`);
    check('多次充值人数 multiRechargeMemberCount', rechargeStats.multiRechargeMemberCount, overview.multiRechargeMemberCount, 0);
    check('多充会员充值总额 multiRechargeAmount', rechargeStats.multiRechargeAmount, overview.multiRechargeAmount, 0.01);
    check('多充会员充值金额占比(%) multiRechargeAmountRate', rechargeStats.multiRechargeAmountRate, overview.multiRechargeAmountRate, 0.5);
    check('投注金额 betAmount', betSummary.betAmount, overview.betAmount, 0.01);
    check('派奖金额 payoutAmount', betSummary.payoutAmount, overview.payoutAmount, 0.01);
    check('会员盈亏 memberWinLoseAmount', betSummary.memberWinLoseAmount, overview.memberWinLoseAmount, 0.01);
    check('会员盈亏=派奖金额-投注金额(公式自洽性，不依赖报表)', betSummary.payoutAmount - betSummary.betAmount, betSummary.memberWinLoseAmount, 0.01);

    sleep(1);

    // 4) 渠道来源分析 —— 合计行交叉验证
    const pkgTotal = getPackageAnalysisTotal(adminToken, dateStr);
    console.log(`\n${'='.repeat(70)}\n  渠道来源分析 —— 合计行 vs 数据分析总览（交叉验证按渠道拆分口径一致）\n${'='.repeat(70)}`);
    if (!pkgTotal) {
        console.warn(`[${TAG}] ⚠️ GetPackageAnalysis 没有返回合计行，跳过这部分交叉验证`);
    } else {
        //console.log(`[${TAG}] 渠道来源分析合计行原始返回: ${JSON.stringify(pkgTotal)}`);
        check('[渠道合计] 多次充值人数', overview.multiRechargeMemberCount, pkgTotal.multiRechargeMemberCount, 0);
        check('[渠道合计] 多充会员充值总额', overview.multiRechargeAmount, pkgTotal.multiRechargeAmount, 0.01);
        check('[渠道合计] 多充会员充值金额占比(%)', overview.multiRechargeAmountRate, pkgTotal.multiRechargeAmountRate, 0.5);
        check('[渠道合计] 投注金额', overview.betAmount, pkgTotal.betAmount, 0.01);
        check('[渠道合计] 派奖金额', overview.payoutAmount, pkgTotal.payoutAmount, 0.01);
        check('[渠道合计] 会员盈亏', overview.memberWinLoseAmount, pkgTotal.memberWinLoseAmount, 0.01);
    }

    sleep(1);

    // 5) 按渠道求和 vs 总览——真正的"渠道拆分"验证(2026-11-13新增)。
    //    先发现今天实际出现过的packageId集合，对每个渠道单独查GetPackageAnalysis
    //    (packageIds数组参数，哪怕只查一个包也要用数组)，求和后跟总览比对。
    console.log(`\n${'='.repeat(70)}\n  渠道来源分析 —— 按渠道分别查询(packageIds)求和 vs 数据分析总览\n${'='.repeat(70)}`);
    // PACKAGE_IDS手动指定：这次只想验证某次造数(或者历史某批账号)产生的那几个渠道，
    // 不想等discoverActivePackageIds扫描当天全部注册用户(可能混进其它人的数据，也更慢)。
    // 不传则保持原有自动发现行为，两种模式互不依赖、都能独立工作。
    const activePackageIds = __ENV.PACKAGE_IDS
        ? __ENV.PACKAGE_IDS.split(',').map(s => parseInt(s.trim(), 10)).filter(v => !isNaN(v))
        : discoverActivePackageIds(adminToken, startTs, endTs);
    console.log(`[${TAG}] ${__ENV.PACKAGE_IDS ? '手动指定' : '自动发现(今天出现过)'}的packageId: [${activePackageIds.join(', ')}]`);

    const byChannel = [];
    for (const pid of activePackageIds) {
        sleep(0.3);
        const row = getPackageAnalysisByPackageIds(adminToken, dateStr, [pid]);
        if (!row) {
            console.warn(`[${TAG}] packageId=${pid} 查不到任何数据(可能该渠道包未登记进报表统计范围)`);
            continue;
        }
        console.log(`[${TAG}] packageId=${pid} packageName="${row.packageName}": 充值=${row.rechargeAmount} 多充=${row.multiRechargeAmount} 投注=${row.betAmount} 派奖=${row.payoutAmount} 盈亏=${row.memberWinLoseAmount}`);
        byChannel.push(row);
    }

    if (byChannel.length === 0) {
        console.warn(`[${TAG}] ⚠️ 一个渠道都没查到数据，跳过求和交叉验证`);
    } else if (__ENV.PACKAGE_IDS) {
        // 手动指定模式：activePackageIds只是"我想看的那几个渠道"，不代表当天全部渠道，
        // 跟总览(全站)做"求和=总览"这个断言在语义上不成立(除非手动指定的刚好覆盖了
        // 当天全部渠道)，所以这里不做这个检查，改成对每个指定渠道自己的字段做公式
        // 自洽性检查(会员盈亏=派奖-投注，不依赖总览/其它渠道)，依然能给出PASS/FAIL。
        console.log(`[${TAG}] 手动指定模式：不跟总览做"求和=总览"断言(除非这几个packageId正好覆盖当天全部渠道，否则对不上是正常的，不是bug)。`);
        byChannel.forEach(row => {
            check(`[渠道${row.packageId}:${row.packageName}] 会员盈亏=派奖-投注(该渠道自身公式自洽性)`,
                parseFloat(row.payoutAmount) - parseFloat(row.betAmount), row.memberWinLoseAmount, 0.01);
        });
    } else {
        // 自动发现模式：activePackageIds覆盖了当天出现过的全部渠道，"求和=总览"才成立。
        const sum = (key) => byChannel.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);
        const sumMultiRechargeMemberCount = byChannel.reduce((s, r) => s + (r.multiRechargeMemberCount || 0), 0);
        console.log(`[${TAG}] 按渠道求和结果: 充值=${sum('rechargeAmount')} 多充人数=${sumMultiRechargeMemberCount} 多充金额=${sum('multiRechargeAmount')} 投注=${sum('betAmount')} 派奖=${sum('payoutAmount')} 盈亏=${sum('memberWinLoseAmount')}`);
        check('[按渠道求和] 充值金额', sum('rechargeAmount'), overview.rechargeAmount, 0.01);
        check('[按渠道求和] 多次充值人数', sumMultiRechargeMemberCount, overview.multiRechargeMemberCount, 0);
        check('[按渠道求和] 多充会员充值总额', sum('multiRechargeAmount'), overview.multiRechargeAmount, 0.01);
        check('[按渠道求和] 投注金额', sum('betAmount'), overview.betAmount, 0.01);
        check('[按渠道求和] 派奖金额', sum('payoutAmount'), overview.payoutAmount, 0.01);
        check('[按渠道求和] 会员盈亏', sum('memberWinLoseAmount'), overview.memberWinLoseAmount, 0.01);
    }

    const failCount = results.filter(l => l.startsWith('❌')).length;
    console.log(`\n${'='.repeat(70)}\n  汇总：共 ${results.length} 项，通过 ${results.length - failCount}，失败 ${failCount}\n${'='.repeat(70)}\n`);
}
