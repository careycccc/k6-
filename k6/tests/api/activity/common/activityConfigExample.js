/**
 * 活动配置处理示例
 * 
 * 本文件展示如何使用统一的活动配置处理方案
 */

import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, handleConfigSetting, ConfigType } from './activityConfigHandler.js';

export const exampleActivityTag = 'exampleActivity';

/**
 * 示例：创建活动的主函数
 */
export function createExampleActivity(data) {
    logger.info(`[${exampleActivityTag}] 开始创建示例活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${exampleActivityTag}] Token 不存在`);
            return {
                success: false,
                tag: exampleActivityTag,
                message: 'Token 不存在'
            };
        }

        // 检查并配置活动设置
        const settingResult = checkAndConfigureExampleSettings(data);
        if (!settingResult.success) {
            return {
                success: false,
                tag: exampleActivityTag,
                message: `配置活动设置失败: ${settingResult.message}`
            };
        }

        // 继续创建活动的其他逻辑...
        logger.info(`[${exampleActivityTag}] 活动创建成功`);
        return {
            success: true,
            tag: exampleActivityTag,
            message: '示例活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${exampleActivityTag}] 创建活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: exampleActivityTag,
            message: `创建活动失败: ${errorMsg}`
        };
    }
}

/**
 * 示例1：使用批量配置处理（推荐）
 */
function checkAndConfigureExampleSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/ExampleActivity/GetConfig';
    const updateSettingApi = '/api/ExampleActivity/UpdateConfig';

    try {
        // 1. 获取当前配置
        logger.info(`[${exampleActivityTag}] 获取活动配置`);
        const settingsResult = sendRequest({}, getSettingApi, exampleActivityTag, false, token);

        // 2. 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${exampleActivityTag}] 获取配置失败: 响应为空`);
            return {
                success: false,
                message: '获取配置失败: 响应为空'
            };
        }

        // 3. 解析配置（根据实际API响应格式调整）
        let settings;
        if (settingsResult.msgCode !== undefined) {
            // 标准响应格式：{ msgCode: 0, data: {...} }
            if (settingsResult.msgCode !== 0) {
                logger.error(`[${exampleActivityTag}] 获取配置失败: ${settingsResult.msg}`);
                return {
                    success: false,
                    message: `获取配置失败: ${settingsResult.msg || '未知错误'}`
                };
            }
            settings = settingsResult.data;
        } else {
            // 直接返回配置对象
            settings = settingsResult;
        }

        if (!settings) {
            logger.error(`[${exampleActivityTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        // 4. 定义配置规则
        const configRules = [
            // 开关类配置：会先关闭再开启（如果已开启），或等待1秒后开启（如果已关闭）
            { settingKey: 'IsOpenExampleActivity', configType: ConfigType.SWITCH },

            // 数字类配置：当前值 + 2
            { settingKey: 'ExampleCodingMultiple', configType: ConfigType.NUMBER },
            { settingKey: 'ExampleMaxAmount', configType: ConfigType.NUMBER },

            // 字符类配置：使用指定的值
            { settingKey: 'ExampleName', configType: ConfigType.STRING, targetValue: 'MyExample' },

            // 字符类配置：动态生成值（如添加时间戳）
            {
                settingKey: 'ExampleDescription',
                configType: ConfigType.STRING,
                targetValue: `Example_${Date.now()}`
            }
        ];

        // 5. 批量处理配置
        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: exampleActivityTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${exampleActivityTag}] 配置活动设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 示例2：使用单个配置处理（适用于特殊场景）
 */
function checkAndConfigureSingleSetting(data, settings) {
    const token = data.token;
    const updateSettingApi = '/api/ExampleActivity/UpdateConfig';

    try {
        // 处理单个开关配置
        const switchResult = handleConfigSetting({
            token,
            settingKey: 'IsOpenExampleActivity',
            currentSetting: settings.isOpenExampleActivity,
            configType: ConfigType.SWITCH,
            updateApi: updateSettingApi,
            tag: exampleActivityTag
        });

        if (!switchResult.success) {
            return switchResult;
        }

        // 处理单个数字配置
        const numberResult = handleConfigSetting({
            token,
            settingKey: 'ExampleCodingMultiple',
            currentSetting: settings.exampleCodingMultiple,
            configType: ConfigType.NUMBER,
            updateApi: updateSettingApi,
            tag: exampleActivityTag
        });

        if (!numberResult.success) {
            return numberResult;
        }

        // 处理单个字符配置
        const stringResult = handleConfigSetting({
            token,
            settingKey: 'ExampleName',
            currentSetting: settings.exampleName,
            configType: ConfigType.STRING,
            targetValue: 'CustomName',
            updateApi: updateSettingApi,
            tag: exampleActivityTag
        });

        return stringResult;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 示例3：处理带有 value2 字段的配置
 */
function checkAndConfigureWithValue2(data, settings) {
    const token = data.token;
    const updateSettingApi = '/api/ExampleActivity/UpdateConfig';

    const configRules = [
        {
            settingKey: 'ExampleSetting',
            configType: ConfigType.STRING,
            targetValue: 'value1_content',
            value2: 'value2_content'  // 如果API需要 value2 字段
        }
    ];

    const result = handleMultipleConfigs({
        token,
        settings,
        configRules,
        updateApi: updateSettingApi,
        tag: exampleActivityTag
    });

    return result;
}

/**
 * 示例4：处理不同响应格式的配置
 */
function handleDifferentResponseFormats(settingsResult) {
    let settings;

    // 格式1：标准响应 { msgCode: 0, data: {...} }
    if (settingsResult.msgCode !== undefined) {
        if (settingsResult.msgCode !== 0) {
            return { success: false, message: settingsResult.msg };
        }
        settings = settingsResult.data;
    }
    // 格式2：直接返回配置对象 { isOpenActivity: {...}, codingMultiple: {...} }
    else if (typeof settingsResult === 'object' && settingsResult !== null) {
        settings = settingsResult;
    }
    // 格式3：单个配置对象 { settingKey: "IsOpenActivity", value1: "1" }
    else if (settingsResult.settingKey) {
        // 需要包装成对象
        settings = {
            [settingsResult.settingKey.charAt(0).toLowerCase() + settingsResult.settingKey.slice(1)]: settingsResult
        };
    }
    else {
        return { success: false, message: '无法识别的响应格式' };
    }

    return { success: true, settings };
}

/**
 * 示例5：条件性配置处理
 */
function conditionalConfigProcessing(data, settings) {
    const token = data.token;
    const updateSettingApi = '/api/ExampleActivity/UpdateConfig';

    // 根据条件决定要处理哪些配置
    const configRules = [
        { settingKey: 'IsOpenExampleActivity', configType: ConfigType.SWITCH }
    ];

    // 只有在某个条件满足时才处理额外的配置
    if (settings.isOpenExampleActivity?.value1 === "1") {
        configRules.push(
            { settingKey: 'ExampleCodingMultiple', configType: ConfigType.NUMBER },
            { settingKey: 'ExampleMaxAmount', configType: ConfigType.NUMBER }
        );
    }

    const result = handleMultipleConfigs({
        token,
        settings,
        configRules,
        updateApi: updateSettingApi,
        tag: exampleActivityTag
    });

    return result;
}

/**
 * 示例6：处理配置失败的情况
 */
function handleConfigFailures(data) {
    const settingResult = checkAndConfigureExampleSettings(data);

    if (!settingResult.success) {
        // 检查是否有部分配置失败
        if (settingResult.failedConfigs && settingResult.failedConfigs.length > 0) {
            logger.warn(`[${exampleActivityTag}] 以下配置处理失败:`);
            settingResult.failedConfigs.forEach(failed => {
                logger.warn(`  - ${failed.settingKey}: ${failed.message}`);
            });

            // 可以选择继续或中断
            // return { success: false, message: '部分配置失败' };
        } else {
            // 完全失败
            return {
                success: false,
                message: `配置失败: ${settingResult.message}`
            };
        }
    }

    return { success: true };
}
