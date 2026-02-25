import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createRankingTag = 'createRanking';

// 公共奖金配置数组（bonusConfig格式）
// 总计: 100% 奖金池分配
// 设计原则: 前10名占60%，11-100名占30%，101-500名占10%
const bonusConfigArray = [
    { "start": 1, "end": 1, "rewardRatio": 20 },      // 第1名: 20%
    { "start": 2, "end": 2, "rewardRatio": 12 },      // 第2名: 12%
    { "start": 3, "end": 3, "rewardRatio": 8 },       // 第3名: 8%
    { "start": 4, "end": 4, "rewardRatio": 5 },       // 第4名: 5%
    { "start": 5, "end": 5, "rewardRatio": 4 },       // 第5名: 4%
    { "start": 6, "end": 6, "rewardRatio": 3 },       // 第6名: 3%
    { "start": 7, "end": 7, "rewardRatio": 2.5 },     // 第7名: 2.5%
    { "start": 8, "end": 8, "rewardRatio": 2 },       // 第8名: 2%
    { "start": 9, "end": 9, "rewardRatio": 1.75 },    // 第9名: 1.75%
    { "start": 10, "end": 10, "rewardRatio": 1.75 },  // 第10名: 1.75%
    // 前10名小计: 60%

    { "start": 11, "end": 20, "rewardRatio": 15 },    // 第11-20名: 15% (每人1.5%)
    { "start": 21, "end": 50, "rewardRatio": 12 },    // 第21-50名: 12% (每人0.4%)
    { "start": 51, "end": 100, "rewardRatio": 3 },    // 第51-100名: 3% (每人0.06%)
    // 11-100名小计: 30%

    { "start": 101, "end": 200, "rewardRatio": 4 },   // 第101-200名: 4% (每人0.04%)
    { "start": 201, "end": 300, "rewardRatio": 3 },   // 第201-300名: 3% (每人0.03%)
    { "start": 301, "end": 400, "rewardRatio": 2 },   // 第301-400名: 2% (每人0.02%)
    { "start": 401, "end": 500, "rewardRatio": 1 }    // 第401-500名: 1% (每人0.01%)
    // 101-500名小计: 10%

    // 总计: 60% + 30% + 10% = 100%
];

/**
 * 将 bonusConfig 格式转换为 bonusDistributionRatio 格式
 */
function convertToBonusDistributionRatio(bonusConfig) {
    return bonusConfig.map(item => ({
        Start: item.start,
        End: item.end,
        RewardRatio: item.rewardRatio
    }));
}

/**
 * 获取明天的日期字符串（格式：YYYY-MM-DD 00:00:00）
 */
function getTomorrowDate() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');

    return `${year}-${month}-${day} 00:00:00`;
}

// 日榜配置模板
const dailyRankConfigTemplate = {
    rankType: 1,
    rankCategory: 0,
    get effectiveDate() {
        return getTomorrowDate();
    },
    prizePoolRatio: 0.068,
    prizePoolRatioShow: 1.4,
    minValidBetAmount: 100,
    codingMultiple: 10,
    initialGoldPool: 80000,
    maxRank: 500,
    get bonusDistributionRatio() {
        return JSON.stringify(convertToBonusDistributionRatio(bonusConfigArray));
    },
    state: 1
};

// 周榜配置模板
const weeklyRankConfigTemplate = {
    rankType: 2,
    rankCategory: 0,
    get effectiveDate() {
        return getTomorrowDate();
    },
    prizePoolRatio: 0.0059,
    prizePoolRatioShow: 0.6,
    minValidBetAmount: 200,
    codingMultiple: 10,
    initialGoldPool: 130000,
    maxRank: 500,
    get bonusDistributionRatio() {
        return JSON.stringify(convertToBonusDistributionRatio(bonusConfigArray));
    },
    state: 1
};

// 月榜配置模板
const monthlyRankConfigTemplate = {
    rankType: 3,
    rankCategory: 0,
    get effectiveDate() {
        return getTomorrowDate();
    },
    prizePoolRatio: 0.0062,
    prizePoolRatioShow: 0.1,
    minValidBetAmount: 300,
    codingMultiple: 10,
    initialGoldPool: 150000,
    maxRank: 500,
    get bonusDistributionRatio() {
        return JSON.stringify(convertToBonusDistributionRatio(bonusConfigArray));
    },
    state: 1
};

/**
 * 创建会员排行榜活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createRanking(data) {
    logger.info(`[${createRankingTag}] 开始创建会员排行榜活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createRankingTag}] Token 不存在，无法创建会员排行榜活动`);
            return {
                success: false,
                tag: createRankingTag,
                message: 'Token 不存在，跳过会员排行榜活动创建'
            };
        }

        // 步骤1：查询排行榜配置并保存ID列表
        logger.info(`[${createRankingTag}] ========== 步骤1：查询排行榜配置 ==========`);
        const configResult = queryRankConfigList(data);
        if (!configResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `查询排行榜配置失败: ${configResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 查询到 ${configResult.idList.length} 个排行榜配置`);
        // 将ID列表保存到data中，供后续使用
        data.userRankConfigIdList = configResult.idList;

        // 步骤2：设置排行榜自动审核开关
        logger.info(`[${createRankingTag}] ========== 步骤2：设置排行榜自动审核开关 ==========`);
        const autoApproveResult = updateRankSetting(data, 'AutoApproveUserRankReward', 1);
        if (!autoApproveResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `设置自动审核开关失败: ${autoApproveResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 自动审核开关设置完成`);

        // 步骤3：设置活动打码量
        logger.info(`[${createRankingTag}] ========== 步骤3：设置活动打码量 ==========`);
        const codingMultipleResult = updateRankSetting(data, 'UserRankAmountCodingMultiple', 3);
        if (!codingMultipleResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `设置活动打码量失败: ${codingMultipleResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 活动打码量设置完成`);

        // 步骤4：配置日榜
        logger.info(`[${createRankingTag}] ========== 步骤4：配置日榜 ==========`);
        const dailyRankResult = configureDailyRank(data);
        if (!dailyRankResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `日榜配置失败: ${dailyRankResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 日榜配置完成`);

        // 步骤5：配置周榜
        logger.info(`[${createRankingTag}] ========== 步骤5：配置周榜 ==========`);
        const weeklyRankResult = configureWeeklyRank(data);
        if (!weeklyRankResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `周榜配置失败: ${weeklyRankResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 周榜配置完成`);

        // 步骤6：配置月榜
        logger.info(`[${createRankingTag}] ========== 步骤6：配置月榜 ==========`);
        const monthlyRankResult = configureMonthlyRank(data);
        if (!monthlyRankResult.success) {
            return {
                success: false,
                tag: createRankingTag,
                message: `月榜配置失败: ${monthlyRankResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] 月榜配置完成`);

        logger.info(`[${createRankingTag}] 会员排行榜活动创建成功`);
        return {
            success: true,
            tag: createRankingTag,
            message: '会员排行榜活动创建成功',
            idList: configResult.idList
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 创建会员排行榜活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRankingTag,
            message: `创建会员排行榜活动失败: ${errorMsg}`
        };
    }
}

/**
 * 查询排行榜配置列表并提取所有ID
 * @param {*} data
 * @returns {Object} 查询结果 { success, message, idList }
 */
function queryRankConfigList(data) {
    const token = data.token;
    const getRankConfigApi = '/api/Rank/GetUserRankConfigList';

    try {
        logger.info(`[${createRankingTag}] 查询会员排行榜配置列表`);
        const rankConfigResult = sendQueryRequest({}, getRankConfigApi, createRankingTag, false, token);

        if (!rankConfigResult) {
            logger.error(`[${createRankingTag}] 查询排行榜配置失败: 响应为空`);
            return {
                success: false,
                message: '查询排行榜配置失败: 响应为空',
                idList: []
            };
        }

        //logger.info(`[${createRankingTag}] 查询响应: ${JSON.stringify(rankConfigResult)}`);

        // 解析响应，获取 userRankConfigList
        let userRankConfigList;
        if (rankConfigResult.msgCode !== undefined) {
            if (rankConfigResult.msgCode !== 0) {
                logger.error(`[${createRankingTag}] 查询排行榜配置失败: ${rankConfigResult.msg}`);
                return {
                    success: false,
                    message: `查询排行榜配置失败: ${rankConfigResult.msg || '未知错误'}`,
                    idList: []
                };
            }
            // 尝试从 data 或 userRankConfigList 字段获取
            userRankConfigList = rankConfigResult.data?.userRankConfigList || rankConfigResult.userRankConfigList;
        } else {
            userRankConfigList = rankConfigResult.userRankConfigList;
        }

        if (!userRankConfigList || !Array.isArray(userRankConfigList) || userRankConfigList.length === 0) {
            logger.error(`[${createRankingTag}] userRankConfigList 为空或不是数组`);
            return {
                success: false,
                message: 'userRankConfigList 为空或不是数组',
                idList: []
            };
        }

        // 提取所有对象的 id 值
        const idList = userRankConfigList.map(config => config.id).filter(id => id !== undefined && id !== null);

        logger.info(`[${createRankingTag}] 提取到 ${idList.length} 个配置ID: ${JSON.stringify(idList)}`);

        return {
            success: true,
            message: `成功查询到 ${idList.length} 个排行榜配置`,
            idList: idList
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 查询排行榜配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`,
            idList: []
        };
    }
}

/**
 * 更新排行榜设置
 * @param {*} data
 * @param {string} settingKey 设置键名
 * @param {number} value 设置值
 * @returns {Object} 更新结果 { success, message }
 */
function updateRankSetting(data, settingKey, value) {
    const token = data.token;
    const updateSettingApi = '/api/Rank/UpdateRankSetting';

    try {
        logger.info(`[${createRankingTag}] 更新排行榜设置: ${settingKey} = ${value}`);

        const payload = {
            settingKey: settingKey,
            value1: value
        };

        const result = sendRequest(payload, updateSettingApi, createRankingTag, false, token);

        logger.info(`[${createRankingTag}] 更新设置响应: ${JSON.stringify(result)}`);

        // 处理响应 - 响应格式: {code: 0, data: false, msg: "Succeed", msgCode: 0}
        if (result && result.msgCode === 0) {
            logger.info(`[${createRankingTag}] 设置 ${settingKey} 更新成功`);
            return { success: true, message: '设置更新成功' };
        } else {
            return {
                success: false,
                message: result?.msg || `更新失败，响应: ${JSON.stringify(result)}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 更新排行榜设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `更新失败: ${errorMsg}`
        };
    }
}


/**
 * 配置日榜（包含编辑、分配、开启三个步骤）
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureDailyRank(data) {
    return configureRank(data, 0, 1, dailyRankConfigTemplate, '日榜');
}

/**
 * 配置周榜（包含编辑、分配、开启三个步骤）
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureWeeklyRank(data) {
    return configureRank(data, 1, 2, weeklyRankConfigTemplate, '周榜');
}

/**
 * 配置月榜（包含编辑、分配、开启三个步骤）
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureMonthlyRank(data) {
    return configureRank(data, 2, 3, monthlyRankConfigTemplate, '月榜');
}

/**
 * 通用排行榜配置函数（包含编辑、分配、开启三个步骤）
 * @param {*} data
 * @param {number} idIndex ID列表中的索引（0=日榜，1=周榜，2=月榜）
 * @param {number} rankType 排行榜类型（1=日榜，2=周榜，3=月榜）
 * @param {Object} configTemplate 配置模板
 * @param {string} rankName 排行榜名称（用于日志）
 * @returns {Object} 配置结果 { success, message }
 */
function configureRank(data, idIndex, rankType, configTemplate, rankName) {
    const idList = data.userRankConfigIdList;

    if (!idList || idList.length <= idIndex) {
        logger.error(`[${createRankingTag}] ID列表不足，无法配置${rankName}（需要索引${idIndex}）`);
        return {
            success: false,
            message: `ID列表不足，无法配置${rankName}`
        };
    }

    // 使用对应索引的ID
    const rankId = idList[idIndex];
    logger.info(`[${createRankingTag}] ${rankName}使用ID: ${rankId}`);

    try {
        // 步骤1：编辑配置
        logger.info(`[${createRankingTag}] ${rankName} - 步骤1：编辑配置`);
        const editResult = editUserRankConfig(data, rankId, configTemplate);
        if (!editResult.success) {
            return {
                success: false,
                message: `${rankName}编辑失败: ${editResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] ${rankName}编辑成功`);

        // 步骤2：分配奖金
        logger.info(`[${createRankingTag}] ${rankName} - 步骤2：分配奖金`);
        const bonusResult = updateUserBonusConfig(data, rankType);
        if (!bonusResult.success) {
            return {
                success: false,
                message: `${rankName}奖金分配失败: ${bonusResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] ${rankName}奖金分配成功`);

        // 步骤3：开启排行榜（先关闭再开启）
        logger.info(`[${createRankingTag}] ${rankName} - 步骤3：开启排行榜`);
        const stateResult = toggleUserRankState(data, rankType);
        if (!stateResult.success) {
            return {
                success: false,
                message: `${rankName}开关切换失败: ${stateResult.message}`
            };
        }
        logger.info(`[${createRankingTag}] ${rankName}开关切换成功`);

        return {
            success: true,
            message: `${rankName}配置成功`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 配置${rankName}时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置${rankName}失败: ${errorMsg}`
        };
    }
}

/**
 * 编辑会员排行榜配置
 * @param {*} data
 * @param {number} id 排行榜配置ID
 * @param {Object} configTemplate 配置模板
 * @returns {Object} 编辑结果 { success, message }
 */
function editUserRankConfig(data, id, configTemplate) {
    const token = data.token;
    const updateConfigApi = '/api/Rank/UpdateUserRankConfig';

    try {
        const tenantId = data.tenantId;

        const payload = {
            id: id,
            ...configTemplate,
            tenantId: tenantId
        };

        logger.info(`[${createRankingTag}] 发送编辑配置请求 - ID: ${id}`);

        const result = sendRequest(payload, updateConfigApi, createRankingTag, false, token);

        logger.info(`[${createRankingTag}] 编辑配置响应: ${JSON.stringify(result)}`);

        if (result === true || (result && result.msgCode === 0)) {
            logger.info(`[${createRankingTag}] 配置编辑成功 - ID: ${id}`);
            return { success: true, message: '配置编辑成功' };
        } else {
            return {
                success: false,
                message: result?.msg || `编辑失败，响应: ${JSON.stringify(result)}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 编辑配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `编辑失败: ${errorMsg}`
        };
    }
}

/**
 * 更新会员排行榜奖金分配
 * @param {*} data
 * @param {number} rankType 排行榜类型（1=日榜，2=周榜，3=月榜）
 * @returns {Object} 更新结果 { success, message }
 */
function updateUserBonusConfig(data, rankType) {
    const token = data.token;
    const updateBonusApi = '/api/Rank/UpdateUserBonusConfig';

    try {
        const payload = {
            rankType: rankType,
            bonusConfig: bonusConfigArray
        };

        logger.info(`[${createRankingTag}] 发送奖金分配请求 - rankType: ${rankType}`);

        const result = sendRequest(payload, updateBonusApi, createRankingTag, false, token);

        logger.info(`[${createRankingTag}] 奖金分配响应: ${JSON.stringify(result)}`);

        if (result === true || (result && result.msgCode === 0)) {
            logger.info(`[${createRankingTag}] 奖金分配成功 - rankType: ${rankType}`);
            return { success: true, message: '奖金分配成功' };
        } else {
            return {
                success: false,
                message: result?.msg || `分配失败，响应: ${JSON.stringify(result)}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 分配奖金时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `分配失败: ${errorMsg}`
        };
    }
}

/**
 * 切换会员排行榜开关状态（先关闭再开启）
 * @param {*} data
 * @param {number} rankType 排行榜类型（1=日榜，2=周榜，3=月榜）
 * @returns {Object} 配置结果 { success, message }
 */
function toggleUserRankState(data, rankType) {
    const token = data.token;
    const updateStateApi = '/api/Rank/UpdateUserRankState';

    try {
        // 1. 先关闭排行榜（state: 0）
        logger.info(`[${createRankingTag}] 关闭排行榜 - rankType: ${rankType}`);
        const closePayload = {
            rankType: rankType,
            state: 0
        };

        const closeResult = sendRequest(closePayload, updateStateApi, createRankingTag, false, token);
        logger.info(`[${createRankingTag}] 关闭排行榜响应: ${JSON.stringify(closeResult)}`);

        if (closeResult && closeResult.msgCode === 0) {
            logger.info(`[${createRankingTag}] 排行榜关闭成功`);
        } else {
            logger.warn(`[${createRankingTag}] 排行榜关闭失败: ${closeResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `排行榜关闭失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        // 等待1秒
        sleep(1);

        // 2. 再开启排行榜（state: 1）
        logger.info(`[${createRankingTag}] 开启排行榜 - rankType: ${rankType}`);
        const openPayload = {
            rankType: rankType,
            state: 1
        };

        const openResult = sendRequest(openPayload, updateStateApi, createRankingTag, false, token);
        logger.info(`[${createRankingTag}] 开启排行榜响应: ${JSON.stringify(openResult)}`);

        if (openResult && openResult.msgCode === 0) {
            logger.info(`[${createRankingTag}] 排行榜开启成功`);
            return { success: true, message: '排行榜开关切换成功（已开启）' };
        } else {
            return {
                success: false,
                message: `排行榜开启失败: ${openResult?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRankingTag}] 切换排行榜开关时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `切换开关失败: ${errorMsg}`
        };
    }
}
