import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { createImageUploader, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createRechargeWheelTag = 'createRechargeWheel';

// 在模块顶层创建所有图片上传器
// 金币图案 1-6.png
const uploadCoinImage1 = createImageUploader('../../uploadFile/img/rechargeWheel/1.png', createRechargeWheelTag);
const uploadCoinImage2 = createImageUploader('../../uploadFile/img/rechargeWheel/2.png', createRechargeWheelTag);
const uploadCoinImage3 = createImageUploader('../../uploadFile/img/rechargeWheel/3.png', createRechargeWheelTag);
const uploadCoinImage4 = createImageUploader('../../uploadFile/img/rechargeWheel/4.png', createRechargeWheelTag);
const uploadCoinImage5 = createImageUploader('../../uploadFile/img/rechargeWheel/5.png', createRechargeWheelTag);
const uploadCoinImage6 = createImageUploader('../../uploadFile/img/rechargeWheel/6.png', createRechargeWheelTag);

// 转盘图案 11-14.png
const uploadWheelImage11 = createImageUploader('../../uploadFile/img/rechargeWheel/11.png', createRechargeWheelTag);
const uploadWheelImage12 = createImageUploader('../../uploadFile/img/rechargeWheel/12.png', createRechargeWheelTag);
const uploadWheelImage13 = createImageUploader('../../uploadFile/img/rechargeWheel/13.png', createRechargeWheelTag);
const uploadWheelImage14 = createImageUploader('../../uploadFile/img/rechargeWheel/14.png', createRechargeWheelTag);

/**
 * 创建充值转盘活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createRechargeWheel(data) {
    logger.info(`[${createRechargeWheelTag}] 开始创建充值转盘活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createRechargeWheelTag}] Token 不存在，无法创建充值转盘活动`);
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: 'Token 不存在，跳过充值转盘活动创建'
            };
        }

        // 步骤1：配置充值转盘开关（先关闭再开启）
        logger.info(`[${createRechargeWheelTag}] ========== 步骤1：配置充值转盘开关 ==========`);
        const switchResult = updateRechargeWheelSwitch(data);
        if (!switchResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置充值转盘开关失败: ${switchResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤2：配置首充
        logger.info(`[${createRechargeWheelTag}] ========== 步骤2：配置首充 ==========`);
        const firstRechargeResult = updateFirstRechargeSwitch(data);
        if (!firstRechargeResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置首充失败: ${firstRechargeResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤3：上传所有图片
        logger.info(`[${createRechargeWheelTag}] ========== 步骤3：上传图片 ==========`);
        const uploadResult = uploadAllImages(data);
        if (!uploadResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `上传图片失败: ${uploadResult.message}`
            };
        }

        const imageMap = uploadResult.imageMap;
        logger.info(`[${createRechargeWheelTag}] 所有图片上传完成`);

        // 等待0.5秒
        sleep(0.5);

        // 步骤4：配置普通转盘
        logger.info(`[${createRechargeWheelTag}] ========== 步骤4：配置普通转盘 ==========`);
        const normalWheelResult = configureNormalWheel(data, imageMap);
        if (!normalWheelResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置普通转盘失败: ${normalWheelResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤5：配置黄金转盘
        logger.info(`[${createRechargeWheelTag}] ========== 步骤5：配置黄金转盘 ==========`);
        const goldWheelResult = configureGoldWheel(data, imageMap);
        if (!goldWheelResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置黄金转盘失败: ${goldWheelResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤6：配置钻石转盘
        logger.info(`[${createRechargeWheelTag}] ========== 步骤6：配置钻石转盘 ==========`);
        const diamondWheelResult = configureDiamondWheel(data, imageMap);
        if (!diamondWheelResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置钻石转盘失败: ${diamondWheelResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤7：配置特殊转盘
        logger.info(`[${createRechargeWheelTag}] ========== 步骤7：配置特殊转盘 ==========`);
        const specialWheelResult = configureSpecialWheel(data, imageMap);
        if (!specialWheelResult.success) {
            return {
                success: false,
                tag: createRechargeWheelTag,
                message: `配置特殊转盘失败: ${specialWheelResult.message}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 充值转盘活动创建成功`);
        return {
            success: true,
            tag: createRechargeWheelTag,
            message: '充值转盘活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 创建充值转盘活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRechargeWheelTag,
            message: `创建充值转盘活动失败: ${errorMsg}`
        };
    }
}

/**
 * 更新充值转盘开关（先关闭再开启）
 * @param {*} data
 * @returns {Object} 更新结果 { success, message }
 */
function updateRechargeWheelSwitch(data) {
    const token = data.token;
    const api = '/api/RechargeWheel/UpdateConfig';

    try {
        // 步骤1：关闭充值转盘
        logger.info(`[${createRechargeWheelTag}] 关闭充值转盘开关`);

        const closePayload = {
            "settingKey": "RechargeWheelSwitch",
            "value1": "0"
        };

        const closeResult = sendRequest(closePayload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 关闭响应: ${JSON.stringify(closeResult)}`);

        if (!closeResult || closeResult.msgCode !== 0) {
            logger.error(`[${createRechargeWheelTag}] 关闭充值转盘开关失败: ${closeResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `关闭充值转盘开关失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 充值转盘开关已关闭，等待1秒...`);
        sleep(1);

        // 步骤2：开启充值转盘
        logger.info(`[${createRechargeWheelTag}] 开启充值转盘开关`);

        const openPayload = {
            "settingKey": "RechargeWheelSwitch",
            "value1": "1"
        };

        const openResult = sendRequest(openPayload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 开启响应: ${JSON.stringify(openResult)}`);

        if (!openResult || openResult.msgCode !== 0) {
            logger.error(`[${createRechargeWheelTag}] 开启充值转盘开关失败: ${openResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启充值转盘开关失败: ${openResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 充值转盘开关已开启`);
        return {
            success: true,
            message: '充值转盘开关配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 更新充值转盘开关时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `更新开关失败: ${errorMsg}`
        };
    }
}

/**
 * 更新首充配置
 * @param {*} data
 * @returns {Object} 更新结果 { success, message }
 */
function updateFirstRechargeSwitch(data) {
    const token = data.token;
    const api = '/api/RechargeWheel/UpdateConfig';

    try {
        logger.info(`[${createRechargeWheelTag}] 设置首充配置`);

        const payload = {
            "settingKey": "RechargeWheelNeedFirstRechargeSwitch",
            "value1": "1"
        };

        const result = sendRequest(payload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 首充配置响应: ${JSON.stringify(result)}`);

        if (!result || result.msgCode !== 0) {
            logger.error(`[${createRechargeWheelTag}] 设置首充配置失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `设置首充配置失败: ${result?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 首充配置设置成功`);
        return {
            success: true,
            message: '首充配置设置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 更新首充配置时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `更新首充配置失败: ${errorMsg}`
        };
    }
}



/**
 * 上传所有图片
 * @param {*} data
 * @returns {Object} 上传结果 { success, imageMap, message }
 */
function uploadAllImages(data) {
    const token = data.token;

    try {
        logger.info(`[${createRechargeWheelTag}] 开始上传所有图片`);

        const imageMap = {
            coin: [],  // 金币图案 1-6
            wheel: []  // 转盘图案 11-14
        };

        // 上传金币图案 1-6.png
        const coinUploaders = [
            uploadCoinImage1,
            uploadCoinImage2,
            uploadCoinImage3,
            uploadCoinImage4,
            uploadCoinImage5,
            uploadCoinImage6
        ];

        for (let i = 0; i < coinUploaders.length; i++) {
            logger.info(`[${createRechargeWheelTag}] 上传金币图案 ${i + 1}.png`);
            const result = coinUploaders[i](token);

            if (!result.success) {
                logger.error(`[${createRechargeWheelTag}] 上传金币图案 ${i + 1}.png 失败: ${result.error}`);
                return {
                    success: false,
                    message: `上传金币图案 ${i + 1}.png 失败: ${result.error}`
                };
            }

            imageMap.coin.push(result.file);
            logger.info(`[${createRechargeWheelTag}] 金币图案 ${i + 1}.png 上传成功: ${result.file}`);
            sleep(0.3);
        }

        // 上传转盘图案 11-14.png
        const wheelUploaders = [
            uploadWheelImage11,
            uploadWheelImage12,
            uploadWheelImage13,
            uploadWheelImage14
        ];

        for (let i = 0; i < wheelUploaders.length; i++) {
            logger.info(`[${createRechargeWheelTag}] 上传转盘图案 ${11 + i}.png`);
            const result = wheelUploaders[i](token);

            if (!result.success) {
                logger.error(`[${createRechargeWheelTag}] 上传转盘图案 ${11 + i}.png 失败: ${result.error}`);
                return {
                    success: false,
                    message: `上传转盘图案 ${11 + i}.png 失败: ${result.error}`
                };
            }

            imageMap.wheel.push(result.file);
            logger.info(`[${createRechargeWheelTag}] 转盘图案 ${11 + i}.png 上传成功: ${result.file}`);
            sleep(0.3);
        }

        logger.info(`[${createRechargeWheelTag}] 所有图片上传完成`);
        logger.info(`[${createRechargeWheelTag}] 金币图案: ${imageMap.coin.length} 张`);
        logger.info(`[${createRechargeWheelTag}] 转盘图案: ${imageMap.wheel.length} 张`);

        return {
            success: true,
            imageMap: imageMap,
            message: '所有图片上传成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 上传图片时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `上传图片失败: ${errorMsg}`
        };
    }
}

/**
 * 配置普通转盘
 * @param {*} data
 * @param {Object} imageMap 图片映射
 * @returns {Object} 配置结果 { success, message }
 */
function configureNormalWheel(data, imageMap) {
    const token = data.token;
    const api = '/api/RechargeWheel/Update';

    try {
        logger.info(`[${createRechargeWheelTag}] 配置普通转盘`);

        const payload = {
            "rechargeWheelType": 1,
            "specialWheelUnlockCond": 0,
            "taskConfig": [
                { "id": 2, "rechargeType": 1, "rechargeAmount": 300, "spinCount": 1 },
                { "id": 3, "rechargeType": 2, "rechargeAmount": 500, "spinCount": 1 },
                { "id": 13, "rechargeType": 1, "rechargeAmount": 800, "spinCount": 1 }
            ],
            "rewardConfig": [
                { "id": 4, "rewardType": 1, "rewardAmount": 17, "washCode": 2, "weight": 30, "icon": imageMap.coin[0] },
                { "id": 5, "rewardType": 1, "rewardAmount": 57, "washCode": 2, "weight": 30, "icon": imageMap.coin[1] },
                { "id": 6, "rewardType": 1, "rewardAmount": 77, "washCode": 2, "weight": 20, "icon": imageMap.coin[2] },
                { "id": 7, "rewardType": 1, "rewardAmount": 177, "washCode": 2, "weight": 20, "icon": imageMap.coin[3] },
                { "id": 8, "rewardType": 1, "rewardAmount": 277, "washCode": 2, "weight": 10, "icon": imageMap.coin[4] },
                { "id": 9, "rewardType": 1, "rewardAmount": 377, "washCode": 2, "weight": 10, "icon": imageMap.coin[5] },
                { "id": 11, "rewardType": 3, "rewardAmount": 1, "washCode": 1, "weight": 10, "icon": imageMap.wheel[1] },  // rewardType=3 -> 12.png (wheel[1])
                { "id": 12, "rewardType": 2, "rewardAmount": 1, "washCode": 1, "weight": 20, "icon": imageMap.wheel[0] }   // rewardType=2 -> 11.png (wheel[0])
            ]
        };

        const result = sendRequest(payload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 普通转盘配置响应: ${JSON.stringify(result)}`);

        // 检查返回结果 - 响应可能是布尔值 true 或对象 {msgCode: 0}
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (!isSuccess) {
            logger.error(`[${createRechargeWheelTag}] 配置普通转盘失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `配置普通转盘失败: ${result?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 普通转盘配置成功`);
        return {
            success: true,
            message: '普通转盘配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 配置普通转盘时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置普通转盘失败: ${errorMsg}`
        };
    }
}

/**
 * 配置黄金转盘
 * @param {*} data
 * @param {Object} imageMap 图片映射
 * @returns {Object} 配置结果 { success, message }
 */
function configureGoldWheel(data, imageMap) {
    const token = data.token;
    const api = '/api/RechargeWheel/Update';

    try {
        logger.info(`[${createRechargeWheelTag}] 配置黄金转盘`);

        const payload = {
            "rechargeWheelType": 2,
            "specialWheelUnlockCond": 0,
            "taskConfig": [
                { "id": 2, "rechargeType": 1, "rechargeAmount": 600, "spinCount": 1 },
                { "id": 3, "rechargeType": 2, "rechargeAmount": 1200, "spinCount": 1 }
            ],
            "rewardConfig": [
                { "id": 4, "rewardType": 1, "rewardAmount": 77, "washCode": 2, "weight": 30, "icon": imageMap.coin[0] },
                { "id": 5, "rewardType": 1, "rewardAmount": 177, "washCode": 2, "weight": 30, "icon": imageMap.coin[1] },
                { "id": 6, "rewardType": 1, "rewardAmount": 277, "washCode": 2, "weight": 30, "icon": imageMap.coin[2] },
                { "id": 7, "rewardType": 1, "rewardAmount": 377, "washCode": 2, "weight": 20, "icon": imageMap.coin[3] },
                { "id": 8, "rewardType": 1, "rewardAmount": 577, "washCode": 2, "weight": 20, "icon": imageMap.coin[4] },
                { "id": 9, "rewardType": 1, "rewardAmount": 777, "washCode": 2, "weight": 10, "icon": imageMap.coin[5] },
                { "id": 10, "rewardType": 3, "rewardAmount": 1, "washCode": 1, "weight": 20, "icon": imageMap.wheel[1] },  // rewardType=3 -> 12.png (wheel[1])
                { "id": 11, "rewardType": 4, "rewardAmount": 1, "washCode": 1, "weight": 20, "icon": imageMap.wheel[2] }   // rewardType=4 -> 13.png (wheel[2])
            ]
        };

        const result = sendRequest(payload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 黄金转盘配置响应: ${JSON.stringify(result)}`);

        // 检查返回结果 - 响应可能是布尔值 true 或对象 {msgCode: 0}
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (!isSuccess) {
            logger.error(`[${createRechargeWheelTag}] 配置黄金转盘失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `配置黄金转盘失败: ${result?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 黄金转盘配置成功`);
        return {
            success: true,
            message: '黄金转盘配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 配置黄金转盘时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置黄金转盘失败: ${errorMsg}`
        };
    }
}

/**
 * 配置钻石转盘
 * @param {*} data
 * @param {Object} imageMap 图片映射
 * @returns {Object} 配置结果 { success, message }
 */
function configureDiamondWheel(data, imageMap) {
    const token = data.token;
    const api = '/api/RechargeWheel/Update';

    try {
        logger.info(`[${createRechargeWheelTag}] 配置钻石转盘`);

        const payload = {
            "rechargeWheelType": 3,
            "specialWheelUnlockCond": 0,
            "taskConfig": [
                { "id": 2, "rechargeType": 1, "rechargeAmount": 800, "spinCount": 1 },
                { "id": 3, "rechargeType": 1, "rechargeAmount": 1500, "spinCount": 1 },
                { "id": 4, "rechargeType": 2, "rechargeAmount": 2000, "spinCount": 1 }
            ],
            "rewardConfig": [
                { "id": 5, "rewardType": 1, "rewardAmount": 177, "washCode": 2, "weight": 30, "icon": imageMap.coin[0] },
                { "id": 6, "rewardType": 1, "rewardAmount": 277, "washCode": 2, "weight": 30, "icon": imageMap.coin[1] },
                { "id": 7, "rewardType": 1, "rewardAmount": 377, "washCode": 2, "weight": 30, "icon": imageMap.coin[2] },
                { "id": 8, "rewardType": 4, "rewardAmount": 1, "washCode": 1, "weight": 20, "icon": imageMap.wheel[2] },   // rewardType=4 -> 13.png (wheel[2])
                { "id": 9, "rewardType": 1, "rewardAmount": 577, "washCode": 2, "weight": 20, "icon": imageMap.coin[3] },
                { "id": 10, "rewardType": 1, "rewardAmount": 777, "washCode": 2, "weight": 20, "icon": imageMap.coin[4] },
                { "id": 11, "rewardType": 1, "rewardAmount": 1777, "washCode": 2, "weight": 20, "icon": imageMap.coin[5] },
                { "id": 12, "rewardType": 4, "rewardAmount": 2, "washCode": 1, "weight": 10, "icon": imageMap.wheel[2] }   // rewardType=4 -> 13.png (wheel[2])
            ]
        };

        const result = sendRequest(payload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 钻石转盘配置响应: ${JSON.stringify(result)}`);

        // 检查返回结果 - 响应可能是布尔值 true 或对象 {msgCode: 0}
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (!isSuccess) {
            logger.error(`[${createRechargeWheelTag}] 配置钻石转盘失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `配置钻石转盘失败: ${result?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 钻石转盘配置成功`);
        return {
            success: true,
            message: '钻石转盘配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 配置钻石转盘时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置钻石转盘失败: ${errorMsg}`
        };
    }
}

/**
 * 配置特殊转盘
 * @param {*} data
 * @param {Object} imageMap 图片映射
 * @returns {Object} 配置结果 { success, message }
 */
function configureSpecialWheel(data, imageMap) {
    const token = data.token;
    const api = '/api/RechargeWheel/Update';

    try {
        logger.info(`[${createRechargeWheelTag}] 配置特殊转盘`);

        const payload = {
            "rechargeWheelType": 4,
            "specialWheelUnlockCond": 3777,
            "taskConfig": [
                { "id": 2, "rechargeType": 1, "rechargeAmount": 800, "spinCount": 1 },
                { "id": 3, "rechargeType": 1, "rechargeAmount": 15000, "spinCount": 1 },
                { "id": 4, "rechargeType": 1, "rechargeAmount": 2000, "spinCount": 1 },
                { "id": 5, "rechargeType": 2, "rechargeAmount": 4000, "spinCount": 1 }
            ],
            "rewardConfig": [
                { "id": 6, "rewardType": 1, "rewardAmount": 277, "washCode": 2, "weight": 30, "icon": imageMap.coin[0] },
                { "id": 7, "rewardType": 3, "rewardAmount": 2, "washCode": 1, "weight": 30, "icon": imageMap.wheel[1] },   // rewardType=3 -> 12.png (wheel[1])
                { "id": 8, "rewardType": 1, "rewardAmount": 577, "washCode": 2, "weight": 30, "icon": imageMap.coin[1] },
                { "id": 9, "rewardType": 3, "rewardAmount": 4, "washCode": 1, "weight": 30, "icon": imageMap.wheel[1] },   // rewardType=3 -> 12.png (wheel[1])
                { "id": 10, "rewardType": 1, "rewardAmount": 1777, "washCode": 2, "weight": 20, "icon": imageMap.coin[2] },
                { "id": 11, "rewardType": 4, "rewardAmount": 2, "washCode": 1, "weight": 20, "icon": imageMap.wheel[2] },  // rewardType=4 -> 13.png (wheel[2])
                { "id": 12, "rewardType": 1, "rewardAmount": 2777, "washCode": 2, "weight": 20, "icon": imageMap.coin[3] },
                { "id": 13, "rewardType": 5, "rewardAmount": 1, "washCode": 1, "weight": 10, "icon": imageMap.wheel[3] }   // rewardType=5 -> 14.png (wheel[3])
            ]
        };

        const result = sendRequest(payload, api, createRechargeWheelTag, false, token);

        logger.info(`[${createRechargeWheelTag}] 特殊转盘配置响应: ${JSON.stringify(result)}`);

        // 检查返回结果 - 响应可能是布尔值 true 或对象 {msgCode: 0}
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (!isSuccess) {
            logger.error(`[${createRechargeWheelTag}] 配置特殊转盘失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `配置特殊转盘失败: ${result?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeWheelTag}] 特殊转盘配置成功`);
        return {
            success: true,
            message: '特殊转盘配置成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeWheelTag}] 配置特殊转盘时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `配置特殊转盘失败: ${errorMsg}`
        };
    }
}
