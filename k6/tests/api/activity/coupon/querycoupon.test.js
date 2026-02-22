import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { stringToTimestamp } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';

//优惠券的查询

export const couponTag = 'coupon'

let couponinfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 优惠券的查询
 * @param {*} data 
 */
export function queryCoupon(data) {
    const api = '/api/Coupon/GetUserCouponPageList'
    const payload = {
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime,
        state: 2
    }
    const result = commonRequest5(data, api, payload, couponTag)
    if (!result || !result.list) {
        logger.info('优惠券查询结果为空，跳过后续处理', result)
        return {}
    }
    // 用户存放符合金额的对象（充值优惠券和奖励优惠券）
    const amountcouponList = []
    result.list.forEach(ele => {
        if (ele.couponType != 3 && ele.couponTypeText != '转盘次数优惠券') {
            if (ele.rewardConfig.isFixedAmount) {
                // 有固定金额奖励
                amountcouponList.push({
                    userId: ele.userId,
                    amount: ele.rewardConfig.amountOrRatio
                })
            }
        }
    });
    couponinfo.amountcountTotal = result.totalCount
    if (amountcouponList.length > 0) {
        const groupResult = groupByAndSum(amountcouponList, 'userId', 'amount')
        couponinfo.amount = groupResult.sum
        couponinfo.amountUsercount = groupResult.count
    } else {
        logger.error('本次查询<->没有使用含有金额的优惠券')
    }
    return couponinfo
}

