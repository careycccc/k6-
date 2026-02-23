import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { stringToTimestamp } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';
import { sleep } from 'k6'

// 活动礼包
let giftPackInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

export const giftPackTag = 'giftPack'

/**
 * 活动礼包查询已完成领取成功
 * @param {*} data 
 */
export function queryGiftPack(data) {
    const api = '/api/GiftPack/GetGiftPackUserList'
    const payload = {
        startDate: stringToTimestamp.starttime,
        endDate: stringToTimestamp.endtime,
        receiveState: 4 // 领取状态已完成
    }
    const result = commonRequest5(data, api, payload, giftPackTag)
    if (!result || !result.list) {
        logger.info('活动礼包查询结果为空，跳过后续处理', result)
        return {}
    }
    giftPackInfo.amountcountTotal = result.totalCount
    //总金额
    let infolist = []
    result.list.forEach(ele => {
        sleep(0.5)
        const info = queryGiftPackDetail(data, ele)
        infolist.push(info)
    })

    const groupResult = groupByAndSum(infolist, 'userid', 'amount')
    giftPackInfo.amount = groupResult.sum || 0;
    giftPackInfo.amountUsercount = groupResult.count || 0;
    giftPackInfo.amountcountTotal = groupResult.count || 0;
    return giftPackInfo
}


/**
 根据oderNO进行详情查询
 * 找到详情里面的奖励为金额的并且返回金额
 * 
*/
function queryGiftPackDetail(data, ele) {
    const api = '/api/GiftPack/GetGiftPackUserDetail'
    const payload = {
        orderNo: ele.orderNo
    }
    const result = commonRequest(data, api, payload, giftPackTag)

    if (!result || !result.list) {
        logger.info(`${orderNo}活动礼包详情查询结果为空，跳过后续处理`, result)
    }
    // 活动礼包里面的奖励金额
    let amount = 0
    result.rewardConfig.forEach(item => {
        item.rewardConfig.forEach(it => {
            if (it.type == 0) {
                amount += it.value
            }
        })
    })
    return {
        amount: amount,
        userid: ele.userId
    }

}



