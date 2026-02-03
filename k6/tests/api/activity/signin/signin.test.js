
import { commonRequest3 } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';


//每日签到。昨日的手动领取 + 进入的系统发放，才是昨日的完整数据

export const signinTag = 'signin'

let signininfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 每日签到 查询，
 * @param {*} data 
 */
export function querySignin(data) {
    const api = '/api/CardPlan/GetCardPlanUserRewardRecordPageList'
    let result1, result2
    try {
        const payload1 = {
            startDate: fromOptions.startTimeSecend,
            endDate: fromOptions.endTimeSecend,
            receiveMode: 2   // 1表示系统发放 2手动领取
        }
        result1 = common(data, api, payload1)
    } catch {
        logger.error('每日签到手动领取查询失败')
        return signininfo
    }

    try {
        const payload2 = {
            startDate: fromOptions.startTimeLastdaySecend,
            endDate: fromOptions.endTimeLastdaySecend,
            receiveMode: 1
        }
        result2 = common(data, api, payload2)

    } catch {
        logger.error('每日签到自动领取查询失败')
        return signininfo
    }

    if (!result1 || !result1.list || !result2 || !result2.list) {
        logger.error('每日签到的系统发放或者手动发放查询失败')
        return {}
    }
    signininfo.amountcountTotal = result1.totalCount + result2.totalCount || 0;
    signininfo.amount = result1.summary.rewardAmountTotal + result2.summary.rewardAmountTotal || 0;
    signininfo.amountUsercount = result1.summary.userCountTotal + result2.summary.userCountTotal || 0;

    return signininfo
}

export function common(data, api, payload) {
    const result = commonRequest3(data, api, payload, signinTag)
    if (!result || !result.list) {
        logger.error('每日签到查询失败')
        return {}
    }
    return result
}
