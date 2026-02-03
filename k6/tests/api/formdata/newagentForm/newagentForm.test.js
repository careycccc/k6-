import { logger } from '../../../../libs/utils/logger.js';
import { commonRequest5, isEmptyfunc } from '../config/formreqeust.js';
import { stringToTimestamp } from '../config/config.js';
import { groupByAndSum } from '../../common/common.js';

// 新版返佣数据查询

export const newagentFromtag = 'newagentFrom'

let l3InviteOkRewardInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

let l3InvitedReward = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}


/**
 * 邀请成功奖金
 * @param {object} data 
 */
export function queryL3InviteOkReward(data) {
    return common(data, 'L3InviteOkReward', l3InviteOkRewardInfo)
}

/**
 * 被邀请人奖金
 * @param {*} data 
 */
export function queryL3InvitedReward(data) {
    return common(data, 'L3InvitedReward', l3InvitedReward)
}

/**
 * 
 * @param {*} data 
 * @param {string} financialType  奖励类型
 * @param {Object} commonObj 要返回的每个对象
 */
function common(data, financialType, commonObj) {
    const api = '/api/AgentL3/GetPageListRewardList'
    const payload = {
        start: stringToTimestamp.starttime,
        end: stringToTimestamp.endtime,
        financialType,
    }
    const result = commonRequest5(data, api, payload, newagentFromtag)
    if (!result || !result.list) {
        logger.error(`新版返佣的数据为空类型为${financialType}`, result)
        console.log('')
        return {}
    }

    const grpupResult = groupByAndSum(result.list, 'userId', 'amount')
    commonObj.amountcountTotal = result.totalCount || 0;
    commonObj.amount = grpupResult.sum || 0;
    commonObj.amountUsercount = grpupResult.count || 0;
    return commonObj
}