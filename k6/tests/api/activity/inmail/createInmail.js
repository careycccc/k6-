import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { jumpType } from '../../common/type.js';
import { queryCouponIds } from '../coupon/createCoupon.js';
import { getUploadFileName } from '../../uploadFile/uploadInmail.js';
import { sleep } from 'k6';

export const createInmailTag = 'createInmail';

// 用于收集站内信ID
export const inmailIds = [];

/**
 * 创建站内信活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createInmail(data) {
    logger.info(`[${createInmailTag}] 开始创建站内信活动`);

    try {
        // 必须接收 data 参数来拿 token
        const token = data.token;

        if (!token) {
            logger.error(`[${createInmailTag}] Token 不存在，无法创建站内信`);
            return {
                success: false,
                tag: createInmailTag,
                message: 'Token 不存在，跳过站内信活动创建'
            };
        }

        // 检查是否有上传的图片资源，如果没有则尝试上传
        let uploadedSrc = data.uploadedSrc;
        let uploadedUrls = data.uploadedUrls;

        if (!uploadedSrc || !uploadedUrls || uploadedSrc.length === 0 || uploadedUrls.length === 0) {
            logger.info(`[${createInmailTag}] 未检测到图片资源，开始上传图片...`);

            try {
                const uploadData = getUploadFileName();
                uploadedSrc = uploadData.uploadedSrc;
                uploadedUrls = uploadData.uploadedUrls;

                logger.info(`[${createInmailTag}] 图片上传成功，共上传 ${uploadedUrls.length} 个文件`);
            } catch (uploadError) {
                logger.error(`[${createInmailTag}] 图片上传失败: ${uploadError.message}`);
                return {
                    success: false,
                    tag: createInmailTag,
                    message: `图片上传失败: ${uploadError.message}，跳过站内信活动创建`
                };
            }
        }

        // 更新 data 对象，确保后续使用的是正确的图片资源
        data.uploadedSrc = uploadedSrc;
        data.uploadedUrls = uploadedUrls;

        // 第一步：创建站内信
        const createdCount = createInmailMessages(data);
        if (createdCount === 0) {
            logger.error(`[${createInmailTag}] 站内信创建失败`);
            return {
                success: false,
                tag: createInmailTag,
                message: '站内信创建失败，跳过活动'
            };
        }

        // 第二步：启用站内信（只启用本次创建的）
        const startResult = startInmail(data, createdCount);
        if (!startResult) {
            logger.error(`[${createInmailTag}] 站内信启用失败`);
            return {
                success: false,
                tag: createInmailTag,
                message: '站内信启用失败，跳过活动'
            };
        }

        logger.info(`[${createInmailTag}] 站内信活动创建并启用成功，共创建 ${inmailIds.length} 条站内信`);

        return {
            success: true,
            tag: createInmailTag,
            message: `站内信活动创建成功，共创建 ${inmailIds.length} 条站内信`,
            inmailIds: [...inmailIds]
        };

    } catch (error) {
        logger.error(`[${createInmailTag}] 创建站内信活动时发生错误: ${error.message}`);
        return {
            success: false,
            tag: createInmailTag,
            message: `创建站内信活动失败: ${error.message}`
        };
    }
}

/**
 * 创建站内信消息
 * @param {*} data 
 * @returns {number} 成功创建的站内信数量，失败返回0
 */
function createInmailMessages(data) {
    const api = '/api/Inmail/Add';
    const token = data.token;
    const inmailList = [];

    // 根据 jumpType 生成站内信列表
    jumpType.forEach(({ id, name }) => {
        inmailList.push([
            name + '站内信',
            data.uploadedSrc[0],
            data.uploadedUrls[0],
            { id, name }
        ]);
    });

    logger.info(`[${createInmailTag}] 准备创建 ${inmailList.length} 条站内信`);

    // 查询优惠券ID列表（可选）
    const couponIdList = queryCouponIds(data);
    let couponIds = null;

    if (couponIdList.length === 0) {
        logger.info(`[${createInmailTag}] 未查询到优惠券，站内信将不添加优惠券`);
        couponIds = null;
    } else if (couponIdList.length >= 3) {
        // 取前2个优惠券ID
        const selectedIds = couponIdList.slice(0, 2);
        couponIds = selectedIds.join(',');
        logger.info(`[${createInmailTag}] 从 ${couponIdList.length} 个优惠券中取前 2 个: ${couponIds}`);
    } else {
        // 少于3个，使用所有优惠券
        couponIds = couponIdList.join(',');
        logger.info(`[${createInmailTag}] 使用所有 ${couponIdList.length} 个优惠券: ${couponIds}`);
    }

    let allSuccess = true;
    let successCount = 0;

    inmailList.forEach(([inmailName, dataSrc, imgSrc, { id, name }]) => {
        const payload = {
            "backstageDisplayName": inmailName,
            "validType": 1,
            "jumpType": 3,
            "jumpPage": id,
            "jumpButtonText": name,
            "targetType": 1,
            "translations": [
                {
                    "language": "hi",
                    "content": `<p><img data-src="${dataSrc}" src="${dataSrc}" data-image-id="img0" style="vertical-align: baseline;">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                },
                {
                    "language": "en",
                    "content": `<p><img data-src="${dataSrc}" src="${dataSrc}" data-image-id="img1" style="vertical-align: baseline;">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                },
                {
                    "language": "zh",
                    "content": `<p><img data-src="${dataSrc}" src="${dataSrc}" data-image-id="img0" style="vertical-align: baseline;">${inmailName}</p>`,
                    "title": inmailName,
                    "thumbnail": imgSrc
                }
            ],
            "sendType": 1,
            "isHasReward": true,
            "rewardConfig": {
                "freeReward": {
                    "rewardAmount": 103,
                    "amountCodingMultiple": 2,
                    "couponIds": couponIds
                },
                "rewardTypes": [1, 2],
                "rechargeReward": {
                    "rechargeAmount": 1000,
                    "rechargeCount": 1,
                    "rewardAmount": 1003,
                    "amountCodingMultiple": 2,
                    "couponIds": couponIds
                },
                "expireType": 1
            }
        };

        try {
            const result = sendRequest(payload, api, createInmailTag, false, token);
            if (result) {
                successCount++;
                logger.info(`[${createInmailTag}] 创建站内信成功: ${inmailName}`);
            } else {
                logger.error(`[${createInmailTag}] 创建站内信失败: ${inmailName}`);
                allSuccess = false;
            }

            // 每次创建后睡眠0.5秒，避免触发频率限制
            sleep(0.5);
        } catch (error) {
            logger.error(`[${createInmailTag}] 创建站内信异常: ${inmailName}, 错误: ${error.message}`);
            allSuccess = false;
        }
    });

    logger.info(`[${createInmailTag}] 站内信创建完成，成功: ${successCount}/${inmailList.length}`);

    // 返回成功创建的数量
    return successCount;
}

/**
 * 启用站内信
 * @param {*} data 
 * @param {number} countToEnable 要启用的站内信数量（本次创建的数量）
 * @returns {boolean} 启用是否成功
 */
function startInmail(data, countToEnable) {
    const api = '/api/Inmail/GetPageList';
    const token = data.token;

    // 获取站内信列表
    const payload = {};

    try {
        let result = sendQueryRequest(payload, api, createInmailTag, false, token);

        // 判断 result 的 typeof 是不是对象
        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const idList = [];

        if (result && result.list && result.list.length > 0) {
            // 处理获取到的站内信列表
            result.list.forEach(item => {
                idList.push(item.id);
                // 收集站内信ID
                inmailIds.push(item.id);
            });

            // 只启用最新创建的站内信（取前 countToEnable 个）
            const inmailsToEnable = idList.slice(0, Math.min(countToEnable, idList.length));

            logger.info(`[${createInmailTag}] 查询到 ${idList.length} 条站内信，准备启用最新的 ${inmailsToEnable.length} 条`);

            // 启动站内信
            let allSuccess = true;
            let successCount = 0;

            inmailsToEnable.forEach(id => {
                // 睡眠1s
                sleep(1);
                const startResult = startInmailById(id, token);
                if (startResult) {
                    successCount++;
                } else {
                    allSuccess = false;
                }
            });

            logger.info(`[${createInmailTag}] 站内信启用完成，成功: ${successCount}/${inmailsToEnable.length}`);

            return allSuccess;
        } else {
            logger.warn(`[${createInmailTag}] 未查询到站内信列表`);
            return false;
        }

    } catch (error) {
        logger.error(`[${createInmailTag}] 启用站内信时发生错误: ${error.message}`);
        return false;
    }
}

/**
 * 根据ID启用站内信
 * @param {string} id 站内信ID
 * @param {string} token 认证token
 * @returns {boolean} 启用是否成功
 */
function startInmailById(id, token) {
    const api = '/api/Inmail/UpdateState';
    const payload = {
        state: 1,
        id: id
    };

    try {
        const result = sendRequest(payload, api, createInmailTag, false, token);
        if (result) {
            logger.info(`[${createInmailTag}] 启用站内信成功 ID: ${id}`);
            return true;
        } else {
            logger.error(`[${createInmailTag}] 启用站内信失败 ID: ${id}`);
            return false;
        }
    } catch (error) {
        logger.error(`[${createInmailTag}] 启用站内信异常 ID: ${id}, 错误: ${error.message}`);
        return false;
    }
}
