import { stringToTimestamp } from '../../formdata/config/config.js';
import { groupByAndSum } from '../../common/common.js';
import { commonRequest5 } from '../../formdata/config/formreqeust.js';
export const giftCodesTag = 'giftCodes'

// 礼品码
let giftcodesInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}



export function queryGiftcodes(data) {
    const api = '/api/GiftCode/GetRedReceivePageList'
    const payload = {
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        pageSize: 200
    }
    const result = commonRequest5(data, api, payload, giftCodesTag)
    giftcodesInfo.amountcountTotal = result.totalCount
    const groupResult = groupByAndSum(result.list, 'userId', 'amount')
    giftcodesInfo.amountUsercount = groupResult.count
    giftcodesInfo.amount = groupResult.sum
    return giftcodesInfo
}