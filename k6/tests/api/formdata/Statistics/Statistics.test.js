import { logger } from '../../../../libs/utils/logger.js';
import { fromOptions } from '../config/config.js';
import { commonRequest, commonRequest2, commonRequest3, compareListsByTwoProperties } from '../config/formreqeust.js';
import {
    GetPageListRptDataSummaryRechargeSumarry,
    GetPageListRptDataSummaryWithdrawSumarry,
    GetPageListRptDataSummaryGameSumarry,
    GetPageListRptDataSummaryGameTypeSumarry,
    GetPageListRptDataSummaryActivitySumarry
} from './statisticsinfo.test.js';

// 报表管理 -> 数据统计报表
export const Statisticstag = 'queryStatistics';


const start = fromOptions.startTime
const end = fromOptions.endTime
const payload = {
    start,
    end,
    dateType: 1,  // 1表示按日查询
}

// 数据统计里面的返回的数据
let StatisticsData = {
    information: [], // 用户统计各个详情里面的数据的总计的数据
    SummaryView: {},  // 用于收集数据汇总模块的数据
    SummaryCommission: {}, //  用于收集数据推广模块的数据
    RechargeWithdraw: [], // 用于收集首充首提模块的数据
    ToupByState: [], // 用户收集充值状态的数据
    WithdrawByState: [], // 用户收集提现状态的数据
}


/**
 * 
 * 数据统计查询
*/
export function queryStatisticsFunc(data) {
    //数据汇总模块
    queryDataSunmmery(data)
    // 推广模块
    GetRptDataSummaryCommission(data)
    // 首充首提模块
    GetRptDataSummaryTopRechargeWithdraw(data)
    // 充值状态模块
    GetRptDataSummaryRechargeSumarryByState(data)
    // 提现状态模块
    GetRptDataSummaryWithdrawSumarryByState(data)
    // 充值通道
    GetRptDataSummaryRechargeSumarryTop4(data)
    // 提现通道
    GetRptDataSummaryWithdrawSumarryTop4(data)
    // 平台
    GetRptDataSummaryGameSumarryTop4(data)
    // 子游戏
    GetRptDataSummaryGameTypeSumarryTop4(data)
    // 活动
    GetRptDataSummaryActivitySumarryTop4(data)
    return StatisticsData
}



/**
 * 
 * 数据汇总模块
*/
export function queryDataSunmmery(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryView'
    const result = commonRequest(data, api, payload, Statisticstag)
    StatisticsData.SummaryView = { ...result }
}

/**
 * 推广模块
*/
export function GetRptDataSummaryCommission(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryCommission'
    const result = commonRequest(data, api, payload, Statisticstag)
    StatisticsData.SummaryCommission = { ...result }
}

/**
 * 
 * 首充首提模块
*/
export function GetRptDataSummaryTopRechargeWithdraw(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryTopRechargeWithdraw'
    const result = commonRequest2(data, api, payload, Statisticstag)
    StatisticsData.RechargeWithdraw = [...result]
}

/**
 * 充值状态模块
*/
export function GetRptDataSummaryRechargeSumarryByState(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryRechargeSumarryByState'
    const result = commonRequest2(data, api, payload, Statisticstag)
    StatisticsData.ToupByState = [...result]
}

/**
 * 充值通道前4模块
*/
export function GetRptDataSummaryRechargeSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryRechargeSumarryTop4'
    let result = commonRequest2(data, api, payload, Statisticstag)
    // 检查 result 是否有效，并且是数组且有数据
    if (!result || !Array.isArray(result) || result.length === 0) {
        logger.error('充值通道前4模块返回的数据为空或无效');
        return false;
    }

    let results = GetPageListRptDataSummaryRechargeSumarry(data)

    // 检查 results 和 results.arr 是否有效
    if (!results || !results.arr || !Array.isArray(results.arr)) {
        logger.error('充值详情的数据无效', results);
        return false;
    }

    try {
        let resultBool = compareListsByTwoProperties(result, results.arr, 'amount', 'rechargeWithdrawChannelName')
        StatisticsData.information.push({
            name: '充值通道详情总计',
            data: { ...results.summary },
            arr: results.arr
        })
        if (resultBool) {
            logger.info('充值通道前4模块和充值详情的数据校验通过')
            return true
        } else {
            logger.error('充值通道前4模块和充值详情的数据校验不通过')
            console.log('')
            return false
        }
    } catch (error) {
        logger.error('充值通道前4模块数据校验出错:', error.message);
        console.error('错误堆栈:', error.stack);
        return false;
    }
}


/**
 * 提现状态模块
*/
export function GetRptDataSummaryWithdrawSumarryByState(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryWithdrawSumarryByState'
    const result = commonRequest2(data, api, payload, Statisticstag)
    StatisticsData.WithdrawByState = [...result]
}

/**
 * 提现通道前四
*/
export function GetRptDataSummaryWithdrawSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryWithdrawSumarryTop4'
    let result = commonRequest2(data, api, payload, Statisticstag)

    // 检查 result 是否有效，并且是数组且有数据
    if (!result || !Array.isArray(result) || result.length === 0) {
        logger.error('提现通道前4模块返回的数据为空或无效');
        return false;
    }

    let results = GetPageListRptDataSummaryWithdrawSumarry(data)

    // 检查 results 和 results.arr 是否有效
    if (!results || !results.arr || !Array.isArray(results.arr)) {
        logger.error('提现详情的数据无效', results);
        return false;
    }

    try {
        let resultBool = compareListsByTwoProperties(result, results.arr, 'amount', 'rechargeWithdrawChannelId')
        StatisticsData.information.push({
            name: '提现通道详情总计',
            data: { ...results.summary },
            arr: results.arr
        })
        if (resultBool) {
            logger.info('提现通道前4模块和提现详情的数据校验通过')
            return true
        } else {
            logger.error('提现通道前4模块和提现详情的数据校验不通过')
            console.log('')
            return false
        }
    } catch (error) {
        logger.error('提现通道前4模块数据校验出错:', error.message);
        console.error('错误堆栈:', error.stack);
        return false;
    }
}


/**
 * 平台前四
*/
export function GetRptDataSummaryGameSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryGameSumarryTop4'
    let result = commonRequest2(data, api, payload, Statisticstag)
    let results = GetPageListRptDataSummaryGameSumarry(data)
    let resultBool = compareListsByTwoProperties(result, results.arr, 'betAmount', 'vendorCode')
    StatisticsData.information.push({
        name: '平台详情总计',
        data: { ...results.summary }
    })
    if (resultBool) {
        logger.info('平台前4模块和平台详情的数据校验通过')
        return true
    } else {
        logger.error('平台前4模块和平台详情的数据校验不通过')
        console.log('')
        return false
    }
}

/**
 * 子游戏前四
*/
export function GetRptDataSummaryGameTypeSumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryGameTypeSumarryTop4'
    let result = commonRequest2(data, api, payload, Statisticstag)
    let results = GetPageListRptDataSummaryGameTypeSumarry(data)
    let resultBool = compareListsByTwoProperties(result, results.arr, 'betAmount', 'gameCode')
    StatisticsData.information.push({
        name: '子游戏详情总计',
        data: { ...results.summary }
    })
    if (resultBool) {
        logger.info('子游戏前4模块和子游戏详情的数据校验通过')
        return true
    } else {
        logger.error('子游戏前4模块和子游戏详情的数据校验不通过')
        console.log('')
        return false
    }
}

/**
 * 活动前四
*/
export function GetRptDataSummaryActivitySumarryTop4(data) {
    const api = '/api/RptDataSummary/GetRptDataSummaryActivitySumarryTop4'
    let result = commonRequest2(data, api, payload, Statisticstag)
    let results = GetPageListRptDataSummaryActivitySumarry(data)

    let resultBool = compareListsByTwoProperties(result, results.arr, 'amount', 'activityType')
    // 这里重新发送一次活动详情的请求，获取详细的数据
    let resultinfo = commonRequest3(data, '/api/RptDataSummary/GetPageListRptDataSummaryActivitySumarry', payload, Statisticstag)
    StatisticsData.information.push({
        name: '活动详情总计',
        data: { ...resultinfo.summary },
        arr: [...resultinfo.list], // 活动详情
    })
    if (resultBool) {
        logger.info('活动前4模块和活动详情的数据校验通过')
        return true
    } else {
        logger.error('活动前4模块和活动详情的数据校验不通过')
        console.log('')
        return false
    }
}

