import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createInviteTurntableTag = 'createInviteTurntable';

/**
 * 创建邀请转盘活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createInviteTurntable(data) {
    logger.info(`[${createInviteTurntableTag}] 开始创建邀请转盘活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createInviteTurntableTag}] Token 不存在，无法创建邀请转盘`);
            return {
                success: false,
                tag: createInviteTurntableTag,
                message: 'Token 不存在，跳过邀请转盘活动创建'
            };
        }

        // 定义两种配置模式
        const configs = [
            {
                name: '普通模式',
                mode: 'update',  // 更新模式
                api: '/api/InvitedWheel/UpdateInvitedWheelConfig'
            },
            {
                name: '故事模式',
                mode: 'add',  // 新增模式
                api: '/api/InvitedWheel/AddInvitedWheelConfig'
            }
        ];

        let successCount = 0;
        let failedConfigs = [];

        // 循环创建每种配置
        for (const config of configs) {
            sleep(1);
            logger.info(`[${createInviteTurntableTag}] 配置${config.name}...`);

            const result = createInviteTurntableConfig(data, config);

            if (result.success) {
                successCount++;
                logger.info(`[${createInviteTurntableTag}] ${config.name} 配置成功`);
                sleep(0.5);
            } else {
                failedConfigs.push(config.name);
                logger.error(`[${createInviteTurntableTag}] ${config.name} 配置失败: ${result.message}`);
            }
        }

        if (successCount === configs.length) {
            logger.info(`[${createInviteTurntableTag}] 所有配置创建成功 (${successCount}/${configs.length})`);
            return {
                success: true,
                tag: createInviteTurntableTag,
                message: `邀请转盘活动配置成功，共配置 ${successCount} 种模式`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createInviteTurntableTag}] 部分配置创建成功 (${successCount}/${configs.length})`);
            return {
                success: true,
                tag: createInviteTurntableTag,
                message: `部分配置创建成功 (${successCount}/${configs.length})，失败: ${failedConfigs.join(', ')}`
            };
        } else {
            logger.error(`[${createInviteTurntableTag}] 所有配置创建失败`);
            return {
                success: false,
                tag: createInviteTurntableTag,
                message: '所有邀请转盘配置创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createInviteTurntableTag}] 创建邀请转盘活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createInviteTurntableTag,
            message: `创建邀请转盘活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建邀请转盘配置
 * @param {*} data
 * @param {Object} config 配置信息
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createInviteTurntableConfig(data, config) {
    const token = data.token;
    const api = config.api;

    let payload;

    if (config.mode === 'update') {
        // 普通模式 - 更新默认配置
        payload = {
            "id": 100002,
            "configName": "默认配置",
            "priority": 0,
            "targetType": 0,
            "targetDetail": "",
            "totalPrizeAmount": 500,
            "dayFreeDrawsCount": 3,
            "invitedDrawsCount": 1,
            "validRechargeAmount": 0,
            "inviteWinningRatio": 35,
            "firstSpinBonusRatioMin": 99.5,
            "firstSpinBonusRatioMax": 99.7,
            "freeSpinBonusMin": 5,
            "freeSpinBonusMax": 20,
            "noWinSpinBonusMin": 0.3,
            "noWinSpinBonusMax": 0.6,
            "isOpenDiskDisplay": true,
            "diskDisplayModeDetail": "27|77|87|377|57|500|177",
            "state": 1,
            "isScriptControl": false
        };
    } else {
        // 故事模式 - 新增配置
        payload = {
            "configName": "故事模式",
            "priority": 1,
            "targetType": 1,
            "targetDetail": "1,2,3,4,5,6,7,8,9,10,11,12",
            "totalPrizeAmount": 999,
            "dayFreeDrawsCount": 2,
            "invitedDrawsCount": 2,
            "validRechargeAmount": 100,
            "inviteWinningRatio": 25,
            "firstSpinBonusRatioMin": 95,
            "firstSpinBonusRatioMax": 99,
            "freeSpinBonusMin": 10,
            "freeSpinBonusMax": 20,
            "noWinSpinBonusMin": 5,
            "noWinSpinBonusMax": 40,
            "isOpenDiskDisplay": true,
            "diskDisplayModeDetail": "57|67|77|87|97|177|577",
            "state": 1,
            "isScriptControl": true
        };
    }

    try {
        const result = sendRequest(payload, api, createInviteTurntableTag, false, token);

        if (result && result.msgCode === 0) {
            logger.info(`[${createInviteTurntableTag}] ${config.name}配置成功 - ${payload.configName}`);
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '配置失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createInviteTurntableTag}] 配置请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
