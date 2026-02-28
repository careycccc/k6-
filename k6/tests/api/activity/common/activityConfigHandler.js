import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

/**
 * 活动配置处理器 - 统一处理所有活动的配置规则
 * 
 * 配置规则：
 * 1. 开关类：value1="1"表示开启，"0"表示关闭
 *    - 如果已开启(value1="1")：先关闭等1s再开启
 *    - 如果已关闭(value1="0")：等1s后开启
 * 
 * 2. 数字类：读取value1的值后进行+2操作再设置
 * 
 * 3. 字符类：原封不动使用提供的payload数据
 */

/**
 * 配置类型枚举
 */
export const ConfigType = {
    SWITCH: 'switch',      // 开关类
    NUMBER: 'number',      // 数字类
    STRING: 'string'       // 字符类
};

/**
 * 处理单个配置项
 * @param {Object} params 参数对象
 * @param {string} params.token - 认证token
 * @param {string} params.settingKey - 配置键名
 * @param {Object} params.currentSetting - 当前配置对象（包含value1等）
 * @param {string} params.configType - 配置类型（switch/number/string）
 * @param {string} params.updateApi - 更新配置的API路径
 * @param {string} params.tag - 日志标签
 * @param {string|null} params.targetValue - 目标值（仅用于string类型）
 * @param {string|null} params.value2 - value2字段（可选）
 * @returns {Object} 处理结果 { success, message }
 */
export function handleConfigSetting(params) {
    const {
        token,
        settingKey,
        currentSetting,
        configType,
        updateApi,
        tag,
        targetValue = null,
        value2 = ""
    } = params;

    try {
        if (!currentSetting) {
            logger.error(`[${tag}] 配置项 ${settingKey} 不存在`);
            return {
                success: false,
                message: `配置项 ${settingKey} 不存在`
            };
        }

        const currentValue = currentSetting.value1;
        logger.info(`[${tag}] 处理配置 ${settingKey}, 当前值: ${currentValue}, 类型: ${configType}`);

        switch (configType) {
            case ConfigType.SWITCH:
                return handleSwitchConfig(token, settingKey, currentValue, updateApi, tag, value2);

            case ConfigType.NUMBER:
                return handleNumberConfig(token, settingKey, currentValue, updateApi, tag, value2);

            case ConfigType.STRING:
                return handleStringConfig(token, settingKey, currentValue, targetValue, updateApi, tag, value2);

            default:
                logger.error(`[${tag}] 未知的配置类型: ${configType}`);
                return {
                    success: false,
                    message: `未知的配置类型: ${configType}`
                };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 处理配置 ${settingKey} 时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `处理配置失败: ${errorMsg}`
        };
    }
}

/**
 * 处理开关类配置
 * 规则：
 * - 如果当前是"1"（已开启）：先关闭，等1s，再开启
 * - 如果当前是"0"（已关闭）：等1s，再开启
 */
function handleSwitchConfig(token, settingKey, currentValue, updateApi, tag, value2) {
    if (currentValue === "1") {
        // 已开启，先关闭
        logger.info(`[${tag}] ${settingKey} 已开启，先关闭...`);
        const closePayload = {
            settingKey: settingKey,
            value1: "0",
            value2: value2
        };
        const closeResult = sendRequest(closePayload, updateApi, tag, false, token);

        if (!closeResult || (closeResult.msgCode !== undefined && closeResult.msgCode !== 0)) {
            return {
                success: false,
                message: `关闭 ${settingKey} 失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${tag}] ${settingKey} 已关闭，等待1秒...`);
        sleep(1);
    } else {
        // 已关闭，直接等待
        logger.info(`[${tag}] ${settingKey} 已关闭，等待1秒后开启...`);
        sleep(1);
    }

    // 开启配置
    logger.info(`[${tag}] 开启 ${settingKey}...`);
    const openPayload = {
        settingKey: settingKey,
        value1: "1",
        value2: value2
    };
    const openResult = sendRequest(openPayload, updateApi, tag, false, token);

    if (!openResult || (openResult.msgCode !== undefined && openResult.msgCode !== 0)) {
        return {
            success: false,
            message: `开启 ${settingKey} 失败: ${openResult?.msg || '未知错误'}`
        };
    }

    logger.info(`[${tag}] ${settingKey} 已成功开启`);
    sleep(0.3);

    return { success: true };
}

/**
 * 处理数字类配置
 * 规则：读取value1的值后进行+2操作再设置
 */
function handleNumberConfig(token, settingKey, currentValue, updateApi, tag, value2) {
    const currentNumber = parseFloat(currentValue) || 0;
    const newValue = currentNumber + 2;

    logger.info(`[${tag}] ${settingKey} 当前值: ${currentNumber}, 设置为: ${newValue}`);

    const payload = {
        settingKey: settingKey,
        value1: String(newValue),
        value2: value2
    };
    const result = sendRequest(payload, updateApi, tag, false, token);

    if (!result || (result.msgCode !== undefined && result.msgCode !== 0)) {
        return {
            success: false,
            message: `设置 ${settingKey} 失败: ${result?.msg || '未知错误'}`
        };
    }

    logger.info(`[${tag}] ${settingKey} 已设置为 ${newValue}`);
    sleep(0.3);

    return { success: true };
}

/**
 * 处理字符类配置
 * 规则：原封不动使用提供的targetValue
 */
function handleStringConfig(token, settingKey, currentValue, targetValue, updateApi, tag, value2) {
    if (targetValue === null) {
        logger.warn(`[${tag}] ${settingKey} 未提供目标值，跳过设置`);
        return { success: true };
    }

    logger.info(`[${tag}] ${settingKey} 当前值: ${currentValue}, 设置为: ${targetValue}`);

    const payload = {
        settingKey: settingKey,
        value1: targetValue,
        value2: value2
    };
    const result = sendRequest(payload, updateApi, tag, false, token);

    if (!result || (result.msgCode !== undefined && result.msgCode !== 0)) {
        return {
            success: false,
            message: `设置 ${settingKey} 失败: ${result?.msg || '未知错误'}`
        };
    }

    logger.info(`[${tag}] ${settingKey} 已设置为 ${targetValue}`);
    sleep(0.3);

    return { success: true };
}

/**
 * 批量处理多个配置项
 * @param {Object} params 参数对象
 * @param {string} params.token - 认证token
 * @param {Object} params.settings - 所有配置对象
 * @param {Array} params.configRules - 配置规则数组
 * @param {string} params.updateApi - 更新配置的API路径
 * @param {string} params.tag - 日志标签
 * @returns {Object} 处理结果 { success, message, failedConfigs }
 * 
 * configRules 格式示例：
 * [
 *   { settingKey: 'IsOpenChampion', configType: 'switch' },
 *   { settingKey: 'ChampionCodingMultiple', configType: 'number' },
 *   { settingKey: 'ChampionName', configType: 'string', targetValue: 'MyChampion' }
 * ]
 */
export function handleMultipleConfigs(params) {
    const { token, settings, configRules, updateApi, tag } = params;

    const failedConfigs = [];
    let successCount = 0;

    for (const rule of configRules) {
        const { settingKey, configType, targetValue = null, value2 = "" } = rule;

        // 获取配置的键名（可能是驼峰或其他格式）
        const currentSetting = settings[settingKey] || settings[settingKey.charAt(0).toLowerCase() + settingKey.slice(1)];

        const result = handleConfigSetting({
            token,
            settingKey,
            currentSetting,
            configType,
            updateApi,
            tag,
            targetValue,
            value2
        });

        if (result.success) {
            successCount++;
        } else {
            failedConfigs.push({
                settingKey,
                message: result.message
            });
            logger.error(`[${tag}] 配置 ${settingKey} 处理失败: ${result.message}`);
        }
    }

    if (failedConfigs.length === 0) {
        logger.info(`[${tag}] 所有配置处理成功 (${successCount}/${configRules.length})`);
        return { success: true };
    } else {
        logger.warn(`[${tag}] 部分配置处理失败 (${successCount}/${configRules.length})`);
        return {
            success: false,
            message: `${failedConfigs.length} 个配置处理失败`,
            failedConfigs
        };
    }
}
