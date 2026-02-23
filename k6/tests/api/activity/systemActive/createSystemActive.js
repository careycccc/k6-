import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { systemJumpType } from '../../common/type.js';
import { uploadFile } from '../../uploadFile/uploadSystemActive.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { sleep } from 'k6';

export const createSystemActiveTag = 'createSystemActive';

// 用于收集系统活动ID
export const systemActiveIds = [];

/**
 * 安全地获取错误信息
 * @param {*} error 错误对象
 * @returns {string} 错误信息字符串
 */
function getErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
}

/**
 * 创建系统活动
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createSystemActive(data) {
    logger.info(`[${createSystemActiveTag}] 开始创建系统活动`);

    try {
        // 必须接收 data 参数来拿 token
        let token = data.token;

        if (!token) {
            logger.error(`[${createSystemActiveTag}] Token 不存在，尝试重新登录...`);
            token = AdminLogin();
            if (!token) {
                logger.error(`[${createSystemActiveTag}] 登录失败，无法创建系统活动`);
                return {
                    success: false,
                    tag: createSystemActiveTag,
                    message: 'Token 不存在且登录失败，跳过系统活动创建'
                };
            }
        }

        // 第一步：查询系统活动列表，获取活动ID
        const activityList = querySystemActivities(data);
        if (!activityList || activityList.length === 0) {
            logger.error(`[${createSystemActiveTag}] 查询系统活动列表失败`);
            return {
                success: false,
                tag: createSystemActiveTag,
                message: '查询系统活动列表失败，跳过活动创建'
            };
        }

        logger.info(`[${createSystemActiveTag}] 查询到 ${activityList.length} 个系统活动`);

        // 第二步：逐个上传图片并更新活动
        let successCount = 0;
        let skipCount = 0;

        for (let i = 0; i < systemJumpType.length; i++) {
            const jumpTypeItem = systemJumpType[i];
            const filePath = `../uploadFile/img/systemActive/${jumpTypeItem.pageType}.png`;

            // 找到对应的活动
            const activity = activityList.find(a => a.pageType === jumpTypeItem.pageType);
            if (!activity) {
                logger.warn(`[${createSystemActiveTag}] 未找到 pageType=${jumpTypeItem.pageType} 的活动，跳过`);
                skipCount++;
                continue;
            }

            logger.info(`[${createSystemActiveTag}] [${i + 1}/${systemJumpType.length}] 处理活动: ${jumpTypeItem.title}`);

            // 上传图片
            let imgUrl = null;
            try {
                const uploadRes = uploadFile(filePath, token);
                if (uploadRes && uploadRes.status === 200) {
                    const uploadData = JSON.parse(uploadRes.body);
                    if (uploadData.code === 0 && uploadData.data && uploadData.data.length > 0) {
                        imgUrl = uploadData.data[0].src;
                        logger.info(`[${createSystemActiveTag}] 图片上传成功: ${jumpTypeItem.pageType}.png`);
                    }
                }
            } catch (uploadError) {
                const errorMsg = getErrorMessage(uploadError);
                logger.error(`[${createSystemActiveTag}] 图片上传失败: ${jumpTypeItem.title}, 错误: ${errorMsg}`);
                skipCount++;
                continue; // 跳过这个活动
            }

            if (!imgUrl) {
                logger.error(`[${createSystemActiveTag}] 图片上传失败: ${jumpTypeItem.title}，跳过该活动`);
                skipCount++;
                continue;
            }

            // 更新活动
            const updateResult = updateSystemActivity(data, activity.id, imgUrl, jumpTypeItem, i);
            if (updateResult) {
                successCount++;
                logger.info(`[${createSystemActiveTag}] 活动更新成功: ${jumpTypeItem.title}`);
            } else {
                logger.error(`[${createSystemActiveTag}] 活动更新失败: ${jumpTypeItem.title}`);
                skipCount++;
            }

            // 每次操作后睡眠0.5秒，避免触发频率限制
            sleep(0.5);
        }

        logger.info(`[${createSystemActiveTag}] 活动更新完成，成功: ${successCount}, 跳过: ${skipCount}`);

        // 第三步：等待3秒后启用所有活动
        sleep(3);
        const enableResult = enableSystemActivities(data, activityList);

        logger.info(`[${createSystemActiveTag}] 系统活动创建完成，共处理 ${successCount} 个活动`);

        return {
            success: successCount > 0,
            tag: createSystemActiveTag,
            message: `系统活动创建完成，成功: ${successCount}, 跳过: ${skipCount}`,
            systemActiveIds: [...systemActiveIds]
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSystemActiveTag}] 创建系统活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createSystemActiveTag,
            message: `创建系统活动失败: ${errorMsg}`
        };
    }
}

/**
 * 查询系统活动列表
 * @param {*} data 
 * @returns {Array} 系统活动列表
 */
function querySystemActivities(data) {
    const token = data.token;
    const api = '/api/ActivityInformation/GetPageList';
    const payload = {
        activityType: 0,
        pageSize: 50,
        sysLanguage: "en",
    };

    try {
        logger.info(`[${createSystemActiveTag}] 开始查询系统活动列表...`);

        let result = sendQueryRequest(payload, api, createSystemActiveTag, false, token);

        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }

        const activityList = [];

        if (result && result.list && result.list.length > 0) {
            logger.info(`[${createSystemActiveTag}] 查询到 ${result.list.length} 条系统活动记录`);

            result.list.forEach(item => {
                activityList.push({
                    id: item.id,
                    pageType: item.pageType,
                    title: item.titile
                });
                systemActiveIds.push(item.id);
            });
        } else {
            logger.warn(`[${createSystemActiveTag}] 查询结果为空或没有list字段`);
        }

        return activityList;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSystemActiveTag}] 查询系统活动列表时发生错误: ${errorMsg}`);
        return [];
    }
}

/**
 * 更新单个系统活动
 * @param {*} data 
 * @param {string} activityId 活动ID
 * @param {string} imgUrl 图片URL
 * @param {Object} jumpTypeItem 跳转类型信息
 * @param {number} sortIndex 排序值
 * @returns {boolean} 更新是否成功
 */
function updateSystemActivity(data, activityId, imgUrl, jumpTypeItem, sortIndex) {
    const token = data.token;
    const api = '/api/ActivityInformation/Update';

    const payload = {
        "imgUrl": imgUrl,
        "informationType": 2,
        "title": jumpTypeItem.title,
        "sort": sortIndex,
        "displayTarget": 1,
        "pageType": jumpTypeItem.pageType,
        "pageId": 0,
        "sysLanguage": "en",
        "id": activityId,
        "content": "",
    };

    try {
        const result = sendRequest(payload, api, createSystemActiveTag, false, token);
        return !!result;
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSystemActiveTag}] 更新系统活动请求异常: ${errorMsg}`);
        return false;
    }
}

/**
 * 启用系统活动
 * @param {*} data 
 * @param {Array} activityList 活动列表
 * @returns {boolean} 启用是否成功
 */
function enableSystemActivities(data, activityList) {
    const token = data.token;

    let allSuccess = true;
    let successCount = 0;

    activityList.forEach(activity => {
        try {
            const result = enableSystemActive(data, activity.id, 1, 'en');
            if (result) {
                successCount++;
                logger.info(`[${createSystemActiveTag}] 启用系统活动成功 ID: ${activity.id}`);
            } else {
                logger.error(`[${createSystemActiveTag}] 启用系统活动失败 ID: ${activity.id}`);
                allSuccess = false;
            }

            // 每次启用后睡眠0.5秒，避免触发频率限制
            sleep(0.5);
        } catch (error) {
            const errorMsg = getErrorMessage(error);
            logger.error(`[${createSystemActiveTag}] 启用系统活动异常 ID: ${activity.id}, 错误: ${errorMsg}`);
            allSuccess = false;
        }
    });

    logger.info(`[${createSystemActiveTag}] 系统活动启用完成，成功: ${successCount}/${activityList.length}`);

    return allSuccess;
}

/**
 * 启用单个系统活动
 * @param {*} data 
 * @param {string} id 活动id
 * @param {number} state 活动状态，1表示启动，0表示关闭
 * @param {string} sysLanguage 语言，默认 en
 * @returns {boolean} 启用是否成功
 */
function enableSystemActive(data, id, state, sysLanguage) {
    const token = data.token;
    const api = '/api/ActivityInformation/UpdateState';
    const payload = {
        id,
        state,
        sysLanguage,
    };

    try {
        const result = sendRequest(payload, api, createSystemActiveTag, false, token);
        return !!result;
    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createSystemActiveTag}] 启用系统活动请求异常: ${errorMsg}`);
        return false;
    }
}
