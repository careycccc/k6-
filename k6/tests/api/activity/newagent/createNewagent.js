import { logger } from '../../../../libs/utils/logger.js';

export const createNewagentTag = 'createNewagent';

/**
 * 创建新版返佣活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createNewagent(data) {
    logger.info(`[${createNewagentTag}] 开始创建新版返佣活动`);

    // TODO: 在这里添加具体的创建逻辑

    return {
        success: true,
        tag: createNewagentTag,
        message: '新版返佣活动创建成功'
    };
}
