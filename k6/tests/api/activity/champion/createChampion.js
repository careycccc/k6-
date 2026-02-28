import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, ConfigType } from '../common/activityConfigHandler.js';

export const createChampionTag = 'createChampion';

// vendorCode 列表，按顺序尝试
const VENDOR_CODES = ["TB_Chess", "INOUT", "EVO_Electronic", "JILI", "G9"];

// 在模块顶层创建图片上传器
const uploadChampionImage = createImageUploader('../../uploadFile/img/champion/1.png', createChampionTag);

/**
 * 创建锦标赛活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createChampion(data) {
    logger.info(`[${createChampionTag}] 开始创建锦标赛活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createChampionTag}] Token 不存在，无法创建锦标赛活动`);
            return {
                success: false,
                tag: createChampionTag,
                message: 'Token 不存在，跳过锦标赛活动创建'
            };
        }

        // 检查并配置锦标赛设置
        const settingResult = checkAndConfigureChampionSettings(data);
        if (!settingResult.success) {
            return {
                success: false,
                tag: createChampionTag,
                message: `配置锦标赛设置失败: ${settingResult.message}`
            };
        }

        // 处理图片上传
        const imageResult = handleImageUpload(data, 'championImagePath', uploadChampionImage, createChampionTag);

        if (!imageResult.success) {
            return {
                success: false,
                tag: createChampionTag,
                message: `图片上传失败: ${imageResult.error}，跳过锦标赛活动创建`
            };
        }

        const imagePath = imageResult.imagePath;

        // 尝试使用不同的 vendorCode 创建锦标赛活动
        let lastError = null;
        for (let i = 0; i < VENDOR_CODES.length; i++) {
            const vendorCode = VENDOR_CODES[i];
            logger.info(`[${createChampionTag}] 尝试使用 vendorCode: ${vendorCode} (${i + 1}/${VENDOR_CODES.length})`);

            const createResult = createChampionActivity(data, vendorCode, imagePath);

            if (createResult.success) {
                logger.info(`[${createChampionTag}] 锦标赛活动创建成功，使用 vendorCode: ${vendorCode}`);

                // 等待0.5秒
                sleep(0.5);

                return {
                    success: true,
                    tag: createChampionTag,
                    message: `锦标赛活动创建成功，使用 vendorCode: ${vendorCode}`,
                    vendorCode: vendorCode
                };
            } else if (createResult.errorCode === 6026) {
                // 如果是错误码 6026，记录并尝试下一个 vendorCode
                logger.info(`[${createChampionTag}] vendorCode ${vendorCode} 已有活动，尝试下一个...`);
                lastError = createResult.message;
                continue;
            } else {
                // 其他错误，直接返回失败
                logger.error(`[${createChampionTag}] 创建失败: ${createResult.message}`);
                return {
                    success: false,
                    tag: createChampionTag,
                    message: createResult.message
                };
            }
        }

        // 所有 vendorCode 都尝试过了，仍然失败
        logger.error(`[${createChampionTag}] 所有 vendorCode 都已尝试，创建失败`);
        return {
            success: false,
            tag: createChampionTag,
            message: `所有 vendorCode 都已尝试失败: ${lastError || '未知错误'}`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createChampionTag}] 创建锦标赛活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createChampionTag,
            message: `创建锦标赛活动失败: ${errorMsg}`
        };
    }
}

/**
 * 检查并配置锦标赛设置
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureChampionSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/Champion/GetChampionSetting';
    const updateSettingApi = '/api/Champion/UpdateChampionSetting';

    try {
        // 1. 获取当前配置
        logger.info(`[${createChampionTag}] 获取锦标赛配置`);
        const settingsResult = sendRequest({}, getSettingApi, createChampionTag, false, token);

        logger.info(`[${createChampionTag}] 配置响应: ${JSON.stringify(settingsResult)}`);

        // 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${createChampionTag}] 获取配置失败: 响应为空`);
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
                logger.error(`[${createChampionTag}] 获取配置失败: msgCode=${settingsResult.msgCode}, msg=${settingsResult.msg}`);
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
            logger.error(`[${createChampionTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        logger.info(`[${createChampionTag}] 配置数据: ${JSON.stringify(settings)}`);

        // 2. 使用统一配置处理器处理所有配置
        const configRules = [
            { settingKey: 'IsOpenChampion', configType: ConfigType.SWITCH },
            { settingKey: 'ChampionCodingMultiple', configType: ConfigType.NUMBER }
        ];

        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: createChampionTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createChampionTag}] 配置锦标赛设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 创建锦标赛活动
 * @param {*} data
 * @param {string} vendorCode 供应商代码
 * @param {string} imagePath 图片路径
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createChampionActivity(data, vendorCode, imagePath) {
    const token = data.token;
    const api = '/api/Champion/Add';

    // 获取当前时间和未来时间
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    // 格式化日期为 "YYYY-MM-DD HH:mm:ss"
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day} 00:00:00`;
    };

    // 构建锦标赛活动的payload
    const payload = {
        "image": imagePath,
        "id": 0,
        "gameCategory": 0,
        "vendorCode": vendorCode,
        "gameCode": null,
        "betAmount": 1000,
        "rechargeAmount": 100,
        "bindWallet": 1,
        "taskCycle": 1,
        "startDate": formatDate(tomorrow),
        "endDate": formatDate(dayAfterTomorrow),
        "championDetaileds": [
            { "id": 0, "minRanking": 1, "maxRanking": 1, "awardAmount": 801 },
            { "id": 0, "minRanking": 2, "maxRanking": 2, "awardAmount": 601 },
            { "id": 0, "minRanking": 3, "maxRanking": 3, "awardAmount": 450 },
            { "id": 0, "minRanking": 4, "maxRanking": 4, "awardAmount": 350 },
            { "id": 0, "minRanking": 5, "maxRanking": 5, "awardAmount": 280 },
            { "id": 0, "minRanking": 6, "maxRanking": 6, "awardAmount": 220 },
            { "id": 0, "minRanking": 7, "maxRanking": 7, "awardAmount": 180 },
            { "id": 0, "minRanking": 8, "maxRanking": 8, "awardAmount": 150 },
            { "id": 0, "minRanking": 9, "maxRanking": 9, "awardAmount": 130 },
            { "id": 0, "minRanking": 10, "maxRanking": 10, "awardAmount": 110 },
            { "id": 0, "minRanking": 11, "maxRanking": 20, "awardAmount": 70 },
            { "id": 0, "minRanking": 21, "maxRanking": 30, "awardAmount": 60 },
            { "id": 0, "minRanking": 31, "maxRanking": 50, "awardAmount": 100 },
            { "id": 0, "minRanking": 51, "maxRanking": 100, "awardAmount": 200 },
            { "id": 0, "minRanking": 101, "maxRanking": 300, "awardAmount": 600 },
            { "id": 0, "minRanking": 301, "maxRanking": 500, "awardAmount": 400 },
            { "id": 0, "minRanking": 501, "maxRanking": 1000, "awardAmount": 500 }
        ]
    };

    try {
        const result = sendRequest(payload, api, createChampionTag, false, token);

        // 检查返回结果 - sendRequest 返回的是完整响应体，使用 msgCode
        if (result && result.msgCode === 0) {
            return { success: true };
        } else if (result && result.msgCode === 6026) {
            // 错误码 6026：供应商已有活动
            return {
                success: false,
                errorCode: 6026,
                message: result.msg || 'Vendor already has activity'
            };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createChampionTag}] 创建锦标赛活动请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
