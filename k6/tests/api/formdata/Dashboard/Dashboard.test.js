import { sendRequest } from '../../common/request.js';

export const Dashboardtag = 'queryDashboard';

/**
 * @param {*} data
 * @returns {Array} 仪表盘的几个矩阵的数据,每个为一个对象{statisticDataRsp，statisticDate}
 */
export function queryDashboardFunc(data) {
    const matrix = queryDashboardMatrixFunc(data)
    const sumary = queryDashboardSummaryFunc(data)
    return matrix, sumary
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

//公共的请求函数
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

