/**
 * 渠道获客漏斗报表验证
 *
 * 流程：
 *   Step 1: 查询 startDate~endDate 范围内注册的真实用户（剔除 userType=1 测试账号）
 *   Step 2: 查询该日期范围内的广告消耗数据（多天累加）
 *   Step 3: 查询系统漏斗报表（多天累加）
 *   Step 4: 逐用户查询在 startDate~endDate 内的充值/投注/提现/首充/二充/三充/活动数据
 *   Step 5: 本地计算值 vs 系统值逐字段对比，生成竖向报表
 *
 * 运行命令：
 *   k6 run -e TENANT_ID=3004 -e PACKAGE_ID=1 -e DATE_RANGE=2026-05-01~2026-05-05 channelFunnelVerify.test.js
 *   k6 run -e TENANT_ID=3101 -e PACKAGE_ID=0,1,2 -e DATE_RANGE=2026-05-06~2026-05-06 channelFunnelVerify.test.js
 *
 * 参数说明：
 *   TENANT_ID    租户ID（必填）
 *   PACKAGE_ID   渠道包ID，支持多个逗号分隔，如 1,2,3（必填）
 *   DATE_RANGE   日期范围，格式 YYYY-MM-DD~YYYY-MM-DD（必填）
 *                查询该范围内注册的用户，以及这些用户在该范围内的所有活动数据
 *
 * 时区：UTC+5:30（印度时间），与后台系统一致
 */

import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTzOffset } from '../retention/rechargeRetentionApi.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
// 支持多个渠道包ID，逗号分隔，如 "1,2,3"
const PACKAGE_IDS = (__ENV.PACKAGE_ID || '0').split(',').map(s => parseInt(s.trim(), 10)).filter(v => !isNaN(v));
const DATE_RANGE = __ENV.DATE_RANGE || '';

const TZ_OFFSET_MS = getTzOffset(TENANT_ID) * 3600 * 1000;

const TAG = 'ChannelFunnelVerify';

export const options = {
    scenarios: {
        channel_funnel_verify: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '4h'
        }
    }
};

// ============================================================
// 日期工具（UTC+5:30）
// ============================================================

function parseDateRange(rangeStr) {
    const parts = rangeStr.split('~');
    if (parts.length !== 2) throw new Error(`DATE_RANGE 格式错误: ${rangeStr}`);
    return [parts[0].trim(), parts[1].trim()];
}

function enumerateDates(startDate, endDate) {
    const dates = [];
    const cur = new Date(startDate + 'T00:00:00Z');
    const fin = new Date(endDate + 'T00:00:00Z');
    while (cur <= fin) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

/**
 * YYYY-MM-DD → 当天租户时区 00:00:00 的 UTC 毫秒时间戳
 * 例如 UTC+5:30：当天 00:00:00 本地时间 = UTC 前一天 18:30:00
 */
function dateToIstStartTs(dateStr) {
    const utcMidnight = new Date(dateStr + 'T00:00:00Z').getTime();
    return utcMidnight - TZ_OFFSET_MS;
}

function dateToIstEndTs(dateStr) {
    return dateToIstStartTs(dateStr) + 24 * 60 * 60 * 1000 - 1;
}

// ============================================================
// API 封装
// ============================================================

/** Step 1: 分页获取注册用户列表（剔除 userType=1） */
function fetchRealUsers(adminToken, packageId, startTs, endTs) {
    const api = '/api/Users/GetPageList';
    const users = [];
    let pageNo = 1, totalPage = 1;

    while (pageNo <= totalPage) {
        const result = sendRequest({
            packageId,
            registerBeginTime: startTs,
            registerEndTime: endTs,
            pageNo,
            pageSize: 500,
            orderBy: 'Desc'
        }, api, TAG, false, adminToken);

        if (!result) break;
        const list = result.list || [];
        if (result.totalPage && result.totalPage > totalPage) totalPage = result.totalPage;

        list.forEach(u => {
            if (u.userType !== 1) users.push(u);  // 剔除测试账号
        });

        pageNo++;
        if (pageNo <= totalPage) sleep(0.3);
    }
    return users;
}

/** Step 2: 获取广告消耗数据（多天累加） */
function fetchAdSpend(adminToken, packageId, startDateStr, endDateStr) {
    const result = sendRequest({
        channelPackageId: packageId,
        reportDateStart: startDateStr,
        reportDateEnd: endDateStr,
        pageNo: 1,
        pageSize: 200
    }, '/api/FinanceAdSpend/GetPageList', TAG, false, adminToken);

    if (!result || !result.list || result.list.length === 0) {
        return { spendAmount: 0, impressions: 0, clicks: 0 };
    }
    let spendAmount = 0, impressions = 0, clicks = 0;
    result.list.forEach(r => {
        // 只累加匹配当前渠道包的数据，防止 packageId=0 时获取到全量汇总
        if (r.channelPackageId !== undefined && r.channelPackageId !== packageId) return;

        spendAmount += parseFloat(r.spendAmount || 0);
        impressions += parseInt(r.impressions || 0, 10);
        clicks += parseInt(r.clicks || 0, 10);
    });
    return { spendAmount, impressions, clicks };
}

/** Step 3: 获取系统漏斗报表（多天时累加所有行） */
function fetchFunnelReport(adminToken, packageId, startDateStr, endDateStr) {
    const result = sendRequest({
        channelPackageId: packageId,
        startTime: startDateStr,
        endTime: endDateStr,
        pageNo: 1,
        pageSize: 200,
        sortField: 'ReportDate',
        orderBy: 1
    }, '/api/RptChannelFunnel/GetPageList', TAG, false, adminToken);

    if (!result || !result.list || result.list.length === 0) return {};

    // 多天时把所有行的数值累加成一条汇总
    const sum = {};
    result.list.forEach(row => {
        // 只累加匹配当前渠道包的数据
        if (row.channelPackageId !== undefined && row.channelPackageId !== packageId) return;

        Object.keys(row).forEach(k => {
            const v = parseFloat(row[k]);
            if (!isNaN(v)) {
                sum[k] = (sum[k] || 0) + v;
            } else if (sum[k] === undefined) {
                sum[k] = row[k]; // 非数值字段取第一行
            }
        });
    });
    return sum;
}

/** 查询单用户充值订单（Payed 状态），时间范围为整个查询窗口 */
function fetchUserRecharge(adminToken, userId, startTs, endTs) {
    const result = sendRequest({
        userId,
        rechargeState: 'Payed',
        startTime: startTs,
        endTime: endTs,
        pageNo: 1,
        pageSize: 500,
        dateType: 0,
        orderBy: 'Desc'
    }, '/api/RechargeOrder/GetRechargeOrderPageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户首充/二充/三充记录，时间范围为整个查询窗口 */
function fetchUserRptRecharge(adminToken, userId, startDateStr, endDateStr) {
    const result = sendQueryRequest({
        memberIdType: 1,
        memberId: userId,
        startTime: `${startDateStr} 00:00:00`,
        endTime: `${endDateStr} 23:59:59`
    }, '/api/RptUserInfo/GetUserRptRechargePageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户提现订单（Pass 状态），时间范围为整个查询窗口 */
function fetchUserWithdraw(adminToken, userId, startTs, endTs) {
    const result = sendRequest({
        userId,
        withdrawState: 'Pass',
        startTime: startTs,
        endTime: endTs,
        pageNo: 1,
        pageSize: 500,
        dateType: 1,
        orderBy: 'Desc',
        sortField: ''
    }, '/api/WithdrawOrder/GetWithdrawOrderPageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户投注记录（5个游戏类型），时间范围为整个查询窗口 */
function fetchUserBet(adminToken, userId, startTs, endTs) {
    let betAmount = 0, winAmount = 0;
    for (let cat = 0; cat < 5; cat++) {
        try {
            const result = sendQueryRequest({
                categoryType: cat,
                queryTimeType: 'BetTime',
                userId,
                beginTimeUnix: startTs,
                endTimeUnix: endTs,
                pageSize: 200,
                sortField: 'BetTime'
            }, '/api/ThirdGame/GetBetRecordPageList', TAG, false, adminToken);

            if (result && result.sum) {
                betAmount += parseFloat(result.sum.betAmountSum || 0);
                winAmount += parseFloat(result.sum.winAmountSum || 0);
            } else if (result && result.list) {
                result.list.forEach(r => {
                    betAmount += parseFloat(r.betAmount || 0);
                    winAmount += parseFloat(r.winAmount || 0);
                });
            }
        } catch (e) { /* 某类型无数据，忽略 */ }
    }
    return { betAmount, winAmount };
}

/** 查询单用户在时间窗口内的活动发放金额 */
function fetchUserActivityAmount(adminToken, userId, startDateStr, endDateStr) {
    const result = sendQueryRequest({
        memberIdType: 1,
        memberId: userId,
        startTime: `${startDateStr} 00:00:00`,
        endTime: `${endDateStr} 23:59:59`
    }, '/api/RptUserInfo/GetUserRptActivityPageList', TAG, false, adminToken);

    if (!result || !result.summary) return 0;
    return parseFloat(result.summary.totalAllActivityAmount || 0);
}

// ============================================================
// 本地计算
// ============================================================

/**
 * 逐用户查询在 startDate~endDate 窗口内的活动数据并汇总
 * users:        该时间段内注册的真实用户列表
 * adSpend:      广告消耗汇总
 * startTs/endTs: 整个日期范围的 IST 时间戳（用于充值/提现/投注）
 * startDateStr/endDateStr: 日期字符串（用于首充/二充/三充/活动）
 */
function calcMetrics(users, adSpend, startTs, endTs, startDateStr, endDateStr, adminToken) {
    const { spendAmount, impressions, clicks } = adSpend;
    const registerCount = users.length;

    console.log(`\n[Calc] 开始逐用户查询数据，共 ${registerCount} 人`);
    console.log(`[Calc] 活动时间窗口: ${startDateStr} ~ ${endDateStr}`);

    let totalRecharge = 0, totalWithdraw = 0;
    let totalBet = 0, totalWin = 0;
    let firstRechargeUsers = 0, firstRechargeAmt = 0;
    let secondRechargeUsers = 0, secondRechargeAmt = 0;
    let thirdRechargeUsers = 0, thirdRechargeAmt = 0;
    let betUsers = 0;
    let activityAmount = 0;

    users.forEach((u, idx) => {
        if (idx % 10 === 0 && idx > 0) {
            console.log(`   ...已查询 ${idx}/${registerCount} 人...`);
        }
        sleep(0.2);

        // 充值：在查询时间窗口内
        const rechargeList = fetchUserRecharge(adminToken, u.userId, startTs, endTs);
        rechargeList.forEach(r => { totalRecharge += parseFloat(r.actualAmount || 0); });

        // 提现：在查询时间窗口内
        const withdrawList = fetchUserWithdraw(adminToken, u.userId, startTs, endTs);
        withdrawList.forEach(r => { totalWithdraw += parseFloat(r.amount || 0); });

        // 投注：在查询时间窗口内
        const { betAmount, winAmount } = fetchUserBet(adminToken, u.userId, startTs, endTs);
        totalBet += betAmount;
        totalWin += winAmount;
        if (betAmount > 0) betUsers++;

        // 首充/二充/三充：在查询时间窗口内（日期字符串格式）
        const rptList = fetchUserRptRecharge(adminToken, u.userId, startDateStr, endDateStr);
        const r1 = rptList.find(r => r.rechargeType === 'R1');
        const r2 = rptList.find(r => r.rechargeType === 'R2');
        const r3 = rptList.find(r => r.rechargeType === 'R3');

        if (r1) {
            firstRechargeUsers++;
            firstRechargeAmt += parseFloat(r1.actualAmount || r1.rechargeAmount || 0);
        }
        if (r2) {
            secondRechargeUsers++;
            secondRechargeAmt += parseFloat(r2.actualAmount || r2.rechargeAmount || 0);
        }
        if (r3) {
            thirdRechargeUsers++;
            thirdRechargeAmt += parseFloat(r3.actualAmount || r3.rechargeAmount || 0);
        }

        // 活动发放：逐用户查询，只统计该时间段内注册的用户在该时间段内领取的活动金额
        activityAmount += fetchUserActivityAmount(adminToken, u.userId, startDateStr, endDateStr);
    });

    // 派生指标
    const platWinLose = totalBet - totalWin;
    const platNetProfit = platWinLose - activityAmount;
    const netDeposit = totalRecharge - totalWithdraw;

    const safe = (n, d) => d === 0 ? 0 : n / d;

    return {
        spendAmount, impressions, clicks,
        registerCount,
        firstRechargeUsers, firstRechargeAmt,
        secondRechargeUsers, secondRechargeAmt,
        thirdRechargeUsers, thirdRechargeAmt,
        betUsers, totalBet, totalWin,
        totalRecharge, totalWithdraw, netDeposit,
        activityAmount, platWinLose, platNetProfit,
        ctr: safe(clicks, impressions),
        cpm: safe(spendAmount, impressions) * 1000,
        cpc: safe(spendAmount, clicks),
        clickToRegisterRate: safe(registerCount, clicks),
        cpa: safe(spendAmount, registerCount),
        registerToFirstRate: safe(firstRechargeUsers, registerCount),
        avgFirstRecharge: safe(firstRechargeAmt, firstRechargeUsers),
        cpfd: safe(spendAmount, firstRechargeUsers),
        firstToSecondRate: safe(secondRechargeUsers, firstRechargeUsers),
        secondToThirdRate: safe(thirdRechargeUsers, secondRechargeUsers),
        costPerSecondRecharge: safe(spendAmount, secondRechargeUsers),
        costPerThirdRecharge: safe(spendAmount, thirdRechargeUsers),
        registerToBetRate: safe(betUsers, registerCount),
        avgBetAmount: safe(totalBet, betUsers),
        costPerBetUser: safe(spendAmount, betUsers),
        roasRecharge: safe(totalRecharge, spendAmount),
        roasWinLose: safe(platWinLose, spendAmount),
        roasNetProfit: safe(platNetProfit, spendAmount),
        roi: safe(platNetProfit - spendAmount, spendAmount),
        userLtv: safe(platNetProfit, registerCount),
        firstRechargeUserLtv: safe(platNetProfit, firstRechargeUsers),
        ltvCacRatio: safe(safe(platNetProfit, firstRechargeUsers), safe(spendAmount, firstRechargeUsers))
    };
}

// ============================================================
// 报表打印（竖向，每行一个指标）
// ============================================================

/**
 * 生成报表内容（返回行数组，不直接打印）
 * 同时返回是否有错误字段，用于最后的错误汇总
 */
function buildReport(dateStr, calc, sys) {
    const TOL_PCT = 1;
    const TOL_ABS = 1;
    const lines = [];
    const errorLines = []; // 只收集 ❌ 的行

    function check(label, calcVal, sysVal, isCount = false) {
        const c = parseFloat(calcVal) || 0;
        const s = parseFloat(sysVal) || 0;
        let ok;
        if (isCount) {
            ok = c === s;
        } else {
            const diff = Math.abs(c - s);
            ok = diff <= TOL_ABS || (s !== 0 && diff / Math.abs(s) * 100 <= TOL_PCT);
        }
        const icon = ok ? '✅' : '❌';
        const calcStr = typeof calcVal === 'number' ? calcVal.toFixed(4) : String(calcVal);
        const sysStr = typeof sysVal === 'number' ? sysVal.toFixed(4) : String(sysVal);
        const diffStr = ok ? '' : ` ← 差值: ${(c - s).toFixed(4)}`;
        const line = `${icon} ${label.padEnd(28)} | 计算: ${calcStr.padStart(12)} | 系统: ${sysStr.padStart(12)}${diffStr}`;
        if (!ok) errorLines.push(`  ${line}`);
        return line;
    }

    lines.push(`\n${'═'.repeat(75)}`);
    lines.push(`  📊 渠道漏斗验证报表 | ${dateStr}`);
    lines.push(`${'═'.repeat(75)}`);

    lines.push(`\n  ── 广告投放 ──────────────────────────────────────────────────────`);
    lines.push(`  ${check('投放消耗(spendAmount)', calc.spendAmount, sys.spendAmount)}`);
    lines.push(`  ${check('曝光次数(impressions)', calc.impressions, sys.impressions, true)}`);
    lines.push(`  ${check('点击次数(clicks)', calc.clicks, sys.clicks, true)}`);
    lines.push(`  ${check('点击率CTR(%)', calc.ctr, sys.ctr)}`);
    lines.push(`  ${check('CPM(千次曝光成本)', calc.cpm, sys.cpm)}`);
    lines.push(`  ${check('CPC(单次点击成本)', calc.cpc, sys.cpc)}`);

    lines.push(`\n  ── 注册漏斗 ──────────────────────────────────────────────────────`);
    lines.push(`  ${check('注册人数(registerCount)', calc.registerCount, sys.registerCount, true)}`);
    lines.push(`  ${check('点击→注册转化率(%)', calc.clickToRegisterRate, sys.clickToRegisterRate)}`);
    lines.push(`  ${check('单注册成本CPA', calc.cpa, sys.cpa)}`);

    lines.push(`\n  ── 充值漏斗 ──────────────────────────────────────────────────────`);
    lines.push(`  ${check('首充人数', calc.firstRechargeUsers, sys.firstRechargeUserCount, true)}`);
    lines.push(`  ${check('注册→首充转化率(%)', calc.registerToFirstRate, sys.registerToFirstRate)}`);
    lines.push(`  ${check('首充金额', calc.firstRechargeAmt, sys.firstRechargeAmount)}`);
    lines.push(`  ${check('人均首充', calc.avgFirstRecharge, sys.avgFirstRecharge)}`);
    lines.push(`  ${check('单首充成本CPFD', calc.cpfd, sys.cpfd)}`);
    lines.push(`  ${check('二充人数', calc.secondRechargeUsers, sys.secondRechargeUserCount, true)}`);
    lines.push(`  ${check('二充金额', calc.secondRechargeAmt, sys.secondRechargeAmount)}`);
    lines.push(`  ${check('首充→二充转化率(%)', calc.firstToSecondRate, sys.firstToSecondRate)}`);
    lines.push(`  ${check('单二充成本', calc.costPerSecondRecharge, sys.costPerSecondRecharge)}`);
    lines.push(`  ${check('三充人数', calc.thirdRechargeUsers, sys.thirdRechargeUserCount, true)}`);
    lines.push(`  ${check('三充金额', calc.thirdRechargeAmt, sys.thirdRechargeAmount)}`);
    lines.push(`  ${check('二充→三充转化率(%)', calc.secondToThirdRate, sys.secondToThirdRate)}`);
    lines.push(`  ${check('单三充成本', calc.costPerThirdRecharge, sys.costPerThirdRecharge)}`);

    lines.push(`\n  ── 投注 ──────────────────────────────────────────────────────────`);
    lines.push(`  ${check('活跃投注人数', calc.betUsers, sys.betUserCount, true)}`);
    lines.push(`  ${check('注册→投注转化率(%)', calc.registerToBetRate, sys.registerToBetRate)}`);
    lines.push(`  ${check('总投注金额(打码量)', calc.totalBet, sys.betAmount)}`);
    lines.push(`  ${check('人均投注金额', calc.avgBetAmount, sys.avgBetAmount)}`);
    lines.push(`  ${check('单活跃用户成本', calc.costPerBetUser, sys.costPerBetUser)}`);

    lines.push(`\n  ── 资金 ──────────────────────────────────────────────────────────`);
    lines.push(`  ${check('总充值', calc.totalRecharge, sys.rechargeAmountTotal)}`);
    lines.push(`  ${check('总提现', calc.totalWithdraw, sys.withdrawAmountTotal)}`);
    lines.push(`  ${check('充提差额(净存款)', calc.netDeposit, sys.netDeposit)}`);
    lines.push(`  ${check('平台盈亏(投注-派奖)', calc.platWinLose, sys.platWinLoseAmount)}`);
    lines.push(`  ${check('活动发放金额', calc.activityAmount, sys.activityAmount)}`);
    lines.push(`  ${check('平台净利润', calc.platNetProfit, sys.platNetProfit)}`);

    lines.push(`\n  ── ROI 指标 ──────────────────────────────────────────────────────`);
    lines.push(`  ${check('充值ROAS', calc.roasRecharge, sys.roasRecharge)}`);
    lines.push(`  ${check('盈亏ROAS', calc.roasWinLose, sys.roasWinLose)}`);
    lines.push(`  ${check('净利润ROAS', calc.roasNetProfit, sys.roasNetProfit)}`);
    lines.push(`  ${check('ROI', calc.roi, sys.roi)}`);
    lines.push(`  ${check('单用户LTV', calc.userLtv, sys.userLtv)}`);
    lines.push(`  ${check('首充用户LTV', calc.firstRechargeUserLtv, sys.firstRechargeUserLtv)}`);
    lines.push(`  ${check('LTV/CAC比值', calc.ltvCacRatio, sys.ltvCacRatio)}`);

    lines.push(`\n  ── 仅展示（无法本地验证）────────────────────────────────────────`);
    lines.push(`  ℹ️  次日留存率(retentionRate_2)  : ${sys.retentionRate_2}`);
    lines.push(`  ℹ️  7日留存率(retentionRate_7)   : ${sys.retentionRate_7}`);
    lines.push(`  ℹ️  30日留存率(retentionRate_30) : ${sys.retentionRate_30}`);
    lines.push(`  ℹ️  回本周期(paybackDays)         : ${sys.paybackDays}`);
    lines.push(`\n${'═'.repeat(75)}\n`);

    return { lines, errorLines, hasError: errorLines.length > 0, label: dateStr };
}

// ============================================================
// 汇总卡片（多天 或 多渠道时输出）
// ============================================================

/**
 * 打印"投入效果"汇总卡片
 * needSummary : 是否需要输出（单天单渠道时不输出）
 * label       : 标题标签
 * calcResults : calcMetrics 返回结果的数组
 */
function printSummaryCard(needSummary, label, calcResults) {
    if (!needSummary || calcResults.length === 0) return;

    // 累加所有报表的数值
    const sum = calcResults.reduce((acc, r) => {
        acc.spendAmount += r.spendAmount || 0;
        acc.impressions += r.impressions || 0;
        acc.clicks += r.clicks || 0;
        acc.registerCount += r.registerCount || 0;
        acc.firstRechargeUsers += r.firstRechargeUsers || 0;
        acc.firstRechargeAmt += r.firstRechargeAmt || 0;
        acc.secondRechargeUsers += r.secondRechargeUsers || 0;
        acc.secondRechargeAmt += r.secondRechargeAmt || 0;
        acc.thirdRechargeUsers += r.thirdRechargeUsers || 0;
        acc.thirdRechargeAmt += r.thirdRechargeAmt || 0;
        acc.betUsers += r.betUsers || 0;
        acc.totalBet += r.totalBet || 0;
        acc.totalWin += r.totalWin || 0;
        acc.totalRecharge += r.totalRecharge || 0;
        acc.totalWithdraw += r.totalWithdraw || 0;
        acc.activityAmount += r.activityAmount || 0;
        return acc;
    }, {
        spendAmount: 0, impressions: 0, clicks: 0,
        registerCount: 0,
        firstRechargeUsers: 0, firstRechargeAmt: 0,
        secondRechargeUsers: 0, secondRechargeAmt: 0,
        thirdRechargeUsers: 0, thirdRechargeAmt: 0,
        betUsers: 0, totalBet: 0, totalWin: 0,
        totalRecharge: 0, totalWithdraw: 0, activityAmount: 0
    });

    const safe = (n, d) => d === 0 ? 0 : n / d;
    const platWinLose = sum.totalBet - sum.totalWin;
    const platNetProfit = platWinLose - sum.activityAmount;
    const netDeposit = sum.totalRecharge - sum.totalWithdraw;
    const f = n => (typeof n === 'number' ? n.toFixed(4) : String(n));

    console.log(`\n${'='.repeat(75)}`);
    console.log(`  📊 汇总卡片 | ${label}`);
    console.log(`${'='.repeat(75)}`);
    console.log(`  广告消耗       : ${f(sum.spendAmount)}`);
    console.log(`  曝光           : ${sum.impressions}`);
    console.log(`  点击           : ${sum.clicks}`);
    console.log(`  CTR            : ${f(safe(sum.clicks, sum.impressions) * 100)}%`);
    console.log(`  注册人数       : ${sum.registerCount}`);
    console.log(`  首充人数       : ${sum.firstRechargeUsers}`);
    console.log(`  注册→首充转化  : ${f(safe(sum.firstRechargeUsers, sum.registerCount) * 100)}%`);
    console.log(`  首充金额       : ${f(sum.firstRechargeAmt)}`);
    console.log(`  CPA            : ${f(safe(sum.spendAmount, sum.registerCount))}`);
    console.log(`  CPFD           : ${f(safe(sum.spendAmount, sum.firstRechargeUsers))}`);
    console.log(`  二充人数       : ${sum.secondRechargeUsers}`);
    console.log(`  三充人数       : ${sum.thirdRechargeUsers}`);
    console.log(`  投注人数       : ${sum.betUsers}`);
    console.log(`  总投注额       : ${f(sum.totalBet)}`);
    console.log(`  总充值         : ${f(sum.totalRecharge)}`);
    console.log(`  总提现         : ${f(sum.totalWithdraw)}`);
    console.log(`  净存款         : ${f(netDeposit)}`);
    console.log(`  平台盈亏       : ${f(platWinLose)}`);
    console.log(`  活动奖励       : ${f(sum.activityAmount)}`);
    console.log(`  平台净利润     : ${f(platNetProfit)}`);
    console.log(`  ROAS(充值)     : ${f(safe(sum.totalRecharge, sum.spendAmount))}`);
    console.log(`  ROAS(盈亏)     : ${f(safe(platWinLose, sum.spendAmount))}`);
    console.log(`  ROI            : ${f(safe(platNetProfit - sum.spendAmount, sum.spendAmount))}`);
    console.log(`  用户LTV        : ${f(safe(platNetProfit, sum.registerCount))}`);
    console.log(`${'='.repeat(75)}\n`);
}

export function setup() {
    console.log(`\n${'='.repeat(75)}`);
    console.log(`[Setup] 开始管理员登录 | 租户: ${TENANT_ID}`);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) {
        console.error('[Setup] ❌ 管理员登录失败');
        throw new Error('管理员登录失败');
    }
    console.log('[Setup] ✅ 登录成功');
    console.log(`${'='.repeat(75)}\n`);
    return { adminToken };
}

export default function (data) {
    const { adminToken } = data;
    const [startDate, endDate] = parseDateRange(DATE_RANGE);
    const dates = enumerateDates(startDate, endDate);

    // 整个日期范围的时间戳（IST）
    const rangeStartTs = dateToIstStartTs(startDate);
    const rangeEndTs = dateToIstEndTs(endDate);

    const isMultiDay = dates.length > 1;
    const isMultiPackage = PACKAGE_IDS.length > 1;
    const needSummary = isMultiDay || isMultiPackage;

    console.log(`\n${'='.repeat(75)}`);
    console.log(`🔍 渠道漏斗验证  租户=${TENANT_ID}  日期=${startDate}~${endDate}(${dates.length}天)  渠道包=${PACKAGE_IDS.join(',')}(${PACKAGE_IDS.length}个)`);
    console.log(`${'='.repeat(75)}\n`);

    const allCalcResults = [];
    const finalReports = [];

    // ── 外层：按渠道包循环，每个渠道包查整个日期范围 ──────────────
    PACKAGE_IDS.forEach((packageId, pkgIdx) => {
        console.log(`\n${'━'.repeat(75)}`);
        console.log(`📦 渠道包 ID=${packageId}  日期范围=${startDate}~${endDate}`);
        console.log(`${'━'.repeat(75)}`);

        // Step 1: 查询整个日期范围内注册的真实用户（所有天合并）
        console.log(`[Step 1] 获取 ${startDate}~${endDate} 注册用户列表...`);
        const users = fetchRealUsers(adminToken, packageId, rangeStartTs, rangeEndTs);
        console.log(`[Step 1] ✅ 真实注册用户: ${users.length} 人`);

        if (users.length === 0) {
            console.warn(`[Step 1] ⚠️ 渠道包 ${packageId} 在 ${startDate}~${endDate} 无注册用户，将继续对比系统报表`);
        }

        // Step 2: 整个日期范围的广告消耗（累加多天）
        console.log(`[Step 2] 获取广告消耗数据（${startDate}~${endDate}）...`);
        const adSpend = fetchAdSpend(adminToken, packageId, startDate, endDate);
        console.log(`[Step 2] ✅ 消耗=${adSpend.spendAmount} 曝光=${adSpend.impressions} 点击=${adSpend.clicks}`);

        // Step 3: 整个日期范围的系统漏斗报表（多天累加）
        console.log(`[Step 3] 获取系统漏斗报表（${startDate}~${endDate}）...`);
        const sysReport = fetchFunnelReport(adminToken, packageId, startDate, endDate);
        if (Object.keys(sysReport).length === 0) {
            console.warn(`[Step 3] ⚠️ 渠道包 ${packageId} 系统漏斗报表为空`);
        }
        console.log(`[Step 3] ✅ 系统报表处理完成`);

        // Step 4: 逐用户查询在整个日期范围内的行为数据
        console.log(`[Step 4] 开始本地计算（行为时间窗口: ${startDate}~${endDate}）...`);
        const calcResult = calcMetrics(
            users, adSpend,
            rangeStartTs, rangeEndTs,
            startDate, endDate,
            adminToken
        );
        console.log(`[Step 4] ✅ 本地计算完成`);

        // Step 5: 构建对比报表（收集到最后统一输出）
        const label = PACKAGE_IDS.length === 1
            ? `包${packageId} | ${startDate}~${endDate}`
            : `包${packageId} | ${startDate}~${endDate}`;
        const report = buildReport(label, calcResult, sysReport);
        finalReports.push(report);
        allCalcResults.push(calcResult);

        if (pkgIdx < PACKAGE_IDS.length - 1) sleep(1);
    });

    // === 最终报表展示环节 ===

    // 1. 先打印所有详细对比报表
    if (finalReports.length > 0) {
        console.log(`\n${'═'.repeat(75)}`);
        console.log(`  📋 详细对比报表汇总 (${finalReports.length} 份)`);
        console.log(`${'═'.repeat(75)}`);
        finalReports.forEach(r => {
            r.lines.forEach(line => console.log(line));
        });
    }

    // 2. 汇总卡片：多天 或 多渠道 时输出
    const summaryLabel = `渠道包: ${PACKAGE_IDS.join(',')}  |  ${startDate}~${endDate}`;
    printSummaryCard(needSummary, summaryLabel, allCalcResults);

    // 3. 最后展示错误统计信息（如果有错误，确保展示在最底部）
    const errorReports = finalReports.filter(r => r.hasError);
    if (errorReports.length > 0) {
        console.log(`\n${'❗'.repeat(37)}`);
        console.log(`  🚨 发现数据差异的报表汇总 (${errorReports.length}/${finalReports.length})`);
        console.log(`${'❗'.repeat(37)}`);
        errorReports.forEach(r => {
            console.log(`\n  📍 [${r.label}] 错误项:`);
            r.errorLines.forEach(errLine => console.log(errLine));
        });
        console.log(`\n${'❗'.repeat(37)}\n`);
    }

    console.log(`\n${'='.repeat(75)}`);
    console.log(`✅ 验证完成  ${PACKAGE_IDS.length} 个渠道包 × ${dates.length}天范围 = ${allCalcResults.length} 份报表`);
    console.log(`${'='.repeat(75)}\n`);
}
