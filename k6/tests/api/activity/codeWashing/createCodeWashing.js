import { logger } from '../../../../libs/utils/logger.js';

export const createCodeWashingTag = 'createCodeWashing';

/**
 * 创建洗码活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createCodeWashing(data) {
    logger.info(`[${createCodeWashingTag}] 开始创建洗码活动`);

    // TODO: 在这里添加具体的创建逻辑

    return {
        success: false,
        tag: createCodeWashingTag,
        message: '洗码活动不用创建,直接在后台开启就可以了'
    };
}
