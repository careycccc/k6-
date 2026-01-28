import { fromOptions } from '../config/config.js';
import { commonRequest4, commonRequest3 } from '../config/formreqeust.js';
import { logger } from '../../../../libs/utils/logger.js';


export const DailySummaryTag = 'DailySummaryTag'
const startTime = fromOptions.startTimeSecend
const endTime = fromOptions.endTimeSecend
const channelId = fromOptions.channelId

const payload = {
    dateType: 1,
    pageSize: 200,
    startTime,
    endTime,
}

//平台要返回的对象
let DailySummaryReportData = {
    loginCount: 0,//登录人数
    betUserCount: 0,//投注人数
    totalRegisterCount: 0,//注册人数
    totalBetAmount: 0,//投注金额
    totalFeeAmount: 0,//手续费
    totalActivityAmount: 0,//活动金额
    totalRechargeAmount: 0,//充值金额
    totalRechargeCount: 0,//充值次数
    totalWithdrawCount: 0,//提现次数
    totalWithdrawAmount: 0,//提现金额
    totalPlatNetDeposit: 0,//平台净入款
    totalPlatWinLoseAmount: 0,//平台盈亏
    totalPlatNetProfit: 0,//平台净盈利
    totalBetCount: 0,//投注次数
    totalActiveSummary: {},// 每日活动报表的总计
    totalRechargeSummary: {},// 每日充值报表的总计
    totalWithdrawSummary: {}, // 每日提现报表总计
    totalGameSummary: {},// 每日游戏报表总计
    todayRechargecount1: 0,//首充人数
    todayRechargeamount1: 0,//首充金额
    todayRechargecount2: 0,//二充人数
    todayRechargeamount2: 0,//二充金额
}

/**
 * 查询平台报表
*/
export function queryDailySummaryReportFunc(data) {
    const result = DailySummaryReport(data)
    if (result.list && result.list.length > 0 && result.summary != null) {
        result.list.forEach(item => {
            DailySummaryReportData.loginCount += item.loginCount
            DailySummaryReportData.betUserCount += item.betUserCount
            if (item.rechargeAmount - item.withdrawAmount != item.platNetDeposit) {
                logger.error(`会员汇总的平台净入款的计算不正确，充值金额：${item.rechargeAmount},提现金额${item.withdrawAmount},平台净入款金额：${item.platNetDeposit}`)
                console.log('')
            }
            // 在验证平台净盈利计算时使用容差比较
            const calculatedProfit = item.platNetDeposit + item.platWinLoseAmount;
            if (!isAmountEqual(calculatedProfit, item.platNetProfit)) {
                const diff = Math.abs(calculatedProfit - item.platNetProfit);
                logger.error(`每日汇总的平台净盈利的计算不正确，平台净入款金额：${item.platNetDeposit},平台盈亏金额：${item.platWinLoseAmount},平台净盈利金额：${item.platNetProfit}，计算结果：${calculatedProfit}，差异：${diff}`)
                console.log('')
            }

        })
        DailySummaryReportData = { ...result.summary }
    }
    // 每日活动
    const activeResult = DailyAcitveReport(data)
    if (activeResult.list && activeResult.list.length > 0) {
        // 活动的总计
        DailySummaryReportData.totalActiveSummary = {
            summary: { ...activeResult.summary },
            list: [...activeResult.list]
        }
        // 活动次数进行对比
        if (activeResult.summary.totalActivityCount != DailySummaryReportData.totalBetCount) {
            logger.error(`每日汇总报表${DailySummaryReportData.totalBetCount}和每日活动报表${activeResult.summary.totalActivityCount}的活动次数对不上，`)
            console.log('')
        }
        // 活动金额进行对比
        if (activeResult.summary.totalActivityAmount != DailySummaryReportData.totalActivityAmount) {
        }
        // 活动金额进行对比
        if (activeResult.summary.totalActivityAmount != DailySummaryReportData.totalActivityAmount) {
            logger.error(`每日汇总报表${DailySummaryReportData.totalActivityAmount}和每日活动报表${activeResult.summary.totalActivityAmount}的活动金额对不上，`)
            console.log('')
        }
    }

    // 每日充值
    const rechargeResult = DailyRechargeReport(data)
    if (rechargeResult.list && rechargeResult.list.length > 0) {
        DailySummaryReportData.totalRechargeSummary = { ...rechargeResult.summary }
        // 充值次数 - 充值成功次数 是否等于充值失败的次数
        const totalRechargeCount = rechargeResult.summary.totalRechargeCount;
        const totalRechargeSuccessCount = rechargeResult.summary.totalRechargeSuccessCount;
        const totalRechargeFailCount = rechargeResult.summary.totalRechargeFailCount;
        if (totalRechargeCount - totalRechargeSuccessCount != totalRechargeFailCount) {
            logger.error(`充值次数:${totalRechargeCount} - 充值成功次数:${totalRechargeSuccessCount} 不等于充值失败的次数:${totalRechargeFailCount}`)
        }
        // 充值金额进行对比
        if (rechargeResult.summary.totalRechargeSuccessAmount != DailySummaryReportData.totalRechargeAmount) {
            logger.error(`每日汇总报表${DailySummaryReportData.totalRechargeAmount}和每日充值报表${rechargeResult.summary.totalRechargeSuccessAmount}的充值金额对不上，`)
            console.log('')
        }
    }

    //每日提现
    const withdrawResult = DailyWithdrawReport(data)
    if (withdrawResult.list && withdrawResult.list.length > 0) {
        DailySummaryReportData.totalWithdrawSummary = { ...withdrawResult.summary }
        const WithdrawCount = withdrawResult.summary.totalWithdrawCount
        const WithdrawSuccessCount = withdrawResult.summary.totalWithdrawSuccessCount
        if (WithdrawSuccessCount > WithdrawCount) {
            logger.error(`每日提现报表的每日提现成功次数:${WithdrawSuccessCount}大于来每日提现次数:${WithdrawCount}`)
            console.log('')
        }
        // 提现金额进行对比
        if (withdrawResult.summary.totalWithdrawSuccessAmount != DailySummaryReportData.totalWithdrawAmount) {
            logger.error(`每日汇总报表${DailySummaryReportData.totalWithdrawAmount}和每日提现报表${withdrawResult.summary.totalWithdrawSuccessAmount}的提现金额对不上，`)
            console.log('')
        }
    }

    // 每日游戏报表
    const gameResult = DailyGameReport(data)
    if (gameResult.list && gameResult.list.length > 0) {
        DailySummaryReportData.totalGameSummary = { ...gameResult.summary }
        // 投注金额进行对比
        if (gameResult.summary.totalBetAmount != DailySummaryReportData.totalBetAmount) {
            logger.error(`每日汇总报表${DailySummaryReportData.totalBetAmount}和每日游戏报表${gameResult.summary.totalBetAmount}的投注金额对不上，`)
            console.log('')
        }
    }

    // 渠道查询
    const channelResult = ChannelQuery(data);
    // 记录渠道查询的原始结果
    // console.log('渠道查询原始结果:', JSON.stringify(channelResult));

    // 初始化 channelSummary 变量
    let channelSummary = {
        todayRegisterCount1: 0,
        todayRechargecount1: 0,
        todayRechargeamount1: 0,
        todayRechargecount2: 0,
        todayRechargeamount2: 0,
        todayRechargeSumAmount: 0,
        todayWithdrawSumAmount: 0
    };

    // 修改条件判断，直接检查 channelResult 是否为数组且长度大于0
    if (Array.isArray(channelResult) && channelResult.length > 0) {

        // 使用 reduce 方法进行累加，同时处理数值精度
        channelSummary = channelResult.reduce((acc, item) => ({
            todayRegisterCount1: acc.todayRegisterCount1 + (Number(item.todayRegisterCount1) || 0),
            todayRechargecount1: acc.todayRechargecount1 + (Number(item.todayRechargecount1) || 0),
            todayRechargeamount1: parseFloat((acc.todayRechargeamount1 + (Number(item.todayRechargeamount1) || 0)).toFixed(2)),
            todayRechargecount2: acc.todayRechargecount2 + (Number(item.todayRechargecount2) || 0),
            todayRechargeamount2: parseFloat((acc.todayRechargeamount2 + (Number(item.todayRechargeamount2) || 0)).toFixed(2)),
            todayRechargeSumAmount: parseFloat((acc.todayRechargeSumAmount + (Number(item.todayRechargeSumAmount) || 0)).toFixed(2)),
            todayWithdrawSumAmount: parseFloat((acc.todayWithdrawSumAmount + (Number(item.todayWithdrawSumAmount) || 0)).toFixed(2))
        }), channelSummary);

        // 更新汇总对象
        DailySummaryReportData.todayRechargecount1 = channelSummary.todayRechargecount1;
        DailySummaryReportData.todayRechargeamount1 = channelSummary.todayRechargeamount1;
        DailySummaryReportData.todayRechargecount2 = channelSummary.todayRechargecount2;
        DailySummaryReportData.todayRechargeamount2 = channelSummary.todayRechargeamount2;

        // 记录渠道查询的汇总金额
        DailySummaryReportData.todayRechargeSumAmount = channelSummary.todayRechargeSumAmount;
        DailySummaryReportData.todayWithdrawSumAmount = channelSummary.todayWithdrawSumAmount;
    } else {
        console.log('渠道查询返回空数据或列表不存在');
        console.log('channelResult:', JSON.stringify(channelResult));
    }

    // 定义金额对比的容差函数
    function isAmountEqual(amount1, amount2, tolerance = 0.01) {
        return Math.abs(amount1 - amount2) < tolerance;
    }

    // 渠道数据和平台数据的对比
    if (!isAmountEqual(DailySummaryReportData.totalRegisterCount, channelSummary.todayRegisterCount1)) {
        logger.error(`每日汇总报表${DailySummaryReportData.totalRegisterCount}和渠道查询报表${channelSummary.todayRegisterCount1}的注册人数对不上，`)
        console.log('')
    }
    if (!isAmountEqual(DailySummaryReportData.totalRechargeAmount, channelSummary.todayRechargeSumAmount)) {
        logger.error(`每日汇总报表${DailySummaryReportData.totalRechargeAmount}和渠道查询报表${channelSummary.todayRechargeSumAmount}的充值金额对不上，`)
        console.log('')
    }
    if (!isAmountEqual(DailySummaryReportData.totalWithdrawAmount, channelSummary.todayWithdrawSumAmount)) {
        logger.error(`每日汇总报表${DailySummaryReportData.totalWithdrawAmount}和渠道查询报表${channelSummary.todayWithdrawSumAmount}的提现金额对不上，`)
        console.log('')
    }
    return DailySummaryReportData
}

// 每日汇总报表
export function DailySummaryReport(data) {
    const api = '/api/RptUserActivity/GetPlatRptStatisticPageList'
    return commonRequest3(data, api, payload, DailySummaryTag)
}

//每日活动报表
export function DailyAcitveReport(data) {
    const api = '/api/RptUserActivity/GetDayPlatRptActivityPageList'
    return commonRequest3(data, api, payload, DailySummaryTag)
}

//每日充值报表
export function DailyRechargeReport(data) {
    const api = '/api/RptUserActivity/GetDayPlatRptRechargePageList'
    return commonRequest3(data, api, payload, DailySummaryTag)
}

// 每日提现报表
export function DailyWithdrawReport(data) {
    const api = 'api/RptUserActivity/GetDayPlatRptWithdrawPageList'
    return commonRequest3(data, api, payload, DailySummaryTag)
}

// 每日游戏报表
export function DailyGameReport(data) {
    const api = 'api/RptUserActivity/GetDayPlatRptGamePageList'
    const gamePayload = {
        ...payload,
        IsSummary: false,
        sortField: ''
    }
    return commonRequest3(data, api, gamePayload, DailySummaryTag)
}

// 渠道查询
export function ChannelQuery(data) {
    const api = '/api/RptUserActivity/GetPlatRptChannelPageList'
    const channelPayload = {
        ...payload,
        channelId: channelId,

    }
    return commonRequest4(data, api, channelPayload, DailySummaryTag)
}


// 定义金额对比的容差函数
function isAmountEqual(amount1, amount2, tolerance = 0.01) {
    return Math.abs(amount1 - amount2) < tolerance;
}