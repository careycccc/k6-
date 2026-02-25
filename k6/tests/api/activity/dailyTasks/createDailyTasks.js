import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, ConfigType } from '../../common/activityConfigHandler.js';

export const createDailyTasksTag = 'createDailyTasks';

// 在模块顶层创建2个图片上传器，对应2个不同的任务
const uploadDailyTasksImage1 = createImageUploader('../../uploadFile/img/dailyTasks/1.png', createDailyTasksTag);
const uploadDailyTasksImage2 = createImageUploader('../../uploadFile/img/dailyTasks/2.png', createDailyTasksTag);

/**
 * 创建每日每周任务活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createDailyTasks(data) {
    logger.info(`[${createDailyTasksTag}] 开始创建每日每周任务活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createDailyTasksTag}] Token 不存在，无法创建每日任务活动`);
            return {
                success: false,
                tag: createDailyTasksTag,
                message: 'Token 不存在，跳过每日任务活动创建'
            };
        }

        // 检查并配置每日每周任务设置
        const settingResult = checkAndConfigureDailyTasksSettings(data);
        if (!settingResult.success) {
            return {
                success: false,
                tag: createDailyTasksTag,
                message: `配置每日每周任务设置失败: ${settingResult.message}`
            };
        }

        // 恢复图片上传功能 - taskLogoType=1 是支持的
        const uploadFunctions = [uploadDailyTasksImage1, uploadDailyTasksImage2];
        const cacheKeys = ['dailyTasksImagePath1', 'dailyTasksImagePath2'];
        const imagePaths = [];

        for (let i = 0; i < uploadFunctions.length; i++) {
            const imageResult = handleImageUpload(data, cacheKeys[i], uploadFunctions[i], createDailyTasksTag);

            if (!imageResult.success) {
                return {
                    success: false,
                    tag: createDailyTasksTag,
                    message: `图片${i + 1}上传失败: ${imageResult.error}，跳过每日任务活动创建`
                };
            }

            imagePaths.push(imageResult.imagePath);
        }

        // 生成时间戳用于任务名称
        const timestamp = Date.now();

        // 创建两个任务：每日充值+投注任务、每周邀请任务
        const tasks = [
            {
                name: `每日+充值投注任务_${timestamp}`,
                sort: 1,
                taskType: 0, // 每日任务
                taskDetailType: 3, // 3 = 充值+投注组合类型
                taskDetail: {
                    rechargeAmount: 100,  // 充值金额要求
                    betAmount: 200,       // 投注金额要求
                    gameCode: []
                },
                minVipLevel: 0,
                needRechargeAmount: 200,
                codingMultiple: 2,
                experienceScore: 30,
                imagePath: imagePaths[0] // 使用第1张图片
            },
            {
                name: `每周+邀请任务_${timestamp}`,
                sort: 2,
                taskType: 1, // 每周任务
                taskDetailType: 2, // 2 = 邀请任务
                taskDetail: {
                    invitedUserCount: 2,
                    gameCode: []
                },
                minVipLevel: 0,
                needRechargeAmount: 300,
                codingMultiple: 2,
                experienceScore: 10,
                imagePath: imagePaths[1] // 使用第2张图片
            }
        ];

        let successCount = 0;
        let failedTasks = [];
        let createdTaskIds = [];

        // 循环创建每个任务
        for (const task of tasks) {
            sleep(1)
            const createResult = createDailyTasksActivity(data, task);

            if (createResult.success) {
                successCount++;
                createdTaskIds.push({
                    name: createResult.taskName,
                    startDate: createResult.startDate,
                    endDate: createResult.endDate
                });
                logger.info(`[${createDailyTasksTag}] ${task.name} 创建成功`);
                sleep(0.5);
            } else {
                failedTasks.push(task.name);
                logger.error(`[${createDailyTasksTag}] ${task.name} 创建失败: ${createResult.message}`);
            }
        }

        // 验证创建的任务是否真的存在
        if (successCount > 0) {
            sleep(2); // 等待2秒让数据库同步
            const verifyResult = verifyCreatedTasks(data, createdTaskIds);

            // 如果验证成功，继续配置任务
            if (verifyResult.allFound) {
                logger.info(`[${createDailyTasksTag}] 开始配置任务奖励...`);
                const configResult = configureTaskRewards(data, createdTaskIds);

                if (configResult.success) {
                    logger.info(`[${createDailyTasksTag}] 任务奖励配置完成`);
                } else {
                    logger.warn(`[${createDailyTasksTag}] 任务奖励配置失败: ${configResult.message}`);
                }
            }
        }

        if (successCount === tasks.length) {
            logger.info(`[${createDailyTasksTag}] 所有每日任务创建成功 (${successCount}/${tasks.length})`);
            return {
                success: true,
                tag: createDailyTasksTag,
                message: `每日任务活动创建成功，共创建 ${successCount} 个任务`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createDailyTasksTag}] 部分任务创建成功 (${successCount}/${tasks.length})`);
            return {
                success: true,
                tag: createDailyTasksTag,
                message: `部分任务创建成功 (${successCount}/${tasks.length})，失败: ${failedTasks.join(', ')}`
            };
        } else {
            logger.error(`[${createDailyTasksTag}] 所有任务创建失败`);
            return {
                success: false,
                tag: createDailyTasksTag,
                message: '所有每日任务创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createDailyTasksTag}] 创建每日任务活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createDailyTasksTag,
            message: `创建每日任务活动失败: ${errorMsg}`
        };
    }
}

/**
 * 检查并配置每日每周任务设置
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureDailyTasksSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/DayWeek/GetConfig';
    const updateSettingApi = '/api/DayWeek/UpdateConfig';

    try {
        // 1. 获取当前配置
        logger.info(`[${createDailyTasksTag}] 获取每日每周任务配置`);
        const settingsResult = sendRequest({}, getSettingApi, createDailyTasksTag, false, token);

        logger.info(`[${createDailyTasksTag}] 配置响应: ${JSON.stringify(settingsResult)}`);

        // 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${createDailyTasksTag}] 获取配置失败: 响应为空`);
            return {
                success: false,
                message: '获取配置失败: 响应为空'
            };
        }

        // 判断响应格式
        let settings;
        if (settingsResult.msgCode !== undefined) {
            // 标准响应格式（有 msgCode 和 data）
            if (settingsResult.msgCode !== 0) {
                logger.error(`[${createDailyTasksTag}] 获取配置失败: msgCode=${settingsResult.msgCode}, msg=${settingsResult.msg}`);
                return {
                    success: false,
                    message: `获取配置失败: ${settingsResult.msg || '未知错误'}`
                };
            }
            settings = settingsResult.data;
        } else if (settingsResult.settingKey === "IsOpenDailyWeeklyTask") {
            // 直接返回单个配置对象，需要包装成对象
            settings = {
                isOpenDailyWeeklyTask: settingsResult
            };
        } else {
            logger.error(`[${createDailyTasksTag}] 无法识别的响应格式`);
            return {
                success: false,
                message: '无法识别的响应格式'
            };
        }

        if (!settings) {
            logger.error(`[${createDailyTasksTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        // 2. 使用统一配置处理器处理所有配置
        const configRules = [
            { settingKey: 'isOpenDailyWeeklyTask', configType: ConfigType.SWITCH }
        ];

        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: createDailyTasksTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createDailyTasksTag}] 配置每日每周任务设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 配置任务奖励
 * @param {*} data 
 * @param {Array} createdTasks 创建的任务列表（包含任务名称、时间等）
 * @returns {Object} 配置结果
 */
function configureTaskRewards(data, createdTasks) {
    logger.info(`[${createDailyTasksTag}] 开始为 ${createdTasks.length} 个任务配置奖励`);

    let successCount = 0;
    const failedTasks = [];

    for (const task of createdTasks) {
        // 先获取任务ID
        const queryResult = getById(data, task.name);

        if (!queryResult.success || !queryResult.id) {
            logger.error(`[${createDailyTasksTag}] 无法获取任务ID: ${task.name}`);
            failedTasks.push(task.name);
            continue;
        }

        const taskId = queryResult.id;
        logger.info(`[${createDailyTasksTag}] 为任务 ${task.name} (ID: ${taskId}) 配置奖励`);

        // 根据任务名称判断是每日还是每周任务
        const isWeekly = task.name.includes('每周');

        // 配置任务奖励
        const configResult = addOrUpdateAccumulateConfig(data, taskId, task, isWeekly);

        if (configResult.success) {
            successCount++;
            logger.info(`[${createDailyTasksTag}] ✓ 任务奖励配置成功: ${task.name}`);
        } else {
            failedTasks.push(task.name);
            logger.error(`[${createDailyTasksTag}] ✗ 任务奖励配置失败: ${task.name} - ${configResult.message}`);
        }

        sleep(0.5);
    }

    logger.info(`[${createDailyTasksTag}] 奖励配置完成: ${successCount}/${createdTasks.length}`);

    return {
        success: successCount === createdTasks.length,
        successCount: successCount,
        failedTasks: failedTasks,
        message: successCount === createdTasks.length
            ? '所有任务奖励配置成功'
            : `部分任务配置失败: ${failedTasks.join(', ')}`
    };
}

/**
 * 添加或更新累计任务配置
 * @param {*} data 
 * @param {number} taskId 任务ID
 * @param {Object} task 任务信息
 * @param {boolean} isWeekly 是否为每周任务
 * @returns {Object} 配置结果
 */
function addOrUpdateAccumulateConfig(data, taskId, task, isWeekly) {
    const token = data.token;
    const api = '/api/DayWeek/AddOrUpdateAccumulateConfig';

    // 每日任务奖励配置 (充值+投注类型)
    const dailyTaskDetail = [
        { index: 0, needNumber: 1, rewardType: 1, rewardAmount: 0, minRewardAmount: 1, maxRewardAmount: 5, codingMultiple: 1 },
        { index: 1, needNumber: 2, rewardType: 0, rewardAmount: 2, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 2 },
        { index: 2, needNumber: 3, rewardType: 0, rewardAmount: 3, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 3 },
        { index: 3, needNumber: 4, rewardType: 0, rewardAmount: 4, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 4 },
        { index: 4, needNumber: 5, rewardType: 0, rewardAmount: 5, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 5 },
        { index: 5, needNumber: 6, rewardType: 1, rewardAmount: 0, minRewardAmount: 2, maxRewardAmount: 10, codingMultiple: 6 },
        { index: 6, needNumber: 7, rewardType: 0, rewardAmount: 7, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 7 },
        { index: 7, needNumber: 8, rewardType: 0, rewardAmount: 8, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 8 }
    ];

    // 每周任务奖励配置 (邀请类型)
    const weeklyTaskDetail = [
        { index: 0, needNumber: 1, rewardType: 1, rewardAmount: 0, minRewardAmount: 1, maxRewardAmount: 4, codingMultiple: 1 },
        { index: 1, needNumber: 2, rewardType: 1, rewardAmount: 0, minRewardAmount: 1, maxRewardAmount: 4, codingMultiple: 2 },
        { index: 2, needNumber: 3, rewardType: 0, rewardAmount: 3, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 3 },
        { index: 3, needNumber: 4, rewardType: 1, rewardAmount: 0, minRewardAmount: 3, maxRewardAmount: 9, codingMultiple: 4 },
        { index: 4, needNumber: 5, rewardType: 0, rewardAmount: 5, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 5 },
        { index: 5, needNumber: 6, rewardType: 0, rewardAmount: 6, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 6 },
        { index: 6, needNumber: 7, rewardType: 0, rewardAmount: 7, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 7 },
        { index: 7, needNumber: 8, rewardType: 0, rewardAmount: 8, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 8 },
        { index: 8, needNumber: 9, rewardType: 0, rewardAmount: 9, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 9 },
        { index: 9, needNumber: 10, rewardType: 0, rewardAmount: 10, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 10 },
        { index: 10, needNumber: 11, rewardType: 0, rewardAmount: 11, minRewardAmount: 0, maxRewardAmount: 0, codingMultiple: 11 }
    ];

    const payload = {
        "id": taskId,
        "startDate": task.startDate,
        "endDate": isWeekly ? "" : task.endDate,  // 每周任务的endDate为空字符串
        "taskType": isWeekly ? 1 : 0,  // 0: 每日, 1: 每周
        "taskConditionType": isWeekly ? 1 : 0,  // 0: 充值+投注, 1: 邀请
        "taskDetail": isWeekly ? weeklyTaskDetail : dailyTaskDetail,
        "state": 1
    };

    try {
        const result = sendRequest(payload, api, createDailyTasksTag, false, token);

        if (result && result.msgCode === 0) {
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '配置失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createDailyTasksTag}] 配置任务奖励请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

/**
 * 验证创建的任务是否在后台可见
 * @param {*} data 
 * @param {Array} createdTasks 创建的任务列表
 * @returns {Object} 验证结果
 */
function verifyCreatedTasks(data, createdTasks) {
    logger.info(`[${createDailyTasksTag}] ========== 开始验证创建的任务 ==========`);

    let foundCount = 0;
    const notFound = [];

    for (let i = 0; i < createdTasks.length; i++) {
        const task = createdTasks[i];

        // 使用 getById 函数查询任务
        const queryResult = getById(data, task.name);

        if (queryResult.success && queryResult.id) {
            foundCount++;
            logger.info(`[${createDailyTasksTag}] ✓ 任务已确认存在: ${task.name} (ID: ${queryResult.id})`);
        } else {
            notFound.push(task.name);
            logger.warn(`[${createDailyTasksTag}] ✗ 任务在后台未找到: ${task.name}`);
        }
    }

    logger.info(`[${createDailyTasksTag}] ========== 验证完成: ${foundCount}/${createdTasks.length} ==========`);

    if (notFound.length > 0) {
        logger.warn(`[${createDailyTasksTag}] 未找到的任务: ${notFound.join(', ')}`);
        logger.info(`[${createDailyTasksTag}] 请手动检查后台: 活动管理 -> 每日/每周任务`);
        logger.info(`[${createDailyTasksTag}] 时间筛选: ${createdTasks[0].startDate} ~ ${createdTasks[0].endDate}`);
    }

    return {
        allFound: notFound.length === 0,
        foundCount: foundCount,
        notFound: notFound
    };
}

/**
 * 创建每日任务活动
 * @param {*} data
 * @param {Object} taskConfig 任务配置（包含 imagePath）
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createDailyTasksActivity(data, taskConfig) {
    const token = data.token;
    const api = 'api/DayWeek/AddTask';
    // /api/DayWeek/AddTask

    // 获取当前时间和本周周日
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 计算本周周日（0 = 周日, 1 = 周一, ..., 6 = 周六）
    const currentDay = today.getDay();
    const daysUntilSunday = currentDay === 0 ? 0 : 7 - currentDay;
    const thisSunday = new Date(today.getTime() + daysUntilSunday * 24 * 60 * 60 * 1000);

    // 如果今天是周日，结束时间设置为下周日
    if (currentDay === 0) {
        thisSunday.setDate(thisSunday.getDate() + 7);
    }

    // 格式化日期为 "YYYY-MM-DD"
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const startDate = formatDate(today);
    const endDate = formatDate(thisSunday);

    logger.info(`[${createDailyTasksTag}] 任务时间设置 - 开始: ${startDate}, 结束: ${endDate}, 当前星期: ${currentDay === 0 ? '周日' : '周' + ['一', '二', '三', '四', '五', '六'][currentDay - 1]}`);

    // 构建每日任务活动的payload
    // taskLogoType=1 使用自定义图片(taskLogo为图片路径), taskLogoType=0 使用预设图标(taskLogo为数字)
    const payload = {
        "id": 0,
        "taskName": taskConfig.name,
        "taskLogo": taskConfig.imagePath, // 使用上传的图片路径
        "needRechargeAmount": taskConfig.needRechargeAmount,
        "minVipLevel": taskConfig.minVipLevel,
        "taskType": taskConfig.taskType, // 0: 每日任务, 1: 每周任务
        "sort": taskConfig.sort,
        "taskDetailType": taskConfig.taskDetailType,
        "taskDetail": taskConfig.taskDetail,
        "rewardAmount": 200,
        "codingMultiple": taskConfig.codingMultiple,
        "experienceScore": taskConfig.experienceScore,
        "state": 1,
        "translations": [
            {
                "language": "hi",
                "name": ""
            },
            {
                "language": "en",
                "name": taskConfig.name
            },
            {
                "language": "zh",
                "name": ""
            }
        ],
        "startDate": startDate,
        "endDate": endDate,
        "taskLogoType": 1  // 使用自定义图片
    };

    try {
        const result = sendRequest(payload, api, createDailyTasksTag, false, token);

        if (result && result.msgCode === 0) {
            // API 返回成功但不包含任务ID，只返回 {code: 0, msg: "Succeed", msgCode: 0}
            logger.info(`[${createDailyTasksTag}] 任务创建成功 - 任务名: ${taskConfig.name}, 时间: ${startDate} ~ ${endDate}`);
            return {
                success: true,
                taskName: taskConfig.name,
                startDate: startDate,
                endDate: endDate
            };
        } else {
            logger.error(`[${createDailyTasksTag}] 任务创建失败 - msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createDailyTasksTag}] 创建每日任务活动请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}


/**
 * 根据任务名称获取id
 * @param {string} taskName. 任务名称
 */
export function getById(data, taskName) {
    const api = "/api/DayWeek/GetTaskList"
    const token = data.token
    const payload = {
        taskName,
    }
    const result = sendQueryRequest(payload, api, createDailyTasksTag, false, token)
    if (!result || !result.list || result.list.length === 0) {
        return {
            success: false,
            message: `根据任务名称获取id返回的结果是空的，没有查询到结果`,
            id: 0
        }
    }
    return {
        success: true,
        message: "查询成功",
        id: result.list[0].id
    }
}
