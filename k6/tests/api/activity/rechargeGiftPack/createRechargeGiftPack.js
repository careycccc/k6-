import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createRechargeGiftPackTag = 'createRechargeGiftPack';

// 在模块顶层创建图片上传器
const uploadRechargeGiftPackImage = createImageUploader('../../uploadFile/img/rechargegiftpack/1.png', createRechargeGiftPackTag);

/**
 * 创建充值礼包活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createRechargeGiftPack(data) {
    logger.info(`[${createRechargeGiftPackTag}] 开始创建充值礼包活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createRechargeGiftPackTag}] Token 不存在，无法创建充值礼包活动`);
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: 'Token 不存在，跳过充值礼包活动创建'
            };
        }

        // 步骤1：处理图片上传
        logger.info(`[${createRechargeGiftPackTag}] ========== 步骤1：上传图片 ==========`);
        const imageResult = handleImageUpload(data, 'rechargeGiftPackImagePath', uploadRechargeGiftPackImage, createRechargeGiftPackTag);

        if (!imageResult.success) {
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: `图片上传失败: ${imageResult.error}`
            };
        }

        const imagePath = imageResult.imagePath;
        logger.info(`[${createRechargeGiftPackTag}] 图片路径: ${imagePath}`);

        // 等待0.5秒
        sleep(0.5);

        // 步骤2：创建充值礼包
        logger.info(`[${createRechargeGiftPackTag}] ========== 步骤2：创建充值礼包 ==========`);
        const createResult = createRechargeGiftPackActivity(data, imagePath);

        if (!createResult.success) {
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: `创建充值礼包失败: ${createResult.message}`
            };
        }

        logger.info(`[${createRechargeGiftPackTag}] 充值礼包创建成功`);

        // 等待0.5秒
        sleep(0.5);

        // 步骤3：查询充值礼包列表并获取ID
        logger.info(`[${createRechargeGiftPackTag}] ========== 步骤3：查询充值礼包列表 ==========`);
        const queryResult = queryRechargeGiftPackList(data, createResult.notificationText);

        if (!queryResult.success) {
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: `查询充值礼包列表失败: ${queryResult.message}`
            };
        }

        const giftPackId = queryResult.id;
        logger.info(`[${createRechargeGiftPackTag}] 获取到充值礼包ID: ${giftPackId}`);

        // 等待0.5秒
        sleep(0.5);

        // 步骤4：开启充值礼包（先关闭，等待1秒，再开启）
        logger.info(`[${createRechargeGiftPackTag}] ========== 步骤4：开启充值礼包 ==========`);
        const stateResult = updateRechargeGiftPackState(data, giftPackId);

        if (!stateResult.success) {
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: `开启充值礼包失败: ${stateResult.message}`
            };
        }

        // 等待0.5秒
        sleep(0.5);

        // 步骤5：创建惊喜礼包活动
        logger.info(`[${createRechargeGiftPackTag}] ========== 步骤5：创建惊喜礼包活动 ==========`);
        const activityResult = createActivityRecharge(data, imagePath, giftPackId);

        if (!activityResult.success) {
            return {
                success: false,
                tag: createRechargeGiftPackTag,
                message: `创建惊喜礼包活动失败: ${activityResult.message}`
            };
        }

        logger.info(`[${createRechargeGiftPackTag}] 充值礼包活动创建成功`);
        return {
            success: true,
            tag: createRechargeGiftPackTag,
            message: '充值礼包活动创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeGiftPackTag}] 创建充值礼包活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRechargeGiftPackTag,
            message: `创建充值礼包活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建充值礼包活动
 * @param {*} data
 * @param {string} imagePath 图片路径
 * @returns {Object} 创建结果 { success, message }
 */
function createRechargeGiftPackActivity(data, imagePath) {
    const token = data.token;
    const api = '/api/RechargeGiftPack/AddRechargeGiftPack';

    try {
        // 生成时间戳
        const timestamp = Date.now();
        const title = `充值1000送222_${timestamp}`;

        // 构建充值礼包的payload
        const payload = {
            "title": title,
            "imgUrl": imagePath,
            "rechargeAmount": 1000,
            "rechargeMultiplier": 2,
            "bonusAmount": 222,
            "bonusMultiplier": 3,
            "translateList": [
                {
                    "language": "hi",
                    "notificationText": title
                },
                {
                    "language": "en",
                    "notificationText": title
                },
                {
                    "language": "zh",
                    "notificationText": title
                }
            ]
        };

        //logger.info(`[${createRechargeGiftPackTag}] 创建充值礼包payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createRechargeGiftPackTag, false, token);

        logger.info(`[${createRechargeGiftPackTag}] 创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createRechargeGiftPackTag}] 充值礼包创建成功`);
            return {
                success: true,
                notificationText: title
            };
        } else {
            logger.error(`[${createRechargeGiftPackTag}] 充值礼包创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeGiftPackTag}] 创建充值礼包请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}


/**
 * 查询充值礼包列表并获取ID
 * @param {*} data
 * @param {string} notificationText 创建时使用的通知文本
 * @returns {Object} 查询结果 { success, id, message }
 */
function queryRechargeGiftPackList(data, notificationText) {
    const token = data.token;
    const api = '/api/RechargeGiftPack/GetRechargeGiftPackPageList';

    try {
        logger.info(`[${createRechargeGiftPackTag}] 查询充值礼包列表`);

        const payload = {};

        const result = sendQueryRequest(payload, api, createRechargeGiftPackTag, false, token);

        if (!result) {
            logger.error(`[${createRechargeGiftPackTag}] 查询充值礼包列表失败: 响应为空`);
            return {
                success: false,
                message: '查询充值礼包列表失败: 响应为空'
            };
        }

        //logger.info(`[${createRechargeGiftPackTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let giftPackList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createRechargeGiftPackTag}] 查询充值礼包列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询充值礼包列表失败: ${result.msg || '未知错误'}`
                };
            }
            // 从 data.list 中获取列表
            giftPackList = result.data?.list || result.list || [];
        } else {
            giftPackList = result.list || [];
        }

        if (!giftPackList || !Array.isArray(giftPackList) || giftPackList.length === 0) {
            logger.error(`[${createRechargeGiftPackTag}] 充值礼包列表为空，无法继续操作`);
            return {
                success: false,
                message: '充值礼包列表为空'
            };
        }

        logger.info(`[${createRechargeGiftPackTag}] 查询到 ${giftPackList.length} 个充值礼包`);

        // 查找title等于notificationText的礼包
        let targetGiftPack = null;
        for (const giftPack of giftPackList) {
            if (giftPack.title === notificationText) {
                targetGiftPack = giftPack;
                logger.info(`[${createRechargeGiftPackTag}] 找到匹配的充值礼包: title="${giftPack.title}", id=${giftPack.id}`);
                break;
            }
        }

        // 如果没有找到匹配的，使用第一项
        if (!targetGiftPack) {
            targetGiftPack = giftPackList[0];
            logger.info(`[${createRechargeGiftPackTag}] 未找到匹配的充值礼包，使用第一项: title="${targetGiftPack.title}", id=${targetGiftPack.id}`);
        }

        return {
            success: true,
            id: targetGiftPack.id,
            message: `成功获取充值礼包ID: ${targetGiftPack.id}`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeGiftPackTag}] 查询充值礼包列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 更新充值礼包状态（先关闭，等待1秒，再开启）
 * @param {*} data
 * @param {number} giftPackId 充值礼包ID
 * @returns {Object} 更新结果 { success, message }
 */
function updateRechargeGiftPackState(data, giftPackId) {
    const token = data.token;
    const api = '/api/RechargeGiftPack/UpdateRechargeGiftPackState';

    try {
        // 步骤1：关闭充值礼包
        logger.info(`[${createRechargeGiftPackTag}] 关闭充值礼包 (ID: ${giftPackId})`);

        const closePayload = {
            "id": giftPackId,
            "state": 0
        };

        const closeResult = sendRequest(closePayload, api, createRechargeGiftPackTag, false, token);

        logger.info(`[${createRechargeGiftPackTag}] 关闭响应: ${JSON.stringify(closeResult)}`);

        if (!closeResult || closeResult.msgCode !== 0) {
            logger.error(`[${createRechargeGiftPackTag}] 关闭充值礼包失败: ${closeResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `关闭充值礼包失败: ${closeResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeGiftPackTag}] 充值礼包已关闭，等待1秒...`);
        sleep(1);

        // 步骤2：开启充值礼包
        logger.info(`[${createRechargeGiftPackTag}] 开启充值礼包 (ID: ${giftPackId})`);

        const openPayload = {
            "id": giftPackId,
            "state": 1
        };

        const openResult = sendRequest(openPayload, api, createRechargeGiftPackTag, false, token);

        logger.info(`[${createRechargeGiftPackTag}] 开启响应: ${JSON.stringify(openResult)}`);

        if (!openResult || openResult.msgCode !== 0) {
            logger.error(`[${createRechargeGiftPackTag}] 开启充值礼包失败: ${openResult?.msg || '未知错误'}`);
            return {
                success: false,
                message: `开启充值礼包失败: ${openResult?.msg || '未知错误'}`
            };
        }

        logger.info(`[${createRechargeGiftPackTag}] 充值礼包已开启`);
        return {
            success: true,
            message: '充值礼包状态更新成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeGiftPackTag}] 更新充值礼包状态时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `更新状态失败: ${errorMsg}`
        };
    }
}


/**
 * 创建惊喜礼包活动
 * @param {*} data
 * @param {string} imagePath 图片路径
 * @param {number} giftPackId 充值礼包ID
 * @returns {Object} 创建结果 { success, message }
 */
function createActivityRecharge(data, imagePath, giftPackId) {
    const token = data.token;
    const api = '/api/RechargeGiftPack/AddActivityRecharge';

    try {
        // 获取组合标签ID
        const compositeTagIdMap = data.compositeTagIdMap;
        const targetTagName = "重提差在100-1000或注册天数已经有2天以上的或者提现超过1000的会员";

        // 调试日志：检查 data 对象中的标签数据
        logger.info(`[${createRechargeGiftPackTag}] 检查标签数据:`);
        logger.info(`[${createRechargeGiftPackTag}] - compositeTagIdMap 存在: ${!!compositeTagIdMap}`);
        if (compositeTagIdMap) {
            logger.info(`[${createRechargeGiftPackTag}] - compositeTagIdMap 键数量: ${Object.keys(compositeTagIdMap).length}`);
            //logger.info(`[${createRechargeGiftPackTag}] - compositeTagIdMap 键列表: ${Object.keys(compositeTagIdMap).join(', ')}`);
        }

        if (!compositeTagIdMap || !compositeTagIdMap[targetTagName]) {
            logger.error(`[${createRechargeGiftPackTag}] 未找到组合标签: ${targetTagName}`);
            logger.error(`[${createRechargeGiftPackTag}] 可用的组合标签: ${compositeTagIdMap ? Object.keys(compositeTagIdMap).join(', ') : '无'}`);
            logger.error(`[${createRechargeGiftPackTag}] 提示: 请确保标签创建活动（priority: 0）已经成功执行`);
            return {
                success: false,
                message: `未找到组合标签: ${targetTagName}。请确保标签创建活动已成功执行。`
            };
        }

        const targetTagId = compositeTagIdMap[targetTagName];
        logger.info(`[${createRechargeGiftPackTag}] 使用组合标签ID: ${targetTagId} (${targetTagName})`);

        // 生成时间戳
        const timestamp = Date.now();
        const activityName = `惊喜礼包${timestamp}`;

        logger.info(`[${createRechargeGiftPackTag}] 创建惊喜礼包活动: ${activityName}`);

        // 构建惊喜礼包活动的payload
        const payload = {
            "activityName": activityName,
            "activityType": 1,
            "state": 1,
            "buyMode": 0,
            "isDisplayActivityImage": true,
            "validTime": 30,
            "targetUserType": 0,
            "rechargeGiftPackCondition": [
                {
                    "index": 1,
                    "minLossAmount": 100,
                    "maxBalance": 10000,
                    "repeatCooldownTime": 5
                }
            ],
            "rechargeGiftPackReward": [
                {
                    "vipLevel": -1,
                    "rechargeGiftPackId": giftPackId,
                    "limitCount": 1,
                    "priority": 10
                }
            ],
            "targetDetail": String(targetTagId),
            "translateList": [
                {
                    "language": "hi",
                    "imageUrl": imagePath
                },
                {
                    "language": "en",
                    "imageUrl": imagePath
                },
                {
                    "language": "zh",
                    "imageUrl": imagePath
                }
            ]
        };

        //logger.info(`[${createRechargeGiftPackTag}] 惊喜礼包活动payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createRechargeGiftPackTag, false, token);

        //logger.info(`[${createRechargeGiftPackTag}] 惊喜礼包活动创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createRechargeGiftPackTag}] 惊喜礼包活动创建成功`);
            return { success: true };
        } else {
            logger.error(`[${createRechargeGiftPackTag}] 惊喜礼包活动创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRechargeGiftPackTag}] 创建惊喜礼包活动请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
