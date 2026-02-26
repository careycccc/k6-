import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createSigninTag = 'createSignin';

// 在模块顶层创建图片上传器
const uploadSigninImage1 = createImageUploader('../../uploadFile/img/signin/1.png', createSigninTag);
const uploadSigninImage2 = createImageUploader('../../uploadFile/img/signin/2.png', createSigninTag);

/**
 * 创建每日签到活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createSignin(data) {
    logger.info(`[${createSigninTag}] 开始创建每日签到活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createSigninTag}] Token 不存在，无法创建每日签到活动`);
            return {
                success: false,
                tag: createSigninTag,
                message: 'Token 不存在，跳过每日签到活动创建'
            };
        }

        // 步骤1：上传图片1并创建活动类型1
        logger.info(`[${createSigninTag}] ========== 步骤1：创建活动类型1 ==========`);
        const activity1Result = createSigninActivity1(data);
        if (!activity1Result.success) {
            return {
                success: false,
                tag: createSigninTag,
                message: `创建活动类型1失败: ${activity1Result.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤2：上传图片2并创建活动类型2
        logger.info(`[${createSigninTag}] ========== 步骤2：创建活动类型2 ==========`);
        const activity2Result = createSigninActivity2(data);
        if (!activity2Result.success) {
            return {
                success: false,
                tag: createSigninTag,
                message: `创建活动类型2失败: ${activity2Result.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤3：查询活动列表
        logger.info(`[${createSigninTag}] ========== 步骤3：查询活动列表 ==========`);
        const queryResult = querySigninActivities(data);
        if (!queryResult.success) {
            logger.warn(`[${createSigninTag}] 查询活动列表失败或为空，跳过启用步骤: ${queryResult.message}`);
            return {
                success: true,
                tag: createSigninTag,
                message: '每日签到活动创建成功（未启用活动）'
            };
        }

        const activityIds = queryResult.activityIds;
        logger.info(`[${createSigninTag}] 获取到 ${activityIds.length} 个活动ID`);

        // 等待0.5秒
        sleep(0.5);

        // 步骤4：启用活动
        logger.info(`[${createSigninTag}] ========== 步骤4：启用活动 ==========`);
        const enableResult = enableSigninActivities(data, activityIds);
        if (!enableResult.success) {
            logger.warn(`[${createSigninTag}] 启用活动失败: ${enableResult.message}`);
        }

        logger.info(`[${createSigninTag}] 每日签到活动创建成功`);
        return {
            success: true,
            tag: createSigninTag,
            message: '每日签到活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSigninTag}] 创建每日签到活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createSigninTag,
            message: `创建每日签到活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建签到活动类型1
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createSigninActivity1(data) {
    const token = data.token;
    const api = '/api/DailyCheckIn/Add';

    try {
        // 上传图片1
        logger.info(`[${createSigninTag}] 上传活动类型1图片`);
        const imageResult = handleImageUpload(data, 'signinImage1Path', uploadSigninImage1, createSigninTag);

        if (!imageResult.success) {
            return {
                success: false,
                message: `图片上传失败: ${imageResult.error}`
            };
        }

        const imagePath = imageResult.imagePath;
        logger.info(`[${createSigninTag}] 图片路径: ${imagePath}`);

        // 等待0.5秒
        sleep(0.5);

        // 计算日期
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const endDate = new Date(tomorrow.getTime() + 5 * 24 * 60 * 60 * 1000);

        // 格式化日期为 "YYYY-MM-DD HH:mm:ss"
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day} 00:00:00`;
        };

        const formatEndDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day} 23:59:59`;
        };

        // 生成时间戳
        const timestamp = Date.now();
        const activityName = `vip0不连续签到_${timestamp}`;

        logger.info(`[${createSigninTag}] 创建活动类型1: ${activityName}`);
        logger.info(`[${createSigninTag}] 活动开始时间: ${formatDate(tomorrow)}`);
        logger.info(`[${createSigninTag}] 活动结束时间: ${formatEndDate(endDate)}`);

        // 构建payload
        const payload = {
            "activityName": activityName,
            "statisticsType": "0",
            "activityType": "2",
            "activityStartTime": formatDate(tomorrow),
            "activityEndTime": formatEndDate(endDate),
            "isCycle": true,
            "cycleCheckInDays": 3,
            "picturesUrl": imagePath,
            "targetDetail": "0",
            "targetType": 8,
            "codingMultiple": 3,
            "rewardDetail": [
                { "dayIndex": 1, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 10 },
                { "dayIndex": 2, "rechargeAmount": 300, "rewardType": 1, "rewardAmount": 100 },
                { "dayIndex": 3, "rechargeAmount": 1000, "rewardType": 1, "rewardAmount": 500 }
            ],
            "translations": [
                { "language": "hi", "name": "印地语", "description": `<p>${activityName}</p>` },
                { "language": "en", "name": "英语", "description": `<p>${activityName}</p>` },
                { "language": "zh", "name": "中文", "description": `<p>${activityName}</p>` }
            ]
        };

        //logger.info(`[${createSigninTag}] 活动类型1 payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createSigninTag, false, token);

        //logger.info(`[${createSigninTag}] 活动类型1创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createSigninTag}] 活动类型1创建成功`);
            return { success: true };
        } else {
            logger.error(`[${createSigninTag}] 活动类型1创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `活动类型1创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSigninTag}] 创建活动类型1时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建活动类型1失败: ${errorMsg}`
        };
    }
}

/**
 * 创建签到活动类型2
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createSigninActivity2(data) {
    const token = data.token;
    const api = '/api/DailyCheckIn/Add';

    try {
        // 尝试上传图片2，如果失败则尝试图片1
        logger.info(`[${createSigninTag}] 尝试上传活动类型2图片 (2.png)`);
        let imageResult = handleImageUpload(data, 'signinImage2Path', uploadSigninImage2, createSigninTag);

        if (!imageResult.success) {
            logger.warn(`[${createSigninTag}] 图片2上传失败，尝试使用图片1`);
            imageResult = handleImageUpload(data, 'signinImage1Path', uploadSigninImage1, createSigninTag);

            if (!imageResult.success) {
                logger.error(`[${createSigninTag}] 图片1和图片2都上传失败`);
                return {
                    success: false,
                    message: `图片上传失败: 2.png 和 1.png 都无法上传`
                };
            }
        }

        const imagePath = imageResult.imagePath;
        logger.info(`[${createSigninTag}] 图片路径: ${imagePath}`);

        // 等待0.5秒
        sleep(0.5);

        // 计算本月开始和结束日期
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-11
        const currentDay = now.getDate();

        // 获取本月最后一天
        const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

        let startYear, startMonth, endYear, endMonth;

        // 如果今天是本月最后一天，使用下个月
        if (currentDay === lastDayOfMonth) {
            logger.info(`[${createSigninTag}] 今天是本月最后一天，使用下个月日期`);
            startYear = currentMonth === 11 ? currentYear + 1 : currentYear;
            startMonth = currentMonth === 11 ? 0 : currentMonth + 1;
            endYear = startYear;
            endMonth = startMonth;
        } else {
            // 使用本月
            logger.info(`[${createSigninTag}] 使用本月日期`);
            startYear = currentYear;
            startMonth = currentMonth;
            endYear = currentYear;
            endMonth = currentMonth;
        }

        // 计算该月的最后一天
        const lastDay = new Date(endYear, endMonth + 1, 0).getDate();

        // 格式化日期
        const formatMonthStart = (year, month) => {
            const m = String(month + 1).padStart(2, '0');
            return `${year}-${m}-01 00:00:00`;
        };

        const formatMonthEnd = (year, month, lastDay) => {
            const m = String(month + 1).padStart(2, '0');
            const d = String(lastDay).padStart(2, '0');
            return `${year}-${m}-${d} 23:59:59`;
        };

        const activityStartTime = formatMonthStart(startYear, startMonth);
        const activityEndTime = formatMonthEnd(endYear, endMonth, lastDay);

        // 生成时间戳
        const timestamp = Date.now();
        const activityName = `vip每日签到（常驻）_${timestamp}`;

        logger.info(`[${createSigninTag}] 创建活动类型2: ${activityName}`);
        logger.info(`[${createSigninTag}] 活动开始时间: ${activityStartTime}`);
        logger.info(`[${createSigninTag}] 活动结束时间: ${activityEndTime}`);

        // 构建payload
        const payload = {
            "activityName": activityName,
            "statisticsType": "0",
            "activityType": "0",
            "activityStartTime": activityStartTime,
            "activityEndTime": activityEndTime,
            "isCycle": true,
            "cycleCheckInDays": 15,
            "picturesUrl": imagePath,
            "targetDetail": "1,2,3,4,5,6,7,8,9,10,12,11",
            "targetType": 8,
            "codingMultiple": 2,
            "rewardDetail": [
                { "dayIndex": 1, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 10 },
                { "dayIndex": 2, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 11 },
                { "dayIndex": 3, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 12 },
                { "dayIndex": 4, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 13 },
                { "dayIndex": 5, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 14 },
                { "dayIndex": 6, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 15 },
                { "dayIndex": 7, "rechargeAmount": 500, "rewardType": 1, "rewardAmount": 1000 },
                { "dayIndex": 8, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 16 },
                { "dayIndex": 9, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 17 },
                { "dayIndex": 10, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 18 },
                { "dayIndex": 11, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 19 },
                { "dayIndex": 12, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 20 },
                { "dayIndex": 13, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 21 },
                { "dayIndex": 14, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 22 },
                { "dayIndex": 15, "rechargeAmount": 700, "rewardType": 1, "rewardAmount": 1500 },
                { "dayIndex": 16, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 23 },
                { "dayIndex": 17, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 24 },
                { "dayIndex": 18, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 25 },
                { "dayIndex": 19, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 26 },
                { "dayIndex": 20, "rechargeAmount": 1000, "rewardType": 1, "rewardAmount": 2000 },
                { "dayIndex": 21, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 27 },
                { "dayIndex": 22, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 28 },
                { "dayIndex": 23, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 29 },
                { "dayIndex": 24, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 30 },
                { "dayIndex": 25, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 31 },
                { "dayIndex": 26, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 32 },
                { "dayIndex": 27, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 33 },
                { "dayIndex": 28, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 34 },
                { "dayIndex": 29, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 35 },
                { "dayIndex": 30, "rechargeAmount": 100, "rewardType": 0, "rewardAmount": 36 },
                { "dayIndex": 31, "rechargeAmount": 2000, "rewardType": 1, "rewardAmount": 5000 }
            ],
            "translations": [
                { "language": "hi", "name": "印地语", "description": `<p>${activityName}</p>` },
                { "language": "en", "name": "英语", "description": `<p>${activityName}</p>` },
                { "language": "zh", "name": "中文", "description": `<p>${activityName}</p>` }
            ]
        };

        //logger.info(`[${createSigninTag}] 活动类型2 payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createSigninTag, false, token);

        //logger.info(`[${createSigninTag}] 活动类型2创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createSigninTag}] 活动类型2创建成功`);
            return { success: true };
        } else {
            logger.error(`[${createSigninTag}] 活动类型2创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `活动类型2创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSigninTag}] 创建活动类型2时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建活动类型2失败: ${errorMsg}`
        };
    }
}


/**
 * 查询签到活动列表
 * @param {*} data
 * @returns {Object} 查询结果 { success, activityIds, message }
 */
function querySigninActivities(data) {
    const token = data.token;
    const api = '/api/DailyCheckIn/GetDailyCheckInList';

    try {
        logger.info(`[${createSigninTag}] 查询签到活动列表`);

        const payload = {};

        const result = sendQueryRequest(payload, api, createSigninTag, false, token);

        if (!result) {
            logger.error(`[${createSigninTag}] 查询活动列表失败: 响应为空`);
            return {
                success: false,
                message: '查询活动列表失败: 响应为空'
            };
        }

        //logger.info(`[${createSigninTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let activityList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createSigninTag}] 查询活动列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询活动列表失败: ${result.msg || '未知错误'}`
                };
            }
            // 从 data.list 中获取列表
            activityList = result.data?.list || result.list || [];
        } else {
            activityList = result.list || [];
        }

        if (!activityList || !Array.isArray(activityList) || activityList.length === 0) {
            logger.warn(`[${createSigninTag}] 活动列表为空，无法启用活动`);
            return {
                success: false,
                message: '活动列表为空'
            };
        }

        logger.info(`[${createSigninTag}] 查询到 ${activityList.length} 个活动`);

        // 只取前2项的ID
        const activityIds = [];
        const maxItems = Math.min(2, activityList.length);

        for (let i = 0; i < maxItems; i++) {
            const activity = activityList[i];
            if (activity.id) {
                activityIds.push(activity.id);
                logger.info(`[${createSigninTag}] 活动 ${i + 1}: ID=${activity.id}, Name="${activity.activityName}"`);
            }
        }

        if (activityIds.length === 0) {
            logger.warn(`[${createSigninTag}] 未找到有效的活动ID`);
            return {
                success: false,
                message: '未找到有效的活动ID'
            };
        }

        return {
            success: true,
            activityIds: activityIds,
            message: `成功获取 ${activityIds.length} 个活动ID`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSigninTag}] 查询活动列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 启用签到活动
 * @param {*} data
 * @param {Array} activityIds 活动ID列表
 * @returns {Object} 启用结果 { success, message }
 */
function enableSigninActivities(data, activityIds) {
    const token = data.token;
    const api = '/api/DailyCheckIn/UpdateDailyCheckInState';

    try {
        let successCount = 0;
        let conflictCount = 0;
        let failedCount = 0;

        for (let i = 0; i < activityIds.length; i++) {
            const activityId = activityIds[i];
            logger.info(`[${createSigninTag}] 启用活动 ${i + 1}/${activityIds.length}: ID=${activityId}`);

            const payload = {
                "id": activityId,
                "state": 1
            };

            const result = sendRequest(payload, api, createSigninTag, false, token);

            logger.info(`[${createSigninTag}] 启用响应: ${JSON.stringify(result)}`);

            // 检查返回结果
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createSigninTag}] 活动 ID=${activityId} 启用成功`);
            } else if (result && result.msgCode === 6103) {
                // 活动启动条件冲突，视为警告
                conflictCount++;
                logger.warn(`[${createSigninTag}] 活动 ID=${activityId} 启动条件冲突: ${result.msg || 'There are activities where all members cannot start other activities'}`);
            } else {
                failedCount++;
                logger.error(`[${createSigninTag}] 活动 ID=${activityId} 启用失败: ${result?.msg || '未知错误'}`);
            }

            // 等待0.5秒再启用下一个
            if (i < activityIds.length - 1) {
                sleep(0.5);
            }
        }

        logger.info(`[${createSigninTag}] 启用完成: 成功=${successCount}, 冲突=${conflictCount}, 失败=${failedCount}`);

        if (successCount > 0 || conflictCount > 0) {
            return {
                success: true,
                message: `启用完成: 成功=${successCount}, 冲突=${conflictCount}, 失败=${failedCount}`
            };
        } else {
            return {
                success: false,
                message: `所有活动启用失败`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSigninTag}] 启用活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `启用失败: ${errorMsg}`
        };
    }
}
