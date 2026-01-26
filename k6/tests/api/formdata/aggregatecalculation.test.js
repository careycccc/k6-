import { logger } from "../../../libs/utils/logger.js";


/**
 * 执行数据对比分析函数
 * 该函数接收一个结果数组，筛选出成功且包含数据的报表，然后对这些报表进行两两对比分析
 * @param {Array} results - 包含多个报表结果的数组，每个报表结果应包含success和data属性
 */
export function performDataComparison(results) {
    // console.log('单个表的数据', results)
    // 筛选出成功且包含数据的报表
    // const successReports = results.filter((r) => r.success && r.data);
    // results.forEach(item => {
    //     console.log('')
    //     console.log(item)
    //     console.log('')
    // })
    if (results.length < 2) {
        logger.error('执行数据对比分析函数的接受值的少于两项', results.length)
        return
    }
    // 仪表盘的汇总数据和数据统计的进行对比分析
    // 仪表盘汇总的数据
    const dashboardRegisterNumber = results[0].data.registerCount;
    const dashboardRechargeAmount = results[0].data.rechargeAmount;
    const dashboardcodingAmount = results[0].data.codingAmount;
    const dashboardwithdrawAmount = results[0].data.withdrawAmount;
    const dashboardwinLoseAmount = results[0].data.winLoseAmount;
    const dashboardfirstRechargeUserCount = results[0].data.firstRechargeUserCount;
    const dashboardbetAmount = results[0].data.betAmount;
    const dashboradbetUserCount = results[0].data.betUserCount;
    const dashboardwithdrawCount = results[0].data.withdrawCount;
    const dashboardrechargeCount = results[0].data.rechargeCount;
    const dashboardActiveAmount = results[0].data.activeAmount;
    const dashboardloginUserCount = results[0].data.loginUserCount;


    // 数据统计的数据
    const dataStatisticsRegisterNumber = results[1].data.SummaryView.registerCount;
    const dataStatisticsRechargeAmount = results[1].data.SummaryView.rechargeAmount;
    const dataStatisticscodingAmount = results[1].data.SummaryView.betAmount;
    const dataStatisticswithdrawAmount = results[1].data.SummaryView.withdrawAmount;
    const dataStatisticswinLoseAmount = results[1].data.SummaryView.winLoseAmount;
    const dataStatisticsfirstRechargeUserCount = results[1].data.RechargeWithdraw;
    // 需要找到首充值，R1
    const r1Type = dataStatisticsfirstRechargeUserCount.find(item => item.type == 'R1')
    const dataStatisticsinformation = results[1].data.information
    const plantinfoTotal = dataStatisticsinformation.find(item => item.name == '平台详情总计')
    let plantinfoTotalData = plantinfoTotal.data
    if (typeof plantinfoTotalData != 'object') {
        plantinfoTotalData = JSON.parse(plantinfoTotalData)
    }
    const dataStatisticsbetAmount = plantinfoTotalData.betAmount
    const dataStatisticsbetUserCount = plantinfoTotalData.userCount
    // 数据统计的平台的手续费
    const dataStatisticsplatformFee = plantinfoTotalData.feeAmount

    // 提现通道总计
    const withdrawChannelTotal = dataStatisticsinformation.find(item => item.name == '提现通道详情总计')
    let withdrawChannelTotalData = withdrawChannelTotal.data
    if (typeof withdrawChannelTotalData != 'object') {
        withdrawChannelTotalData = JSON.parse(withdrawChannelTotalData)
    }
    const dataStatisticswithdrawCount = withdrawChannelTotalData.count

    // 充值通道总计
    const rechargeChannelTotal = dataStatisticsinformation.find(item => item.name == '充值通道详情总计')
    let rechargeChannelTotalData = rechargeChannelTotal.data
    if (typeof rechargeChannelTotalData != 'object') {
        rechargeChannelTotalData = JSON.parse(rechargeChannelTotalData)
    }
    const dataStatisticsrechargeCount = rechargeChannelTotalData.count

    // 活动总计
    const activityTotal = dataStatisticsinformation.find(item => item.name == '活动详情总计')
    let activityTotalData = activityTotal.data
    if (typeof activityTotalData != 'object') {
        activityTotalData = JSON.parse(activityTotalData)
    }
    const dataStatisticsactiveAmount = activityTotalData.amount // 活动金额
    const dataStatisticsactiveCount = activityTotalData.count // 活动次数
    const dataStatisticsactiveUserCount = activityTotalData.userCount // 活动领取人数

    // 对比分析
    if (dashboardRegisterNumber !== dataStatisticsRegisterNumber) {
        logger.error(`注册人数对不上 -- 仪表盘汇总的数据${dashboardRegisterNumber}<--->数据统计的数据${dataStatisticsRegisterNumber}`)
        console.log('')
    }
    if (dashboardRechargeAmount !== dataStatisticsRechargeAmount) {
        logger.error(`充值金额对不上 -- 仪表盘汇总的数据${dashboardRechargeAmount}<--->数据统计的数据${dataStatisticsRechargeAmount}`)
        console.log('')
    }
    if (dashboardcodingAmount !== dataStatisticscodingAmount) {
        logger.error(`有效投注对不上 -- 仪表盘汇总的数据${dashboardcodingAmount}<--->数据统计的数据${dataStatisticscodingAmount}`)
        console.log('')
    }
    if (dashboardwithdrawAmount !== dataStatisticswithdrawAmount) {
        logger.error(`提现金额对不上 -- 仪表盘汇总的数据${dashboardwithdrawAmount}<--->数据统计的数据${dataStatisticswithdrawAmount}`)
        console.log('')
    }

    // 使用绝对值比较平台盈亏
    if (Math.abs(dashboardwinLoseAmount) !== Math.abs(dataStatisticswinLoseAmount)) {
        logger.error(`平台盈亏对不上 -- 仪表盘汇总的数据${dashboardwinLoseAmount}<--->数据统计的数据${dataStatisticswinLoseAmount}`)
        console.log('')
    }

    if (dashboardfirstRechargeUserCount !== r1Type.userCount) {
        logger.error(`首充人数对不上 -- 仪表盘汇总的数据${dashboardfirstRechargeUserCount}<--->数据统计的数据${r1Type.userCount}`)
        console.log('')
    }

    if (dashboardbetAmount !== dataStatisticsbetAmount) {
        logger.error(`投注金额对不上 -- 仪表盘汇总的数据${dashboardbetAmount}<--->数据统计的数据${dataStatisticsbetAmount}`)
        console.log('')
    }

    if (dashboradbetUserCount !== dataStatisticsbetUserCount) {
        logger.error(`投注人数对不上 -- 仪表盘汇总的数据${dashboradbetUserCount}<--->数据统计的数据${dataStatisticsbetUserCount}`)
        console.log('')
    }
    if (dashboardwithdrawCount !== dataStatisticswithdrawCount) {
        logger.error(`提现次数对不上 -- 仪表盘汇总的数据${dashboardwithdrawCount}<--->数据统计的数据${dataStatisticswithdrawCount}`)
        console.log('')
    }

    if (dashboardrechargeCount !== dataStatisticsrechargeCount) {
        logger.error(`充值次数对不上 -- 仪表盘汇总的数据${dashboardrechargeCount}<--->数据统计的数据${dataStatisticsrechargeCount}`)
        console.log('')
    }

    if (dashboardActiveAmount !== dataStatisticsactiveAmount) {
        logger.error(`活动金额对不上 -- 仪表盘汇总的数据${dashboardActiveAmount}<--->数据统计的数据${dataStatisticsactiveAmount}`)
        console.log('')
    }

    // 平台报表 和 仪表盘，或者数据统计进行比较
    const DailyRegisterCount = results[2].data.totalRegisterCount
    const DailyloginCount = results[2].data.loginCount
    const DailybetUserCount = results[2].data.betUserCount
    const DailytotalBetAmount = results[2].data.totalBetAmount
    const DailyplatformFee = results[2].data.totalFeeAmount
    // 中奖金额
    const DailytotalWinAmount = results[2].data.totalWinAmount
    const DailytotalActivityAmount = results[2].data.totalActivityAmount

    if (DailyRegisterCount != dataStatisticsRegisterNumber) {
        logger.error(`注册人数对不上 -- 平台报表的数据${DailyRegisterCount}<--->数据统计的数据${dataStatisticsRegisterNumber}`)
        console.log('')
    }
    if (DailyloginCount != dashboardloginUserCount) {
        logger.error(`登录人数对不上 -- 平台报表的数据${DailyloginCount}<--->仪表盘的汇总数据${dashboardloginUserCount}`)
        console.log('')
    }

    if (dashboradbetUserCount != DailybetUserCount) {
        logger.error(`投注人数对不上 -- 平台报表的数据${DailybetUserCount}<--->仪表盘的汇总数据${dashboradbetUserCount}`)
        console.log('')

    }
    if (DailytotalBetAmount != dashboardbetAmount) {
        logger.error(`投注金额对不上 -- 平台报表的数据${DailytotalBetAmount}<--->仪表盘的汇总数据${dashboardbetAmount}`)
        console.log('')
    }

    if (DailyplatformFee != dataStatisticsplatformFee) {
        logger.error(`手续费对不上 -- 平台报表的数据${DailyplatformFee}<--->数据统计的数据${dataStatisticsplatformFee}`)
        console.log('')
    }

    if (DailytotalActivityAmount != dataStatisticsactiveAmount) {
        logger.error(`活动金额对不上 -- 平台报表的数据${DailytotalActivityAmount}<--->数据统计的数据${dataStatisticsactiveAmount}`)
        console.log('')
    }
}
