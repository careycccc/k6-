/**
 * 活动咨询通用API
 * 主要用于通过活动咨询列表获取活动信息，并通过活动咨询的方式领取奖励
 */

import { httpClient } from '../../../../libs/http/client.js';
import { logger } from '../../../../libs/utils/logger.js';
import { getTimeRandom } from '../../../utils/utils.js';

const TAG = 'ActivityInfoAPI';

/**
 * 获取活动咨询列表
 * API: /api/Activity/GetActivityInformationList
 * @param {string} userToken - 用户token
 * @returns {Array|null} 活动咨询列表
 */
export function getActivityInformationList(userToken) {
    logger.info(`[${TAG}] 获取活动咨询列表`);

    const api = '/api/Activity/GetActivityInformationList';
    const timeData = getTimeRandom();
    
    const payload = {
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: 'ActivityInfo', name: 'ActivityInfo_GetActivityInformationList' }
                }
            },
            true // isDesk = true (前台接口)
        );

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (parsedBody && parsedBody.msgCode === 0 && parsedBody.data) {
            return parsedBody.data;
        } else {
            logger.error(`[${TAG}] 获取活动咨询列表失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }
    } catch (error) {
        logger.error(`[${TAG}] 获取活动咨询列表异常: ${error.message}`);
        return null;
    }
}

/**
 * 通过活动咨询的方式领取活动奖励
 * API: /api/Activity/ReceiveDailyCheckInReward (此接口为活动咨询的通用领取接口)
 * @param {string} userToken - 用户token
 * @param {number} activityId - 活动ID
 * @param {number} rewardType - 奖励类型
 * @returns {object} {success, msg, data}
 */
export function receiveRewardViaActivityInfo(userToken, activityId, rewardType) {
    logger.info(`[${TAG}] 通过活动咨询领取奖励 (ActivityId: ${activityId}, RewardType: ${rewardType})`);

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
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: 'ActivityInfo', name: 'ActivityInfo_ReceiveDailyCheckInReward' }
                }
            },
            true // isDesk = true
        );

        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (parsedBody && parsedBody.code === 0 && parsedBody.data !== null && parsedBody.msgCode === 0) {
            logger.info(`[${TAG}] 活动咨询奖励领取成功: ${JSON.stringify(parsedBody.data)}`);
            return {
                success: true,
                msg: '领取成功',
                data: parsedBody.data
            };
        } else {
            const errorMsg = parsedBody?.msg || '未知错误';
            logger.error(`[${TAG}] 活动咨询奖励领取失败: ${errorMsg}`);
            return {
                success: false,
                msg: errorMsg
            };
        }
    } catch (error) {
        logger.error(`[${TAG}] 活动咨询奖励领取异常: ${error.message}`);
        return {
            success: false,
            msg: `异常: ${error.message}`
        };
    }
}
