import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { sleep } from 'k6';

export const createWeekCardTag = 'createWeekCard';

/**
 * 格式化日期为 "YYYY-MM-DD" 格式
 * @param {Date} date 
 * @returns {string}
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 计算明天的日期
 * @returns {string} YYYY-MM-DD 格式
 */
function getTomorrowDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
}

/**
 * 创建周卡月卡活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createWeekCard(data) {
    logger.info(`[${createWeekCardTag}] 开始创建周卡月卡活动`);

    const results = {
        weekCard: null,
        monthCard: null,
        success: false,
        tag: createWeekCardTag,
        message: ''
    };

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createWeekCardTag}] Token 不存在，无法创建周卡月卡活动`);
            return {
                success: false,
                tag: createWeekCardTag,
                message: 'Token 不存在'
            };
        }

        // 第一步：查询配置获取活动ID
        logger.info(`[${createWeekCardTag}] ========== 第一步：查询配置 ==========`);
        const configResult = queryCardConfigs(data);

        if (!configResult.success) {
            logger.error(`[${createWeekCardTag}] 查询配置失败，终止活动创建: ${configResult.message}`);
            return {
                success: false,
                tag: createWeekCardTag,
                message: `查询配置失败: ${configResult.message}`
            };
        }

        const { weekCardId, monthCardId, hasMonthCard } = configResult;

        // 第二步：创建周卡和月卡
        logger.info(`[${createWeekCardTag}] ========== 第二步：创建周卡和月卡 ==========`);

        // 创建周卡
        logger.info(`[${createWeekCardTag}] 创建周卡 (ID: ${weekCardId})`);
        results.weekCard = createCard(data, weekCardId, 0, 'weekCard');

        // 检查周卡创建结果
        const weekCardSuccess = results.weekCard.success;

        if (!weekCardSuccess) {
            logger.error(`[${createWeekCardTag}] 周卡创建失败，终止流程`);
            return {
                success: false,
                tag: createWeekCardTag,
                message: '周卡创建失败',
                weekCard: results.weekCard,
                monthCard: results.monthCard
            };
        }

        // 创建月卡（仅当第一步返回了月卡ID时）
        let monthCardSuccess = false;
        if (hasMonthCard && monthCardId) {
            logger.info(`[${createWeekCardTag}] 创建月卡 (ID: ${monthCardId})`);
            results.monthCard = createCard(data, monthCardId, 1, 'monthCard');
            monthCardSuccess = results.monthCard.success;
        } else {
            logger.warn(`[${createWeekCardTag}] ⚠️ 系统没有生成月卡配置，跳过月卡创建和启用`);
            results.monthCard = {
                success: false,
                message: '系统没有生成月卡配置'
            };
        }

        // 第三步：启用周卡和月卡（先关闭再开启）
        logger.info(`[${createWeekCardTag}] ========== 第三步：启用周卡和月卡 ==========`);

        // 启用周卡
        logger.info(`[${createWeekCardTag}] 启用周卡 (ID: ${weekCardId})`);
        const weekCardEnableResult = enableCard(data, weekCardId, 0);
        results.weekCard.enabled = weekCardEnableResult.success;
        results.weekCard.enableMessage = weekCardEnableResult.message;

        // 启用月卡（仅当第一步返回了月卡ID且创建成功时）
        if (hasMonthCard && monthCardId && monthCardSuccess) {
            logger.info(`[${createWeekCardTag}] 启用月卡 (ID: ${monthCardId})`);
            const monthCardEnableResult = enableCard(data, monthCardId, 1);
            results.monthCard.enabled = monthCardEnableResult.success;
            results.monthCard.enableMessage = monthCardEnableResult.message;
        }

        // 汇总最终结果
        const weekCardEnabled = results.weekCard.enabled || false;
        const monthCardEnabled = results.monthCard?.enabled || false;

        if (weekCardSuccess && weekCardEnabled && monthCardSuccess && monthCardEnabled) {
            results.success = true;
            results.message = '周卡和月卡都创建并启用成功';
            logger.info(`[${createWeekCardTag}] ✅ ${results.message}`);
        } else if (weekCardSuccess && weekCardEnabled) {
            results.success = true;
            results.message = hasMonthCard
                ? '周卡创建并启用成功，月卡部分失败'
                : '周卡创建并启用成功（系统未生成月卡配置）';
            logger.warn(`[${createWeekCardTag}] ⚠️ ${results.message}`);
        } else {
            results.success = false;
            results.message = '周卡创建成功但启用失败';
            logger.error(`[${createWeekCardTag}] ❌ ${results.message}`);
        }

        return results;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createWeekCardTag}] 创建周卡月卡活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createWeekCardTag,
            message: `创建失败: ${errorMsg}`,
            weekCard: results.weekCard,
            monthCard: results.monthCard
        };
    }
}

/**
 * 查询周卡月卡配置
 * @param {*} data 
 * @returns {Object} { success, weekCardId, monthCardId, hasMonthCard, message }
 */
function queryCardConfigs(data) {
    const token = data.token;
    const api = '/api/CardPlan/GetConfigs';
    const tag = 'queryCardConfigs';

    try {
        logger.info(`[${tag}] 查询周卡月卡配置`);

        const payload = {};

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询配置失败: 响应为空`);
            return {
                success: false,
                message: '查询配置失败: 响应为空'
            };
        }

        //logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应 - 响应本身就是数组或者在 result.data 中
        let configData;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询配置失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询配置失败: ${result.msg || '未知错误'}`
                };
            }
            configData = result.data || [];
        } else if (Array.isArray(result)) {
            // 响应本身就是数组
            configData = result;
        } else {
            configData = result.data || [];
        }

        // 检查是否有数据
        if (!configData || !Array.isArray(configData) || configData.length === 0) {
            logger.error(`[${tag}] 配置数据为空，无法继续操作`);
            return {
                success: false,
                message: '配置数据为空，系统未生成周卡月卡配置'
            };
        }

        logger.info(`[${tag}] 查询到 ${configData.length} 个配置`);

        // 获取周卡ID（第一个）
        const weekCardId = configData[0].id;
        logger.info(`[${tag}] 周卡ID: ${weekCardId}`);

        // 检查是否有月卡
        let monthCardId = null;
        let hasMonthCard = false;

        if (configData.length > 1) {
            monthCardId = configData[1].id;
            hasMonthCard = true;
            logger.info(`[${tag}] 月卡ID: ${monthCardId}`);
        } else {
            logger.warn(`[${tag}] ⚠️ 系统只生成了周卡配置，未生成月卡配置`);
        }

        return {
            success: true,
            weekCardId: weekCardId,
            monthCardId: monthCardId,
            hasMonthCard: hasMonthCard,
            message: '查询配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 创建周卡或月卡
 * @param {*} data 
 * @param {number} cardId 卡ID
 * @param {number} cardType 卡类型 (0: 周卡, 1: 月卡)
 * @param {string} cardName 卡名称（用于日志）
 * @returns {Object} { success, message }
 */
function createCard(data, cardId, cardType, cardName) {
    const token = data.token;
    const api = '/api/CardPlan/Update';
    const tag = `create${cardName}`;

    try {
        logger.info(`[${tag}] 创建${cardName === 'weekCard' ? '周卡' : '月卡'} (ID: ${cardId})`);

        // 计算明天的日期
        const tomorrowDate = getTomorrowDate();

        // 根据卡类型设置不同的参数
        const isWeekCard = cardType === 0;
        const payload = {
            "id": cardId,
            "cardType": cardType,
            "price": isWeekCard ? 500 : 1000,
            "dailyRewardAmount": isWeekCard ? 5 : 10,
            "rewardDays": isWeekCard ? 7 : 30,
            "effectMode": cardType,
            "limitCount": isWeekCard ? 1 : 3,
            "countStartTime": tomorrowDate,
            "state": 1,
            "codingMultiple": isWeekCard ? 5 : 10
        };

        //logger.info(`[${tag}] 请求参数: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, tag, false, token);

        //logger.info(`[${tag}] 创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] ${cardName === 'weekCard' ? '周卡' : '月卡'}创建成功`);
            return {
                success: true,
                message: `${cardName === 'weekCard' ? '周卡' : '月卡'}创建成功`
            };
        } else {
            logger.error(`[${tag}] ${cardName === 'weekCard' ? '周卡' : '月卡'}创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `${cardName === 'weekCard' ? '周卡' : '月卡'}创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 创建${cardName === 'weekCard' ? '周卡' : '月卡'}时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建失败: ${errorMsg}`
        };
    }
}

/**
 * 启用周卡或月卡（先关闭再开启）
 * @param {*} data 
 * @param {number} cardId 卡ID
 * @param {number} cardType 卡类型 (0: 周卡, 1: 月卡)
 * @returns {Object} { success, message }
 */
function enableCard(data, cardId, cardType) {
    const token = data.token;
    const api = '/api/CardPlan/UpdateState';
    const tag = 'enableCard';
    const cardName = cardType === 0 ? '周卡' : '月卡';

    try {
        // 步骤1：关闭卡
        logger.info(`[${tag}] 关闭${cardName} (ID: ${cardId})`);

        const closePayload = {
            "id": cardId,
            "state": 0,
            "cardType": cardType
        };

        const closeResult = sendRequest(closePayload, api, tag, false, token);

        logger.info(`[${tag}] 关闭响应: ${JSON.stringify(closeResult)}`);

        const closeSuccess = closeResult === true || (closeResult && closeResult.msgCode === 0);

        if (!closeSuccess) {
            logger.error(`[${tag}] 关闭${cardName}失败: ${closeResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `关闭${cardName}失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${tag}] ${cardName}已关闭，等待1秒...`);
        sleep(1);

        // 步骤2：开启卡
        logger.info(`[${tag}] 开启${cardName} (ID: ${cardId})`);

        const openPayload = {
            "id": cardId,
            "state": 1,
            "cardType": cardType
        };

        const openResult = sendRequest(openPayload, api, tag, false, token);

        //logger.info(`[${tag}] 开启响应: ${JSON.stringify(openResult)}`);

        const openSuccess = openResult === true || (openResult && openResult.msgCode === 0);

        if (!openSuccess) {
            logger.error(`[${tag}] 开启${cardName}失败: ${openResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启${cardName}失败: ${openResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${tag}] ${cardName}已开启`);
        return {
            success: true,
            message: `${cardName}启用成功`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 启用${cardName}时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `启用失败: ${errorMsg}`
        };
    }
}

