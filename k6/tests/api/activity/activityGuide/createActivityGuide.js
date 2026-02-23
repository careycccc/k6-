import { logger } from '../../../../libs/utils/logger.js';
import { sendQueryRequest, sendRequest } from '../../common/request.js';
import { sleep } from 'k6'

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

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createActivityGuideTag}] Token 不存在，无法创建引导活动`);
            return {
                success: false,
                tag: createActivityGuideTag,
                message: 'Token 不存在，跳过引导活动创建'
            };
        }

        // 查询引导活动
        const queryResult = queryActivityGuide(data);
        if (!queryResult.success) {
            return queryResult;
        }

        // 更新引导活动配置
        const api = "/api/ActivityGuide/UpdateGuideConfig";
        const payload = {
            "codingMultiple": 1,
            "description": "引导用户观看充值教程视频，根据观看时长发放奖励",
            "guideActivityType": 0,
            "id": queryResult.id,
            "isRepeatTriggered": false,
            "name": "充值视频观看",
            "rewardAmount": 25,   // 观看后送的金额
            "videoUrl": "https://apk.jandroveximunda.com/XpTwTQf7/rec888fduew/1dsew78432hds2.mp4",
            "viewDuration": 10, // 观看时长，单位秒
        };

        const result = sendRequest(payload, api, createActivityGuideTag, false, token);

        if (result) {
            logger.info(`[${createActivityGuideTag}] 引导活动更新成功`);
            sleep(1);
            // 启用引导活动
            enableActivityGuide(data, queryResult.id);
            return {
                success: true,
                tag: createActivityGuideTag,
                message: '引导活动创建成功'
            };
        } else {
            logger.error(`[${createActivityGuideTag}] 引导活动更新失败`);
            return {
                success: false,
                tag: createActivityGuideTag,
                message: '引导活动更新失败'
            };
        }
    } catch (error) {
        const errorMsg = error && error.message ? error.message : String(error);
        logger.error(`[${createActivityGuideTag}] 创建引导活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createActivityGuideTag,
            message: `创建引导活动失败: ${errorMsg}`
        };
    }


}


/**
 * 查询引导活动
 * @param {*} data 
 * @returns {Object} 查询结果，包含 success 和 id
 */
export function queryActivityGuide(data) {
    const api = "/api/ActivityGuide/GetGuideConfigPageList";
    const token = data.token;
    const payload = {};

    try {
        const result = sendQueryRequest(payload, api, createActivityGuideTag, false, token);

        if (!result || !result.list || result.list.length === 0) {
            logger.error(`[${createActivityGuideTag}] 查询引导活动列表为空`);
            return {
                success: false,
                tag: createActivityGuideTag,
                message: '查询引导活动列表为空'
            };
        }

        // 查找充值视频观看的引导活动
        const targetActivity = result.list.find(item =>
            item.name === "充值视频观看" || item.guideActivityTypeName === "视频观看"
        );

        if (targetActivity) {
            logger.info(`[${createActivityGuideTag}] 找到引导活动，ID: ${targetActivity.id}`);
            return {
                success: true,
                tag: createActivityGuideTag,
                message: '查询引导活动成功',
                id: targetActivity.id
            };
        } else {
            logger.error(`[${createActivityGuideTag}] 未找到充值视频观看的引导活动`);
            return {
                success: false,
                tag: createActivityGuideTag,
                message: '查询引导活动列表没有找到充值视频观看的引导活动'
            };
        }
    } catch (error) {
        const errorMsg = error && error.message ? error.message : String(error);
        logger.error(`[${createActivityGuideTag}] 查询引导活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createActivityGuideTag,
            message: `查询引导活动失败: ${errorMsg}`
        };
    }
}

/**
 * 启用引导活动
 * @param {number} id 活动的id 
 */
export function enableActivityGuide(data, id) {
    const api = "/api/ActivityGuide/UpdateGuideConfigState"
    const token = data.token;
    const payload = {
        "id": id,
        "state": 1,
    }
    const result = sendRequest(payload, api, createActivityGuideTag, false, token);
    if (!result) {
        return {
            success: false,
            tag: createActivityGuideTag,
            message: `启用引导活动失败: ${result.msg}`
        };
    }
    return {
        success: true,
        tag: createActivityGuideTag,
        message: '启用引导活动成功'
    }
}
