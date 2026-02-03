import { logger } from '../../../../libs/utils/logger.js';
import { commonRequest3, isEmptyfunc } from '../config/formreqeust.js';
import { stringToTimestamp } from '../config/config.js';
import { groupByAndSum } from '../../common/common.js';

// 账变模块
export const accountChangesTag = 'accountChanges'

let RechargeGiftInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}


/**
 * 充值赠送查询
 * @param {Object} data 
 */
export function queryRechargeGift(data) {
    const result = common(data, ['RechargeGift'])
    if (isEmptyfunc(result)) {
        return {}
    }
    const groppResult = groupByAndSum(result.list, 'userId', 'amount')
    RechargeGiftInfo.amount = result.summary.totalAmount || 0;
    RechargeGiftInfo.amountcountTotal = result.totalCount || 0;
    RechargeGiftInfo.amountUsercount = groppResult.count || 0;
    return RechargeGiftInfo
}



let vipInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}
// 查询昨日的vip的收益
export function queryVipinfo(data) {
    const result = common(data, ['VIPReward'])
    if (isEmptyfunc(result)) {
        return {}
    }
    const groppResult = groupByAndSum(result.list, 'userId', 'amount')
    vipInfo.amount = result.summary.totalAmount || 0;
    vipInfo.amountcountTotal = result.totalCount || 0;
    vipInfo.amountUsercount = groppResult.count || 0;
    return vipInfo
}
/**
 * 
 * @param {*} data 
 * @param {Arry} financialTypeList 一个查询的列表，可以好几个一起查询
 * @param {string} name 主要是标注一下那个类型的没有数据 
 */
export function common(data, financialTypeList, name) {
    const api = '/api/Financial/GetPageList'
    const payload = {
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        financialTypeList,
        searchUserIdType: 1, // 会员id
        userTypeList: [0] // 正式账号+游客
    }
    const result = commonRequest3(data, api, payload, accountChangesTag)
    const isEmpty = isEmptyfunc(result)
    if (!isEmpty) {
        if (!isEmptyfunc(result.summary)) {
            // 进行账变前后的金额进行比对
            result.list.forEach(ele => {
                if (ele.backAmount - ele.beforeAmount != ele.amount) {
                    logger.error(`${name}-${ele.userId}的账变前${ele.beforeAmount}后${ele.backAmount}的金额不等于账变金额${ele.amount}`)
                    console.log('')
                }
            });
            // 表示有正常的数据
            return result
        } else {
            logger.error(`result.summary<-->${name}没有数据`)
            return {}
        }
    } else {
        logger.error(`${name}没有数据`)
        return {}
    }
}
