import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createGiftCodesTag = 'createGiftCodes';

/**
 * 生成随机大写字母和数字组合
 * @param {number} length 长度
 * @returns {string} 随机字符串
 */
function generateRandomCode(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * 获取过期时间（今天+3天的23:59:59）
 * @returns {number} 时间戳（毫秒）
 */
function getExpiredTime() {
    const now = new Date();
    const expiredDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59, 999);
    return expiredDate.getTime();
}

/**
 * 创建礼品码活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createGiftCodes(data) {
    logger.info(`[${createGiftCodesTag}] 开始创建礼品码活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createGiftCodesTag}] Token 不存在，无法创建礼品码活动`);
            return {
                success: false,
                tag: createGiftCodesTag,
                message: 'Token 不存在，跳过礼品码活动创建'
            };
        }

        const expiredTime = getExpiredTime();
        const timestamp = Date.now();

        logger.info(`[${createGiftCodesTag}] 过期时间设置为: ${new Date(expiredTime).toLocaleString('zh-CN')}`);

        // 创建两种类型的礼品码
        const giftCodes = [
            {
                name: '普通礼品码',
                type: 1,  // 1: 普通礼品码
                config: {
                    codePrefix: generateRandomCode(6),  // 6位随机码
                    quantity: 2,
                    onlyCode: null
                }
            },
            {
                name: '唯一礼品码',
                type: 2,  // 2: 唯一礼品码
                config: {
                    codePrefix: null,
                    quantity: 1,
                    onlyCode: generateRandomCode(8)  // 6-10位随机码，这里用8位
                }
            }
        ];

        let successCount = 0;
        let failedCodes = [];

        // 循环创建每种礼品码
        for (const giftCode of giftCodes) {
            sleep(1);
            const createResult = createGiftCodeActivity(data, giftCode, expiredTime);

            if (createResult.success) {
                successCount++;
                logger.info(`[${createGiftCodesTag}] ${giftCode.name} 创建成功`);
                sleep(0.5);
            } else {
                failedCodes.push(giftCode.name);
                logger.error(`[${createGiftCodesTag}] ${giftCode.name} 创建失败: ${createResult.message}`);
            }
        }

        if (successCount === giftCodes.length) {
            logger.info(`[${createGiftCodesTag}] 所有礼品码创建成功 (${successCount}/${giftCodes.length})`);
            return {
                success: true,
                tag: createGiftCodesTag,
                message: `礼品码活动创建成功，共创建 ${successCount} 种礼品码`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createGiftCodesTag}] 部分礼品码创建成功 (${successCount}/${giftCodes.length})`);
            return {
                success: true,
                tag: createGiftCodesTag,
                message: `部分礼品码创建成功 (${successCount}/${giftCodes.length})，失败: ${failedCodes.join(', ')}`
            };
        } else {
            logger.error(`[${createGiftCodesTag}] 所有礼品码创建失败`);
            return {
                success: false,
                tag: createGiftCodesTag,
                message: '所有礼品码创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createGiftCodesTag}] 创建礼品码活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createGiftCodesTag,
            message: `创建礼品码活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建礼品码活动
 * @param {*} data
 * @param {Object} giftCode 礼品码配置
 * @param {number} expiredTime 过期时间
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createGiftCodeActivity(data, giftCode, expiredTime) {
    const token = data.token;
    const api = '/api/GiftCode/CreateGiftCodes';

    // 根据礼品码类型构建不同的 payload
    const isUnique = giftCode.type === 2;

    const payload = isUnique ? {
        // 唯一礼品码配置
        "codeType": 2,
        "codePrefix": null,
        "quantity": 1,
        "expiredTime": expiredTime,
        "bindMobile": true,
        "bindWithdrawInfo": true,
        "amountType": 1,  // 1: 固定金额
        "fixedAmount": 200,
        "perCodeLimit": 2,
        "perUserLimit": 1,
        "rechargeStatRange": 1,
        "minRechargeAmount": 1000,
        "totalAmount": 1000,
        "amountCode": 2,
        "userLimit": 3,
        "limitGroups": "1,2,3,4,5,6,7,8,9,10,11,12",
        "onlyCode": giftCode.config.onlyCode
    } : {
        // 普通礼品码配置
        "codeType": 1,
        "codePrefix": giftCode.config.codePrefix,
        "quantity": 2,
        "expiredTime": expiredTime,
        "bindMobile": true,
        "bindWithdrawInfo": false,
        "amountType": 2,  // 2: 随机金额
        "fixedAmount": null,
        "perCodeLimit": 2,
        "perUserLimit": 2,
        "rechargeStatRange": 1,
        "minRechargeAmount": 100,
        "totalAmount": 2000,
        "amountCode": 2,
        "userLimit": 0,
        "limitGroups": "",
        "minAmount": 100,
        "maxAmount": 200
    };

    try {
        const result = sendRequest(payload, api, createGiftCodesTag, false, token);

        if (result && result.msgCode === 0) {
            const codeInfo = isUnique
                ? `唯一码: ${giftCode.config.onlyCode}`
                : `前缀: ${giftCode.config.codePrefix}, 数量: ${giftCode.config.quantity}`;
            logger.info(`[${createGiftCodesTag}] ${giftCode.name}创建成功 - ${codeInfo}`);
            return { success: true };
        } else {
            return {
                success: false,
                errorCode: result?.msgCode,
                message: result?.msg || '创建失败'
            };
        }
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createGiftCodesTag}] 创建礼品码请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}

