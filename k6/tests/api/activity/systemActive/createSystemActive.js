import { logger } from '../../../../libs/utils/logger.js';

export const createSystemActiveTag = 'createSystemActive';

/**
 * 创建系统活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createSystemActive(data) {
    logger.info(`[${createSystemActiveTag}] 开始创建系统活动`);

    // TODO: 在这里添加具体的创建逻辑

    // 示例：如果需要跳过该活动，返回 success: false
    // return {
    //     success: false,
    //     tag: createSystemActiveTag,
    //     message: '系统活动已存在，跳过创建'
    // };

    return {
        success: true,
        tag: createSystemActiveTag,
        message: '系统活动创建成功'
    };
}
