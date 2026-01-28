import { fromOptions } from '../../formdata/config/config.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';
import { groupByAndSum } from '../../common/common.js';

//充值转盘
export const rechargeWheelTag = 'rechargeWheel'
let rechargeWheelInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 充值转盘的金额查询
 * 
*/
export function queryRechargeWheel(data) {
    const api = '/api/RechargeWheel/GetPageListRewardRecord'
    const payload = {
        rewardType: 1,  // 金额奖励
        start: fromOptions.startTime,
        end: fromOptions.endTime,
    }
    const result = commonRequest5(data, api, payload, rechargeWheelTag)
    rechargeWheelInfo.amountcountTotal = result.totalCount
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    rechargeWheelInfo.amountUsercount = groupResult.count
    rechargeWheelInfo.amount = groupResult.sum
    return rechargeWheelInfo
}