import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createCustomizePopupTag = 'createCustomizePopup';

// 在模块顶层创建图片上传器
const uploadCustomizePopupImage1 = createImageUploader('../../uploadFile/img/customisablepopup/1.png', createCustomizePopupTag);
const uploadCustomizePopupImage2 = createImageUploader('../../uploadFile/img/customisablepopup/2.png', createCustomizePopupTag);
const uploadCustomizePopupImage3 = createImageUploader('../../uploadFile/img/customisablepopup/3.png', createCustomizePopupTag);
const uploadCustomizePopupImage4 = createImageUploader('../../uploadFile/img/customisablepopup/4.png', createCustomizePopupTag);

/**
 * 创建定制化弹窗活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createCustomizePopup(data) {
    logger.info(`[${createCustomizePopupTag}] 开始创建定制化弹窗活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createCustomizePopupTag}] Token 不存在，无法创建定制化弹窗活动`);
            return {
                success: false,
                tag: createCustomizePopupTag,
                message: 'Token 不存在，跳过定制化弹窗活动创建'
            };
        }

        // 第一步：创建所有定制化弹窗
        const createResult = createPopups(data);
        if (!createResult.success) {
            logger.error(`[${createCustomizePopupTag}] 定制化弹窗创建失败: ${createResult.message}`);
            return {
                success: false,
                tag: createCustomizePopupTag,
                message: createResult.message
            };
        }

        // 第二步：查询弹窗ID列表
        const queryResult = queryPopupIds(data);
        if (!queryResult.success || queryResult.ids.length === 0) {
            logger.error(`[${createCustomizePopupTag}] 查询弹窗ID失败`);
            return {
                success: false,
                tag: createCustomizePopupTag,
                message: '查询弹窗ID失败'
            };
        }

        // 第三步：启动查询到的弹窗
        const startResult = startPopups(data, queryResult.ids);
        if (!startResult.success) {
            logger.error(`[${createCustomizePopupTag}] 启动弹窗失败`);
            return {
                success: false,
                tag: createCustomizePopupTag,
                message: '启动弹窗失败'
            };
        }

        logger.info(`[${createCustomizePopupTag}] 定制化弹窗活动创建并启动成功，共创建 ${createResult.count} 个弹窗`);

        return {
            success: true,
            tag: createCustomizePopupTag,
            message: `定制化弹窗活动创建成功，共创建 ${createResult.count} 个弹窗`,
            popupIds: queryResult.ids
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createCustomizePopupTag}] 创建定制化弹窗活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createCustomizePopupTag,
            message: `创建定制化弹窗活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建所有定制化弹窗
 * @param {*} data 
 * @returns {Object} { success, count, message }
 */
function createPopups(data) {
    const api = '/api/CustomizePopup/Add';
    const token = data.token;

    // 定义要创建的弹窗列表
    const popupConfigs = [
        {
            uploader: uploadCustomizePopupImage1,
            cacheKey: 'customizePopupImage1Path',
            title: '跳每日签到',
            sort: 1,
            validType: 1,
            frequency: 3,
            jumpType: 3,
            jumpPage: 20,
            targetType: 1,
            isForcePopup: false,
            jumpLink: null
        },
        {
            uploader: uploadCustomizePopupImage2,
            cacheKey: 'customizePopupImage2Path',
            title: '跳亏损救援金',
            sort: 2,
            validType: 1,
            frequency: 1,
            jumpType: 3,
            jumpPage: 18,
            targetType: 1,
            isForcePopup: true,
            jumpLink: null
        },
        {
            uploader: uploadCustomizePopupImage3,
            cacheKey: 'customizePopupImage3Path',
            title: '跳客服',
            sort: 3,
            validType: 1,
            frequency: 3,
            jumpType: 4,
            jumpPage: 2,
            targetType: 2,
            isForcePopup: true,
            jumpLink: null
        },
        {
            uploader: uploadCustomizePopupImage4,
            cacheKey: 'customizePopupImage4Path',
            title: '跳转链接-git',
            sort: 4,
            validType: 1,
            frequency: 2,
            jumpType: 2,
            jumpLink: 'https://github.com/',
            targetType: 5,
            isForcePopup: true,
            jumpPage: null
        }
    ];

    let successCount = 0;

    for (const config of popupConfigs) {
        // 处理图片上传（每个活动只上传一次）
        const imageResult = handleImageUpload(data, config.cacheKey, config.uploader, createCustomizePopupTag);

        if (!imageResult.success) {
            logger.error(`[${createCustomizePopupTag}] 图片上传失败: ${imageResult.error}`);
            return {
                success: false,
                count: successCount,
                message: `图片上传失败: ${imageResult.error}`
            };
        }

        const imagePath = imageResult.imagePath;

        // 构建translations，三种语言都使用同一张图片
        const translations = [
            { language: 'hi', cover: imagePath },
            { language: 'en', cover: imagePath },
            { language: 'zh', cover: imagePath }
        ];

        // 构建payload
        const payload = {
            title: config.title,
            sort: config.sort,
            validType: config.validType,
            frequency: config.frequency,
            jumpType: config.jumpType,
            targetType: config.targetType,
            isForcePopup: config.isForcePopup,
            translations: translations
        };

        // 根据jumpType添加对应的字段
        if (config.jumpType === 2 && config.jumpLink) {
            // jumpType为2时，使用jumpLink
            payload.jumpLink = config.jumpLink;
        } else if (config.jumpPage !== null) {
            // 其他jumpType使用jumpPage
            payload.jumpPage = config.jumpPage;
        }

        try {
            const result = sendRequest(payload, api, createCustomizePopupTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createCustomizePopupTag}] 创建定制化弹窗成功: ${config.title}`);
                successCount++;
                // 缓存图片路径
                data[config.cacheKey] = imagePath;
                sleep(0.5);
            } else {
                logger.error(`[${createCustomizePopupTag}] 创建定制化弹窗失败: ${config.title}, msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
                return {
                    success: false,
                    count: successCount,
                    message: `创建定制化弹窗失败: ${result?.msg || '未知错误'}`
                };
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createCustomizePopupTag}] 创建定制化弹窗异常: ${config.title}, 错误: ${errorMsg}`);
            return {
                success: false,
                count: successCount,
                message: `创建定制化弹窗异常: ${errorMsg}`
            };
        }
    }

    return {
        success: true,
        count: successCount
    };
}


/**
 * 查询定制化弹窗ID列表
 * @param {*} data 
 * @returns {Object} { success, ids }
 */
function queryPopupIds(data) {
    const api = '/api/CustomizePopup/GetPageList';
    const token = data.token;

    const payload = {
        orderBy: 'Desc'
    };

    try {
        let result = sendQueryRequest(payload, api, createCustomizePopupTag, false, token);

        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const idList = [];

        if (result && result.list && result.list.length > 0) {
            // 取前4个ID（如果不足4个就取实际数量）
            const itemsToTake = Math.min(4, result.list.length);
            for (let i = 0; i < itemsToTake; i++) {
                idList.push(result.list[i].id);
            }

            logger.info(`[${createCustomizePopupTag}] 查询到 ${result.list.length} 个定制化弹窗，取前 ${itemsToTake} 个id: ${idList.join(', ')}`);
        } else {
            logger.warn(`[${createCustomizePopupTag}] 未查询到定制化弹窗列表`);
        }

        return {
            success: idList.length > 0,
            ids: idList
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createCustomizePopupTag}] 查询定制化弹窗时发生错误: ${errorMsg}`);
        return {
            success: false,
            ids: []
        };
    }
}

/**
 * 启动定制化弹窗
 * @param {*} data 
 * @param {Array} ids 要启动的弹窗ID列表
 * @returns {Object} { success, message }
 */
function startPopups(data, ids) {
    const api = '/api/CustomizePopup/UpdateState';
    const token = data.token;

    let successCount = 0;

    for (const id of ids) {
        const payload = {
            state: 1,
            id: id
        };

        try {
            const result = sendRequest(payload, api, createCustomizePopupTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createCustomizePopupTag}] 启动定制化弹窗成功 ID: ${id}`);
                successCount++;
                sleep(0.5);
            } else {
                logger.error(`[${createCustomizePopupTag}] 启动定制化弹窗失败 ID: ${id}, msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createCustomizePopupTag}] 启动定制化弹窗异常 ID: ${id}, 错误: ${errorMsg}`);
        }
    }

    return {
        success: successCount === ids.length,
        message: `成功启动 ${successCount}/${ids.length} 个定制化弹窗`
    };
}
