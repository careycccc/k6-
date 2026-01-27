import { logger } from '../../../libs/utils/logger.js';

/**
 * 执行数据对比分析函数
 * 该函数接收一个结果数组，筛选出成功且包含数据的报表，然后对这些报表进行两两对比分析
 * @param {Array} results - 包含多个报表结果的数组，每个报表结果应包含success和data属性
 */
export function performDataComparison(results) {
    try {
        // 添加日志，确认函数被调用
        // 防护：确保 results 是数组，避免 undefined 导致读取 length 出错

        // 检查 results 是否有效
        if (!results || results.length < 3) {
            logger.error('执行数据对比分析函数的接受值的少于三项', results ? results.length : 0);
            return;
        }

        // 检查每个 result 是否有效
        for (let i = 0; i < results.length; i++) {
            if (!results[i] || !results[i].data) {
                logger.error(`results[${i}] 无效或缺少 data 属性`, results[i]);
                return;
            }
        }

        // 仪表盘的汇总数据和数据统计的进行对比分析
        // 仪表盘汇总的数据
        /**
         * 从results数组中提取仪表盘相关的数据
         * 这些数据包含了注册人数、充值金额、编码金额等多种统计信息
         */
        const dashboardRegisterNumber = results[0].data.registerCount;    // 仪表盘注册人数
        const dashboardRechargeAmount = results[0].data.rechargeAmount;  // 仪表盘充值金额

        const dashboardcodingAmount = results[0].data.codingAmount;      // 仪表盘编码金额
        const dashboardwithdrawAmount = results[0].data.withdrawAmount;   // 仪表盘提现金额
        const dashboardwinLoseAmount = results[0].data.winLoseAmount;     // 仪表盘输赢金额
        const dashboardfirstRechargeUserCount = results[0].data.firstRechargeUserCount;  // 仪表盘首次充值用户数
        const dashboardbetAmount = results[0].data.betAmount;            // 仪表盘下注金额
        const dashboradbetUserCount = results[0].data.betUserCount;      // 仪表盘下注用户数
        const dashboardwithdrawCount = results[0].data.withdrawCount;     // 仪表盘提现次数
        const dashboardrechargeCount = results[0].data.rechargeCount;    // 仪表盘充值次数
        const dashboardActiveAmount = results[0].data.ActiveAmount;       // 仪表盘活跃金额
        const dashboardloginUserCount = results[0].data.loginUserCount;   // 仪表盘登录用户数

        // 数据统计的数据
        // 从results[1].data中获取各类统计数据
        // 注册用户数量
        const dataStatisticsRegisterNumber = results[1].data.SummaryView.registerCount;
        // 充值金额
        const dataStatisticsRechargeAmount = results[1].data.SummaryView.rechargeAmount;
        // 下注金额
        const dataStatisticscodingAmount = results[1].data.SummaryView.betAmount;
        /**
         * 从results数组中提取统计数据
         * 这些数据包括提现金额、输赢金额和首次充值用户数
         */
        const dataStatisticswithdrawAmount = results[1].data.SummaryView.withdrawAmount; // 提取提现金额数据
        const dataStatisticswinLoseAmount = results[1].data.SummaryView.winLoseAmount; // 提取输赢金额数据
        const dataStatisticsfirstRechargeUserCount = results[1].data.RechargeWithdraw;
        // 需要找到首充值，R1
        const r1Type = dataStatisticsfirstRechargeUserCount.find((item) => item.type == 'R1');

        // 检查 r1Type 是否存在
        if (!r1Type) {
            logger.error('未找到类型为 R1 的首充值数据');
            return;
        }

        const dataStatisticsinformation = results[1].data.information;

        // 检查 dataStatisticsinformation 是否存在
        if (!dataStatisticsinformation) {
            logger.error('results[1].data.information 不存在');
            return;
        }

        const plantinfoTotal = dataStatisticsinformation.find((item) => item.name == '平台详情总计');

        // 检查 plantinfoTotal 是否存在
        if (!plantinfoTotal) {
            logger.error('未找到名称为"平台详情总计"的数据');
            return;
        }

        let plantinfoTotalData = plantinfoTotal.data;
        if (typeof plantinfoTotalData != 'object') {
            plantinfoTotalData = JSON.parse(plantinfoTotalData);
        }

        const dataStatisticsbetAmount = plantinfoTotalData.betAmount;
        const dataStatisticsbetUserCount = plantinfoTotalData.userCount;
        // 数据统计的平台的手续费
        const dataStatisticsplatformFee = plantinfoTotalData.feeAmount;

        // 提现通道总计
        const withdrawChannelTotal = dataStatisticsinformation.find(
            (item) => item.name == '提现通道详情总计'
        );

        // 检查 withdrawChannelTotal 是否存在
        if (!withdrawChannelTotal) {
            logger.error('未找到名称为"提现通道详情总计"的数据');
            return;
        }

        let withdrawChannelTotalData = withdrawChannelTotal.data;
        if (typeof withdrawChannelTotalData != 'object') {
            withdrawChannelTotalData = JSON.parse(withdrawChannelTotalData);
        }
        const dataStatisticswithdrawCount = withdrawChannelTotalData.count;

        // 充值通道总计
        const rechargeChannelTotal = dataStatisticsinformation.find(
            (item) => item.name == '充值通道详情总计'
        );

        // 检查 rechargeChannelTotal 是否存在
        if (!rechargeChannelTotal) {
            logger.error('未找到名称为"充值通道详情总计"的数据');
            return;
        }

        let rechargeChannelTotalData = rechargeChannelTotal.data;
        if (typeof rechargeChannelTotalData != 'object') {
            rechargeChannelTotalData = JSON.parse(rechargeChannelTotalData);
        }
        // 充值成功的次数
        const dataStatisticsrechargeCount = rechargeChannelTotalData.count;
        // 充值成功的人数
        const dataStatisticsrechargeUserCount = rechargeChannelTotalData.userCount;

        // 活动总计
        const activityTotal = dataStatisticsinformation.find((item) => item.name == '活动详情总计');

        // 检查 activityTotal 是否存在
        if (!activityTotal) {
            logger.error('未找到名称为"活动详情总计"的数据');
            return;
        }

        let activityTotalData = activityTotal.data;
        if (typeof activityTotalData != 'object') {
            activityTotalData = JSON.parse(activityTotalData);
        }
        const dataStatisticsactiveAmount = activityTotalData.amount; // 活动金额
        const dataStatisticsactiveCount = activityTotalData.count; // 活动次数
        const dataStatisticsactiveUserCount = activityTotalData.userCount; // 活动领取人数

        // 对比分析
        if (dashboardRegisterNumber !== dataStatisticsRegisterNumber) {
            logger.error(
                `注册人数对不上 -- 仪表盘汇总的数据${dashboardRegisterNumber}<--->数据统计的数据${dataStatisticsRegisterNumber}`
            );
            console.log('');
        }
        if (dashboardRechargeAmount !== dataStatisticsRechargeAmount) {
            logger.error(
                `充值金额对不上 -- 仪表盘汇总的数据${dashboardRechargeAmount}<--->数据统计的数据${dataStatisticsRechargeAmount}`
            );
            console.log('');
        }
        if (dashboardcodingAmount !== dataStatisticscodingAmount) {
            logger.error(
                `有效投注对不上 -- 仪表盘汇总的数据${dashboardcodingAmount}<--->数据统计的数据${dataStatisticscodingAmount}`
            );
            console.log('');
        }
        if (dashboardwithdrawAmount !== dataStatisticswithdrawAmount) {
            logger.error(
                `提现金额对不上 -- 仪表盘汇总的数据${dashboardwithdrawAmount}<--->数据统计的数据${dataStatisticswithdrawAmount}`
            );
            console.log('');
        }

        // 使用绝对值比较平台盈亏
        if (Math.abs(dashboardwinLoseAmount) !== Math.abs(dataStatisticswinLoseAmount)) {
            logger.error(
                `平台盈亏对不上 -- 仪表盘汇总的数据${dashboardwinLoseAmount}<--->数据统计的数据${dataStatisticswinLoseAmount}`
            );
            console.log('');
        }

        if (dashboardfirstRechargeUserCount !== r1Type.userCount) {
            logger.error(
                `首充人数对不上 -- 仪表盘汇总的数据${dashboardfirstRechargeUserCount}<--->数据统计的数据${r1Type.userCount}`
            );
            console.log('');
        }

        if (dashboardbetAmount !== dataStatisticsbetAmount) {
            logger.error(
                `投注金额对不上 -- 仪表盘汇总的数据${dashboardbetAmount}<--->数据统计的数据${dataStatisticsbetAmount}`
            );
            console.log('');
        }

        if (dashboradbetUserCount !== dataStatisticsbetUserCount) {
            logger.error(
                `投注人数对不上 -- 仪表盘汇总的数据${dashboradbetUserCount}<--->数据统计的数据${dataStatisticsbetUserCount}`
            );
            console.log('');
        }
        if (dashboardwithdrawCount !== dataStatisticswithdrawCount) {
            logger.error(
                `提现次数对不上 -- 仪表盘汇总的数据${dashboardwithdrawCount}<--->数据统计的数据${dataStatisticswithdrawCount}`
            );
            console.log('');
        }

        if (dashboardrechargeCount !== dataStatisticsrechargeCount) {
            logger.error(
                `充值次数对不上 -- 仪表盘汇总的数据${dashboardrechargeCount}<--->数据统计的数据${dataStatisticsrechargeCount}`
            );
            console.log('');
        }

        if (dashboardActiveAmount !== dataStatisticsactiveAmount) {
            logger.error(
                `活动金额对不上 -- 仪表盘汇总的数据${dashboardActiveAmount}<--->数据统计的数据${dataStatisticsactiveAmount}`
            );
            console.log('');
        }

        // console.log('');
        // console.log('[2]---->>>', results);
        // console.log('');

        // 添加日志，确认代码执行到这里
        console.log('准备处理平台报表数据');

        // 检查 results[2] 是否存在
        if (!results[2] || !results[2].data) {
            logger.error('results[2] 无效或缺少 data 属性', results[2]);
            return;
        }

        // 平台报表 和 仪表盘，或者数据统计进行比较
        /**
         * 从结果数据中提取每日统计数据
         * 这些数据包括注册、登录、投注、充值、提现等多个维度的统计信息
         */
        // 每日注册用户总数
        /**
         * 从results[2].data中提取每日相关统计数据
         * 这些数据包括注册、登录、投注、充值、提现、活动等多个维度的统计信息
         */
        // 每日注册用户数
        const DailyRegisterCount = results[2].data.totalRegisterCount;
        // 每日登录用户数
        const DailyloginCount = results[2].data.totalLoginCount;
        const DailybetUserCount = results[2].data.totalBetUserCount;
        const DailytotalBetAmount = results[2].data.totalBetAmount;
        const DailyplatformFee = results[2].data.totalFeeAmount;
        // 派奖金额
        const DailytotalGameSummaryinfo = results[2].data.totalGameSummary
        const DailytotalWinAmount = DailytotalGameSummaryinfo.totalWinAmount;
        const DailytotalActivityAmount = results[2].data.totalActivityAmount;
        const DailytotalRechargeAmount = results[2].data.totalRechargeAmount;
        const DailyRechargeCount = results[2].data.totalRechargeCount;
        const DailywithdrawAmount = results[2].data.totalWithdrawAmount;
        const DailywithdrawCount = results[2].data.totalWithdrawCount;
        const DailytotalPlatWinLoseAmount = results[2].data.totalPlatWinLoseAmount;
        const DailytotalActiveSummaryinfo = results[2].data.totalActiveSummary;
        // 活动领取次数
        const totalActivityCount = DailytotalActiveSummaryinfo.totalActivityCount
        // 活动领取人数
        const totalUserCount = DailytotalActiveSummaryinfo.totalUserCount
        // 每日充值报表的充值成功的人数
        const totalRechargeSummary = results[2].data.totalRechargeSummary;
        const DailyRechargeUserCount = totalRechargeSummary.totalRechargeSuccessUserCount;
        const DailytotalWithdrawCount = results[2].data.totalWithdrawCount;


        if (DailyRegisterCount != dataStatisticsRegisterNumber) {
            logger.error(
                `注册人数对不上 -- 平台报表的数据${DailyRegisterCount}<--->数据统计的数据${dataStatisticsRegisterNumber}`
            );
            console.log('');
        }
        if (DailyloginCount != dashboardloginUserCount) {
            logger.error(
                `登录人数对不上 -- 平台报表的数据${DailyloginCount}<--->仪表盘的汇总数据${dashboardloginUserCount}`
            );
            console.log('');
        }

        if (dashboradbetUserCount != DailybetUserCount) {
            logger.error(
                `投注人数对不上 -- 平台报表的数据${DailybetUserCount}<--->仪表盘的汇总数据${dashboradbetUserCount}`
            );
            console.log('');
        }
        if (DailytotalBetAmount != dashboardbetAmount) {
            logger.error(
                `投注金额对不上 -- 平台报表的数据${DailytotalBetAmount}<--->仪表盘的汇总数据${dashboardbetAmount}`
            );
            console.log('');
        }

        if (DailyplatformFee != dataStatisticsplatformFee) {
            logger.error(
                `手续费对不上 -- 平台报表的数据${DailyplatformFee}<--->数据统计的数据${dataStatisticsplatformFee}`
            );
            console.log('');
        }

        if (DailytotalActivityAmount != dataStatisticsactiveAmount) {
            logger.error(
                `活动金额对不上 -- 平台报表的数据${DailytotalActivityAmount}<--->数据统计的数据${dataStatisticsactiveAmount}`
            );
            console.log('');
        }

        if (totalActivityCount != dataStatisticsactiveCount) {
            logger.error(
                `活动领取次数对不上 -- 平台报表的数据${totalActivityCount}<--->数据统计的数据${dataStatisticsactiveCount}`
            )
            console.log('');
        }

        if (totalUserCount != dataStatisticsactiveUserCount) {
            logger.error(
                `活动领取人数对不上 -- 平台报表的数据${totalUserCount}<--->数据统计的数据${dataStatisticsactiveUserCount}`
            )
            console.log('');
        }

        if (DailytotalActivityAmount != dataStatisticsactiveAmount) {
            logger.error(
                `活动金额对不上 -- 平台报表的数据${DailytotalActivityAmount}<--->数据统计的数据${dataStatisticsactiveAmount}`
            )
            console.log('');
        }

        if (dashboardRechargeAmount != DailytotalRechargeAmount) {
            logger.error(
                `充值金额对不上 -- 平台报表的数据${DailytotalRechargeAmount}<--->仪表盘的汇总的数据${dashboardRechargeAmount}`
            )
            console.log('');
        }
        if (dashboardrechargeCount != DailyRechargeCount) {
            logger.error(
                `充值次数对不上 -- 平台报表的数据${DailyRechargeCount}<--->仪表盘的汇总的数据${dashboardrechargeCount}`
            )
            console.log('');
        }
        if (dashboardwithdrawAmount != DailywithdrawAmount) {
            logger.error(
                `提现金额对不上 -- 平台报表的数据${DailywithdrawAmount}<--->仪表盘的汇总的数据${dashboardwithdrawAmount}`
            )
            console.log('');
        }

        if (dashboardwithdrawCount != DailywithdrawCount) {
            logger.error(
                `提现次数对不上 -- 平台报表的数据${DailywithdrawCount}<--->仪表盘的汇总的数据${dashboardwithdrawCount}`
            )
            console.log('');
        }
        if (Math.abs(DailytotalPlatWinLoseAmount) != Math.abs(dashboardwinLoseAmount)) {
            logger.error(
                `平台盈亏对不上 -- 平台报表的数据${DailytotalPlatWinLoseAmount}<--->仪表盘的汇总的数据${dashboardwinLoseAmount}`
            )
            console.log('');
        }

        if (dataStatisticsrechargeUserCount != DailyRechargeUserCount) {
            logger.error(
                `每日充值报表的充值成功的人数对不上 -- 每日充值报表的数据${DailyRechargeUserCount}<--->数据统计的数据${dataStatisticsrechargeUserCount}`
            )
            console.log('');
        }
        if (DailytotalWithdrawCount != dashboardwithdrawCount) {
            logger.error(
                `每日提现报表的提现成功的次数对不上 -- 每日提现报表的数据${DailytotalWithdrawCount}<--->仪表盘的数据汇总${dashboardwithdrawCount}`
            )
            console.log('');
        }

        // 会员报表数据的对比
        // 会员汇总的数据
        const MemberSummaryinfo = results[2].data.MemberSummary
        // 会员汇总的充值金额
        const membertotalRechargeAmount = MemberSummaryinfo.totalRechargeAmount
        // 会员汇总的充值次数
        const membertotalRechargeCount = MemberSummaryinfo.totalRechargeCount
        // 会员汇总的提现金额
        const membertotalWithdrawAmount = MemberSummaryinfo.totalWithdrawAmount
        // 会员汇总的提现次数
        const membertotalWithdrawCount = MemberSummaryinfo.totalWithdrawCount
        // 会员汇总活动金额
        const membertotalActivityAmount = MemberSummaryinfo.totalActivityAmount
        //会员汇总打码量
        const membertotalCodingAmount = MemberSummaryinfo.totalCodingAmount
        // 会员报表-会员游戏的会员盈亏
        const memberGameProfitTotal = results[2].data.memberGameProfitTotal
        // 会员汇总的会员盈亏
        const membertotalWinLoseAmount = MemberSummaryinfo.totalWinLoseAmount
        // 游戏管理的游戏投注的派奖金额
        const gamemangewinAmountSumTotal = results[2].data.winAmountSumTotal
        // 戏管理的游戏投注的手续费的统计
        const gamemangefeeAmountSumTotal = results[2].data.feeAmountSumTotal

        // 会员报表和平台报表进行对比
        if (DailytotalRechargeAmount != membertotalRechargeAmount) {
            logger.error(
                `会员报表的充值金额对不上 -- 会员报表的数据${membertotalRechargeAmount}<--->平台报表的每日汇总数据${DailytotalRechargeAmount}`
            )
            console.log('');
        }

        if (DailyRechargeCount != membertotalRechargeCount) {
            logger.error(
                `会员报表的充值次数对不上 -- 会员报表的数据${membertotalRechargeCount}<--->平台报表的每日汇总数据${DailyRechargeCount}`
            )
            console.log('');
        }

        if (DailywithdrawAmount != membertotalWithdrawAmount) {
            logger.error(
                `会员报表的提现金额对不上 -- 会员报表的数据${membertotalWithdrawAmount}<--->平台报表的每日汇总数据${DailywithdrawAmount}`
            )
            console.log('');
        }

        if (DailywithdrawCount != membertotalWithdrawCount) {
            logger.error(
                `会员报表的提现次数对不上 -- 会员报表的数据${membertotalWithdrawCount}<--->平台报表的每日汇总数据${DailywithdrawCount}`
            )
            console.log('');
        }

        if (DailytotalActivityAmount != membertotalActivityAmount) {
            logger.error(
                `会员报表的活动金额对不上 -- 会员报表的数据${membertotalActivityAmount}<--->平台报表的每日汇总数据${DailytotalActivityAmount}`
            )
            console.log('');
        }

        if (Math.abs(memberGameProfitTotal) != Math.abs(membertotalWinLoseAmount)) {
            logger.error(
                `会员报表的会员盈亏对不上 -- 会员汇总报表的数据${membertotalWinLoseAmount}<--->会员报表-会员游戏的会员盈亏数据${memberGameProfitTotal}`
            )
            console.log('');
        }

        //会员汇总的会员盈亏和仪表盘的会员盈亏进行对比
        if (Math.abs(membertotalWinLoseAmount) != Math.abs(dashboardwinLoseAmount)) {
            logger.error(
                `会员汇总的会员盈亏对不上 -- 会员汇总报表的数据${membertotalWinLoseAmount}<--->仪表盘的数据汇总${dashboardwinLoseAmount}`
            )
            console.log('');
        }

        if (DailytotalWinAmount != gamemangewinAmountSumTotal) {
            logger.error(
                `游戏管理的游戏投注的派奖金额对不上 -- 游戏管理的游戏投注的的数据${gamemangewinAmountSumTotal}<--->平台报表的每日游戏数据${DailytotalWinAmount}`
            )
            console.log('');
        }




        // 添加日志，确认函数执行完成
        console.log('performDataComparison 函数执行完成');
    } catch (error) {
        logger.error('performDataComparison 函数执行出错:', error.message);
        console.error('错误堆栈:', error.stack);
    }
}
