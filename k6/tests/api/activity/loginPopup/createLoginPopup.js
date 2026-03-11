import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';

export const createLoginPopupTag = 'createLoginPopup';

// 在模块顶层创建图片上传器
const uploadLoginPopupImage1 = createImageUploader('../../uploadFile/img/loginafter/1.png', createLoginPopupTag);
const uploadLoginPopupImage2 = createImageUploader('../../uploadFile/img/loginafter/2.png', createLoginPopupTag);

/**
 * 创建登录前弹窗活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createLoginPopup(data) {
    logger.info(`[${createLoginPopupTag}] 开始创建登录前弹窗活动`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createLoginPopupTag}] Token 不存在，无法创建登录前弹窗活动`);
            return {
                success: false,
                tag: createLoginPopupTag,
                message: 'Token 不存在，跳过登录前弹窗活动创建'
            };
        }

        // 第一步：上传图片并创建弹窗
        const createResult = createPopups(data);
        if (!createResult.success) {
            logger.error(`[${createLoginPopupTag}] 登录前弹窗创建失败: ${createResult.message}`);
            return {
                success: false,
                tag: createLoginPopupTag,
                message: createResult.message
            };
        }

        // 第二步：查询弹窗ID列表
        const queryResult = queryPopupIds(data);
        if (!queryResult.success || queryResult.ids.length === 0) {
            logger.error(`[${createLoginPopupTag}] 查询弹窗ID失败`);
            return {
                success: false,
                tag: createLoginPopupTag,
                message: '查询弹窗ID失败'
            };
        }

        // 第三步：启动前2个弹窗
        const startResult = startPopups(data, queryResult.ids);
        if (!startResult.success) {
            logger.error(`[${createLoginPopupTag}] 启动弹窗失败`);
            return {
                success: false,
                tag: createLoginPopupTag,
                message: '启动弹窗失败'
            };
        }

        logger.info(`[${createLoginPopupTag}] 登录前弹窗活动创建并启动成功，共创建 ${createResult.count} 个弹窗`);

        return {
            success: true,
            tag: createLoginPopupTag,
            message: `登录前弹窗活动创建成功，共创建 ${createResult.count} 个弹窗`,
            popupIds: queryResult.ids
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createLoginPopupTag}] 创建登录前弹窗活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createLoginPopupTag,
            message: `创建登录前弹窗活动失败: ${errorMsg}`
        };
    }
}

/**
 * 创建弹窗（上传图片并创建）
 * @param {*} data 
 * @returns {Object} { success, count, message }
 */
function createPopups(data) {
    const api = '/api/Message/Add';
    const token = data.token;

    // 定义要创建的弹窗列表
    const popupConfigs = [
        {
            uploader: uploadLoginPopupImage1,
            cacheKey: 'loginPopupImage1Path',
            title: '登录前弹窗01',
            content: '<p>登录前弹窗01</p>',
            sort: 1
        },
        {
            uploader: uploadLoginPopupImage2,
            cacheKey: 'loginPopupImage2Path',
            title: '登录前弹窗02',
            content: '<p>登录前弹窗02</p>',
            sort: 2
        }
    ];

    let successCount = 0;

    for (const config of popupConfigs) {
        // 处理图片上传
        const imageResult = handleImageUpload(data, config.cacheKey, config.uploader, createLoginPopupTag);

        if (!imageResult.success) {
            logger.error(`[${createLoginPopupTag}] 图片上传失败: ${imageResult.error}`);
            return {
                success: false,
                count: successCount,
                message: `图片上传失败: ${imageResult.error}`
            };
        }

        const imagePath = imageResult.imagePath;

        // 构建payload
        const payload = {
            type: 2,
            title: config.title,
            content: config.content,
            sort: config.sort,
            imageUrl: imagePath,
            sysLanguage: 'en'
        };

        try {
            const result = sendRequest(payload, api, createLoginPopupTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createLoginPopupTag}] 创建弹窗成功: ${config.title}`);
                successCount++;
                // 缓存图片路径
                data[config.cacheKey] = imagePath;
                sleep(0.5);
            } else {
                logger.error(`[${createLoginPopupTag}] 创建弹窗失败: ${config.title}, msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
                return {
                    success: false,
                    count: successCount,
                    message: `创建弹窗失败: ${result?.msg || '未知错误'}`
                };
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createLoginPopupTag}] 创建弹窗异常: ${config.title}, 错误: ${errorMsg}`);
            return {
                success: false,
                count: successCount,
                message: `创建弹窗异常: ${errorMsg}`
            };
        }
    }

    return {
        success: true,
        count: successCount
    };
}

/**
 * 查询弹窗ID列表
 * @param {*} data 
 * @returns {Object} { success, ids }
 */
function queryPopupIds(data) {
    const api = '/api/Message/GetPageList';
    const token = data.token;

    const payload = {
        type: 2,
        sortField: 'sort',
        orderBy: 'Desc',
        sysLanguage: 'en'
    };

    try {
        let result = sendQueryRequest(payload, api, createLoginPopupTag, false, token);

        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const idList = [];

        if (result && result.list && result.list.length > 0) {
            // 只取前2个id
            const itemsToTake = Math.min(2, result.list.length);
            for (let i = 0; i < itemsToTake; i++) {
                idList.push(result.list[i].id);
            }

            logger.info(`[${createLoginPopupTag}] 查询到 ${result.list.length} 个弹窗，取前 ${itemsToTake} 个id: ${idList.join(', ')}`);
        } else {
            logger.warn(`[${createLoginPopupTag}] 未查询到弹窗列表`);
        }

        return {
            success: idList.length > 0,
            ids: idList
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createLoginPopupTag}] 查询弹窗时发生错误: ${errorMsg}`);
        return {
            success: false,
            ids: []
        };
    }
}

/**
 * 启动弹窗
 * @param {*} data 
 * @param {Array} ids 要启动的弹窗ID列表
 * @returns {Object} { success, message }
 */
function startPopups(data, ids) {
    const api = '/api/Message/UpdateState';
    const token = data.token;

    let successCount = 0;

    for (const id of ids) {
        const payload = {
            id: id,
            state: 1
        };

        try {
            const result = sendRequest(payload, api, createLoginPopupTag, false, token);

            if (result && result.msgCode === 0) {
                logger.info(`[${createLoginPopupTag}] 启动弹窗成功 ID: ${id}`);
                successCount++;
                sleep(0.5);
            } else {
                logger.error(`[${createLoginPopupTag}] 启动弹窗失败 ID: ${id}, msgCode: ${result?.msgCode}, msg: ${result?.msg}`);
            }
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createLoginPopupTag}] 启动弹窗异常 ID: ${id}, 错误: ${errorMsg}`);
        }
    }

    return {
        success: successCount === ids.length,
        message: `成功启动 ${successCount}/${ids.length} 个弹窗`
    };
}
