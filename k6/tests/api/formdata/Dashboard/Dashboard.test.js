import { sendRequest } from '../../common/request.js';
import { logger } from '../../../../libs/utils/logger.js';
import { getWeekMondayAndTodayEnd } from '../../../utils/utils.js';
import { sleep } from 'k6'

export const Dashboardtag = 'queryDashboard';


// 报表管理 -> 仪表盘

// 仪表盘的游戏投注的详细
const dashboardGameBetCalculation = {
    gameType: [],
    betAmount: 0,   //游戏投注的总金额
    betCount: 0 // 游戏投注的总次数
}

// 仪表盘的时间维度数据统计数组
const dashboardTimeStats = [
    [],  // 注册人数
    [],  // 登录人数
    [],  // 充值金额
    [],  // 充值人数
    [],  // 提现金额
    [],  // 提现人数
    [],  // 投注金额
    [],  // 投注人数
    [],  // 平台盈亏
    [],  // 活动金额
    []   // 平台净盈亏
];
// 仪表盘的时间维度数据统计数组的今日数据
const dashboardTimeStatsToday = []
// 仪表盘的时间维度数据统计数组的昨日数据
const dashboardTimeStatsYesterday = []

// 这个主要是收集仪表盘内的要返回的数据
let yesterdayDashboardData = {
    registerCount: 0,              // 昨日注册人数
    loginUserCount: 0,             // 昨日登录人数
    betUserCount: 0,                // 昨日投注人数
    betAmount: 0,                   // 昨日投注金额
    codingAmount: 0,                // 昨日有效投注
    rechargeAmount: 0,              // 昨日充值金额
    rechargeUserCount: 0,           // 昨日充值人数
    withdrawAmount: 0,              // 昨日提现金额
    withdrawUserCount: 0,           // 昨日提现人数
    firstRechargeUserCount: 0,      // 昨日首充人数
    rechargeCount: 0,               // 昨日充值次数
    withdrawCount: 0,               // 昨日提现次数
    netAmount: 0,                   // 昨日充提差额
    winLoseAmount: 0,                // 昨日平台盈亏
    ActiveAmount: 0, // 昨日活动金额
    PlatformNetProfit: 0, // 昨日平台净盈亏
    betCount: 0,                   // 昨日投注次数
    vipData: {
        vipInfo: [],  // 各个vip分布的信息
        vipCount: 0, // 整个平台的正式账号
    }
}



/**
 * 返回仪表盘的汇总数据
 * @param {*} data
 * @returns {object} // 返回仪表盘的数据汇总，昨日，某些数据是vip的数据是今日的
 */
export function queryDashboardFunc(data) {
    // 矩阵
    const matrix = queryDashboardMatrixFunc(data)
    // 仪表盘的汇总数据
    queryDashboardSummaryFunc(data)
    //仪表盘vip各个阶段的人数统计
    const vipCount = queryDashboardVipFunc(data)
    //仪表盘的游戏投注占比
    const gameData = queryDashboardGameFunc(data)
    //近7日投注/盈亏趋势
    const profitData = queryDashboardProfitFunc(data)
    // 时间维度
    queryDashboardTimeFunc(data)
    // 数据汇总
    const sumargData = queryDashboardSummaryFunc(data)
    const todaySumargData = sumargData.find(item => item.statisticDate == 'Today')
    const yesterdaySumargData = sumargData.find(item => item.statisticDate == 'Yesterday')
    // 近七日的充值趋势
    const seventoup = queryDashboardRechargeWithdrawFunc(data)
    CalculationDashboard(gameData, matrix, profitData, todaySumargData, yesterdaySumargData, seventoup, vipCount)
    return yesterdayDashboardData
}

/**
 * 
 * 主要用了计算和统计仪表盘的数据
 * 
*/
export function CalculationDashboard(gameData, matrix, sevenBetinfo, todaySumargData, yesterdaySumargData, seventoup, vipCount) {
    gameData.forEach(element => {
        dashboardGameBetCalculation.gameType.push({ ...element })
        dashboardGameBetCalculation.betAmount += element.betAmount
        dashboardGameBetCalculation.betCount += element.betCount
    });
    if (sevenBetinfo.length < 0) {
        logger.error('近7日投注/盈亏趋势为空')
    }
    // vip的统计
    if (vipCount.length > 0) {
        let count = 0;
        vipCount.forEach(item => {
            count += item.count
        })
        yesterdayDashboardData.vipData.vipCount = count
        yesterdayDashboardData.vipData.vipInfo = [...vipCount]
    } else {
        logger.error('vip的统计为空')
    }

    // 矩阵和游戏饼状图比较,sevenBetinfo[sevenBetinfo.length-1]表示今日的数据
    const result = compareMatrixAndGame(matrix, dashboardGameBetCalculation, sevenBetinfo[sevenBetinfo.length - 1])
    const result2 = compareMatrixAndSummary(matrix, todaySumargData, yesterdaySumargData, seventoup[seventoup.length - 1])
    if (result && result2) {
        logger.info('仪表盘内数据比对统计正确')
    }

}


/**
 矩阵,游戏饼状图比较和近7日投注/盈亏趋势,时间维度数据统计
 * 
*/
function compareMatrixAndGame(matrix, dashboardGameBetCalculation, sevenBetinfo) {
    // 矩阵
    const mat = matrix.betAmount
    const matUserCount = matrix.betUserCount
    // 饼图
    const BetCalculation = dashboardGameBetCalculation.betAmount
    const BetCalculationCount = dashboardGameBetCalculation.betCount
    // 时间维度数据统计
    const reportNum = dashboardTimeStatsToday[6].reportNum
    const reportCount = dashboardTimeStatsToday[7].reportNum

    // 矩阵的是投注金额，饼图的是有效投注，时间维度数据统计里面的投注也是有效投注
    let count = 0;
    if (dashboardTimeStatsToday.length < 0) {
        logger.error('仪表盘内<-->时间维度数据统计为空')
        console.log('')
        count++
    }

    if (reportNum != BetCalculation) {
        logger.error('仪表盘内<-->时间维度数据统计和饼图的,今日投注金额不相等')
        logger.error(`时间维度数据统计投注金额:${reportNum} 饼图投注金额:${mat}`)
        console.log('')
        count++
    }
    // 矩阵投注人数和时间维度数据统计投注人数比较
    if (reportCount != matUserCount) {
        logger.error('仪表盘内<-->时间维度数据统计和矩阵的,今日投注人数不相等')
        logger.error(`时间维度数据统计投注人数:${reportCount} 矩阵投注人数:${matUserCount}`)
        console.log('')
        count++
    }
    // 近七日的投注和矩阵比较
    if (sevenBetinfo.betAmount != mat) {
        logger.error('仪表盘内<-->近7日投注/盈亏趋势和矩阵的,今日投注金额不相等')
        logger.error(`仪表盘内<-->近7日投注/盈亏趋势投注金额:${sevenBetinfo.betAmount} 矩阵投注金额:${mat}`)
        console.log('')
        count++
    }


    if (count == 0) {
        return true
    }
    return false
}

/**
 * 数据汇总，矩阵，时间维度数据统计,近7日充值/提现趋势 进行比较
 * 
*/
function compareMatrixAndSummary(matrix, summary, yesterdaySummary, toup) {
    let count = 0;
    // 矩阵
    const matrixBetAmount = matrix.betAmount // 今日投注金额
    const matrixBetCount = matrix.betCount // 今日投注次数
    const mattodayIncrease = matrix.todayIncrease // 今日新增
    const matloginUserCount = matrix.loginUserCount // 今日登录
    const matrechargeWithdrawDifference = matrix.rechargeWithdrawDifference // 充值提现差额
    const matbetAmount = matrix.betAmount // 今日投注金额
    const matbetUserCount = matrix.betUserCount // 今日投注人数
    const matbetCount = matrix.betCount // 今日投注次数
    const matplatformProfit = matrix.platformProfit // 平台盈亏
    const matactivityAmount = matrix.activityAmount // 今日活动金额
    const matactivityUserCount = matrix.activityUserCount // 今日活动参与人数
    // 数据汇总
    let summaryObject = summary.statisticDataRsp
    if (typeof summaryObject != 'object') {
        summaryObject = JSON.parse(summaryObject)
    }
    if (summaryObject == null) {
        logger.error('今日数据汇总为空')
        return
    }
    const registerCount = summaryObject.registerCount // 注册人数
    const loginUserCount = summaryObject.loginUserCount // 登录人数
    const firstRechargeUserCount = summaryObject.firstRechargeUserCount // 首充人数
    const betUserCount = summaryObject.betUserCount // 投注人数
    const rechargeUserCount = summaryObject.rechargeUserCount // 充值人数
    const withdrawUserCount = summaryObject.withdrawUserCount // 提现人数
    const rechargeCount = summaryObject.rechargeCount // 充值次数
    const rechargeAmount = summaryObject.rechargeAmount // 充值金额
    const withdrawCount = summaryObject.withdrawCount // 提现次数
    const withdrawAmount = summaryObject.withdrawAmount // 提现金额
    const netAmount = summaryObject.netAmount // 充提差额
    const betAmount = summaryObject.betAmount // 投注金额
    const codingAmount = summaryObject.codingAmount // 有效投注
    const winLoseAmount = summaryObject.winLoseAmount // 平台盈亏
    // 两个进行比较
    if (matrixBetAmount != betAmount) {
        logger.error('数据汇总和矩阵的,今日投注金额不相等')
        logger.error(`数据汇总今日投注金额:${betAmount} 矩阵今日投注金额:${matrixBetAmount}`)
        console.log('')
        count++
    }
    if (mattodayIncrease != registerCount) {
        logger.error('数据汇总和矩阵的,今日新增人数不相等')
        logger.error(`数据汇总今日新增人数:${registerCount} 矩阵今日新增人数:${mattodayIncrease}`)
        console.log('')
        count++
    }
    if (matloginUserCount != loginUserCount) {
        logger.error('数据汇总和矩阵的,今日登录人数不相等')
        logger.error(`数据汇总今日登录人数:${loginUserCount} 矩阵今日登录人数:${matloginUserCount}`)
        console.log('')
        count++
    }
    if (matrechargeWithdrawDifference != netAmount) {
        logger.error('数据汇总和矩阵的,充提差不相等')
        logger.error(`数据汇总充提差:${netAmount} 矩阵充提差:${matrechargeWithdrawDifference}`)
        console.log('')
        count++
    }
    if (matbetAmount != betAmount) {
        logger.error('数据汇总和矩阵的,今日投注金额不相等')
        logger.error(`数据汇总今日投注金额:${betAmount} 矩阵今日投注金额:${matbetAmount}`)
        console.log('')
        count++
    }
    if (matbetUserCount != betUserCount) {
        logger.error('数据汇总和矩阵的,今日投注人数不相等')
        logger.error(`数据汇总今日投注人数:${betUserCount} 矩阵今日投注人数:${matbetUserCount}`)
        console.log('')
        count++
    }
    if (matplatformProfit != winLoseAmount) {
        logger.error('数据汇总和矩阵的,平台盈亏不相等')
        logger.error(`数据汇总平台盈亏:${winLoseAmount} 矩阵平台盈亏:${matplatformProfit}`)
        console.log('')
        count++
    }
    if (toup.rechargeAmount != rechargeAmount) {
        logger.error('数据汇总和近七日的充值提现趋势,今日充值金额不相等')
        logger.error(`数据汇总今日充值金额:${rechargeAmount} 近七日的充值提现趋势今日充值金额:${toup.rechargeAmount}`)
        console.log('')
        count++
    }
    if (toup.withdrawAmount != withdrawAmount) {
        logger.error('数据汇总和近七日的充值提现趋势,今日提现金额不相等')
        logger.error(`数据汇总今日提现金额:${withdrawAmount} 近七日的充值提现趋势今日提现金额:${toup.withdrawAmount}`)
        count++
        console.log('')
    }

    // 时间维度和数据汇总进昨日的数据进行比较
    if (dashboardTimeStatsYesterday.length == 0) {
        logger.error('昨日时间维度数据统计为空')
        return
    }
    let yesterdaySummaryObject = yesterdaySummary.statisticDataRsp
    if (typeof summaryObject != 'object') {
        yesterdaySummaryObject = JSON.parse(yesterdaySummaryObject)
    }
    if (yesterdaySummaryObject == null) {
        logger.error('昨日数据汇总为空')
        return
    }
    // 昨日数据汇总为yesterdayDashboardData对象赋值
    yesterdayDashboardData.registerCount = yesterdaySummaryObject.registerCount
    yesterdayDashboardData.loginUserCount = yesterdaySummaryObject.loginUserCount
    yesterdayDashboardData.betUserCount = yesterdaySummaryObject.betUserCount
    yesterdayDashboardData.betAmount = yesterdaySummaryObject.betAmount
    yesterdayDashboardData.codingAmount = yesterdaySummaryObject.codingAmount
    yesterdayDashboardData.rechargeAmount = yesterdaySummaryObject.rechargeAmount
    yesterdayDashboardData.rechargeUserCount = yesterdaySummaryObject.rechargeUserCount
    yesterdayDashboardData.withdrawAmount = yesterdaySummaryObject.withdrawAmount
    yesterdayDashboardData.withdrawUserCount = yesterdaySummaryObject.withdrawUserCount
    yesterdayDashboardData.firstRechargeUserCount = yesterdaySummaryObject.firstRechargeUserCount
    yesterdayDashboardData.rechargeCount = yesterdaySummaryObject.rechargeCount
    yesterdayDashboardData.withdrawCount = yesterdaySummaryObject.withdrawCount
    yesterdayDashboardData.netAmount = yesterdaySummaryObject.netAmount
    yesterdayDashboardData.winLoseAmount = yesterdaySummaryObject.winLoseAmount
    yesterdayDashboardData.ActiveAmount = yesterdaySummaryObject.activityAmount
    yesterdayDashboardData.PlatformNetProfit = yesterdaySummaryObject.platformNetProfit
    yesterdayDashboardData.betCount = yesterdaySummaryObject.betCount
    // 昨日数据汇总变量
    const yesterdayRegisterCount = yesterdaySummaryObject.registerCount // 昨日注册人数
    const yesterdayLoginUserCount = yesterdaySummaryObject.loginUserCount // 昨日登录人数
    const yesterdayFirstRechargeUserCount = yesterdaySummaryObject.firstRechargeUserCount // 昨日首充人数
    const yesterdayBetUserCount = yesterdaySummaryObject.betUserCount // 昨日投注人数
    const yesterdayRechargeUserCount = yesterdaySummaryObject.rechargeUserCount // 昨日充值人数
    const yesterdayWithdrawUserCount = yesterdaySummaryObject.withdrawUserCount // 昨日提现人数
    const yesterdayRechargeCount = yesterdaySummaryObject.rechargeCount // 昨日充值次数
    const yesterdayRechargeAmount = yesterdaySummaryObject.rechargeAmount // 昨日充值金额
    const yesterdayWithdrawCount = yesterdaySummaryObject.withdrawCount // 昨日提现次数
    const yesterdayWithdrawAmount = yesterdaySummaryObject.withdrawAmount // 昨日提现金额
    const yesterdayNetAmount = yesterdaySummaryObject.netAmount // 昨日充提差额
    const yesterdayBetAmount = yesterdaySummaryObject.betAmount // 昨日投注金额
    const yesterdayCodingAmount = yesterdaySummaryObject.codingAmount // 昨日有效投注
    const yesterdayWinLoseAmount = yesterdaySummaryObject.winLoseAmount // 昨日平台盈亏


    // 昨日时间维度数据统计
    const dashboardRegisterCount = dashboardTimeStatsYesterday[0].reportNum
    const dashboardLoginUserCount = dashboardTimeStatsYesterday[1].reportNum
    const dashboardRechargeAmount = dashboardTimeStatsYesterday[2].reportNum
    const dashboardRechargeUserCount = dashboardTimeStatsYesterday[3].reportNum
    const dashboardWithdrawAmount = dashboardTimeStatsYesterday[4].reportNum
    const dashboardWithdrawUserCount = dashboardTimeStatsYesterday[5].reportNum
    const dashboradBetAmount = dashboardTimeStatsYesterday[6].reportNum
    const dashboradBetUserCount = dashboardTimeStatsYesterday[7].reportNum
    const dashboradWinLoseAmount = dashboardTimeStatsYesterday[8].reportNum
    const dashboradActiveAmount = dashboardTimeStatsYesterday[9].reportNum // 昨日的活动金额
    const dashboradPlatformNetProfit = dashboardTimeStatsYesterday[10].reportNum // 昨日的平台净利

    yesterdayDashboardData.PlatformNetProfit = dashboradPlatformNetProfit
    yesterdayDashboardData.ActiveAmount = dashboradActiveAmount

    if (dashboardRegisterCount != yesterdayRegisterCount) {
        logger.error('数据汇总和时间维度数据统计的,昨日注册人数不相等')
        logger.error(`数据汇总昨日注册人数:${yesterdayRegisterCount} 时间维度数据统计的昨日注册人数:${dashboardReisterNumber}`)
        count++
        console.log('')
    }
    if (dashboardLoginUserCount != yesterdayLoginUserCount) {
        logger.error('数据汇总和时间维度数据统计的,昨日登录人数不相等')
        logger.error(`数据汇总昨日登录人数:${yesterdayLoginUserCount} 时间维度数据统计的昨日登录人数:${dashboardLoginUserCount}`)
        count++
        console.log('')
    }

    if (dashboardRechargeAmount != yesterdayRechargeAmount) {
        logger.error('数据汇总和时间维度数据统计的,昨日充值金额不相等')
        logger.error(`数据汇总昨日充值金额:${yesterdayRechargeAmount} 时间维度数据统计的昨日充值金额:${dashboardRechargeAmount}`)
        count++
        console.log('')
    }
    if (dashboardRechargeUserCount != yesterdayRechargeUserCount) {
        logger.error('数据汇总和时间维度数据统计的,昨日充值人数不相等')
        logger.error(`数据汇总昨日充值人数:${yesterdayRechargeUserCount} 时间维度数据统计的昨日充值人数:${dashboardRechargeUserCount}`)
        count++
        console.log('')
    }
    if (dashboardWithdrawAmount != yesterdayWithdrawAmount) {
        logger.error('数据汇总和时间维度数据统计的,昨日提现金额不相等')
        logger.error(`数据汇总昨日提现金额:${yesterdayWithdrawAmount} 时间维度数据统计的昨日提现金额:${dashboardWithdrawAmount}`)
        count++
        console.log('')
    }

    if (dashboardWithdrawUserCount != yesterdayWithdrawUserCount) {
        logger.error('数据汇总和时间维度数据统计的,昨日提现人数不相等')
        logger.error(`数据汇总昨日提现人数:${yesterdayWithdrawUserCount} 时间维度数据统计的昨日提现人数:${dashboardWithdrawUserCount}`)
        count++
        console.log('')
    }

    if (dashboradBetAmount != yesterdayBetAmount) {
        logger.error('数据汇总和时间维度数据统计的,昨日投注金额不相等')
        logger.error(`数据汇总昨日投注金额:${yesterdayBetAmount} 时间维度数据统计的昨日投注金额:${dashboradBetAmount}`)
        count++
        console.log('')
    }

    if (dashboradBetUserCount != yesterdayBetUserCount) {
        logger.error('数据汇总和时间维度数据统计的,昨日投注人数不相等')
        logger.error(`数据汇总昨日投注人数:${yesterdayBetUserCount} 时间维度数据统计的昨日投注人数:${dashboradBetUserCount}`)
        count++
        console.log('')

    }

    if (dashboradWinLoseAmount != yesterdayWinLoseAmount) {
        logger.error('数据汇总和时间维度数据统计的,昨日平台盈亏不相等')
        logger.error(`数据汇总昨日平台盈亏:${yesterdayWinLoseAmount} 时间维度数据统计的昨日平台盈亏:${dashboradWinLoseAmount}`)
        count++
        console.log('')
    }
    if (count == 0) {
        return true;
    } else {
        return false;
    }

}
/**
 仪表盘的矩阵的数据
 * 
 * @returns {object} 矩阵的数据
*/
export function queryDashboardMatrixFunc(data) {
    const api = '/api/RptDashBoard/GetOverviewData'
    const token = data.token;
    const payload = {};
    let result = sendRequest(payload, api, Dashboardtag, false, token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    // 这里包括了
    if (result) {
        return {
            todayIncrease: result.todayIncrease, // 今日新增人数
            firstRechargeUserCount: result.firstRechargeUserCount, // 首充人数
            loginUserCount: result.loginUserCount, // 今日登录人数
            totalUserCount: result.totalUserCount, // 总用户数(不包括测试用户)
            rechargeWithdrawDifference: result.rechargeWithdrawDifference, // 充值提现差额
            rechargeAmount: result.rechargeAmount, // 今日充值金额
            rechargeUserCount: result.rechargeUserCount, // 今日充值人数
            withdrawAmount: result.withdrawAmount, // 今日提现金额
            withdrawUserCount: result.withdrawUserCount, // 今日提现人数
            betAmount: result.betAmount, // 今日投注金额
            betUserCount: result.betUserCount, // 今日投注人数
            betCount: result.betCount, // 今日投注次数
            platformProfit: result.platformProfit, // 平台盈亏
            activityAmount: result.activityAmount, // 今日活动金额
            activityUserCount: result.activityUserCount, // 今日活动人数
        };
    }
    return {};
}

/**
 * 仪表盘vip各个阶段的人数统计
 * 
*/
export function queryDashboardVipFunc(data) {
    const api = '/api/RptDashBoard/GetVipLevelUserCount'
    return commonFunc(data, api);
}

/**
 * 仪表盘的游戏投注占比
 * 
*/

export function queryDashboardGameFunc(data) {
    const api = '/api/RptDashBoard/GetGameTypeBetList'
    return commonFunc(data, api);
}

/**
 仪表盘的汇总数据
 * 
 * 
*/
export function queryDashboardSummaryFunc(data) {
    // 仪表盘的数据汇总的数据
    const api = '/api/RptDashBoard/GetPlatStatisticsData';
    return commonFunc(data, api);
}

/**
 * 近7日投注/盈亏趋势
*/
export function queryDashboardProfitFunc(data) {
    const api = '/api/RptDashBoard/GetRecentSevenBetWinLoseData'
    return commonFunc(data, api);
}

/**
 * 近七日充值和提现
*/

export function queryDashboardRechargeWithdrawFunc(data) {
    const api = '/api/RptDashBoard/GetRecentSevenRechargeWithdrawData'
    return commonFunc(data, api);
}

/**
 * 时间维度数据统计
 * @returns {object} 注册人数，登录人数，充值金额，充值人数，提现金额，提现人数，投注金额，投注人数，投注次数，平台盈亏，活动金额，平台净盈亏
*/
export function queryDashboardTimeFunc(data) {
    const api = '/api/RptDashBoard/GetPlatLineChartList'
    const token = data.token;
    for (let i = 0; i <= dashboardTimeStats.length - 1; i++) {
        sleep(0.5)
        const arr = commonFunc2(api, i, token)
        dashboardTimeStats[i] = arr
        if (arr && arr.length > 0) {
            dashboardTimeStatsToday.push(arr[arr.length - 1])
            dashboardTimeStatsYesterday.push(arr[arr.length - 2])
        }
    }
    return dashboardTimeStatsToday
}


/**
 * 公共函数返回一个
*/
function commonFunc(data, api) {
    const token = data.token;
    const payload = {};
    let result = sendRequest(payload, api, Dashboardtag, false, token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    // 这里包括了
    if (result && result.length > 0) {
        return result;
    }
    return [];
}

// 公共请求函数2
function commonFunc2(api, index, token) {
    const timeObjct = getWeekMondayAndTodayEnd()
    const payload = {
        endTime: timeObjct.todayEnd,
        lineChartType: index,
        startTime: timeObjct.weekMonday,
        typeList: []
    };
    let result = sendRequest(payload, api, Dashboardtag, false, token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    // 这里包括了
    if (result && result.length > 0) {
        return result;
    }
    return [];
}

