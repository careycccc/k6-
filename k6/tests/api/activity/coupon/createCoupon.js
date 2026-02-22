import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { sleep } from 'k6';

export const createCouponTag = 'createCoupon';

// 用于收集优惠券ID
export const couponIds = [];

/**
 * 创建优惠券活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createCoupon(data) {
    logger.info(`[${createCouponTag}] 开始创建优惠券活动`);

    try {
        // 必须接收 data 参数来拿 token
        const token = data.token;

        if (!token) {
            logger.error(`[${createCouponTag}] Token 不存在，无法创建优惠券`);
            return {
                success: false,
                tag: createCouponTag,
                message: 'Token 不存在，跳过优惠券活动创建'
            };
        }

        // 第一步：创建优惠券
        const createResult = createCoupons(data);
        if (!createResult) {
            logger.error(`[${createCouponTag}] 优惠券创建失败`);
            return {
                success: false,
                tag: createCouponTag,
                message: '优惠券创建失败，跳过活动'
            };
        }

        // 第二步：启用优惠券
        const startResult = startCoupons(data);
        if (!startResult) {
            logger.error(`[${createCouponTag}] 优惠券启用失败`);
            return {
                success: false,
                tag: createCouponTag,
                message: '优惠券启用失败，跳过活动'
            };
        }

        logger.info(`[${createCouponTag}] 优惠券活动创建并启用成功，共创建 ${couponIds.length} 个优惠券`);

        return {
            success: true,
            tag: createCouponTag,
            message: `优惠券活动创建成功，共创建 ${couponIds.length} 个优惠券`,
            couponIds: [...couponIds]
        };

    } catch (error) {
        logger.error(`[${createCouponTag}] 创建优惠券活动时发生错误: ${error.message}`);
        return {
            success: false,
            tag: createCouponTag,
            message: `创建优惠券活动失败: ${error.message}`
        };
    }
}

/**
 * 创建优惠券
 * @param {*} data 
 * @returns {boolean} 创建是否成功
 */
function createCoupons(data) {
    const api = '/api/Coupon/Add';
    const token = data.token;

    const couponList = [
        ['充值奖励优惠券011', 1, 0, '1'],
        ['奖励优惠券011', 2, 1, '1,2']
    ];

    let allSuccess = true;

    couponList.forEach(([couponName, couponType, rechargeCount, useConditionType]) => {
        const payload = {
            backstageDisplayName: couponName,
            translations: [
                { language: 'hi', name: couponName, description: couponName },
                { language: 'en', name: couponName, description: couponName },
                { language: 'zh', name: couponName, description: couponName }
            ],
            couponType,
            rewardConfig: {
                isFixedAmount: true,
                amountOrRatio: 100,
                amountLimit: 0,
                amountCodingMultiple: 2,
                spinType: null,
                freeSpinCount: 0,
                giftCouponIds: []
            },
            rechargeAmount: 100,
            rechargeCount,
            validBetAmount: 0,
            validBetConfig: null,
            validDays: 7,
            useConditionType,
            giftSelfLoop: false
        };

        try {
            const result = sendRequest(payload, api, createCouponTag, false, token);
            if (!result) {
                logger.error(`[${createCouponTag}] 创建优惠券失败: ${couponName}`);
                allSuccess = false;
            } else {
                logger.info(`[${createCouponTag}] 创建优惠券成功: ${couponName}`);
            }
        } catch (error) {
            logger.error(`[${createCouponTag}] 创建优惠券异常: ${couponName}, 错误: ${error.message}`);
            allSuccess = false;
        }
    });

    return allSuccess;
}

/**
 * 查询优惠券ID列表（不启用）
 * @param {*} data 
 * @returns {Array} 优惠券ID列表
 */
export function queryCouponIds(data) {
    const token = data.token;

    // 优惠券的查询
    const api = '/api/Coupon/GetPageList';
    const payload = {};

    try {
        let result = sendQueryRequest(payload, api, createCouponTag, false, token);

        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const idList = [];

        if (result && result.list && result.list.length > 0) {
            // 处理获取到的优惠券列表
            result.list.forEach((item) => {
                idList.push(item.id);
                // 收集优惠券ID
                couponIds.push(item.id);
            });

            logger.info(`[${createCouponTag}] 查询到 ${idList.length} 个优惠券`);
        } else {
            logger.warn(`[${createCouponTag}] 未查询到优惠券列表`);
        }

        return idList;

    } catch (error) {
        logger.error(`[${createCouponTag}] 查询优惠券时发生错误: ${error.message}`);
        return [];
    }
}

/**
 * 启用优惠券
 * @param {*} data 
 * @returns {boolean} 启用是否成功
 */
function startCoupons(data) {
    const token = data.token;

    // 查询优惠券ID列表
    const idList = queryCouponIds(data);

    if (idList.length === 0) {
        logger.warn(`[${createCouponTag}] 未查询到优惠券列表`);
        return false;
    }

    logger.info(`[${createCouponTag}] 准备启用 ${idList.length} 个优惠券`);

    // 启动优惠券
    let allSuccess = true;
    idList.forEach((id) => {
        // 睡眠1s
        sleep(1);
        const startResult = startCouponsById(id, token);
        if (!startResult) {
            allSuccess = false;
        }
    });

    return allSuccess;
}

/**
 * 根据ID启用优惠券
 * @param {string} id 优惠券ID
 * @param {string} token 认证token
 * @returns {boolean} 启用是否成功
 */
function startCouponsById(id, token) {
    const api = '/api/Coupon/UpdateState';
    const payload = {
        state: 1,
        id: id
    };

    try {
        const result = sendRequest(payload, api, createCouponTag, false, token);
        if (result) {
            logger.info(`[${createCouponTag}] 启用优惠券成功 ID: ${id}`);
            return true;
        } else {
            logger.error(`[${createCouponTag}] 启用优惠券失败 ID: ${id}`);
            return false;
        }
    } catch (error) {
        logger.error(`[${createCouponTag}] 启用优惠券异常 ID: ${id}, 错误: ${error.message}`);
        return false;
    }
}
