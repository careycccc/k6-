import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createBannerTag = 'createBanner';

// 在模块顶层创建图片上传器
const uploadBannerImage1 = createImageUploader('../../uploadFile/img/banner/1.png', createBannerTag);
const uploadBannerImage2 = createImageUploader('../../uploadFile/img/banner/2.png', createBannerTag);
const uploadBannerImage3 = createImageUploader('../../uploadFile/img/banner/3.png', createBannerTag);

/**
 * 创建轮播图活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createBanner(data) {
    logger.info(`[${createBannerTag}] 开始创建轮播图活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createBannerTag}] Token 不存在，无法创建轮播图活动`);
            return {
                success: false,
                tag: createBannerTag,
                message: 'Token 不存在，跳过轮播图活动创建'
            };
        }

        // 第一步：创建所有轮播图
        const createResult = createBanners(data);
        if (!createResult.success) {
            logger.error(`[${createBannerTag}] 轮播图创建失败: ${createResult.message}`);
            return {
                success: false,
                tag: createBannerTag,
                message: createResult.message
            };
        }

        // 如果没有成功创建任何轮播图，直接返回
        if (createResult.count === 0) {
            logger.warn(`[${createBannerTag}] 没有成功创建任何轮播图`);
            return {
                success: false,
                tag: createBannerTag,
                message: '没有成功创建任何轮播图'
            };
        }

        // 第二步：查询轮播图ID列表（只查询成功创建的数量）
        const queryResult = queryBannerIds(data, createResult.count);
        if (!queryResult.success || queryResult.ids.length === 0) {
            logger.error(`[${createBannerTag}] 查询轮播图ID失败`);
            return {
                success: false,
                tag: createBannerTag,
                message: '查询轮播图ID失败'
            };
        }

        // 第三步：启动查询到的轮播图
        const startResult = startBanners(data, queryResult.ids);
        if (!startResult.success) {
            logger.error(`[${createBannerTag}] 启动轮播图失败`);
            return {
                success: false,
                tag: createBannerTag,
                message: '启动轮播图失败'
            };
        }

        logger.info(`[${createBannerTag}] 轮播图活动创建并启动成功，共创建 ${createResult.count} 个轮播图`);

        return {
            success: true,
            tag: createBannerTag,
            message: `轮播图活动创建成功，共创建 ${createResult.count} 个轮播图`,
            bannerIds: queryResult.ids
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createBannerTag}] 创建轮播图活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createBannerTag,
            message: `创建轮播图活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建所有轮播图
 * @param {*} data 
 * @returns {Object} { success, count, message }
 */
function createBanners(data) {
    const api = '/api/Message/Add';
    const token = data.token;

    // 定义要创建的轮播图列表
    const bannerConfigs = [
        {
            uploader: uploadBannerImage1,
            cacheKey: 'bannerImage1Path',
            sort: 1,
            messageJumpType: 1,
            jumpUrl: 'https://github.com/',
            targetType: 2,
            pageType: null,
            customPopupId: null
        },
        {
            uploader: uploadBannerImage2,
            cacheKey: 'bannerImage2Path',
            sort: 2,
            messageJumpType: 2,
            pageType: 14,
            targetType: 1,
            jumpUrl: null,
            customPopupId: null
        },
        {
            uploader: uploadBannerImage3,
            cacheKey: 'bannerImage3Path',
            sort: 3,
            messageJumpType: 5,
            customPopupId: 4,
            targetType: 1,
            jumpUrl: null,
            pageType: null
        }
    ];

    let successCount = 0;

    for (const config of bannerConfigs) {
        // 处理图片上传
        const imageResult = handleImageUpload(data, config.cacheKey, config.uploader, createBannerTag);

        if (!imageResult.success) {
            logger.error(`[${createBannerTag}] 图片上传失败: ${imageResult.error}，跳过此轮播图`);
            continue; // 跳过失败的，继续创建下一个
        }

        const imagePath = imageResult.imagePath;

        // 构建payload
        const payload = {
            type: 4,
            sort: config.sort,
            messageJumpType: config.messageJumpType,
            imageUrl: imagePath,
            sysLanguage: 'en',
            targetType: config.targetType
        };

        // 根据messageJumpType添加对应的字段
        if (config.jumpUrl) {
            payload.jumpUrl = config.jumpUrl;
        }
        if (config.pageType !== null) {
            payload.pageType = config.pageType;
        }
        if (config.customPopupId !== null) {
            payload.customPopupId = config.customPopupId;
        }

        try {
            const result = sendRequest(payload, api, createBannerTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createBannerTag}] 创建轮播图成功: sort=${config.sort}`);
                successCount++;
                // 缓存图片路径
                data[config.cacheKey] = imagePath;
                sleep(0.5);
            } else {
                logger.error(`[${createBannerTag}] 创建轮播图失败: sort=${config.sort}, msgCode: ${result?.msgCode}, msg: ${result?.msg}，跳过此轮播图`);
                // 继续创建下一个
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createBannerTag}] 创建轮播图异常: sort=${config.sort}, 错误: ${errorMsg}，跳过此轮播图`);
            // 继续创建下一个
        }
    }

    // 只要有一个成功就算成功
    return {
        success: successCount > 0,
        count: successCount,
        message: successCount > 0 ? `成功创建 ${successCount} 个轮播图` : '所有轮播图创建失败'
    };
}

/**
 * 查询轮播图ID列表
 * @param {*} data 
 * @param {number} expectedCount 期望查询的数量（即成功创建的数量）
 * @returns {Object} { success, ids }
 */
function queryBannerIds(data, expectedCount) {
    const api = '/api/Message/GetPageList';
    const token = data.token;

    const payload = {
        type: 4,
        sortField: 'sort',
        orderBy: 'Desc',
        sysLanguage: 'en'
    };

    try {
        let result = sendQueryRequest(payload, api, createBannerTag, false, token);

        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const idList = [];

        if (result && result.list && result.list.length > 0) {
            // 只取成功创建的数量，最多3个
            const itemsToTake = Math.min(expectedCount, result.list.length, 3);
            for (let i = 0; i < itemsToTake; i++) {
                idList.push(result.list[i].id);
            }

            logger.info(`[${createBannerTag}] 查询到 ${result.list.length} 个轮播图，取前 ${itemsToTake} 个id: ${idList.join(', ')}`);
        } else {
            logger.warn(`[${createBannerTag}] 未查询到轮播图列表`);
        }

        return {
            success: idList.length > 0,
            ids: idList
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createBannerTag}] 查询轮播图时发生错误: ${errorMsg}`);
        return {
            success: false,
            ids: []
        };
    }
}

/**
 * 启动轮播图
 * @param {*} data 
 * @param {Array} ids 要启动的轮播图ID列表
 * @returns {Object} { success, message }
 */
function startBanners(data, ids) {
    const api = '/api/Message/UpdateState';
    const token = data.token;

    let successCount = 0;

    for (const id of ids) {
        const payload = {
            id: id,
            state: 1
        };

        try {
            const result = sendRequest(payload, api, createBannerTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createBannerTag}] 启动轮播图成功 ID: ${id}`);
                successCount++;
                sleep(0.5);
            } else {
                logger.error(`[${createBannerTag}] 启动轮播图失败 ID: ${id}, msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createBannerTag}] 启动轮播图异常 ID: ${id}, 错误: ${errorMsg}`);
        }
    }

    return {
        success: successCount === ids.length,
        message: `成功启动 ${successCount}/${ids.length} 个轮播图`
    };
}
