import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { getTomorrowDate, getTodayTimeRange } from '../common/dateTimeUtils.js';

export const createluckyDoubleBonusTag = 'createluckyDoubleBonus';

/**
 * 创建幸运加倍活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createluckyDoubleBonus(data) {
    logger.info(`[${createluckyDoubleBonusTag}] 开始创建幸运加倍活动`);

    const results = {
        registerActivity: null,
        autoActivity: null,
        manualActivity: null,
        success: false,
        tag: createluckyDoubleBonusTag,
        message: ''
    };

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createluckyDoubleBonusTag}] Token 不存在，无法创建幸运加倍活动`);
            return {
                success: false,
                tag: createluckyDoubleBonusTag,
                message: 'Token 不存在'
            };
        }

        // 创建注册优惠活动
        logger.info(`[${createluckyDoubleBonusTag}] ========== 创建注册优惠活动 ==========`);
        results.registerActivity = createRegisterActivity(data);

        // 创建自动优惠活动
        logger.info(`[${createluckyDoubleBonusTag}] ========== 创建自动优惠活动 ==========`);
        results.autoActivity = createAutoActivity(data);

        // 创建手动优惠活动
        logger.info(`[${createluckyDoubleBonusTag}] ========== 创建手动优惠活动 ==========`);
        results.manualActivity = createManualActivity(data);

        // 汇总结果
        const registerSuccess = results.registerActivity.success;
        const autoSuccess = results.autoActivity.success;
        const manualSuccess = results.manualActivity.success;

        const successCount = [registerSuccess, autoSuccess, manualSuccess].filter(Boolean).length;

        if (successCount === 3) {
            results.success = true;
            results.message = '注册优惠、自动优惠和手动优惠活动都创建成功';
            logger.info(`[${createluckyDoubleBonusTag}] ✅ ${results.message}`);
        } else if (successCount > 0) {
            results.success = true;
            results.message = `部分活动创建成功（注册优惠: ${registerSuccess ? '成功' : '失败'}, 自动优惠: ${autoSuccess ? '成功' : '失败'}, 手动优惠: ${manualSuccess ? '成功' : '失败'}）`;
            logger.warn(`[${createluckyDoubleBonusTag}] ⚠️ ${results.message}`);
        } else {
            results.success = false;
            results.message = '所有活动创建失败';
            logger.error(`[${createluckyDoubleBonusTag}] ❌ ${results.message}`);
        }

        return results;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createluckyDoubleBonusTag}] 创建幸运加倍活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createluckyDoubleBonusTag,
            message: `创建失败: ${errorMsg}`,
            registerActivity: results.registerActivity,
            autoActivity: results.autoActivity,
            manualActivity: results.manualActivity
        };
    }
}

/**
 * 创建注册优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function createRegisterActivity(data) {
    const token = data.token;
    const tag = 'createRegisterActivity';

    try {
        // 第一步：创建注册优惠活动
        logger.info(`[${tag}] ========== 第一步：创建注册优惠活动 ==========`);
        const createResult = addRegisterLuckyDouble(data);

        if (!createResult.success) {
            logger.error(`[${tag}] 创建注册优惠活动失败: ${createResult.message}`);
            return createResult;
        }

        // 第二步：查询活动列表获取ID
        logger.info(`[${tag}] ========== 第二步：查询活动列表 ==========`);
        const queryResult = queryRegisterActivity(data);

        if (!queryResult.success) {
            logger.error(`[${tag}] 查询活动列表失败: ${queryResult.message}`);
            return queryResult;
        }

        const activityId = queryResult.id;

        // 第三步：开启活动
        logger.info(`[${tag}] ========== 第三步：开启活动 ==========`);
        const openResult = openRegisterActivity(data, activityId);

        if (openResult.success) {
            logger.info(`[${tag}] 注册优惠活动创建并开启成功`);
            return {
                success: true,
                message: '注册优惠活动创建并开启成功'
            };
        } else {
            logger.error(`[${tag}] 开启活动失败: ${openResult.message}`);
            return openResult;
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 创建注册优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 添加注册优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function addRegisterLuckyDouble(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/AddRegisterLuckyDouble';
    const tag = 'addRegisterLuckyDouble';

    try {
        logger.info(`[${tag}] 添加注册优惠活动`);

        const payload = {
            "doubleActivityType": 0,
            "rewardMode": 1,
            "randomMin": "188",
            "randomMax": "588",
            "codingMultiple": "2",
            "displayText": "288",
            "sameIpLimit": false,
            "sameDeviceLimit": false,
            "isDouble": true,
            "taskExpireHours": 3,
            "isForceClaim": 0,
            "doubleMode": 2,
            "doubleCodingMultiple": "3",
            "doubleDetails": {
                "byRecharge": [],
                "byTasks": {
                    "firstRecharge": {
                        "enabled": true,
                        "bonusMultiplier": "2"
                    },
                    "firstWithdraw": {
                        "enabled": true,
                        "bonusMultiplier": "3"
                    },
                    "secondRecharge": {
                        "enabled": true,
                        "bonusMultiplier": "3"
                    },
                    "rechargeWheel": {
                        "enabled": true,
                        "bonusMultiplier": "2",
                        "getRewardCount": "1"
                    },
                    "joinTelegramGroup": {
                        "enabled": true,
                        "bonusMultiplier": "3"
                    },
                    "invitedWheel": {
                        "enabled": true,
                        "bonusMultiplier": "3",
                        "getRewardCount": "1"
                    },
                    "validBet": {
                        "enabled": true,
                        "bonusMultiplier": "2",
                        "validBetAmount": "1000"
                    },
                    "vipUpReward": {
                        "enabled": true,
                        "bonusMultiplier": "3",
                        "getRewardCount": "2"
                    }
                }
            }
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 注册优惠活动添加成功`);
            return {
                success: true,
                message: '注册优惠活动添加成功'
            };
        } else {
            logger.error(`[${tag}] 注册优惠活动添加失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `添加失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 添加注册优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `添加失败: ${errorMsg}`
        };
    }
}

/**
 * 查询注册优惠活动列表
 * @param {*} data 
 * @returns {Object} { success, id, message }
 */
function queryRegisterActivity(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/GetRegisterLuckyDoubleConfigPageList';
    const tag = 'queryRegisterActivity';

    try {
        logger.info(`[${tag}] 查询注册优惠活动列表`);

        const payload = {};

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询活动列表失败: 响应为空`);
            return {
                success: false,
                message: '查询活动列表失败: 响应为空'
            };
        }

        //logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let activityList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询活动列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询活动列表失败: ${result.msg || '未知错误'}`
                };
            }
            activityList = result.data?.list || result.list || [];
        } else if (Array.isArray(result)) {
            activityList = result;
        } else {
            activityList = result.data?.list || result.list || [];
        }

        if (!activityList || !Array.isArray(activityList) || activityList.length === 0) {
            logger.error(`[${tag}] 活动列表为空`);
            return {
                success: false,
                message: '活动列表为空'
            };
        }

        logger.info(`[${tag}] 查询到 ${activityList.length} 个活动`);

        // 获取第一项的ID
        const activityId = activityList[0].id;
        logger.info(`[${tag}] 活动ID: ${activityId}`);

        return {
            success: true,
            id: activityId,
            message: '查询活动列表成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询活动列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 开启注册优惠活动
 * @param {*} data 
 * @param {number} activityId 活动ID
 * @returns {Object} { success, message }
 */
function openRegisterActivity(data, activityId) {
    const token = data.token;
    const api = '/api/LuckyDouble/OpenOrCloseRegisterActivity';
    const tag = 'openRegisterActivity';

    try {
        logger.info(`[${tag}] 开启注册优惠活动 (ID: ${activityId})`);

        const payload = {
            "id": activityId,
            "status": 1
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 开启响应: ${JSON.stringify(result)}`);

        // 特殊处理：msgCode 6063 表示同类型活动已开启，视为成功（警告）
        if (result && result.msgCode === 6063) {
            logger.warn(`[${tag}] ⚠️ 同类型活动已开启，禁止重复开启: ${result.msg}`);
            return {
                success: true,
                message: `活动已存在并开启（跳过重复开启）: ${result.msg}`,
                isDuplicate: true
            };
        }

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 注册优惠活动开启成功`);
            return {
                success: true,
                message: '注册优惠活动开启成功'
            };
        } else {
            logger.error(`[${tag}] 注册优惠活动开启失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 开启注册优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `开启失败: ${errorMsg}`
        };
    }
}



/**
 * 创建自动优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function createAutoActivity(data) {
    const token = data.token;
    const tag = 'createAutoActivity';

    try {
        // 第一步：创建自动优惠活动
        logger.info(`[${tag}] ========== 第一步：创建自动优惠活动 ==========`);
        const createResult = addAutoLuckyDouble(data);

        if (!createResult.success) {
            logger.error(`[${tag}] 创建自动优惠活动失败: ${createResult.message}`);
            return createResult;
        }

        // 第二步：查询活动列表获取ID
        logger.info(`[${tag}] ========== 第二步：查询活动列表 ==========`);
        const queryResult = queryAutoActivity(data);

        if (!queryResult.success) {
            logger.error(`[${tag}] 查询活动列表失败: ${queryResult.message}`);
            return queryResult;
        }

        const activityId = queryResult.id;

        // 第三步：开启活动
        logger.info(`[${tag}] ========== 第三步：开启活动 ==========`);
        const openResult = openAutoActivity(data, activityId);

        if (openResult.success) {
            logger.info(`[${tag}] 自动优惠活动创建并开启成功`);
            return {
                success: true,
                message: '自动优惠活动创建并开启成功'
            };
        } else {
            logger.error(`[${tag}] 开启活动失败: ${openResult.message}`);
            return openResult;
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 创建自动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 添加自动优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function addAutoLuckyDouble(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/AddAutoLuckyDouble';
    const tag = 'addAutoLuckyDouble';

    try {
        logger.info(`[${tag}] 添加自动优惠活动`);

        const payload = {
            "targetGroupType": 1,
            "rewardMode": 0,
            "fixedAmount": "126",
            "codingMultiple": "2",
            "isDouble": true,
            "isForceClaim": 0,
            "doubleMode": 1,
            "doubleCodingMultiple": "3",
            "targetParams": {
                "minutes": "30"
            },
            "doubleDetails": {
                "byRecharge": [
                    {
                        "rechargeAmount": "100",
                        "bonusMultiplier": "2"
                    },
                    {
                        "rechargeAmount": "500",
                        "bonusMultiplier": "4"
                    },
                    {
                        "rechargeAmount": "1000",
                        "bonusMultiplier": "8"
                    },
                    {
                        "rechargeAmount": "5000",
                        "bonusMultiplier": "15"
                    }
                ]
            },
            "gameStatisticCondition": {
                "platformType": 0
            },
            "rewardCondition": {
                "statisticDay": 1,
                "statisticType": 0
            }
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 自动优惠活动添加成功`);
            return {
                success: true,
                message: '自动优惠活动添加成功'
            };
        } else {
            logger.error(`[${tag}] 自动优惠活动添加失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `添加失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 添加自动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `添加失败: ${errorMsg}`
        };
    }
}

/**
 * 查询自动优惠活动列表
 * @param {*} data 
 * @returns {Object} { success, id, message }
 */
function queryAutoActivity(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/GetAutoLuckyDoubleConfigPageList';
    const tag = 'queryAutoActivity';

    try {
        logger.info(`[${tag}] 查询自动优惠活动列表`);

        const payload = {};

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询活动列表失败: 响应为空`);
            return {
                success: false,
                message: '查询活动列表失败: 响应为空'
            };
        }

        //logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let activityList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询活动列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询活动列表失败: ${result.msg || '未知错误'}`
                };
            }
            activityList = result.data?.list || result.list || [];
        } else if (Array.isArray(result)) {
            activityList = result;
        } else {
            activityList = result.data?.list || result.list || [];
        }

        if (!activityList || !Array.isArray(activityList) || activityList.length === 0) {
            logger.error(`[${tag}] 活动列表为空`);
            return {
                success: false,
                message: '活动列表为空'
            };
        }

        logger.info(`[${tag}] 查询到 ${activityList.length} 个活动`);

        // 获取第一项的ID
        const activityId = activityList[0].id;
        logger.info(`[${tag}] 活动ID: ${activityId}`);

        return {
            success: true,
            id: activityId,
            message: '查询活动列表成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询活动列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 开启自动优惠活动
 * @param {*} data 
 * @param {number} activityId 活动ID
 * @returns {Object} { success, message }
 */
function openAutoActivity(data, activityId) {
    const token = data.token;
    const api = '/api/LuckyDouble/OpenOrCloseAutoActivity';
    const tag = 'openAutoActivity';

    try {
        logger.info(`[${tag}] 开启自动优惠活动 (ID: ${activityId})`);

        const payload = {
            "id": activityId,
            "status": 1
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 开启响应: ${JSON.stringify(result)}`);

        // 特殊处理：msgCode 6063 表示同类型活动已开启，视为成功（警告）
        if (result && result.msgCode === 6063) {
            logger.warn(`[${tag}] ⚠️ 同类型活动已开启，禁止重复开启: ${result.msg}`);
            return {
                success: true,
                message: `活动已存在并开启（跳过重复开启）: ${result.msg}`,
                isDuplicate: true
            };
        }

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 自动优惠活动开启成功`);
            return {
                success: true,
                message: '自动优惠活动开启成功'
            };
        } else {
            logger.error(`[${tag}] 自动优惠活动开启失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 开启自动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `开启失败: ${errorMsg}`
        };
    }
}


/**
 * 创建手动优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function createManualActivity(data) {
    const token = data.token;
    const tag = 'createManualActivity';

    try {
        // 第一步：创建手动优惠活动
        logger.info(`[${tag}] ========== 第一步：创建手动优惠活动 ==========`);
        const createResult = addManualLuckyDouble(data);

        if (!createResult.success) {
            logger.error(`[${tag}] 创建手动优惠活动失败: ${createResult.message}`);
            return createResult;
        }

        // 第二步：查询活动列表获取ID
        logger.info(`[${tag}] ========== 第二步：查询活动列表 ==========`);
        const queryResult = queryManualActivity(data);

        if (!queryResult.success) {
            logger.error(`[${tag}] 查询活动列表失败: ${queryResult.message}`);
            return queryResult;
        }

        const activityId = queryResult.id;

        // 第三步：开启活动
        logger.info(`[${tag}] ========== 第三步：开启活动 ==========`);
        const openResult = openManualActivity(data, activityId);

        if (openResult.success) {
            logger.info(`[${tag}] 手动优惠活动创建并开启成功`);
            return {
                success: true,
                message: '手动优惠活动创建并开启成功'
            };
        } else {
            logger.error(`[${tag}] 开启活动失败: ${openResult.message}`);
            return openResult;
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 创建手动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 添加手动优惠活动
 * @param {*} data 
 * @returns {Object} { success, message }
 */
function addManualLuckyDouble(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/AddManualLuckyDouble';
    const tag = 'addManualLuckyDouble';

    try {
        logger.info(`[${tag}] 添加手动优惠活动`);

        // 计算明天的日期
        const tomorrowDate = getTomorrowDate();

        const payload = {
            "targetGroupType": 4,
            "codingMultiple": "2",
            "claimMethod": 1,
            "rewardExpireDays": "2",
            "isDouble": true,
            "isForceClaim": 0,
            "doubleMode": 0,
            "doubleCodingMultiple": "2",
            "targetParams": {
                "firstRechargeDate": tomorrowDate
            },
            "conditionalRules": {
                "isContainReward": 0,
                "giftRules": [
                    {
                        "conditionAmount": "1000",
                        "mode": "0",
                        "value": "20"
                    },
                    {
                        "conditionAmount": "2000",
                        "mode": "1",
                        "value": "5"
                    }
                ]
            },
            "doubleDetails": {
                "fixed": {
                    "bonusMultiplier": "3"
                },
                "byRecharge": []
            }
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);
        logger.info(`[${tag}] 首充日期设置为: ${tomorrowDate}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 手动优惠活动添加成功`);
            return {
                success: true,
                message: '手动优惠活动添加成功'
            };
        } else {
            logger.error(`[${tag}] 手动优惠活动添加失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `添加失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 添加手动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `添加失败: ${errorMsg}`
        };
    }
}

/**
 * 查询手动优惠活动列表
 * @param {*} data 
 * @returns {Object} { success, id, message }
 */
function queryManualActivity(data) {
    const token = data.token;
    const api = '/api/LuckyDouble/GetManualLuckyDoubleConfigPageList';
    const tag = 'queryManualActivity';

    try {
        logger.info(`[${tag}] 查询手动优惠活动列表`);

        // 获取今天的时间范围
        const { beginTime, endTime } = getTodayTimeRange();

        const payload = {
            "pageNo": 1,
            "pageSize": 20,
            "beginTime": beginTime,
            "endTime": endTime
        };

        logger.info(`[${tag}] 查询时间范围: ${beginTime} - ${endTime}`);

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询活动列表失败: 响应为空`);
            return {
                success: false,
                message: '查询活动列表失败: 响应为空'
            };
        }

        //logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let activityList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询活动列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询活动列表失败: ${result.msg || '未知错误'}`
                };
            }
            activityList = result.data?.list || result.list || [];
        } else if (Array.isArray(result)) {
            activityList = result;
        } else {
            activityList = result.data?.list || result.list || [];
        }

        if (!activityList || !Array.isArray(activityList) || activityList.length === 0) {
            logger.error(`[${tag}] 活动列表为空`);
            return {
                success: false,
                message: '活动列表为空'
            };
        }

        logger.info(`[${tag}] 查询到 ${activityList.length} 个活动`);

        // 获取第一项的ID
        const activityId = activityList[0].id;
        logger.info(`[${tag}] 活动ID: ${activityId}`);

        return {
            success: true,
            id: activityId,
            message: '查询活动列表成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询活动列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 开启手动优惠活动
 * @param {*} data 
 * @param {number} activityId 活动ID
 * @returns {Object} { success, message }
 */
function openManualActivity(data, activityId) {
    const token = data.token;
    const api = '/api/LuckyDouble/OpenOrCloseManualActivity';
    const tag = 'openManualActivity';

    try {
        logger.info(`[${tag}] 开启手动优惠活动 (ID: ${activityId})`);

        const payload = {
            "id": activityId,
            "status": 1
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        logger.info(`[${tag}] 开启响应: ${JSON.stringify(result)}`);

        // 特殊处理：msgCode 6063 表示同类型活动已开启，视为成功（警告）
        if (result && result.msgCode === 6063) {
            logger.warn(`[${tag}] ⚠️ 同类型活动已开启，禁止重复开启: ${result.msg}`);
            return {
                success: true,
                message: `活动已存在并开启（跳过重复开启）: ${result.msg}`,
                isDuplicate: true
            };
        }

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 手动优惠活动开启成功`);
            return {
                success: true,
                message: '手动优惠活动开启成功'
            };
        } else {
            logger.error(`[${tag}] 手动优惠活动开启失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 开启手动优惠活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `开启失败: ${errorMsg}`
        };
    }
}
