import { logger } from '../../../../libs/utils/logger.js';
import { commonRequest5, isEmptyfunc } from '../config/formreqeust.js';
import { stringToTimestamp } from '../config/config.js';
import { groupByAndSum } from '../../common/common.js';
//人工充值模块的数据

export const manualRechargeTag = 'manualRecharge'


let bonusReduceInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 彩金扣减查询
 * 
 * @param {*} data 
 * @returns 
 */
export function queryBonusReduce(data) {
    const result = common(data, 2)
    if (isEmptyfunc(result)) {
        return {}
    }
    const groupResult = groupByAndSum(result.list, 'userId', 'rechargeAmount')
    bonusReduceInfo.amount = groupResult.sum || 0;
    bonusReduceInfo.amountUsercount = groupResult.count || 0;
    bonusReduceInfo.amountcountTotal = result.totalCount || 0;
    return bonusReduceInfo;
}



let bonusToupInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 彩金充值查询
 */
export function queryBonusToup(data) {
    const result = common(data, 1)
    if (isEmptyfunc(result)) {
        return {}
    }
    const groupResult = groupByAndSum(result.list, 'userId', 'rechargeAmount')
    bonusToupInfo.amount = groupResult.sum || 0;
    bonusToupInfo.amountUsercount = groupResult.count || 0;
    bonusToupInfo.amountcountTotal = result.totalCount || 0;
    return bonusToupInfo;
}

/**
 * 
 * @param {*} data 
 * @param {Number} artificialRechargeType 1 彩金充值 3 人工充值
 */
function common(data, artificialRechargeType) {
    const api = '/api/ArtificialRechargeRecord/GetPageList'
    const payload = {
        createTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        artificialRechargeType
    }
    const result = commonRequest5(data, api, payload, manualRechargeTag)
    if (!result || !result.list) {
        logger.error(`人工充值查询数据为空,类型:${artificialRechargeType}`, result)
        return {}
    }
    return result
}