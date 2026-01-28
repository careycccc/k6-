import { commonRequest3 } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { groupByAndSum } from '../../common/common.js';


// 红包雨
const redRainActivityTag = 'redRainActivity';
let redRainActivityInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 查询红包雨的领取记录
*/
export function queryRedRainActivity(data) {
    const api = 'api/CashRain/GetPageListRewardRecord'
    const payload = {
        start: fromOptions.startTime,
        end: fromOptions.endTime
    }
    const result = commonRequest3(data, api, payload, redRainActivityTag)
    redRainActivityInfo.amountcountTotal = result.totalCount
    redRainActivityInfo.amount = result.summary.rewardAmount
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    redRainActivityInfo.amountUsercount = groupResult.count
    return redRainActivityInfo
}
