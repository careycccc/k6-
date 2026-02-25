import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { handleMultipleConfigs, ConfigType } from '../common/activityConfigHandler.js';

export const createNewagentTag = 'createNewagent';

// 在模块顶层创建3个图片上传器，对应3个外链
const uploadOutlinkImage1 = createImageUploader('../../uploadFile/img/outlink/1.png', createNewagentTag);
const uploadOutlinkImage2 = createImageUploader('../../uploadFile/img/outlink/2.png', createNewagentTag);
const uploadOutlinkImage3 = createImageUploader('../../uploadFile/img/outlink/3.png', createNewagentTag);

/**
 * 创建新版返佣活动
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createNewagent(data) {
    logger.info(`[${createNewagentTag}] 开始创建新版返佣活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createNewagentTag}] Token 不存在，无法创建新版返佣活动`);
            return {
                success: false,
                tag: createNewagentTag,
                message: 'Token 不存在，跳过新版返佣活动创建'
            };
        }

        // 模块1：代理配置模块
        logger.info(`[${createNewagentTag}] ========== 模块1：代理配置模块 ==========`);
        const agentConfigResult = checkAndConfigureAgentSettings(data);
        if (!agentConfigResult.success) {
            return {
                success: false,
                tag: createNewagentTag,
                message: `代理配置模块失败: ${agentConfigResult.message}`
            };
        }
        logger.info(`[${createNewagentTag}] 代理配置模块完成`);

        // 模块2：外链配置模块
        logger.info(`[${createNewagentTag}] ========== 模块2：外链配置模块 ==========`);
        const externalLinkResult = configureExternalLinks(data);
        if (!externalLinkResult.success) {
            return {
                success: false,
                tag: createNewagentTag,
                message: `外链配置模块失败: ${externalLinkResult.message}`
            };
        }
        logger.info(`[${createNewagentTag}] 外链配置模块完成`);

        // 模块3：奖励模块配置
        logger.info(`[${createNewagentTag}] ========== 模块3：奖励模块配置 ==========`);
        const rewardConfigResult = configureInviteRewards(data);
        if (!rewardConfigResult.success) {
            return {
                success: false,
                tag: createNewagentTag,
                message: `奖励模块配置失败: ${rewardConfigResult.message}`
            };
        }
        logger.info(`[${createNewagentTag}] 奖励模块配置完成`);

        // 模块4：团队返佣等级配置
        logger.info(`[${createNewagentTag}] ========== 模块4：团队返佣等级配置 ==========`);
        const teamRebateResult = configureTeamRebateLevels(data);
        if (!teamRebateResult.success) {
            return {
                success: false,
                tag: createNewagentTag,
                message: `团队返佣等级配置失败: ${teamRebateResult.message}`
            };
        }
        logger.info(`[${createNewagentTag}] 团队返佣等级配置完成`);

        logger.info(`[${createNewagentTag}] 新版返佣活动创建成功`);
        return {
            success: true,
            tag: createNewagentTag,
            message: '新版返佣活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 创建新版返佣活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createNewagentTag,
            message: `创建新版返佣活动失败: ${errorMsg}`
        };
    }
}

/**
 * 模块1：检查并配置代理设置
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureAgentSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/AgentL3/GetConfig';
    const updateSettingApi = '/api/AgentL3/UpdateConfig';

    try {
        // 1. 获取当前配置
        logger.info(`[${createNewagentTag}] 获取代理配置`);
        const settingsResult = sendRequest({}, getSettingApi, createNewagentTag, false, token);

        // logger.info(`[${createNewagentTag}] 配置响应: ${JSON.stringify(settingsResult)}`);

        // 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${createNewagentTag}] 获取配置失败: 响应为空`);
            return {
                success: false,
                message: '获取配置失败: 响应为空'
            };
        }

        // 判断响应格式
        let settings;
        if (settingsResult.msgCode !== undefined) {
            // 标准响应格式
            if (settingsResult.msgCode !== 0) {
                logger.error(`[${createNewagentTag}] 获取配置失败: msgCode=${settingsResult.msgCode}, msg=${settingsResult.msg}`);
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
            logger.error(`[${createNewagentTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        // logger.info(`[${createNewagentTag}] 配置数据: ${JSON.stringify(settings)}`);

        // 2. 特殊处理：有效充值金额和有效投注金额如果为0或null，设置为100
        const specialConfigs = [
            { key: 'agentL3InviteRechargeAmount', name: '有效充值金额' },
            { key: 'agentL3InviteBetAmount', name: '有效投注金额' }
        ];

        for (const config of specialConfigs) {
            const setting = settings[config.key];
            if (setting && (setting.value1 === "0" || setting.value1 === null || setting.value1 === "" || setting.value1 === 0)) {
                logger.info(`[${createNewagentTag}] ${config.name} 当前值为 ${setting.value1}，设置为 100`);
                const payload = {
                    settingKey: config.key,
                    value1: "100"
                };
                const result = sendRequest(payload, updateSettingApi, createNewagentTag, false, token);
                if (!result || (result.msgCode !== undefined && result.msgCode !== 0)) {
                    logger.error(`[${createNewagentTag}] 设置 ${config.name} 失败: ${result?.msg || '未知错误'}`);
                } else {
                    logger.info(`[${createNewagentTag}] ${config.name} 已设置为 100`);
                }
                sleep(0.3);
            } else {
                logger.info(`[${createNewagentTag}] ${config.name} 当前值为 ${setting?.value1}，无需特殊处理`);
            }
        }

        // 3. 使用统一配置处理器处理所有配置
        const configRules = [
            // 代理排行榜奖励自动审核通过开关
            { settingKey: 'agentL3AutoApproveRankReward', configType: ConfigType.SWITCH },

            // 自动领取佣金开关
            { settingKey: 'agentL3AutoSendCommission', configType: ConfigType.SWITCH },

            // 代理有效邀请投注金额
            { settingKey: 'agentL3InviteBetAmount', configType: ConfigType.NUMBER },

            // 有效邀请奖励次数每日上限
            { settingKey: 'agentL3InviteDayLimitCount', configType: ConfigType.NUMBER },

            // 代理有效邀请充值金额
            { settingKey: 'agentL3InviteRechargeAmount', configType: ConfigType.NUMBER },

            // 邀请人奖金
            { settingKey: 'agentL3InviteRewardAmount', configType: ConfigType.NUMBER },

            // 有效邀请奖励次数总上限
            { settingKey: 'agentL3InviteTotalLimitCount', configType: ConfigType.NUMBER },

            // 代理奖励打码量倍数
            { settingKey: 'agentL3InviteWashCode', configType: ConfigType.NUMBER },

            // 被邀请人金额
            { settingKey: 'agentL3InvitedRewardAmount', configType: ConfigType.NUMBER }
        ];

        const result = handleMultipleConfigs({
            token,
            settings,
            configRules,
            updateApi: updateSettingApi,
            tag: createNewagentTag
        });

        return result;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 配置代理设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}



/**
 * 模块2：配置外链
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureExternalLinks(data) {
    const token = data.token;
    const getLinksApi = '/api/AgentL3/GetAgentExternalLinkList';

    try {
        // 1. 查询现有外链配置
        logger.info(`[${createNewagentTag}] 查询外链配置列表`);
        const linksResult = sendQueryRequest({}, getLinksApi, createNewagentTag, false, token);

        if (!linksResult) {
            logger.error(`[${createNewagentTag}] 查询外链配置失败: 响应为空`);
            return {
                success: false,
                message: '查询外链配置失败: 响应为空'
            };
        }

        // 解析响应
        let linksList;
        if (linksResult.msgCode !== undefined) {
            if (linksResult.msgCode !== 0) {
                logger.error(`[${createNewagentTag}] 查询外链配置失败: ${linksResult.msg}`);
                return {
                    success: false,
                    message: `查询外链配置失败: ${linksResult.msg || '未知错误'}`
                };
            }
            linksList = linksResult.data;
        } else if (linksResult.list) {
            linksList = linksResult.list;
        } else {
            linksList = linksResult;
        }

        if (!linksList || !Array.isArray(linksList) || linksList.length === 0) {
            logger.error(`[${createNewagentTag}] 外链配置列表为空，跳过外链配置`);
            return {
                success: false,
                message: '外链配置列表为空，无法获取ID'
            };
        }

        logger.info(`[${createNewagentTag}] 查询到 ${linksList.length} 个外链配置`);
        //logger.info(`[${createNewagentTag}] 外链列表详情: ${JSON.stringify(linksList)}`);

        // 2. 定义3个外链的配置
        const externalLinks = [
            {
                name: 'Telegram',
                linkIndex: 1,
                buttonText: 'telegram',
                jumpUrl: 'https://t.me/RA9OFFICIAL',
                uploadFn: uploadOutlinkImage1,
                cacheKey: 'outlinkImage1Path'
            },
            {
                name: 'WhatsApp',
                linkIndex: 2,
                buttonText: 'whatsapp',
                jumpUrl: 'https://www.whatsapp.com/channel/0029Vb679NQLtOj5ISjbAV1v',
                uploadFn: uploadOutlinkImage2,
                cacheKey: 'outlinkImage2Path'
            },
            {
                name: 'Instagram',
                linkIndex: 3,
                buttonText: 'instagram',
                jumpUrl: 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Fra9com%2F%3Figsh%3DbHMyd3Z1NHgwMXR1&is_from_rle',
                uploadFn: uploadOutlinkImage3,
                cacheKey: 'outlinkImage3Path'
            }
        ];

        let successCount = 0;
        let failedLinks = [];

        // 3. 循环配置每个外链
        // 注意：linkIndex 是排序值，根据数组索引设置（从1开始）
        for (let i = 0; i < externalLinks.length; i++) {
            sleep(1);
            const link = externalLinks[i];
            logger.info(`[${createNewagentTag}] 配置外链 ${link.linkIndex}: ${link.name}`);

            // 使用数组索引获取对应的外链（第i个）
            if (i >= linksList.length) {
                logger.error(`[${createNewagentTag}] 外链列表只有 ${linksList.length} 个，无法配置第 ${i + 1} 个外链，跳过`);
                failedLinks.push(link.name);
                continue;
            }

            const existingLink = linksList[i];

            if (!existingLink || !existingLink.id) {
                logger.error(`[${createNewagentTag}] 外链 ${i + 1} 缺少ID，跳过`);
                failedLinks.push(link.name);
                continue;
            }

            const linkId = existingLink.id;
            logger.info(`[${createNewagentTag}] 外链 ${link.name} 的ID: ${linkId}，使用 linkIndex: ${link.linkIndex}`);

            // 处理图片上传
            const imageResult = handleImageUpload(data, link.cacheKey, link.uploadFn, createNewagentTag);

            if (!imageResult.success) {
                logger.error(`[${createNewagentTag}] 外链 ${link.name} 图片上传失败: ${imageResult.error}`);
                failedLinks.push(link.name);
                continue;
            }

            const imagePath = imageResult.imagePath;

            // 提交外链配置
            const submitResult = submitExternalLink(data, {
                id: linkId,
                linkIndex: link.linkIndex,
                imgUrl: imagePath,
                buttonText: link.buttonText,
                jumpUrl: link.jumpUrl
            });

            if (submitResult.success) {
                successCount++;
                logger.info(`[${createNewagentTag}] 外链 ${link.name} 配置成功`);
                sleep(0.5);
            } else {
                failedLinks.push(link.name);
                logger.error(`[${createNewagentTag}] 外链 ${link.name} 配置失败: ${submitResult.message}`);
            }
        }

        if (successCount === externalLinks.length) {
            logger.info(`[${createNewagentTag}] 所有外链配置成功 (${successCount}/${externalLinks.length})`);
            return {
                success: true,
                message: `外链配置成功，共配置 ${successCount} 个外链`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createNewagentTag}] 部分外链配置成功 (${successCount}/${externalLinks.length})`);
            return {
                success: true,
                message: `部分外链配置成功 (${successCount}/${externalLinks.length})，失败: ${failedLinks.join(', ')}`
            };
        } else {
            logger.error(`[${createNewagentTag}] 所有外链配置失败`);
            return {
                success: false,
                message: '所有外链配置失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 配置外链时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置外链失败: ${errorMsg}`
        };
    }
}

/**
 * 提交外链配置
 * @param {*} data
 * @param {Object} linkConfig 外链配置对象
 * @returns {Object} 提交结果 { success, errorCode, message }
 */
function submitExternalLink(data, linkConfig) {
    const token = data.token;
    const api = '/api/AgentL3/SubmitAgentExternalLink';

    const payload = {
        id: linkConfig.id,
        linkType: 2,
        linkIndex: linkConfig.linkIndex,
        imgUrl: linkConfig.imgUrl,
        buttonText: linkConfig.buttonText,
        jumpUrl: linkConfig.jumpUrl,
        state: 1
    };

    try {
        const result = sendRequest(payload, api, createNewagentTag, false, token);

        if (result && result.msgCode === 0) {
            logger.info(`[${createNewagentTag}] 外链提交成功 - linkIndex: ${linkConfig.linkIndex}`);
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '提交失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 提交外链请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}


/**
 * 模块3：配置邀请奖励
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureInviteRewards(data) {
    const token = data.token;
    const getRewardsApi = '/api/AgentL3/GetListInviteTaskConfig';

    try {
        // 1. 查询现有奖励配置
        logger.info(`[${createNewagentTag}] 查询邀请奖励配置列表`);
        const rewardsResult = sendQueryRequest({}, getRewardsApi, createNewagentTag, false, token);

        if (!rewardsResult) {
            logger.error(`[${createNewagentTag}] 查询奖励配置失败: 响应为空`);
            return {
                success: false,
                message: '查询奖励配置失败: 响应为空'
            };
        }

        // 解析响应
        let rewardsList;
        if (rewardsResult.msgCode !== undefined) {
            if (rewardsResult.msgCode !== 0) {
                logger.error(`[${createNewagentTag}] 查询奖励配置失败: ${rewardsResult.msg}`);
                return {
                    success: false,
                    message: `查询奖励配置失败: ${rewardsResult.msg || '未知错误'}`
                };
            }
            rewardsList = rewardsResult.data;
        } else if (rewardsResult.list) {
            rewardsList = rewardsResult.list;
        } else {
            rewardsList = rewardsResult;
        }

        if (!rewardsList || !Array.isArray(rewardsList) || rewardsList.length === 0) {
            logger.error(`[${createNewagentTag}] 奖励配置列表为空，跳过奖励配置`);
            return {
                success: false,
                message: '奖励配置列表为空，无法获取ID'
            };
        }

        logger.info(`[${createNewagentTag}] 查询到 ${rewardsList.length} 个奖励配置`);
        logger.info(`[${createNewagentTag}] 奖励列表详情: ${JSON.stringify(rewardsList)}`);

        let successCount = 0;
        let failedRewards = [];

        // 2. 循环更新每个奖励配置
        // 规则：inviteUserCount 从1开始依次递增，rewardAmount 从40开始每次+20
        for (let i = 0; i < rewardsList.length; i++) {
            sleep(0.5);

            const reward = rewardsList[i];
            const inviteUserCount = i + 1;  // 从1开始递增
            const rewardAmount = 40 + (i * 20);  // 从40开始，每次+20

            logger.info(`[${createNewagentTag}] 更新奖励配置 ${i + 1}/${rewardsList.length}: inviteUserCount=${inviteUserCount}, rewardAmount=${rewardAmount}`);

            if (!reward.id) {
                logger.error(`[${createNewagentTag}] 奖励配置 ${i + 1} 缺少ID，跳过`);
                failedRewards.push(`配置${i + 1}`);
                continue;
            }

            // 更新奖励配置
            const updateResult = updateInviteReward(data, {
                id: reward.id,
                inviteUserCount: inviteUserCount,
                rewardAmount: rewardAmount
            });

            if (updateResult.success) {
                successCount++;
                logger.info(`[${createNewagentTag}] 奖励配置 ${i + 1} 更新成功 (ID: ${reward.id})`);
            } else {
                failedRewards.push(`配置${i + 1}`);
                logger.error(`[${createNewagentTag}] 奖励配置 ${i + 1} 更新失败: ${updateResult.message}`);
            }
        }

        if (successCount === rewardsList.length) {
            logger.info(`[${createNewagentTag}] 所有奖励配置更新成功 (${successCount}/${rewardsList.length})`);
            return {
                success: true,
                message: `奖励配置更新成功，共更新 ${successCount} 个配置`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createNewagentTag}] 部分奖励配置更新成功 (${successCount}/${rewardsList.length})`);
            return {
                success: true,
                message: `部分奖励配置更新成功 (${successCount}/${rewardsList.length})，失败: ${failedRewards.join(', ')}`
            };
        } else {
            logger.error(`[${createNewagentTag}] 所有奖励配置更新失败`);
            return {
                success: false,
                message: '所有奖励配置更新失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 配置邀请奖励时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置邀请奖励失败: ${errorMsg}`
        };
    }
}

/**
 * 更新邀请奖励配置
 * @param {*} data
 * @param {Object} rewardConfig 奖励配置对象
 * @returns {Object} 更新结果 { success, errorCode, message }
 */
function updateInviteReward(data, rewardConfig) {
    const token = data.token;
    const api = '/api/AgentL3/UpdateInviteTaskConfig';

    const payload = {
        id: rewardConfig.id,
        inviteUserCount: rewardConfig.inviteUserCount,
        rewardAmount: rewardConfig.rewardAmount
    };

    try {
        logger.info(`[${createNewagentTag}] 发送奖励配置更新请求 - Payload: ${JSON.stringify(payload)}`);
        const result = sendRequest(payload, api, createNewagentTag, false, token);

        logger.info(`[${createNewagentTag}] 奖励配置更新响应 - Result: ${JSON.stringify(result)}, Type: ${typeof result}`);

        // 处理不同的响应格式
        // 1. 如果 sendRequest 返回的是 data 部分（布尔值 true）
        if (result === true) {
            logger.info(`[${createNewagentTag}] 奖励配置更新成功 - ID: ${rewardConfig.id}, inviteUserCount: ${rewardConfig.inviteUserCount}, rewardAmount: ${rewardConfig.rewardAmount}`);
            return { success: true };
        }
        // 2. 标准响应格式 {msgCode: 0}
        else if (result && result.msgCode === 0) {
            logger.info(`[${createNewagentTag}] 奖励配置更新成功 - ID: ${rewardConfig.id}, inviteUserCount: ${rewardConfig.inviteUserCount}, rewardAmount: ${rewardConfig.rewardAmount}`);
            return { success: true };
        }
        // 3. 失败情况
        else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || result?.message || `更新失败，响应: ${JSON.stringify(result)}`
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 更新奖励配置请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}


/**
 * 模块4：配置团队返佣等级
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function configureTeamRebateLevels(data) {
    const token = data.token;
    const getLevelsApi = '/api/AgentL3/GetListRebateLevelRate';
    const updateLevelApi = '/api/AgentL3/UpdateRebateLevelRate';

    try {
        // 1. 查询现有团队返佣等级配置
        logger.info(`[${createNewagentTag}] 查询团队返佣等级配置列表`);
        const levelsResult = sendQueryRequest({}, getLevelsApi, createNewagentTag, false, token);

        if (!levelsResult) {
            logger.error(`[${createNewagentTag}] 查询团队返佣等级配置失败: 响应为空`);
            return {
                success: false,
                message: '查询团队返佣等级配置失败: 响应为空'
            };
        }

        // 解析响应
        let levelsList;
        if (levelsResult.msgCode !== undefined) {
            if (levelsResult.msgCode !== 0) {
                logger.error(`[${createNewagentTag}] 查询团队返佣等级配置失败: ${levelsResult.msg}`);
                return {
                    success: false,
                    message: `查询团队返佣等级配置失败: ${levelsResult.msg || '未知错误'}`
                };
            }
            levelsList = levelsResult.data;
        } else if (levelsResult.list) {
            levelsList = levelsResult.list;
        } else {
            levelsList = levelsResult;
        }

        if (!levelsList || !Array.isArray(levelsList) || levelsList.length === 0) {
            logger.error(`[${createNewagentTag}] 团队返佣等级配置列表为空，跳过配置`);
            return {
                success: false,
                message: '团队返佣等级配置列表为空，无法获取ID'
            };
        }

        logger.info(`[${createNewagentTag}] 查询到 ${levelsList.length} 个团队返佣等级配置`);

        // 2. 定义4个等级的配置模板
        const teamLevelConfigs = [
            {
                teamLevel: 0,
                teamPeoples: 0,
                teamBetAmount: 10000,
                teamRechargeRewardRate: 0.5,
                teamBetRewardRate: {
                    electronic: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
                    video: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
                    sports: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
                    lottery: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 },
                    chessCard: { teamBetRewardRate_L1: 0.2, teamBetRewardRate_L2: 0.1, teamBetRewardRate_L3: 0.05 }
                }
            },
            {
                teamLevel: 1,
                teamPeoples: 5,
                teamBetAmount: 50000,
                teamRechargeRewardRate: 1,
                teamBetRewardRate: {
                    electronic: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 },
                    video: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 },
                    sports: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 },
                    lottery: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 },
                    chessCard: { teamBetRewardRate_L1: 0.3, teamBetRewardRate_L2: 0.15, teamBetRewardRate_L3: 0.07 }
                }
            },
            {
                teamLevel: 2,
                teamPeoples: 20,
                teamBetAmount: 100000,
                teamRechargeRewardRate: 1.5,
                teamBetRewardRate: {
                    electronic: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 },
                    video: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 },
                    sports: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 },
                    lottery: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 },
                    chessCard: { teamBetRewardRate_L1: 0.4, teamBetRewardRate_L2: 0.2, teamBetRewardRate_L3: 0.1 }
                }
            },
            {
                teamLevel: 3,
                teamPeoples: 30,
                teamBetAmount: 200000,
                teamRechargeRewardRate: 1,
                teamBetRewardRate: {
                    electronic: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 },
                    video: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 },
                    sports: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 },
                    lottery: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 },
                    chessCard: { teamBetRewardRate_L1: 0.5, teamBetRewardRate_L2: 0.25, teamBetRewardRate_L3: 0.12 }
                }
            }
        ];

        let successCount = 0;
        let failedLevels = [];

        // 3. 循环更新每个等级配置
        // 根据返回的列表数量和teamLevel匹配进行更新
        for (let i = 0; i < Math.min(levelsList.length, teamLevelConfigs.length); i++) {
            sleep(0.5);

            const level = levelsList[i];
            const config = teamLevelConfigs[i];

            logger.info(`[${createNewagentTag}] 更新团队等级 ${config.teamLevel} 配置 (${i + 1}/${Math.min(levelsList.length, teamLevelConfigs.length)})`);

            if (!level.id) {
                logger.error(`[${createNewagentTag}] 团队等级 ${config.teamLevel} 配置缺少ID，跳过`);
                failedLevels.push(`等级${config.teamLevel}`);
                continue;
            }

            // 更新团队返佣等级配置
            const updateResult = updateTeamRebateLevel(data, {
                id: level.id,
                ...config
            });

            if (updateResult.success) {
                successCount++;
                logger.info(`[${createNewagentTag}] 团队等级 ${config.teamLevel} 配置更新成功 (ID: ${level.id})`);
            } else {
                failedLevels.push(`等级${config.teamLevel}`);
                logger.error(`[${createNewagentTag}] 团队等级 ${config.teamLevel} 配置更新失败: ${updateResult.message}`);
            }
        }

        const totalConfigs = Math.min(levelsList.length, teamLevelConfigs.length);

        if (successCount === totalConfigs) {
            logger.info(`[${createNewagentTag}] 所有团队返佣等级配置更新成功 (${successCount}/${totalConfigs})`);
            return {
                success: true,
                message: `团队返佣等级配置更新成功，共更新 ${successCount} 个等级`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createNewagentTag}] 部分团队返佣等级配置更新成功 (${successCount}/${totalConfigs})`);
            return {
                success: true,
                message: `部分团队返佣等级配置更新成功 (${successCount}/${totalConfigs})，失败: ${failedLevels.join(', ')}`
            };
        } else {
            logger.error(`[${createNewagentTag}] 所有团队返佣等级配置更新失败`);
            return {
                success: false,
                message: '所有团队返佣等级配置更新失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 配置团队返佣等级时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置团队返佣等级失败: ${errorMsg}`
        };
    }
}

/**
 * 更新团队返佣等级配置
 * @param {*} data
 * @param {Object} levelConfig 等级配置对象
 * @returns {Object} 更新结果 { success, errorCode, message }
 */
function updateTeamRebateLevel(data, levelConfig) {
    const token = data.token;
    const api = '/api/AgentL3/UpdateRebateLevelRate';

    const payload = {
        id: levelConfig.id,
        teamLevel: levelConfig.teamLevel,
        teamPeoples: levelConfig.teamPeoples,
        teamBetAmount: levelConfig.teamBetAmount,
        teamRechargeRewardRate: levelConfig.teamRechargeRewardRate,
        teamBetRewardRate: levelConfig.teamBetRewardRate
    };

    try {
        const result = sendRequest(payload, api, createNewagentTag, false, token);

        // 处理不同的响应格式
        // 1. 如果 sendRequest 返回的是 data 部分（布尔值 true）
        if (result === true) {
            logger.info(`[${createNewagentTag}] 团队等级 ${levelConfig.teamLevel} 配置更新成功 - ID: ${levelConfig.id}`);
            return { success: true };
        }
        // 2. 标准响应格式 {msgCode: 0}
        else if (result && result.msgCode === 0) {
            logger.info(`[${createNewagentTag}] 团队等级 ${levelConfig.teamLevel} 配置更新成功 - ID: ${levelConfig.id}`);
            return { success: true };
        }
        // 3. 失败情况
        else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || `更新失败，响应: ${JSON.stringify(result)}`
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createNewagentTag}] 更新团队返佣等级配置请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
