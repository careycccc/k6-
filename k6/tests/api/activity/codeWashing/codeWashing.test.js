import { commonRequest3 } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';
//洗码

export const codeWashingTag = 'codeWashing'

let codeWashingInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 洗码查询
*/
export function queryCodeWashing(data) {
    const api = 'api/CodeWashing/GetRecordPageList'
    const payload = {
        startTime: fromOptions.startTimeSecend,
        endTime: fromOptions.endTimeSecend
    }
    const result = commonRequest3(data, api, payload, codeWashingTag)
    if (!result || !result.list) {
        logger.error('洗码查询失败', result)
        return {}
    }
    codeWashingInfo.amountcountTotal = result.totalCount
    codeWashingInfo.amount = result.summary.rebateAmount
    const groupResult = groupByAndSum(result.list, 'userId', 'rebateAmount')
    codeWashingInfo.amountUsercount = groupResult.count
    console.log(codeWashingInfo)
    return codeWashingInfo
}




