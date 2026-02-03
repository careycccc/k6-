import { commonRequest5 } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';
import { sleep } from 'k6'

//亏损救援金

export const rescueTag = 'rescue'

let rescueInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 亏损救援金查询
 * @param {*} data 
 */
export function queryRescue(data) {
    const api = '/api/LossRelief/GetLossReliefRewardPageList'
    const payload = {
        startTime: fromOptions.startTimeSecend,
        endTime: fromOptions.endTimeSecend,
        timeTypeEnum: 0,
        state: 1
    }
    const result = commonRequest5(data, api, payload, rescueTag)
    if (!result || !result.list) {
        logger.error('亏损救援金查询失败')
        return {}
    }
    rescueInfo.amountcountTotal = result.totalCount || 0;
    if (result.list) {
        const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
        rescueInfo.amountUsercount = groupResult.count || 0;
        rescueInfo.amount = groupResult.sum || 0;
        return rescueInfo
    } else {
        logger.error('亏损救援金result.list为null')
        return {}
    }

}
