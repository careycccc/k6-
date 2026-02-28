import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, ConfigType } from '../common/activityConfigHandler.js';

export const createMegaJackpotTag = 'createMegaJackpot';

// 配置值对象 - 方便每次运行设置不同的值
const JACKPOT_CONFIG = {
    everyDayRewardLimitNum: 3,  // 超级大奖单个会员每日限制
    rewardCodeAmount: 2,          // 爆大奖奖励打码量倍数
    rewardValidityTime: 3         // 超级大奖超时时间(天)
};

/**
 * 创建超级大奖活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createMegaJackpot(data) {
    logger.info(`[${createMegaJackpotTag}] 开始创建超级大奖活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createMegaJackpotTag}] Token 不存在，无法创建超级大奖`);
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: 'Token 不存在，跳过超级大奖活动创建'
            };
        }

        // 第一步：查询配置
        logger.info(`[${createMegaJackpotTag}] 步骤1: 查询超级大奖配置...`);
        const configResult = getJackpotConfig(data);

        if (!configResult.success) {
            logger.error(`[${createMegaJackpotTag}] 查询配置失败: ${configResult.message}`);
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: `查询配置失败: ${configResult.message}`
            };
        }

        const config = configResult.config;
        logger.info(`[${createMegaJackpotTag}] 配置查询成功`);

        // 第二步：检查并配置超级大奖设置
        logger.info(`[${createMegaJackpotTag}] 步骤2: 配置超级大奖设置...`);
        const settingResult = checkAndConfigureMegaJackpotSettings(data, config);
        if (!settingResult.success) {
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: `配置超级大奖设置失败: ${settingResult.message}`
            };
        }

        // 第四步：创建超级大奖活动
        logger.info(`[${createMegaJackpotTag}] 步骤3: 创建超级大奖活动...`);
        sleep(1);
        const createResult = createMegaJackpotActivity(data);

        if (!createResult.success) {
            logger.error(`[${createMegaJackpotTag}] 超级大奖活动创建失败: ${createResult.message}`);
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: `超级大奖活动创建失败: ${createResult.message}`
            };
        }

        logger.info(`[${createMegaJackpotTag}] 超级大奖活动创建成功`);

        // 第五步：查询活动ID
        logger.info(`[${createMegaJackpotTag}] 步骤4: 查询活动ID...`);
        sleep(1);
        const activityIdResult = getActivityId(data);

        if (!activityIdResult.success) {
            logger.error(`[${createMegaJackpotTag}] 查询活动ID失败: ${activityIdResult.message}`);
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: `查询活动ID失败: ${activityIdResult.message}`
            };
        }

        const activityId = activityIdResult.id;
        logger.info(`[${createMegaJackpotTag}] 活动ID: ${activityId}`);

        // 第六步：启用活动
        logger.info(`[${createMegaJackpotTag}] 步骤5: 启用超级大奖活动...`);
        sleep(1);
        const enableResult = enableActivity(data, activityId);

        if (!enableResult.success) {
            logger.error(`[${createMegaJackpotTag}] 启用活动失败: ${enableResult.message}`);
            return {
                success: false,
                tag: createMegaJackpotTag,
                message: `启用活动失败: ${enableResult.message}`
            };
        }

        logger.info(`[${createMegaJackpotTag}] 超级大奖活动启用成功`);
        return {
            success: true,
            tag: createMegaJackpotTag,
            message: '超级大奖活动创建并启用成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 创建超级大奖活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createMegaJackpotTag,
            message: `创建超级大奖活动失败: ${errorMsg}`
        };
    }
}

/**
 * 检查并配置超级大奖设置
 * @param {*} data
 * @param {Object} config 当前配置对象
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureMegaJackpotSettings(data, config) {
    const token = data.token;
    const updateSettingApi = '/api/BigJackpot/UpdateJackpotConfig';

    try {
        // 使用统一配置处理器处理所有配置
        const configRules = [
            { settingKey: 'IsOpenJackpotRewardSwitch', configType: ConfigType.SWITCH },
            { settingKey: 'JackpotEveryDayRewardLimitNum', configType: ConfigType.NUMBER },
            { settingKey: 'JackpotRewardCodeAmount', configType: ConfigType.NUMBER },
            { settingKey: 'JackpotRewardValidityTime', configType: ConfigType.NUMBER }
        ];

        const result = handleMultipleConfigs({
            token,
            settings: config,
            configRules,
            updateApi: updateSettingApi,
            tag: createMegaJackpotTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 配置超级大奖设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 查询活动ID
 * @param {*} data
 * @returns {Object} 查询结果 { success, id, message }
 */
function getActivityId(data) {
    const token = data.token;
    const api = '/api/BigJackpot/GetPageList';
    const payload = {};

    try {
        const result = sendQueryRequest(payload, api, createMegaJackpotTag, false, token);

        if (result && result.list && result.list.length > 0) {
            const activityId = result.list[0].id;
            return {
                success: true,
                id: activityId
            };
        } else {
            return {
                success: false,
                message: '查询活动列表为空'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 查询活动ID请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

/**
 * 启用活动
 * @param {*} data
 * @param {number} activityId 活动ID
 * @returns {Object} 启用结果 { success, errorCode, message }
 */
function enableActivity(data, activityId) {
    const token = data.token;
    const api = '/api/BigJackpot/UpdateState';

    const payload = {
        "id": activityId,
        "state": 1
    };

    try {
        const result = sendRequest(payload, api, createMegaJackpotTag, false, token);

        if (result && result.msgCode === 0) {
            logger.info(`[${createMegaJackpotTag}] 活动启用成功 - ID: ${activityId}`);
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '启用失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 启用活动请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

/**
 * 查询超级大奖配置
 * @param {*} data
 * @returns {Object} 查询结果 { success, config, message }
 */
function getJackpotConfig(data) {
    const token = data.token;
    const api = '/api/BigJackpot/GetJackpotConfig';
    const payload = {};

    try {
        const result = sendQueryRequest(payload, api, createMegaJackpotTag, false, token);

        // result 直接就是配置对象，不需要 result.data
        if (result && typeof result === 'object') {
            // 检查是否已经是正确的配置格式
            const hasValidConfig = Object.values(result).some(item =>
                item && item.settingKey && item.settingName
            );

            if (hasValidConfig) {
                logger.info(`[${createMegaJackpotTag}] 配置查询成功，共 ${Object.keys(result).length} 项配置`);
                return {
                    success: true,
                    config: result
                };
            }
        }

        return {
            success: false,
            message: '查询配置返回数据格式不正确'
        };
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 查询配置请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

/**
 * 更新超级大奖配置
 * @param {*} data
 * @param {string} settingKey 配置键
 * @param {string} value1 配置值1
 * @param {string} value2 配置值2
 * @returns {Object} 更新结果 { success, errorCode, message }
 */
function updateJackpotConfig(data, settingKey, value1, value2) {
    const token = data.token;
    const api = '/api/BigJackpot/UpdateJackpotConfig';

    const payload = {
        "settingKey": settingKey,
        "value1": value1,
        "value2": value2
    };

    try {
        const result = sendRequest(payload, api, createMegaJackpotTag, false, token);

        if (result && result.msgCode === 0) {
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '更新失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 更新配置请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

/**
 * 创建超级大奖活动
 * @param {*} data
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createMegaJackpotActivity(data) {
    const token = data.token;
    const api = '/api/BigJackpot/Add';

    const payload = {
        "rangeType": 1,
        "minMultiple": 5,
        "maxMultiple": 1000,
        "minBetAmount": 100,
        "maxBetAmount": 10000,
        "effectiveRangeList": [],
        "awardAmount": 234,
        "everyDayRewardLimitNum": 3
    };

    try {
        const result = sendRequest(payload, api, createMegaJackpotTag, false, token);

        if (result && result.msgCode === 0) {
            logger.info(`[${createMegaJackpotTag}] 超级大奖创建成功 - 奖金: ${payload.awardAmount}`);
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createMegaJackpotTag}] 创建超级大奖请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
