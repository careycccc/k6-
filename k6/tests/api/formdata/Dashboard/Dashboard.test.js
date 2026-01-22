import { sendRequest } from '../../common/request.js';

export const Dashboardtag = 'queryDashboard';

/**
 * @param {*} data
 * @returns {Array} 仪表盘的几个矩阵的数据,每个为一个对象{statisticDataRsp，statisticDate}
 */
export function queryDashboardFunc(data) {
    const matrix = queryDashboardMatrixFunc(data)
    return matrix
}


//仪表盘的矩阵的数据
/**
 * 
 * @returns {object}
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
    if (result && result.data) {
        return {
            todayIncrease: result.data.todayIncrease, // 今日新增人数
            firstRechargeUserCount: result.data.firstRechargeUserCount, // 首充人数
            loginUserCount: result.data.loginUserCount, // 今日登录人数
            totalUserCount: result.data.totalUserCount, // 总用户数(不包括测试用户)
            rechargeWithdrawDifference: result.data.rechargeWithdrawDifference, // 充值提现差额
            rechargeAmount: result.data.rechargeAmount, // 今日充值金额
            rechargeUserCount: result.data.rechargeUserCount, // 今日充值人数
            withdrawAmount: result.data.withdrawAmount, // 今日提现金额
            withdrawUserCount: result.data.withdrawUserCount, // 今日提现人数
            betAmount: result.data.betAmount, // 今日投注金额
            betUserCount: result.data.betUserCount, // 今日投注人数
            betCount: result.data.betCount, // 今日投注次数
            platformProfit: result.data.platformProfit, // 平台盈亏
            activityAmount: result.data.activityAmount, // 今日活动金额
            activityUserCount: result.data.activityUserCount, // 今日活动人数
        };
    }
    return {};
}


// 仪表盘的汇总数据
export function queryDashboardSummaryFunc(data) {
    // 仪表盘的数据汇总的数据
    const api = '/api/RptDashBoard/GetPlatStatisticsData';
    const token = data.token;
    const payload = {};
    let result = sendRequest(payload, api, Dashboardtag, false, token);
    if (typeof result != 'object') {
        result = JSON.parse(result);
    }
    // 这里包括了
    if (result && result.data && result.data.length > 0) {
        return result.data;
    }
    return [];
}
