import { commonRequest5, commonRequest } from '../../formdata/config/formreqeust.js';
import { fromOptions, stringToTimestamp } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';
import { sleep } from 'k6'

//充值礼包
export const rechargeGiftPackTag = 'rechargeGiftPack'

let rechargeGiftPackInfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 充值礼包查询
*/
export function queryRechargeGiftPack(data) {
    const api = '/api/RechargeGiftPack/GetActivityRechargeGiftPackStaticsPageList'
    const payload = {
        startTime: fromOptions.startTimeSecend,
        endTime: fromOptions.endTimeSecend
    }
    const result = commonRequest5(data, api, payload, rechargeGiftPackTag)
    // 检查 result 是否有效
    if (!result) {
        logger.error('充值礼包查询失败')
        return {}
    }

    // 检查 result.list 是否存在
    if (!result.list) {
        console.log('充值礼包查询结果中没有list属性');
        return {};
    }

    // 检查 result.list 是否为数组
    if (!Array.isArray(result.list)) {
        console.log('充值礼包查询结果中的list不是数组');
        return {};
    }

    // 记录充值礼包的id的数据
    let activityIdList = []

    // 遍历充值礼包列表
    for (const ele of result.list) {
        sleep(0.5)
        const detail = getRechargeGiftPackDail(data, ele.activityId)
        activityIdList.push(detail)
    }

    let count = 0
    let groupResultList = []
    if (activityIdList.length > 0) {
        activityIdList.forEach(ele => {
            count += ele.totalCount
            const groupResult = groupByAndSum(ele.list, 'userId', 'bonusAmount')
            groupResultList.push({
                sum: groupResult.sum,
                count: groupResult.count
            })
        })
    }
    rechargeGiftPackInfo.amountcountTotal = count

    groupResultList.forEach(ele => {
        rechargeGiftPackInfo.amount += ele.sum
        rechargeGiftPackInfo.amountUsercount += ele.count
    })

    return rechargeGiftPackInfo;
}

function getRechargeGiftPackDail(data, activityId) {
    const api = '/api/RechargeGiftPack/GetUserRechargeGiftPackBuyRecordPageList';
    const payload = {
        activityId,
        startTime: stringToTimestamp.starttime,
        endTime: stringToTimestamp.endtime
    }

    // 使用 try-catch 捕获可能的异常
    let result;
    try {
        result = commonRequest5(data, api, payload, rechargeGiftPackTag);
    } catch (error) {
        logger.error(`充值礼包详情查询异常, activityId: ${activityId}`, error.message);
        return {
            totalCount: 0,
            list: []
        };
    }

    // console.log('充值礼包详情查询结果:', result);

    // 检查 result 是否有效
    if (!result) {
        logger.error(`充值礼包每日数据查询失败, activityId: ${activityId}`);
        return {
            totalCount: 0,
            list: []
        };
    }

    // 检查 result.list 是否存在
    if (!result.list && result.list !== undefined) {
        logger.error(`充值礼包详情查询结果中没有list属性, activityId: ${activityId}`);
        return {
            totalCount: result.totalCount || 0,
            list: []
        };
    }

    // 如果 result.list 是 undefined，返回默认值
    if (result.list === undefined) {
        logger.error(`充值礼包详情查询结果中list为undefined, activityId: ${activityId}`);
        return {
            totalCount: result.totalCount || 0,
            list: []
        };
    }

    // 检查 result.list 是否为数组
    if (!Array.isArray(result.list)) {
        logger.error(`充值礼包详情查询结果中的list不是数组, activityId: ${activityId}`);
        return {
            totalCount: result.totalCount || 0,
            list: []
        };
    }

    return {
        totalCount: result.totalCount || 0,
        list: result.list
    };
}


