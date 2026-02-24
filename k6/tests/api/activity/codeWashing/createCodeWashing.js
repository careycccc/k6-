import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

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

        // 2. 检查并启用洗码功能
        const isOpenCodeWashing = settings.isOpenCodeWashing;
        if (isOpenCodeWashing && isOpenCodeWashing.value1 !== "1") {
            logger.info(`[${createCodeWashingTag}] 洗码功能未启用，正在启用...`);
            const enablePayload = {
                "settingKey": "IsOpenCodeWashing",
                "value1": "1",
                "value2": ""
            };
            const enableResult = sendRequest(enablePayload, updateSettingApi, createCodeWashingTag, false, token);

            if (!enableResult || (enableResult.msgCode !== undefined && enableResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `启用洗码功能失败: ${enableResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createCodeWashingTag}] 洗码功能已启用`);
            sleep(0.3);
        } else {
            logger.info(`[${createCodeWashingTag}] 洗码功能已启用，跳过`);
        }

        // 3. 检查并启用自动结算剩余洗码量
        const isSettleTheWashingAmount = settings.isSettleTheWashingAmount;
        if (isSettleTheWashingAmount && isSettleTheWashingAmount.value1 !== "1") {
            logger.info(`[${createCodeWashingTag}] 自动结算剩余洗码量未启用，正在启用...`);
            const settlePayload = {
                "settingKey": "IsSettleTheWashingAmount",
                "value1": "1",
                "value2": ""
            };
            const settleResult = sendRequest(settlePayload, updateSettingApi, createCodeWashingTag, false, token);

            if (!settleResult || (settleResult.msgCode !== undefined && settleResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `启用自动结算剩余洗码量失败: ${settleResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createCodeWashingTag}] 自动结算剩余洗码量已启用`);
            sleep(0.3);
        } else {
            logger.info(`[${createCodeWashingTag}] 自动结算剩余洗码量已启用，跳过`);
        }

        // 4. 检查并启用前端显示手动洗码
        const isFrontManualCodeWashing = settings.isFrontManualCodeWashing;
        if (isFrontManualCodeWashing && isFrontManualCodeWashing.value1 !== "1") {
            logger.info(`[${createCodeWashingTag}] 前端显示手动洗码未启用，正在启用...`);
            const frontPayload = {
                "settingKey": "IsFrontManualCodeWashing",
                "value1": "1",
                "value2": ""
            };
            const frontResult = sendRequest(frontPayload, updateSettingApi, createCodeWashingTag, false, token);

            if (!frontResult || (frontResult.msgCode !== undefined && frontResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `启用前端显示手动洗码失败: ${frontResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createCodeWashingTag}] 前端显示手动洗码已启用`);
            sleep(0.3);
        } else {
            logger.info(`[${createCodeWashingTag}] 前端显示手动洗码已启用，跳过`);
        }

        // 5. 检查并设置洗码量返水打码量倍数
        const codeWashingMultiple = settings.codeWashingMultiple;
        if (codeWashingMultiple && codeWashingMultiple.value1 === "0") {
            logger.info(`[${createCodeWashingTag}] 洗码量返水打码量倍数未设置，正在设置为3...`);
            const multiplePayload = {
                "settingKey": "CodeWashingMultiple",
                "value1": "3",
                "value2": ""
            };
            const multipleResult = sendRequest(multiplePayload, updateSettingApi, createCodeWashingTag, false, token);

            if (!multipleResult || (multipleResult.msgCode !== undefined && multipleResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `设置洗码量返水打码量倍数失败: ${multipleResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createCodeWashingTag}] 洗码量返水打码量倍数已设置为3`);
            sleep(0.3);
        } else {
            logger.info(`[${createCodeWashingTag}] 洗码量返水打码量倍数已设置(${codeWashingMultiple?.value1 || '未知'})，跳过`);
        }

        return { success: true };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createCodeWashingTag}] 配置洗码设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

