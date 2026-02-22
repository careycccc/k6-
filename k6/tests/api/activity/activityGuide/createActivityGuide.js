import { logger } from '../../../../libs/utils/logger.js';

export const createActivityGuideTag = 'createActivityGuide';

/**
 * 创建引导活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createActivityGuide(data) {
    logger.info(`[${createActivityGuideTag}] 开始创建引导活动`);

    // TODO: 在这里添加具体的创建逻辑

    // 示例：如果需要跳过该活动，返回 success: false
    // return {
    //     success: false,
    //     tag: createActivityGuideTag,
    //     message: '引导活动已存在，跳过创建'
    // };

    return {
        success: true,
        tag: createActivityGuideTag,
        message: '引导活动创建成功'
    };
}
