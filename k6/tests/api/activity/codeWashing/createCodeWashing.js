import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, ConfigType } from '../common/activityConfigHandler.js';

export const createCodeWashingTag = 'createCodeWashing';

/**
 * 创建洗码活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createCodeWashing(data) {
    logger.info(`[${createCodeWashingTag}] 开始创建洗码活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createCodeWashingTag}] Token 不存在，无法创建洗码活动`);
            return {
                success: false,
                tag: createCodeWashingTag,
                message: 'Token 不存在，跳过洗码活动创建'
            };
        }

        // 检查并配置洗码设置
        const settingResult = checkAndConfigureCodeWashingSettings(data);
        if (!settingResult.success) {
            return {
                success: false,
                tag: createCodeWashingTag,
                message: `配置洗码设置失败: ${settingResult.message}`
            };
        }

        // TODO: 在这里添加具体的创建活动逻辑

        return {
            success: true,
            tag: createCodeWashingTag,
            message: '洗码活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createCodeWashingTag}] 创建洗码活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createCodeWashingTag,
            message: `创建洗码活动失败: ${errorMsg}`
        };
    }
}

/**
 * 检查并配置洗码设置
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureCodeWashingSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/CodeWashing/GetCodeWashingSetting';
    const updateSettingApi = '/api/CodeWashing/UpdateCodeWashingSetting';

    try {
        // 1. 获取当前配置
        logger.info(`[${createCodeWashingTag}] 获取洗码配置`);
        const settingsResult = sendRequest({}, getSettingApi, createCodeWashingTag, false, token);

        logger.info(`[${createCodeWashingTag}] 配置响应: ${JSON.stringify(settingsResult)}`);

        // 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${createCodeWashingTag}] 获取配置失败: 响应为空`);
            return {
                success: false,
                message: '获取配置失败: 响应为空'
            };
        }

        // 判断响应格式：如果有 msgCode 字段，说明是标准响应格式
        let settings;
        if (settingsResult.msgCode !== undefined) {
            // 标准响应格式
            if (settingsResult.msgCode !== 0) {
                logger.error(`[${createCodeWashingTag}] 获取配置失败: msgCode=${settingsResult.msgCode}, msg=${settingsResult.msg}`);
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
            logger.error(`[${createCodeWashingTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        // 2. 使用统一配置处理器处理所有配置
        const configRules = [
            { settingKey: 'IsOpenCodeWashing', configType: ConfigType.SWITCH },
            { settingKey: 'IsSettleTheWashingAmount', configType: ConfigType.SWITCH },
            { settingKey: 'IsFrontManualCodeWashing', configType: ConfigType.SWITCH },
            { settingKey: 'CodeWashingMultiple', configType: ConfigType.NUMBER }
        ];

        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: createCodeWashingTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createCodeWashingTag}] 配置洗码设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

