/**
 * 渠道获客漏斗报表验证
 *
 * 流程：
 *   Step 1: GetPageList（用户列表）→ 获取真实注册人数（剔除 userType=1 测试账号）
 *   Step 2: GetPageList（广告消耗）→ 获取 spendAmount/impressions/clicks
 *   Step 3: GetPageList（漏斗报表）→ 获取系统计算值
 *   Step 4: 逐用户查询充值/投注/提现/活动数据，本地计算各指标
 *   Step 5: 本地计算值 vs 系统值逐字段对比，生成竖向报表
 *
 * 运行命令：
 *   k6 run -e TENANT_ID=3004 -e PACKAGE_ID=1 -e DATE_RANGE=2026-05-04~2026-05-04 channelFunnelVerify.test.js
 *
 * 参数说明：
 *   TENANT_ID    租户ID（必填）
 *   PACKAGE_ID   渠道包ID（必填）
 *   DATE_RANGE   日期范围，格式 YYYY-MM-DD~YYYY-MM-DD（必填）
 *
 * 时区：UTC+5:30（印度时间），与后台系统一致
 */

import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';

const TENANT_ID  = __ENV.TENANT_ID  || '3004';
const PACKAGE_ID = parseInt(__ENV.PACKAGE_ID || '0', 10);
const DATE_RANGE = __ENV.DATE_RANGE || '';

// UTC+5:30 偏移量（毫秒）
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const TAG = 'ChannelFunnelVerify';

export const options = {
    scenarios: {
        channel_funnel_verify: {
            executor:    'per-vu-iterations',
            vus:         1,
            iterations:  1,
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
    const fin = new Date(endDate   + 'T00:00:00Z');
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
 * YYYY-MM-DD → 当天 IST 00:00:00 的 UTC 毫秒时间戳
 * IST = UTC+5:30，所以 IST 00:00:00 = UTC 前一天 18:30:00
 */
function dateToIstStartTs(dateStr) {
    // dateStr 的 00:00:00 IST = UTC 的 dateStr 前一天 18:30:00
    // 等价于：UTC midnight - 5.5h
    const utcMidnight = new Date(dateStr + 'T00:00:00Z').getTime();
    return utcMidnight - IST_OFFSET_MS;
}

function dateToIstEndTs(dateStr) {
    // dateStr 的 23:59:59.999 IST = UTC 的 dateStr 18:29:59.999
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
            registerEndTime:   endTs,
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

/** Step 2: 获取广告消耗数据 */
function fetchAdSpend(adminToken, packageId, dateStr) {
    const result = sendRequest({
        channelPackageId: packageId,
        reportDateStart:  dateStr,
        reportDateEnd:    dateStr,
        pageNo: 1,
        pageSize: 20
    }, '/api/FinanceAdSpend/GetPageList', TAG, false, adminToken);

    if (!result || !result.list || result.list.length === 0) {
        return { spendAmount: 0, impressions: 0, clicks: 0 };
    }
    // 多条记录累加（同一天可能有多条）
    let spendAmount = 0, impressions = 0, clicks = 0;
    result.list.forEach(r => {
        spendAmount  += parseFloat(r.spendAmount  || 0);
        impressions  += parseInt(r.impressions    || 0, 10);
        clicks       += parseInt(r.clicks         || 0, 10);
    });
    return { spendAmount, impressions, clicks };
}

/** Step 3: 获取系统漏斗报表 */
function fetchFunnelReport(adminToken, packageId, dateStr) {
    const result = sendRequest({
        channelPackageId: packageId,
        startTime:        dateStr,
        endTime:          dateStr,
        pageNo: 1,
        pageSize: 20,
        sortField: 'ReportDate',
        orderBy: 1
    }, '/api/RptChannelFunnel/GetPageList', TAG, false, adminToken);

    if (!result || !result.list || result.list.length === 0) return null;
    return result.list[0];
}

/** 查询单用户充值订单（Payed 状态） */
function fetchUserRecharge(adminToken, userId, startTs, endTs) {
    const result = sendRequest({
        userId,
        rechargeState: 'Payed',
        startTime: startTs,
        endTime:   endTs,
        pageNo: 1,
        pageSize: 500,
        dateType: 0,
        orderBy: 'Desc'
    }, '/api/RechargeOrder/GetRechargeOrderPageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户首充/二充/三充记录 */
function fetchUserRptRecharge(adminToken, userId, startDateStr, endDateStr) {
    const result = sendQueryRequest({
        memberIdType: 1,
        memberId:     userId,
        startTime:    `${startDateStr} 00:00:00`,
        endTime:      `${endDateStr} 23:59:59`
    }, '/api/RptUserInfo/GetUserRptRechargePageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户提现订单（Pass 状态） */
function fetchUserWithdraw(adminToken, userId, startTs, endTs) {
    const result = sendRequest({
        userId,
        withdrawState: 'Pass',
        startTime: startTs,
        endTime:   endTs,
        pageNo: 1,
        pageSize: 500,
        dateType: 1,
        orderBy: 'Desc',
        sortField: ''
    }, '/api/WithdrawOrder/GetWithdrawOrderPageList', TAG, false, adminToken);

    return result && result.list ? result.list : [];
}

/** 查询单用户投注记录（5个游戏类型），返回 { betAmount, winAmount } */
function fetchUserBet(adminToken, userId, startTs, endTs) {
    let betAmount = 0, winAmount = 0;
    for (let cat = 0; cat < 5; cat++) {
        try {
            const result = sendQueryRequest({
                categoryType:  cat,
                queryTimeType: 'BetTime',
                userId,
                beginTimeUnix: startTs,
                endTimeUnix:   endTs,
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

/** 查询渠道活动发放总额 */
function fetchActivityAmount(adminToken, packageId, startDateStr, endDateStr) {
    const result = sendQueryRequest({
        memberIdType: 1,
        packageId,
        startTime: `${startDateStr} 00:00:00`,
        endTime:   `${endDateStr} 23:59:59`
    }, '/api/RptUserInfo/GetUserRptActivityPageList', TAG, false, adminToken);

    if (!result || !result.summary) return 0;
    return parseFloat(result.summary.totalAllActivityAmount || 0);
}

// ============================================================
// 本地计算
// ============================================================

function calcMetrics(users, adSpend, startTs, endTs, startDateStr, endDateStr, adminToken, packageId) {
    const { spendAmount, impressions, clicks } = adSpend;
    const registerCount = users.length;

    console.log(`\n[Calc] 开始逐用户查询数据，共 ${registerCount} 人...`);

    let totalRecharge = 0, totalWithdraw = 0;
    let totalBet = 0, totalWin = 0;
    let firstRechargeUsers = 0, firstRechargeAmt = 0;
    let secondRechargeUsers = 0, secondRechargeAmt = 0;
    let thirdRechargeUsers  = 0, thirdRechargeAmt  = 0;
    let betUsers = 0;

    users.forEach((u, idx) => {
        if (idx % 10 === 0 && idx > 0) {
            console.log(`   ...已查询 ${idx}/${registerCount} 人...`);
        }
        sleep(0.2);

        // 充值
        const rechargeList = fetchUserRecharge(adminToken, u.userId, startTs, endTs);
        rechargeList.forEach(r => { totalRecharge += parseFloat(r.actualAmount || 0); });

        // 提现
        const withdrawList = fetchUserWithdraw(adminToken, u.userId, startTs, endTs);
        withdrawList.forEach(r => { totalWithdraw += parseFloat(r.amount || 0); });

        // 投注
        const { betAmount, winAmount } = fetchUserBet(adminToken, u.userId, startTs, endTs);
        totalBet += betAmount;
        totalWin += winAmount;
        if (betAmount > 0) betUsers++;

        // 首充/二充/三充
        const rptList = fetchUserRptRecharge(adminToken, u.userId, startDateStr, endDateStr);
        const hasR1 = rptList.some(r => r.rechargeType === 'R1');
        const hasR2 = rptList.some(r => r.rechargeType === 'R2');
        const hasR3 = rptList.some(r => r.rechargeType === 'R3');

        if (hasR1) {
            firstRechargeUsers++;
            const r1 = rptList.find(r => r.rechargeType === 'R1');
            firstRechargeAmt += parseFloat(r1.actualAmount || r1.rechargeAmount || 0);
        }
        if (hasR2) {
            secondRechargeUsers++;
            const r2 = rptList.find(r => r.rechargeType === 'R2');
            secondRechargeAmt += parseFloat(r2.actualAmount || r2.rechargeAmount || 0);
        }
        if (hasR3) {
            thirdRechargeUsers++;
            const r3 = rptList.find(r => r.rechargeType === 'R3');
            thirdRechargeAmt += parseFloat(r3.actualAmount || r3.rechargeAmount || 0);
        }
    });

    // 活动发放
    const activityAmount = fetchActivityAmount(adminToken, packageId, startDateStr, endDateStr);

    // 派生指标
    const platWinLose   = totalBet - totalWin;
    const platNetProfit = platWinLose - activityAmount;
    const netDeposit    = totalRecharge - totalWithdraw;

    const safe = (n, d) => d === 0 ? 0 : n / d;

    return {
        // 广告
        spendAmount,
        impressions,
        clicks,
        // 注册
        registerCount,
        // 充值漏斗
        firstRechargeUsers,
        firstRechargeAmt,
        secondRechargeUsers,
        secondRechargeAmt,
        thirdRechargeUsers,
        thirdRechargeAmt,
        // 投注
        betUsers,
        totalBet,
        totalWin,
        // 资金
        totalRecharge,
        totalWithdraw,
        netDeposit,
        activityAmount,
        platWinLose,
        platNetProfit,
        // 派生比率
        ctr:                    safe(clicks, impressions),           // 系统返回小数，如 5.0 表示 5%
        cpm:                    safe(spendAmount, impressions) * 1000,
        cpc:                    safe(spendAmount, clicks),
        clickToRegisterRate:    safe(registerCount, clicks),          // 小数
        cpa:                    safe(spendAmount, registerCount),
        registerToFirstRate:    safe(firstRechargeUsers, registerCount), // 小数
        avgFirstRecharge:       safe(firstRechargeAmt, firstRechargeUsers),
        cpfd:                   safe(spendAmount, firstRechargeUsers),
        firstToSecondRate:      safe(secondRechargeUsers, firstRechargeUsers), // 小数
        secondToThirdRate:      safe(thirdRechargeUsers, secondRechargeUsers), // 小数
        costPerSecondRecharge:  safe(spendAmount, secondRechargeUsers),
        costPerThirdRecharge:   safe(spendAmount, thirdRechargeUsers),
        registerToBetRate:      safe(betUsers, registerCount),        // 小数
        avgBetAmount:           safe(totalBet, betUsers),
        costPerBetUser:         safe(spendAmount, betUsers),
        roasRecharge:           safe(totalRecharge, spendAmount),
        roasWinLose:            safe(platWinLose, spendAmount),
        roasNetProfit:          safe(platNetProfit, spendAmount),
        roi:                    safe(platNetProfit - spendAmount, spendAmount),
        userLtv:                safe(platNetProfit, registerCount),
        firstRechargeUserLtv:   safe(platNetProfit, firstRechargeUsers),
        ltvCacRatio:            safe(safe(platNetProfit, firstRechargeUsers), safe(spendAmount, firstRechargeUsers))
    };
}

// ============================================================
// 报表打印（竖向，每行一个指标）
// ============================================================

function printReport(dateStr, calc, sys) {
    const TOL_PCT = 1;   // 金额允许误差 1%
    const TOL_ABS = 1;   // 绝对值允许误差 ±1

    function check(label, calcVal, sysVal, isCount = false) {
        const c = parseFloat(calcVal) || 0;
        const s = parseFloat(sysVal)  || 0;
        let ok;
        if (isCount) {
            ok = c === s;
        } else {
            const diff = Math.abs(c - s);
            ok = diff <= TOL_ABS || (s !== 0 && diff / Math.abs(s) * 100 <= TOL_PCT);
        }
        const icon   = ok ? '✅' : '❌';
        const calcStr = typeof calcVal === 'number' ? calcVal.toFixed(4) : String(calcVal);
        const sysStr  = typeof sysVal  === 'number' ? sysVal.toFixed(4)  : String(sysVal);
        const diffStr = ok ? '' : ` ← 差值: ${(c - s).toFixed(4)}`;
        return `${icon} ${label.padEnd(28)} | 计算: ${calcStr.padStart(12)} | 系统: ${sysStr.padStart(12)}${diffStr}`;
    }

    const sep = '─'.repeat(75);

    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  📊 渠道漏斗验证报表 | 渠道包: ${PACKAGE_ID} | 日期: ${dateStr}`);
    console.log(`${'═'.repeat(75)}`);

    console.log(`\n  ── 广告投放 ──────────────────────────────────────────────────────`);
    console.log(`  ${check('投放消耗(spendAmount)',      calc.spendAmount,      sys.spendAmount)}`);
    console.log(`  ${check('曝光次数(impressions)',      calc.impressions,      sys.impressions,      true)}`);
    console.log(`  ${check('点击次数(clicks)',           calc.clicks,           sys.clicks,           true)}`);
    console.log(`  ${check('点击率CTR(%)',               calc.ctr,              sys.ctr)}`);
    console.log(`  ${check('CPM(千次曝光成本)',          calc.cpm,              sys.cpm)}`);
    console.log(`  ${check('CPC(单次点击成本)',          calc.cpc,              sys.cpc)}`);

    console.log(`\n  ── 注册漏斗 ──────────────────────────────────────────────────────`);
    console.log(`  ${check('注册人数(registerCount)',    calc.registerCount,    sys.registerCount,    true)}`);
    console.log(`  ${check('点击→注册转化率(%)',         calc.clickToRegisterRate, sys.clickToRegisterRate)}`);
    console.log(`  ${check('单注册成本CPA',              calc.cpa,              sys.cpa)}`);

    console.log(`\n  ── 充值漏斗 ──────────────────────────────────────────────────────`);
    console.log(`  ${check('首充人数',                   calc.firstRechargeUsers,  sys.firstRechargeUserCount,  true)}`);
    console.log(`  ${check('注册→首充转化率(%)',          calc.registerToFirstRate, sys.registerToFirstRate)}`);
    console.log(`  ${check('首充金额',                   calc.firstRechargeAmt,    sys.firstRechargeAmount)}`);
    console.log(`  ${check('人均首充',                   calc.avgFirstRecharge,    sys.avgFirstRecharge)}`);
    console.log(`  ${check('单首充成本CPFD',             calc.cpfd,                sys.cpfd)}`);
    console.log(`  ${check('二充人数',                   calc.secondRechargeUsers, sys.secondRechargeUserCount, true)}`);
    console.log(`  ${check('二充金额',                   calc.secondRechargeAmt,   sys.secondRechargeAmount)}`);
    console.log(`  ${check('首充→二充转化率(%)',          calc.firstToSecondRate,   sys.firstToSecondRate)}`);
    console.log(`  ${check('单二充成本',                  calc.costPerSecondRecharge, sys.costPerSecondRecharge)}`);
    console.log(`  ${check('三充人数',                   calc.thirdRechargeUsers,  sys.thirdRechargeUserCount,  true)}`);
    console.log(`  ${check('三充金额',                   calc.thirdRechargeAmt,    sys.thirdRechargeAmount)}`);
    console.log(`  ${check('二充→三充转化率(%)',          calc.secondToThirdRate,   sys.secondToThirdRate)}`);
    console.log(`  ${check('单三充成本',                  calc.costPerThirdRecharge, sys.costPerThirdRecharge)}`);

    console.log(`\n  ── 投注 ──────────────────────────────────────────────────────────`);
    console.log(`  ${check('活跃投注人数',               calc.betUsers,         sys.betUserCount,     true)}`);
    console.log(`  ${check('注册→投注转化率(%)',          calc.registerToBetRate, sys.registerToBetRate)}`);
    console.log(`  ${check('总投注金额(打码量)',          calc.totalBet,         sys.betAmount)}`);
    console.log(`  ${check('人均投注金额',               calc.avgBetAmount,     sys.avgBetAmount)}`);
    console.log(`  ${check('单活跃用户成本',             calc.costPerBetUser,   sys.costPerBetUser)}`);

    console.log(`\n  ── 资金 ──────────────────────────────────────────────────────────`);
    console.log(`  ${check('总充值',                     calc.totalRecharge,    sys.rechargeAmountTotal)}`);
    console.log(`  ${check('总提现',                     calc.totalWithdraw,    sys.withdrawAmountTotal)}`);
    console.log(`  ${check('充提差额(净存款)',            calc.netDeposit,       sys.netDeposit)}`);
    console.log(`  ${check('平台盈亏(投注-派奖)',         calc.platWinLose,      sys.platWinLoseAmount)}`);
    console.log(`  ${check('活动发放金额',               calc.activityAmount,   sys.activityAmount)}`);
    console.log(`  ${check('平台净利润',                 calc.platNetProfit,    sys.platNetProfit)}`);

    console.log(`\n  ── ROI 指标 ──────────────────────────────────────────────────────`);
    console.log(`  ${check('充值ROAS',                   calc.roasRecharge,     sys.roasRecharge)}`);
    console.log(`  ${check('盈亏ROAS',                   calc.roasWinLose,      sys.roasWinLose)}`);
    console.log(`  ${check('净利润ROAS',                 calc.roasNetProfit,    sys.roasNetProfit)}`);
    console.log(`  ${check('ROI',                         calc.roi,              sys.roi)}`);
    console.log(`  ${check('单用户LTV',                  calc.userLtv,          sys.userLtv)}`);
    console.log(`  ${check('首充用户LTV',                calc.firstRechargeUserLtv, sys.firstRechargeUserLtv)}`);
    console.log(`  ${check('LTV/CAC比值',                calc.ltvCacRatio,      sys.ltvCacRatio)}`);

    // 留存率和回本周期：系统值展示，不做本地验证
    console.log(`\n  ── 仅展示（无法本地验证）────────────────────────────────────────`);
    console.log(`  ℹ️  次日留存率(retentionRate_2)  : ${sys.retentionRate_2}`);
    console.log(`  ℹ️  7日留存率(retentionRate_7)   : ${sys.retentionRate_7}`);
    console.log(`  ℹ️  30日留存率(retentionRate_30) : ${sys.retentionRate_30}`);
    console.log(`  ℹ️  回本周期(paybackDays)         : ${sys.paybackDays}`);

    console.log(`\n${'═'.repeat(75)}\n`);
}

// ============================================================
// Setup
// ============================================================

export function setup() {
    if (!PACKAGE_ID) throw new Error('请通过 -e PACKAGE_ID=xxx 传入渠道包ID');
    if (!DATE_RANGE)  throw new Error('请通过 -e DATE_RANGE=YYYY-MM-DD~YYYY-MM-DD 传入日期范围');

    console.log(`\n[Setup] 租户: ${TENANT_ID} | 渠道包: ${PACKAGE_ID} | 日期: ${DATE_RANGE}`);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error('[Setup] 管理员登录失败');
    console.log(`[Setup] ✅ 登录成功`);
    return { adminToken };
}

// ============================================================
// 主流程
// ============================================================

export default function (data) {
    const { adminToken } = data;
    const [startDate, endDate] = parseDateRange(DATE_RANGE);
    const dates = enumerateDates(startDate, endDate);

    console.log(`\n${'='.repeat(75)}`);
    console.log(`🔍 渠道漏斗验证  渠道包=${PACKAGE_ID}  ${startDate}~${endDate}  共${dates.length}天`);
    console.log(`${'='.repeat(75)}\n`);

    dates.forEach(dateStr => {
        console.log(`\n${'─'.repeat(75)}`);
        console.log(`📅 处理日期: ${dateStr}`);
        console.log(`${'─'.repeat(75)}`);

        const startTs     = dateToIstStartTs(dateStr);
        const endTs       = dateToIstEndTs(dateStr);

        // Step 1: 真实注册用户
        console.log(`[Step 1] 获取注册用户列表...`);
        const users = fetchRealUsers(adminToken, PACKAGE_ID, startTs, endTs);
        console.log(`[Step 1] ✅ 真实注册用户: ${users.length} 人`);

        // Step 2: 广告消耗
        console.log(`[Step 2] 获取广告消耗数据...`);
        const adSpend = fetchAdSpend(adminToken, PACKAGE_ID, dateStr);
        console.log(`[Step 2] ✅ 消耗=${adSpend.spendAmount} 曝光=${adSpend.impressions} 点击=${adSpend.clicks}`);

        // Step 3: 系统漏斗报表
        console.log(`[Step 3] 获取系统漏斗报表...`);
        const sysReport = fetchFunnelReport(adminToken, PACKAGE_ID, dateStr);
        if (!sysReport) {
            console.warn(`[Step 3] ⚠️ 系统漏斗报表为空，跳过 ${dateStr}`);
            return;
        }
        console.log(`[Step 3] ✅ 系统报表获取成功`);

        // Step 4: 本地计算
        console.log(`[Step 4] 开始本地计算...`);
        const calcResult = calcMetrics(
            users, adSpend, startTs, endTs,
            dateStr, dateStr,
            adminToken, PACKAGE_ID
        );
        console.log(`[Step 4] ✅ 本地计算完成`);

        // Step 5: 对比报表
        printReport(dateStr, calcResult, sysReport);

        sleep(1);
    });

    console.log(`\n${'='.repeat(75)}`);
    console.log(`✅ 渠道漏斗验证完成`);
    console.log(`${'='.repeat(75)}\n`);
}
