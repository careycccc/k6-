import { commonRequest3, commonRequest } from '../../formdata/config/formreqeust.js';
import { fromOptions } from '../../formdata/config/config.js';
import { logger } from '../../../../libs/utils/logger.js';
import { groupByAndSum } from '../../common/common.js';
import { sleep } from 'k6'

// 周卡月卡
export const weekCardTag = 'weekCard'

let weekCardinfo = {
    amount: 0, // 领奖金额
    amountUsercount: 0, // 领奖人数
    amountcountTotal: 0 // 总共领奖多少次
}

/**
 * 周卡月卡查询
 * @param {*} data 
 */
export function queryWeekCard(data) {
    const api = '/api/CardPlan/GetCardPlanUserRewardRecordPageList'
    const payload = {
        startDate: fromOptions.startTimeSecend,
        endDate: fromOptions.endTimeSecend,
        state: 1
    }

    // 使用 try-catch 捕获可能的异常
    let result;
    try {
        result = commonRequest3(data, api, payload, weekCardTag);
    } catch (error) {
        logger.error('周卡月卡查询异常:', error.message);
        console.error('错误堆栈:', error.stack);
        return weekCardinfo;
    }
    // 检查 result 是否有效
    if (!result || !result.list) {
        logger.info('周卡月卡查询结果为空，跳过后续处理', result)
        return weekCardinfo;
    }

    // 检查 result.list 是否存在
    if (!result || !result.list && result.list !== undefined) {
        logger.info('周卡月卡查询结果中list为空，跳过后续处理');
        return weekCardinfo;
    }

    // 如果 result.list 是 undefined，返回默认值
    if (result.list === undefined) {
        logger.info('周卡月卡查询结果中list为undefined，跳过后续处理');
        return weekCardinfo;
    }

    // 检查 result.list 是否为数组
    if (!Array.isArray(result.list)) {
        logger.info('周卡月卡查询结果中的list不是数组，跳过后续处理');
        return weekCardinfo;
    }

    // 更新总领奖次数
    weekCardinfo.amountcountTotal = result.totalCount || 0;

    // 检查 result.summary 是否存在
    if (!result || !result.summary) {
        logger.info('周卡月卡查询结果中summary为空，尝试从list计算总金额');
        // 如果没有 summary，尝试从 list 中计算总金额
        const totalAmount = result.list.reduce((sum, item) => sum + (item.rewardAmount || 0), 0);
        weekCardinfo.amount = totalAmount;

        // 按照 userId 分组并统计人数
        const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
        weekCardinfo.amountUsercount = groupResult.count;

        return weekCardinfo;
    }

    // 检查 result.summary.totalAmount 是否存在
    if (result.summary.totalAmount === undefined || result.summary.totalAmount === null) {
        logger.error('周卡月卡查询结果中summary.totalAmount不存在');
        // 如果 totalAmount 不存在，尝试从 list 中计算总金额
        const totalAmount = result.list.reduce((sum, item) => sum + (item.rewardAmount || 0), 0);
        weekCardinfo.amount = totalAmount;
    } else {
        weekCardinfo.amount = result.summary.totalAmount;
    }

    // 按照 userId 分组并统计人数
    const groupResult = groupByAndSum(result.list, 'userId', 'rewardAmount')
    weekCardinfo.amountUsercount = groupResult.count;

    return weekCardinfo;
}


