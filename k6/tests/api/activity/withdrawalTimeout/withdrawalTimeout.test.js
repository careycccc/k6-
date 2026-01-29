
import { commonRequest3 } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';

// 超时提现赔付
export const withdrawalTimeoutTag = 'withdrawalTimeout'

let withdrawalTimeoutInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 超时提现赔付查询
 * @param {*} data 
 */
export function querywithdrawalTimeout(data) {
    const api = '/api/ActivityCompensation/GetCompensationRecordPageList'
    const payload = {
        receiveStartTime: fromOptions.startTimeSecend,
        receiveEndTime: fromOptions.endTimeSecend,
        state: 2,// 已领取
    }
    const result = commonRequest3(data, api, payload, withdrawalTimeoutTag)
    if (!result) {
        logger.error('超时提现赔付查询失败')
        return {}
    }
    withdrawalTimeoutInfo.amount = result.summary.totalCompensationAmount
    withdrawalTimeoutInfo.amountcountTotal = result.totalCount

    const groupResult = groupByAndSum(result.list, 'userId', 'compensationAmount')
    withdrawalTimeoutInfo.amountUsercount = groupResult.count
    console.log(withdrawalTimeoutInfo)
    return withdrawalTimeoutInfo
}