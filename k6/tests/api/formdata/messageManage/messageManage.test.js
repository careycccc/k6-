import { logger } from '../../../../libs/utils/logger.js';
import { commonRequest5, isEmptyfunc } from '../config/formreqeust.js';
import { stringToTimestamp } from '../config/config.js';
import { groupByAndSum } from '../../common/common.js';


// 站内信领取记录，最终计算领取金额
export const messageManageTag = 'messageManage'



let messageManageInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 站内信领取记录，最终计算领取金额
 * @param {*} data 
 */
export function queryMessageManage(data) {
    const api = 'api/Inmail/GetUserInmailRewardRecordPageList'
    const payload = {
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        state: 2,  // 2 已领取
    }
    const result = commonRequest5(data, api, payload, messageManageTag)
    if (!result || !result.list) {
        logger.info('站内信领取记录查询结果为空，跳过后续处理', result)
        return {}
    }
    // 统计站内信的
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    messageManageInfo.amount = groupResult.sum || 0;
    messageManageInfo.amountUsercount = groupResult.count || 0;
    messageManageInfo.amountcountTotal = result.totalCount || 0;
    return messageManageInfo
}