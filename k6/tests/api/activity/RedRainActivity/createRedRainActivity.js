import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createRedRainActivityTag = 'createRedRainActivity';

/**
 * 格式化日期时间为 "YYYY-MM-DD HH:mm:ss" 格式
 * @param {Date} date 
 * @returns {string}
 */
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 计算活动开始时间
 * 规则：
 * - 如果当前时间在早上9点之前或16点之后，开始时间为第二天早上10点
 * - 否则，开始时间为当前时间加上指定小时数
 * - 如果计算后的时间超过16点，改为第二天10点
 * @param {number} hoursToAdd - 要添加的小时数，默认为1
 * @returns {Date}
 */
function calculateStartTime(hoursToAdd = 1) {
    const now = new Date();
    const currentHour = now.getHours();

    // 如果当前时间在早上9点之前或16点之后
    if (currentHour < 9 || currentHour >= 16) {
        // 设置为第二天早上10点
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        return tomorrow;
    } else {
        // 使用当前时间加上指定小时数
        const laterTime = new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);

        // 如果计算后的时间超过16点，改为第二天10点
        if (laterTime.getHours() >= 16) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);
            return tomorrow;
        }

        return laterTime;
    }
}

/**
 * 创建红包雨活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createRedRainActivity(data) {
    logger.info(`[${createRedRainActivityTag}] 开始创建红包雨活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createRedRainActivityTag}] Token 不存在，无法创建红包雨活动`);
            return {
                success: false,
                tag: createRedRainActivityTag,
                message: 'Token 不存在，跳过红包雨活动创建'
            };
        }

        // 尝试创建活动，最多尝试3次，每次增加时间间隔
        const maxAttempts = 3;
        const hoursToAddList = [1, 3, 6]; // 第一次+1小时，第二次+3小时，第三次+6小时

        let result = null;
        let startTime = null;
        let endTime = null;
        let startTimeStr = '';
        let endTimeStr = '';

        // 生成带时间戳的活动名称
        const timestamp = Date.now();
        const activityName = `测试红包雨的活动_${timestamp}`;

        logger.info(`[${createRedRainActivityTag}] 活动名称: ${activityName}`);

        const api = '/api/CashRain/AddConfig';

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const hoursToAdd = hoursToAddList[attempt];

            // 计算开始时间和结束时间
            startTime = calculateStartTime(hoursToAdd);
            endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000); // 开始时间 + 3小时
            startTimeStr = formatDateTime(startTime);
            endTimeStr = formatDateTime(endTime);

            logger.info(`[${createRedRainActivityTag}] 第${attempt + 1}次尝试 - 开始时间: ${startTimeStr} (当前时间+${hoursToAdd}小时)`);
            logger.info(`[${createRedRainActivityTag}] 第${attempt + 1}次尝试 - 结束时间: ${endTimeStr}`);

            const payload = {
                "activityName": activityName,
                "roundType": 1,
                "startTime": startTimeStr,
                "endTime": endTimeStr,
                "preheatTime": 3,
                "preheatTimeUnit": 1,
                "countdownTime": 1,
                "countdownTimeUnit": 1,
                "intervalTime": 20,
                "intervalTimeUnit": 1,
                "codingMultiple": 2,
                "state": 1,
                "rewardPoolType": 0,
                "totalRewardAmount": 5000,
                "roundDuration": 20,
                "rewardConfigDetail": [
                    { "vipLevel": 0, "minAmount": 1, "maxAmount": 2 },
                    { "vipLevel": 1, "minAmount": 10, "maxAmount": 20 },
                    { "vipLevel": 2, "minAmount": 20, "maxAmount": 30 },
                    { "vipLevel": 3, "minAmount": 30, "maxAmount": 40 },
                    { "vipLevel": 4, "minAmount": 40, "maxAmount": 50 },
                    { "vipLevel": 5, "minAmount": 50, "maxAmount": 100 }
                ],
                "totalRewardAmountLimit": 100,
                "roundRewardAmountLimit": 10,
                "totalRewardCountLimit": 10,
                "roundRewardCountLimit": 3,
                "targetType": 9,
                "roundDetail": {
                    "cycleRound": {
                        "intervalTime": 20,
                        "intervalUnit": 1
                    },
                    "fixedRound": []
                }
            };

            logger.info(`[${createRedRainActivityTag}] 发送创建请求（第${attempt + 1}次）...`);
            result = sendRequest(payload, api, createRedRainActivityTag, false, token);

            // 检查返回结果 - 响应可能是布尔值 true 或对象 {msgCode: 0}
            const isSuccess = result === true || (result && result.msgCode === 0);
            const isMsgCode6056 = result && result.msgCode === 6056;

            if (isSuccess) {
                logger.info(`[${createRedRainActivityTag}] 红包雨活动创建成功（第${attempt + 1}次尝试）`);
                return {
                    success: true,
                    tag: createRedRainActivityTag,
                    message: `红包雨活动创建成功${attempt > 0 ? '（调整时间后）' : ''}`
                };
            } else if (isMsgCode6056) {
                // 活动时间重叠
                if (attempt < maxAttempts - 1) {
                    logger.warn(`[${createRedRainActivityTag}] 红包雨活动时间重叠，将尝试调整开始时间为当前时间+${hoursToAddList[attempt + 1]}小时后重试`);
                    // 继续下一次循环
                } else {
                    // 已经是最后一次尝试了
                    logger.error(`[${createRedRainActivityTag}] 红包雨活动创建失败：已尝试${maxAttempts}次，仍然存在时间重叠，跳过该活动创建`);
                    return {
                        success: true, // 返回true表示跳过，不影响后续流程
                        tag: createRedRainActivityTag,
                        message: `红包雨活动创建跳过：多次尝试后仍存在时间重叠`
                    };
                }
            } else {
                // 其他错误，直接返回失败
                logger.error(`[${createRedRainActivityTag}] 红包雨活动创建失败（第${attempt + 1}次尝试）: ${result?.msg || '未知错误'}`);
                return {
                    success: false,
                    tag: createRedRainActivityTag,
                    message: `红包雨活动创建失败: ${result?.msg || '未知错误'}`
                };
            }
        }

        // 理论上不会到这里，但为了安全起见
        logger.error(`[${createRedRainActivityTag}] 红包雨活动创建失败：未知原因`);
        return {
            success: false,
            tag: createRedRainActivityTag,
            message: '红包雨活动创建失败：未知原因'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRedRainActivityTag}] 创建红包雨活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRedRainActivityTag,
            message: `创建红包雨活动失败: ${errorMsg}`
        };
    }
}
