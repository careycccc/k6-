import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5, commonRequest3 } from '../../formdata/config/formreqeust.js';
import { groupByAndSum } from '../../common/common.js';
import { logger } from '../../../../libs/utils/logger.js';

// 每日每周

export const dailyTasksTag = 'dailyTasks'
let dailyTasksinfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

const payload = {
    startTime: fromOptions.startTimeSecend,
    endTime: fromOptions.endTimeSecend,
}

/**
 * 每日每周查询
 * @param {*} data 
 */
export function queryDailyTasks(data) {
    const resultTasks = GetDayWeekTaskReportPageList(data)
    const accumulateTaskReport = GetAccumulateTaskReportPageList(data)
    dailyTasksinfo.amount = resultTasks.sum + accumulateTaskReport
    dailyTasksinfo.amountUsercount = 0
    dailyTasksinfo.amountcountTotal = 0
    return dailyTasksinfo
}

/**
 * 每日每周任务报表
*/
export function GetDayWeekTaskReportPageList(data) {
    const api = '/api/DayWeek/GetDayWeekTaskReportPageList'

    const result = commonRequest5(data, api, payload, dailyTasksTag)
    if (!result || !result.list) {
        logger.error('每日每周任务报表的查询失败')
        return {}
    }
    // 任务id和领取的金额
    return groupByAndSum(result.list, 'taskId', 'rewardAmount')
}

/**
 * 
累计任务报表
 */

export function GetAccumulateTaskReportPageList(data) {
    const api = 'api/DayWeek/GetAccumulateTaskReportPageList'
    const result = commonRequest3(data, api, payload, dailyTasksTag)
    if (!result || !result.list) {
        logger.error('累计任务报表的查询失败')
        return {}
    }
    return result.summary
}

