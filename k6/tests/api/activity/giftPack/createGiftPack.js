import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { queryCouponIds } from '../coupon/createCoupon.js';

export const createGiftPackTag = 'createGiftPack';

/**
 * 创建活动礼包活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createGiftPack(data) {
    logger.info(`[${createGiftPackTag}] 开始创建活动礼包活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createGiftPackTag}] Token 不存在，无法创建活动礼包`);
            return {
                success: false,
                tag: createGiftPackTag,
                message: 'Token 不存在，跳过活动礼包创建'
            };
        }

        const timestamp = Date.now();

        // 查询优惠券ID列表
        logger.info(`[${createGiftPackTag}] 开始查询优惠券ID...`);
        const couponIdList = queryCouponIds(data);

        let couponId = 500108; // 默认值
        if (couponIdList && couponIdList.length > 0) {
            couponId = couponIdList[0]; // 使用第一个优惠券ID
            logger.info(`[${createGiftPackTag}] 使用优惠券ID: ${couponId}`);
        } else {
            logger.warn(`[${createGiftPackTag}] 未查询到优惠券，使用默认ID: ${couponId}`);
        }

        // 定义4种礼包类型
        const giftPacks = [
            {
                name: '充值投注礼包',
                type: 0,  // giftPackType: 0 = 充值投注礼包
                rewardMode: 0  // 普通奖励
            },
            {
                name: '纯奖励礼包-普通奖励',
                type: 1,  // giftPackType: 1 = 纯奖励礼包
                rewardMode: 0  // 普通奖励
            },
            {
                name: '纯奖励礼包-独立随机奖励',
                type: 1,
                rewardMode: 1  // 独立随机奖励
            },
            {
                name: '纯奖励礼包-权重奖励',
                type: 1,
                rewardMode: 2  // 权重奖励
            }
        ];

        let successCount = 0;
        let failedPacks = [];

        // 循环创建每种礼包
        for (const pack of giftPacks) {
            sleep(1);
            const giftPackName = `${pack.name}_${timestamp}`;
            logger.info(`[${createGiftPackTag}] 创建礼包: ${giftPackName}`);

            const result = createGiftPackActivity(data, giftPackName, timestamp, couponId, pack);

            if (result.success) {
                successCount++;
                logger.info(`[${createGiftPackTag}] ${pack.name} 创建成功`);
                sleep(0.5);
            } else {
                failedPacks.push(pack.name);
                logger.error(`[${createGiftPackTag}] ${pack.name} 创建失败: ${result.message}`);
            }
        }

        if (successCount === giftPacks.length) {
            logger.info(`[${createGiftPackTag}] 所有礼包创建成功 (${successCount}/${giftPacks.length})`);
            return {
                success: true,
                tag: createGiftPackTag,
                message: `活动礼包创建成功，共创建 ${successCount} 个礼包`
            };
        } else if (successCount > 0) {
            logger.warn(`[${createGiftPackTag}] 部分礼包创建成功 (${successCount}/${giftPacks.length})`);
            return {
                success: true,
                tag: createGiftPackTag,
                message: `部分礼包创建成功 (${successCount}/${giftPacks.length})，失败: ${failedPacks.join(', ')}`
            };
        } else {
            logger.error(`[${createGiftPackTag}] 所有礼包创建失败`);
            return {
                success: false,
                tag: createGiftPackTag,
                message: '所有礼包创建失败'
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createGiftPackTag}] 创建活动礼包时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createGiftPackTag,
            message: `创建活动礼包失败: ${errorMsg}`
        };
    }
}

/**
 * 创建活动礼包
 * @param {*} data
 * @param {string} giftPackName 礼包名称
 * @param {number} timestamp 时间戳
 * @param {number} couponId 优惠券ID
 * @param {Object} pack 礼包配置
 * @returns {Object} 创建结果 { success, errorCode, message }
 */
function createGiftPackActivity(data, giftPackName, timestamp, couponId, pack) {
    const token = data.token;
    const api = '/api/GiftPack/Add';

    // 根据礼包类型构建不同的 payload
    const isRewardPack = pack.type === 1;  // 纯奖励礼包

    let payload;

    if (!isRewardPack) {
        // 充值投注礼包 (giftPackType: 0)
        payload = {
            "giftPackType": 0,
            "giftPackName": giftPackName,
            "translations": [
                {
                    "language": "hi",
                    "name": `टॉप-अप बेटिंग बंडल ${timestamp}`,
                    "description": `टॉप-अप बेटिंग बंडल ${timestamp}`
                },
                {
                    "language": "en",
                    "name": `Top-up Betting Bundle ${timestamp}`,
                    "description": `Top-up Betting Bundle ${timestamp}`
                },
                {
                    "language": "zh",
                    "name": giftPackName,
                    "description": giftPackName
                }
            ],
            "state": 1,
            "validType": 1,
            "deliveryMethod": 1,
            "validTimeType": 1,
            "validTime": 24,
            "allowRepeat": true,
            "repeatCooldownTime": 10,
            "repeatCooldownTimeType": 0,
            "giftPackTriggerType": 3,
            "receiveType": 0,
            "receiveLimitType": 2,
            "maxReceiveCount": 2,
            "deliveryTargetType": null,
            "rewardMode": 0,
            "deliveryDetail": "",
            "triggerCondition": {
                "mixedGiftPackConditionData": [
                    {
                        "rechargeAmount": 100,
                        "rechargeAmountExpression": 2,
                        "validBetAmount": 200,
                        "validBetAmountExpression": 2
                    }
                ]
            },
            "maxRepeatCount": 2,
            "rewardData": [
                {
                    "minRechargeAmount": 1000,
                    "minBetAmount": 100,
                    "rewardConfig": [
                        {
                            "type": 0,
                            "value": 100,
                            "codingMultiple": 1,
                            "probability": 0
                        },
                        {
                            "type": 1,
                            "value": 1,
                            "codingMultiple": 1,
                            "probability": 0
                        },
                        {
                            "type": 4,
                            "value": 1,
                            "codingMultiple": 1,
                            "probability": 0
                        },
                        {
                            "type": 5,
                            "value": 1,
                            "codingMultiple": 1,
                            "probability": 0,
                            "itemId": couponId
                        }
                    ]
                }
            ]
        };
    } else {
        // 纯奖励礼包 (giftPackType: 1)
        const basePayload = {
            "giftPackType": 1,
            "giftPackName": giftPackName,
            "translations": [
                {
                    "language": "hi",
                    "name": giftPackName,
                    "description": giftPackName
                },
                {
                    "language": "en",
                    "name": giftPackName,
                    "description": giftPackName
                },
                {
                    "language": "zh",
                    "name": giftPackName,
                    "description": giftPackName
                }
            ],
            "state": 1,
            "validType": 0,
            "deliveryMethod": 0,
            "validTimeType": 1,
            "validTime": 24,
            "allowRepeat": true,
            "repeatCooldownTime": 0,
            "repeatCooldownTimeType": 0,
            "giftPackTriggerType": null,
            "receiveType": 0,
            "receiveLimitType": 0,
            "maxReceiveCount": 1,
            "rewardMode": pack.rewardMode,
            "deliveryDetail": "",
            "triggerCondition": null,
            "maxRepeatCount": null
        };

        // 根据奖励模式设置不同的配置
        if (pack.rewardMode === 0) {
            // 普通奖励
            payload = {
                ...basePayload,
                "receiveType": 1,  // 修改为1
                "deliveryTargetType": 1,  // 修改为1
                "rewardData": [
                    {
                        "minRechargeAmount": 0,
                        "minBetAmount": 0,
                        "rewardConfig": [
                            {
                                "type": 0,
                                "value": 10,  // 修改为10
                                "codingMultiple": 1,
                                "probability": 0
                            }
                        ]
                    }
                ]
            };
        } else if (pack.rewardMode === 1) {
            // 独立随机奖励
            payload = {
                ...basePayload,
                "deliveryTargetType": 9,
                "deliveryDetail": "1,2,3,4",
                "delivertDetail": [1, 2, 3, 4],
                "rewardData": [
                    {
                        "minRechargeAmount": 0,
                        "minBetAmount": 0,
                        "rewardConfig": [
                            {
                                "type": 0,
                                "value": 10,
                                "codingMultiple": 1,
                                "probability": 50
                            },
                            {
                                "type": 1,
                                "value": 10,
                                "codingMultiple": 1,
                                "probability": 50
                            },
                            {
                                "type": 4,
                                "value": 10,
                                "codingMultiple": 1,
                                "probability": 20
                            },
                            {
                                "type": 5,
                                "value": 1,
                                "codingMultiple": 1,
                                "probability": 80,
                                "itemId": couponId
                            }
                        ]
                    }
                ]
            };
        } else {
            // 权重奖励 (rewardMode: 2)
            payload = {
                ...basePayload,
                "deliveryTargetType": 2,
                "rewardData": [
                    {
                        "minRechargeAmount": 0,
                        "minBetAmount": 0,
                        "rewardConfig": [
                            {
                                "type": 0,
                                "value": 100,
                                "codingMultiple": 2,
                                "probability": 60
                            },
                            {
                                "type": 2,
                                "value": 1,
                                "codingMultiple": 1,
                                "probability": 30
                            },
                            {
                                "type": 5,
                                "value": 1,
                                "codingMultiple": 1,
                                "probability": 10,
                                "itemId": couponId
                            }
                        ]
                    }
                ]
            };
        }
    }

    try {
        const result = sendRequest(payload, api, createGiftPackTag, false, token);

        if (result && result.msgCode === 0) {
            logger.info(`[${createGiftPackTag}] 礼包创建成功 - 名称: ${giftPackName}, 模式: ${pack.rewardMode}`);
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
        logger.error(`[${createGiftPackTag}] 创建礼包请求异常: ${errorMsg}`);
        return {
            success: false,
            message: `请求异常: ${errorMsg}`
        };
    }
}
