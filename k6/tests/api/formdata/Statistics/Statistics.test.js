import { fromOptions } from '../config/config.js';
import { commonRequest, commonRequest2, commonRequest3 } from '../config/formreqeust.js';

// 报表管理 -> 数据统计报表
export const Statisticstag = 'queryStatistics';


const start = fromOptions.startTime
const end = fromOptions.endTime
const payload = {
    start,
    end,
    dateType: 1,  // 1表示按日查询
}
const payload2 = {
    start,
    end,
    dateType: 1,  // 1表示按日查询
    pageSize: 200
}

/**
 * 
 * 数据统计查询
*/
export function queryStatisticsFunc(data) {
    const result = queryDataSunmmery(data)
    return result
}



/**
 * 
 * 数据汇总模块
*/
export function queryDataSunmmery(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryView'

    return commonRequest(data, api, payload, Statisticstag)
}

/**
 * 推广模块
*/
export function GetRptDataSummaryCommission(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryCommission'
    return commonRequest(data, api, payload, Statisticstag)
}

/**
 * 
 * 首充首提模块
*/
export function GetRptDataSummaryTopRechargeWithdraw(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryTopRechargeWithdraw'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 充值状态模块
*/
export function GetRptDataSummaryRechargeSumarryByState(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryRechargeSumarryByState'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 充值通道前4模块
*/
export function GetRptDataSummaryRechargeSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryRechargeSumarryTop4'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 提现状态模块
*/
export function GetRptDataSummaryWithdrawSumarryByState(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryWithdrawSumarryByState'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 提现通道前四
*/
export function GetRptDataSummaryWithdrawSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryWithdrawSumarryTop4'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 平台前四
*/
export function GetRptDataSummaryGameSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryGameSumarryTop4'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 子游戏前四
*/
export function GetRptDataSummaryGameTypeSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryGameTypeSumarryTop4'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 活动前四
*/
export function GetRptDataSummaryActivitySumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryActivitySumarryTop4'
    return commonRequest2(data, api, payload, Statisticstag)
}

/**
 * 会员充值通道统计
 * 充值通道前四的详细按钮里面的
*/

export function GetPageListRptDataSummaryRechargeSumarry(data) {
    const api = 'api/RptDataSummary/GetPageListRptDataSummaryRechargeSumarry'
    return commonRequest3(data, api, payload2, Statisticstag)
}