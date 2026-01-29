import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { stringToTimestamp } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';

//引导活动
export const activityGuideTag = 'activityGuide'

let activityGuideInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 引导活动查询
 * @param {*} data 
 */
export function queryActivityGuide(data) {
    const api = '/api/ActivityGuide/GetGuideRecordPageList'
    const payload = {
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        guideActivityType: 0,
        state: 1 // 已完成
    }
    const result = commonRequest5(data, api, payload, activityGuideTag)
    if (!result) {
        logger.error('引导活动查询失败')
        return {}
    }
    activityGuideInfo.amountcountTotal = result.totalCount
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    activityGuideInfo.amountUsercount = groupResult.count
    activityGuideInfo.amount = groupResult.sum
    return activityGuideInfo
}