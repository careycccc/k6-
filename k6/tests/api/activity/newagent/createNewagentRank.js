import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { ENV_CONFIG } from '../../../../config/envconfig.js';

export const createNewagentRankTag = 'createNewagentRank';

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
 * bonusConfig: { start, end, rewardRatio }
 * bonusDistributionRatio: { Start, End, RewardRatio }
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

// 代理排行榜配置对象模板
const agentRankConfigTemplate = {
    rankType: 2,
    rankCategory: 1,
    // effectiveDate 动态生成为明天的日期
    get effectiveDate() {
        return getTomorrowDate();
    },
    prizePoolRatio: 0.0059,
    prizePoolRatioShow: 0.6,
    minValidBetAmount: 100,
    codingMultiple: 6,
    initialGoldPool: 130000,
    maxRank: 100,
    // bonusDistributionRatio 使用转换后的格式并序列化为JSON字符串
    get bonusDistributionRatio() {
        return JSON.stringify(convertToBonusDistributionRatio(bonusConfigArray));
    },
    state: 1
};

// 奖金分配配置对象模板
const bonusDistributionConfigTemplate = {
    rankType: 2,
    // bonusConfig 直接使用公共数组
    bonusConfig: bonusConfigArray
};

/**
 * 创建新版返佣排行榜活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createNewagentRank(data) {
    logger.info(`[${createNewagentRankTag}] 开始创建新版返佣排行榜活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createNewagentRankTag}] Token 不存在，无法创建新版返佣排行榜活动`);
            return {
                success: false,
                tag: createNewagentRankTag,
                message: 'Token 不存在，跳过新版返佣排行榜活动创建'
            };
        }

        // 模块1：配置代理排行榜
        logger.info(`[${createNewagentRankTag}] ========== 模块1：配置代理排行榜 ==========`);
        const rankConfigResult = configureAgentRank(data);
        if (!rankConfigResult.success) {
            return {
                success: false,
                tag: createNewagentRankTag,
                message: `代理排行榜配置失败: ${rankConfigResult.message}`
            };
        }
        logger.info(`[${createNewagentRankTag}] 代理排行榜配置完成`);

        // 模块2：配置奖金分配
        logger.info(`[${createNewagentRankTag}] ========== 模块2：配置奖金分配 ==========`);
        const bonusConfigResult = configureBonusDistribution(data);
        if (!bonusConfigResult.success) {
            return {
                success: false,
                tag: createNewagentRankTag,
                message: `奖金分配配置失败: ${bonusConfigResult.message}`
            };
        }
        logger.info(`[${createNewagentRankTag}] 奖金分配配置完成`);

        // 模块3：开启代理排行榜开关
        logger.info(`[${createNewagentRankTag}] ========== 模块3：开启代理排行榜开关 ==========`);
        const rankStateResult = toggleAgentRankState(data);
        if (!rankStateResult.success) {
            return {
                success: false,
                tag: createNewagentRankTag,
                message: `代理排行榜开关配置失败: ${rankStateResult.message}`
            };
        }
        logger.info(`[${createNewagentRankTag}] 代理排行榜开关配置完成`);

        logger.info(`[${createNewagentRankTag}] 新版返佣排行榜活动创建成功`);
        return {
            success: true,
            tag: createNewagentRankTag,
            message: '新版返佣排行榜活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentRankTag}] 创建新版返佣排行榜活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createNewagentRankTag,
            message: `创建新版返佣排行榜活动失败: ${errorMsg}`
        };
    }
}

/**
 * 配置代理排行榜
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureAgentRank(data) {
    const token = data.token;
    const getRankConfigApi = '/api/Rank/GetAgentRankConfigList';
    const updateRankConfigApi = '/api/Rank/UpdateAgentRankConfig';

    try {
        // 1. 查询现有排行榜配置
        logger.info(`[${createNewagentRankTag}] 查询代理排行榜配置列表`);
        const rankConfigResult = sendQueryRequest({}, getRankConfigApi, createNewagentRankTag, false, token);

        if (!rankConfigResult) {
            logger.error(`[${createNewagentRankTag}] 查询排行榜配置失败: 响应为空`);
            return {
                success: false,
                message: '查询排行榜配置失败: 响应为空'
            };
        }

        // 添加调试日志，查看完整响应
        //logger.info(`[${createNewagentRankTag}] 查询响应完整数据: ${JSON.stringify(rankConfigResult)}`);

        // 解析响应 - API直接返回单个配置对象，不是数组
        let rankConfig;
        if (rankConfigResult.msgCode !== undefined) {
            if (rankConfigResult.msgCode !== 0) {
                logger.error(`[${createNewagentRankTag}] 查询排行榜配置失败: ${rankConfigResult.msg}`);
                return {
                    success: false,
                    message: `查询排行榜配置失败: ${rankConfigResult.msg || '未知错误'}`
                };
            }
            // 尝试多种可能的数据字段
            rankConfig = rankConfigResult.data || rankConfigResult;
        } else {
            rankConfig = rankConfigResult;
        }

        //logger.info(`[${createNewagentRankTag}] 解析后的配置: ${JSON.stringify(rankConfig)}`);

        // 检查配置对象是否有效
        if (!rankConfig || typeof rankConfig !== 'object') {
            logger.error(`[${createNewagentRankTag}] 排行榜配置无效`);
            return {
                success: false,
                message: '排行榜配置无效'
            };
        }

        // 检查是否有ID
        if (!rankConfig.id) {
            logger.error(`[${createNewagentRankTag}] 排行榜配置缺少ID，无法更新`);
            return {
                success: false,
                message: '排行榜配置缺少ID'
            };
        }

        const configId = rankConfig.id;
        const tenantId = ENV_CONFIG.TENANTID || rankConfig.tenantId;

        logger.info(`[${createNewagentRankTag}] 使用配置ID: ${configId}, tenantId: ${tenantId}`);

        // 3. 构建更新payload
        const updatePayload = {
            id: configId,
            ...agentRankConfigTemplate,
            tenantId: tenantId
        };

        logger.info(`[${createNewagentRankTag}] 发送排行榜配置更新请求`);
        // logger.info(`[${createNewagentRankTag}] 更新Payload: ${JSON.stringify(updatePayload)}`);

        // 4. 发送更新请求
        const updateResult = sendRequest(updatePayload, updateRankConfigApi, createNewagentRankTag, false, token);

        logger.info(`[${createNewagentRankTag}] 排行榜配置更新响应: ${JSON.stringify(updateResult)}`);

        // 5. 处理响应
        // 处理不同的响应格式
        if (updateResult === true) {
            logger.info(`[${createNewagentRankTag}] 排行榜配置更新成功 - ID: ${configId}`);
            return { success: true, message: '排行榜配置更新成功' };
        } else if (updateResult && updateResult.msgCode === 0) {
            logger.info(`[${createNewagentRankTag}] 排行榜配置更新成功 - ID: ${configId}`);
            return { success: true, message: '排行榜配置更新成功' };
        } else {
            return {
                success: false,
                message: updateResult?.msg || `更新失败，响应: ${JSON.stringify(updateResult)}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentRankTag}] 配置代理排行榜时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 配置奖金分配
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureBonusDistribution(data) {
    const token = data.token;
    const updateBonusConfigApi = '/api/Rank/UpdateAgentBonusConfig';

    try {
        logger.info(`[${createNewagentRankTag}] 配置奖金分配`);

        // 构建更新payload
        const updatePayload = {
            ...bonusDistributionConfigTemplate
        };

        logger.info(`[${createNewagentRankTag}] 发送奖金分配配置更新请求`);
        //logger.info(`[${createNewagentRankTag}] 更新Payload: ${JSON.stringify(updatePayload)}`);

        // 发送更新请求
        const updateResult = sendRequest(updatePayload, updateBonusConfigApi, createNewagentRankTag, false, token);

        logger.info(`[${createNewagentRankTag}] 奖金分配配置更新响应: ${JSON.stringify(updateResult)}`);

        // 处理响应
        if (updateResult === true) {
            logger.info(`[${createNewagentRankTag}] 奖金分配配置更新成功`);
            return { success: true, message: '奖金分配配置更新成功' };
        } else if (updateResult && updateResult.msgCode === 0) {
            logger.info(`[${createNewagentRankTag}] 奖金分配配置更新成功`);
            return { success: true, message: '奖金分配配置更新成功' };
        } else {
            return {
                success: false,
                message: updateResult?.msg || `更新失败，响应: ${JSON.stringify(updateResult)}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentRankTag}] 配置奖金分配时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}

/**
 * 切换代理排行榜开关状态（先关闭再开启）
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function toggleAgentRankState(data) {
    const token = data.token;
    const updateStateApi = '/api/Rank/UpdateAgentRankState';

    try {
        // 1. 先关闭排行榜（state: 0）
        logger.info(`[${createNewagentRankTag}] 关闭代理排行榜`);
        const closePayload = {
            rankType: 2,
            state: 0
        };

        const closeResult = sendRequest(closePayload, updateStateApi, createNewagentRankTag, false, token);
        logger.info(`[${createNewagentRankTag}] 关闭排行榜响应: ${JSON.stringify(closeResult)}`);

        // 检查关闭结果
        if (closeResult && closeResult.msgCode === 0) {
            logger.info(`[${createNewagentRankTag}] 排行榜关闭成功`);
        } else {
            logger.warn(`[${createNewagentRankTag}] 排行榜关闭失败: ${closeResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `排行榜关闭失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        // 等待1秒
        sleep(1);

        // 2. 再开启排行榜（state: 1）
        logger.info(`[${createNewagentRankTag}] 开启代理排行榜`);
        const openPayload = {
            rankType: 2,
            state: 1
        };

        const openResult = sendRequest(openPayload, updateStateApi, createNewagentRankTag, false, token);
        logger.info(`[${createNewagentRankTag}] 开启排行榜响应: ${JSON.stringify(openResult)}`);

        // 检查开启结果
        if (openResult && openResult.msgCode === 0) {
            logger.info(`[${createNewagentRankTag}] 排行榜开启成功`);
            return { success: true, message: '排行榜开关切换成功（已开启）' };
        } else {
            return {
                success: false,
                message: `排行榜开启失败: ${openResult?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentRankTag}] 切换排行榜开关时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `切换开关失败: ${errorMsg}`
        };
    }
}
