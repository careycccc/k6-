import { logger } from '../../../../libs/utils/logger.js';

export const createRechargeWheelTag = 'createRechargeWheel';

/**
 * 创建充值转盘活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createRechargeWheel(data) {
    logger.info(`[${createRechargeWheelTag}] 开始创建充值转盘活动`);

    // TODO: 在这里添加具体的创建逻辑

    return {
        success: true,
        tag: createRechargeWheelTag,
        message: '充值转盘活动创建成功'
    };
}
