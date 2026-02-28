import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createWithdrawalTimeoutTag = 'createWithdrawalTimeout';

/**
 * 创建超时提现赔付活动（设置超时时间）
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createWithdrawalTimeout(data) {
    logger.info(`[${createWithdrawalTimeoutTag}] 开始创建超时提现赔付活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createWithdrawalTimeoutTag}] Token 不存在，无法创建超时提现赔付活动`);
            return {
                success: false,
                tag: createWithdrawalTimeoutTag,
                message: 'Token 不存在'
            };
        }

        // 第一步：设置超时时间
        logger.info(`[${createWithdrawalTimeoutTag}] ========== 第一步：设置超时时间 ==========`);
        const timeoutResult = updateWithdrawalTimeout(data);

        if (!timeoutResult.success) {
            logger.error(`[${createWithdrawalTimeoutTag}] 设置超时时间失败: ${timeoutResult.message}`);
            return timeoutResult;
        }

        // 第二步：查询默认配置
        logger.info(`[${createWithdrawalTimeoutTag}] ========== 第二步：查询默认配置 ==========`);
        const configResult = queryDefaultConfig(data);

        if (!configResult.success) {
            logger.error(`[${createWithdrawalTimeoutTag}] 查询默认配置失败，终止活动创建: ${configResult.message}`);
            return {
                success: false,
                tag: createWithdrawalTimeoutTag,
                message: `查询默认配置失败: ${configResult.message}`
            };
        }

        const defaultConfigId = configResult.id;

        // 第三步：新增活动
        logger.info(`[${createWithdrawalTimeoutTag}] ========== 第三步：新增活动 ==========`);
        const createResult = createCompensationConfig(data, defaultConfigId);

        if (createResult.success) {
            logger.info(`[${createWithdrawalTimeoutTag}] ✅ 超时提现赔付活动创建成功`);
        } else {
            logger.error(`[${createWithdrawalTimeoutTag}] ❌ 超时提现赔付活动创建失败: ${createResult.message}`);
        }

        return createResult;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createWithdrawalTimeoutTag}] 创建超时提现赔付活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createWithdrawalTimeoutTag,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 设置提现超时时间
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function updateWithdrawalTimeout(data) {
    const token = data.token;
    const api = '/api/ActivityCompensation/UpdateSettingConfig';
    const tag = 'updateWithdrawalTimeout';

    try {
        logger.info(`[${tag}] 设置提现超时时间为 1 小时`);

        const payload = {
            "value1": "1",
            "value2": "",
            "settingKey": "EstimatedWithdrawalArrivalTime"
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        // logger.info(`[${tag}] 设置响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 提现超时时间设置成功`);
            return {
                success: true,
                message: '提现超时时间设置成功'
            };
        } else {
            logger.error(`[${tag}] 提现超时时间设置失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `设置失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 设置提现超时时间时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `设置失败: ${errorMsg}`
        };
    }
}

/**
 * 查询默认配置
 * @param {*} data 
 * @returns {Object} { success, id, message }
 */
function queryDefaultConfig(data) {
    const token = data.token;
    const api = '/api/ActivityCompensation/GetCompensationConfigList';
    const tag = 'queryDefaultConfig';

    try {
        logger.info(`[${tag}] 查询默认配置`);

        const payload = {};

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询默认配置失败: 响应为空`);
            return {
                success: false,
                message: '查询默认配置失败: 响应为空'
            };
        }

        // logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应 - 响应可能是数组或包含 data 的对象
        let configList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询默认配置失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询默认配置失败: ${result.msg || '未知错误'}`
                };
            }
            configList = result.data?.list || result.list || [];
        } else if (Array.isArray(result)) {
            configList = result;
        } else {
            configList = result.data?.list || result.list || [];
        }

        // 检查是否有数据
        if (!configList || !Array.isArray(configList) || configList.length === 0) {
            logger.error(`[${tag}] 默认配置为空，无法继续操作`);
            return {
                success: false,
                message: '默认配置为空，系统未生成默认配置'
            };
        }

        logger.info(`[${tag}] 查询到 ${configList.length} 个配置`);

        // 获取第一项的ID
        const defaultConfigId = configList[0].id;
        logger.info(`[${tag}] 默认配置ID: ${defaultConfigId}`);

        return {
            success: true,
            id: defaultConfigId,
            message: '查询默认配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询默认配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 新增赔付活动配置
 * @param {*} data 
 * @param {number} defaultConfigId 默认配置ID
 * @returns {Object} { success, message }
 */
function createCompensationConfig(data, defaultConfigId) {
    const token = data.token;
    const api = '/api/ActivityCompensation/UpdateCompensationConfig';
    const tag = 'createCompensationConfig';

    try {
        logger.info(`[${tag}] 新增赔付活动配置 (默认配置ID: ${defaultConfigId})`);

        const payload = {
            "compensationConfigs": [
                {
                    "id": defaultConfigId,
                    "state": 1,  // 创建时直接开启
                    "receiveType": 1,
                    "expireDays": 0,
                    "codingMultiple": 2,
                    "withdrawAmount": 200,
                    "compensationRules": [
                        {
                            "timeoutDurationHours": 1,
                            "type": 1,
                            "compensationAmount": 10,
                            "compensationRate": 0
                        },
                        {
                            "timeoutDurationHours": 2,
                            "type": 1,
                            "compensationAmount": 20,
                            "compensationRate": 0
                        },
                        {
                            "timeoutDurationHours": 3,
                            "type": 1,
                            "compensationAmount": 30,
                            "compensationRate": 0
                        },
                        {
                            "timeoutDurationHours": 4,
                            "type": 1,
                            "compensationAmount": 40,
                            "compensationRate": 0
                        },
                        {
                            "timeoutDurationHours": 5,
                            "type": 1,
                            "compensationAmount": 50,
                            "compensationRate": 0
                        }
                    ]
                },
                {
                    "id": 0,
                    "state": 1,  // 创建时直接开启
                    "receiveType": 2,
                    "expireDays": 2,
                    "codingMultiple": 3,
                    "withdrawAmount": 1000,
                    "compensationRules": [
                        {
                            "timeoutDurationHours": 2,
                            "type": 1,
                            "compensationAmount": 10,
                            "compensationRate": 0
                        },
                        {
                            "timeoutDurationHours": 4,
                            "type": 2,
                            "compensationAmount": 0,
                            "compensationRate": 10
                        },
                        {
                            "timeoutDurationHours": 6,
                            "type": 2,
                            "compensationAmount": 0,
                            "compensationRate": 20
                        },
                        {
                            "timeoutDurationHours": 8,
                            "type": 2,
                            "compensationAmount": 0,
                            "compensationRate": 30
                        },
                        {
                            "timeoutDurationHours": 12,
                            "type": 2,
                            "compensationAmount": 0,
                            "compensationRate": 50
                        }
                    ]
                }
            ]
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        // logger.info(`[${tag}] 新增响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 赔付活动配置新增成功`);
            return {
                success: true,
                tag: createWithdrawalTimeoutTag,
                message: '超时提现赔付活动创建成功'
            };
        } else {
            logger.error(`[${tag}] 赔付活动配置新增失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                tag: createWithdrawalTimeoutTag,
                message: `新增失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 新增赔付活动配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createWithdrawalTimeoutTag,
            message: `新增失败: ${errorMsg}`
        };
    }
}


