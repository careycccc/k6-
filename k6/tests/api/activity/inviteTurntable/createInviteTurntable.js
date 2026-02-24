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

        // 检查并配置邀请转盘设置
        const settingResult = checkAndConfigureInviteTurntableSettings(data);
        if (!settingResult.success) {
            return {
                success: false,
                tag: createInviteTurntableTag,
                message: `配置邀请转盘设置失败: ${settingResult.message}`
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
        } else if (result && result.msgCode === 6040) {
            // 错误码 6040：优先级重复，说明配置已存在
            logger.info(`[${createInviteTurntableTag}] ${config.name}配置已存在，跳过 - ${payload.configName}`);
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

/**
 * 检查并配置邀请转盘设置
 * @param {*} data
 * @returns {Object} 配置结果 { success, message }
 */
function checkAndConfigureInviteTurntableSettings(data) {
    const token = data.token;
    const getSettingApi = '/api/InvitedWheel/GetConfig';
    const updateSettingApi = '/api/InvitedWheel/UpdateConfig';

    try {
        // 1. 获取当前配置
        logger.info(`[${createInviteTurntableTag}] 获取邀请转盘配置`);
        const settingsResult = sendRequest({}, getSettingApi, createInviteTurntableTag, false, token);

        //logger.info(`[${createInviteTurntableTag}] 配置响应: ${JSON.stringify(settingsResult)}`);

        // 检查响应是否有效
        if (!settingsResult) {
            logger.error(`[${createInviteTurntableTag}] 获取配置失败: 响应为空`);
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
                logger.error(`[${createInviteTurntableTag}] 获取配置失败: msgCode=${settingsResult.msgCode}, msg=${settingsResult.msg}`);
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
            logger.error(`[${createInviteTurntableTag}] 配置数据为空`);
            return {
                success: false,
                message: '配置数据为空'
            };
        }

        // 2. 检查并启用邀请转盘活动开关
        const isOpenInvitedWheel = settings.isOpenInvitedWheel;
        if (isOpenInvitedWheel && isOpenInvitedWheel.value1 !== "1") {
            logger.info(`[${createInviteTurntableTag}] 邀请转盘活动未启用，正在启用...`);
            const enablePayload = {
                "settingKey": "IsOpenInvitedWheel",
                "value1": "1"
            };
            const enableResult = sendRequest(enablePayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!enableResult || (enableResult.msgCode !== undefined && enableResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `启用邀请转盘活动失败: ${enableResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 邀请转盘活动已启用`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 邀请转盘活动已启用，跳过`);
        }

        // 3. 检查并设置是否提现到主钱包
        const isInvitedWheelCashToMainWallet = settings.isInvitedWheelCashToMainWallet;
        if (isInvitedWheelCashToMainWallet && isInvitedWheelCashToMainWallet.value1 !== "0") {
            logger.info(`[${createInviteTurntableTag}] 提现到主钱包设置不正确，正在设置为0...`);
            const cashPayload = {
                "settingKey": "IsInvitedWheelCashToMainWallet",
                "value1": "0"
            };
            const cashResult = sendRequest(cashPayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!cashResult || (cashResult.msgCode !== undefined && cashResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `设置提现到主钱包失败: ${cashResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 提现到主钱包已设置为0`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 提现到主钱包已正确设置(${isInvitedWheelCashToMainWallet?.value1 || '未知'})，跳过`);
        }

        // 4. 检查并设置提现到主钱包打码量倍数
        const invitedWheelWithdrawCashCodeWash = settings.invitedWheelWithdrawCashCodeWash;
        if (invitedWheelWithdrawCashCodeWash && invitedWheelWithdrawCashCodeWash.value1 === "0") {
            logger.info(`[${createInviteTurntableTag}] 提现打码量倍数未设置，正在设置为4...`);
            const codeWashPayload = {
                "settingKey": "InvitedWheelWithdrawCashCodeWash",
                "value1": "4"
            };
            const codeWashResult = sendRequest(codeWashPayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!codeWashResult || (codeWashResult.msgCode !== undefined && codeWashResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `设置提现打码量倍数失败: ${codeWashResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 提现打码量倍数已设置为4`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 提现打码量倍数已设置(${invitedWheelWithdrawCashCodeWash?.value1 || '未知'})，跳过`);
        }

        // 5. 检查并设置周期时间
        const invitedWheelCycleTime = settings.invitedWheelCycleTime;
        if (invitedWheelCycleTime && invitedWheelCycleTime.value1 === "0") {
            logger.info(`[${createInviteTurntableTag}] 周期时间未设置，正在设置为72...`);
            const cyclePayload = {
                "settingKey": "InvitedWheelCycleTime",
                "value1": "72"
            };
            const cycleResult = sendRequest(cyclePayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!cycleResult || (cycleResult.msgCode !== undefined && cycleResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `设置周期时间失败: ${cycleResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 周期时间已设置为72`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 周期时间已设置(${invitedWheelCycleTime?.value1 || '未知'})，跳过`);
        }

        // 6. 检查并启用邀请次数是否自动旋转
        const inviteAutoRotate = settings.inviteAutoRotate;
        if (inviteAutoRotate && inviteAutoRotate.value1 !== "1") {
            logger.info(`[${createInviteTurntableTag}] 邀请自动旋转未启用，正在启用...`);
            const autoRotatePayload = {
                "settingKey": "InviteAutoRotate",
                "value1": "1"
            };
            const autoRotateResult = sendRequest(autoRotatePayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!autoRotateResult || (autoRotateResult.msgCode !== undefined && autoRotateResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `启用邀请自动旋转失败: ${autoRotateResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 邀请自动旋转已启用`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 邀请自动旋转已启用，跳过`);
        }

        // 7. 检查并设置首次邀请中奖生效系数
        const firstInvitedSpinWinProbabilityRate = settings.firstInvitedSpinWinProbabilityRate;
        if (firstInvitedSpinWinProbabilityRate && firstInvitedSpinWinProbabilityRate.value1 === "0") {
            logger.info(`[${createInviteTurntableTag}] 首次邀请中奖生效系数未设置，正在设置为30...`);
            const probabilityPayload = {
                "settingKey": "FirstInvitedSpinWinProbabilityRate",
                "value1": "30"
            };
            const probabilityResult = sendRequest(probabilityPayload, updateSettingApi, createInviteTurntableTag, false, token);

            if (!probabilityResult || (probabilityResult.msgCode !== undefined && probabilityResult.msgCode !== 0)) {
                return {
                    success: false,
                    message: `设置首次邀请中奖生效系数失败: ${probabilityResult?.msg || '未知错误'}`
                };
            }
            logger.info(`[${createInviteTurntableTag}] 首次邀请中奖生效系数已设置为30`);
            sleep(0.3);
        } else {
            logger.info(`[${createInviteTurntableTag}] 首次邀请中奖生效系数已设置(${firstInvitedSpinWinProbabilityRate?.value1 || '未知'})，跳过`);
        }

        return { success: true };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createInviteTurntableTag}] 配置邀请转盘设置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置失败: ${errorMsg}`
        };
    }
}
