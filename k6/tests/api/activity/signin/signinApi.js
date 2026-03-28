/**
 * 每日签到API模块
 */

import { httpClient } from '../../../../libs/http/client.js';
import { logger } from '../../../../libs/utils/logger.js';
import { getTimeRandom } from '../../../utils/utils.js';

const TAG = 'DailySignIn';

/**
 * 获取每日签到活动列表
 * @param {string} adminToken - 管理员token
 * @returns {object} 活动列表
 */
export function getDailyCheckInList(adminToken) {
    logger.info(`[${TAG}] 获取每日签到活动列表`);

    const api = '/api/DailyCheckIn/GetDailyCheckInList';
    const timeData = getTimeRandom();

    const payload = {
        pageNo: 1,
        pageSize: 20,
        orderBy: 'Desc',
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(api, payload, {
            params: { tags: { type: TAG, name: `${TAG}_GetList` } }
        }, false);

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${TAG}] 获取活动列表失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }

        logger.info(`[${TAG}] 获取到 ${parsedBody.data?.list?.length || 0} 个活动`);
        return parsedBody.data;

    } catch (error) {
        logger.error(`[${TAG}] 获取活动列表异常: ${error.message}`);
        return null;
    }
}

/**
 * 根据ID获取每日签到活动详情
 * @param {string} adminToken - 管理员token
 * @param {number} activityId - 活动ID
 * @returns {object} 活动详情
 */
export function getDailyCheckInInfoById(adminToken, activityId) {
    logger.info(`[${TAG}] 获取活动详情: activityId=${activityId}`);

    const api = '/api/DailyCheckIn/GetDailyCheckInInfoById';
    const timeData = getTimeRandom();

    const payload = {
        id: activityId,
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(api, payload, {
            params: { tags: { type: TAG, name: `${TAG}_GetInfo` } }
        }, false);

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${TAG}] 获取活动详情失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }

        return parsedBody.data;

    } catch (error) {
        logger.error(`[${TAG}] 获取活动详情异常: ${error.message}`);
        return null;
    }
}

/**
 * 手动领取每日签到奖励
 * @param {string} userToken - 用户token
 * @param {number} activityId - 活动ID
 * @param {number} rewardType - 奖励类型
 * @returns {object} 领取结果
 */
export function receiveDailyCheckInReward(userToken, activityId, rewardType = 0) {
    logger.info(`[${TAG}] 手动领取签到奖励: activityId=${activityId}, rewardType=${rewardType}`);

    const api = '/api/Activity/ReceiveDailyCheckInReward';
    const timeData = getTimeRandom();

    const payload = {
        activityId: activityId,
        rewardType: rewardType,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(api, payload, {
            params: { tags: { type: TAG, name: `${TAG}_Receive` } }
        }, true);

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${TAG}] 领取奖励失败: ${parsedBody?.msg || '未知错误'}`);
            return {
                success: false,
                msg: parsedBody?.msg || '未知错误',
                msgCode: parsedBody?.msgCode
            };
        }

        logger.info(`[${TAG}] 领取奖励成功`);
        return {
            success: true,
            data: parsedBody.data
        };

    } catch (error) {
        logger.error(`[${TAG}] 领取奖励异常: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 获取用户每日签到记录
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {string} startDate - 开始日期 (格式: YYYY-MM-DD HH:mm:ss)
 * @param {string} endDate - 结束日期 (格式: YYYY-MM-DD HH:mm:ss)
 * @returns {object} 签到记录
 */
export function getDailyCheckInUserList(adminToken, userId, startDate, endDate) {
    logger.info(`[${TAG}] 获取用户签到记录: userId=${userId}`);

    const api = '/api/DailyCheckIn/GetDailyCheckInUserList';
    const timeData = getTimeRandom();

    const payload = {
        startDate: startDate,
        endDate: endDate,
        userId: String(userId),
        pageNo: 1,
        pageSize: 20,
        orderBy: 'Desc',
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(api, payload, {
            params: { tags: { type: TAG, name: `${TAG}_UserList` } }
        }, false);

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${TAG}] 获取签到记录失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }

        return parsedBody.data;

    } catch (error) {
        logger.error(`[${TAG}] 获取签到记录异常: ${error.message}`);
        return null;
    }
}
