import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { systemJumpType } from '../../common/type.js';
import { uploadFile } from '../../uploadFile/uploadSystemActive.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getActiveLangs } from '../../../../config/languageConfig.js';
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

        // 获取所有激活的语言
        const languages = getActiveLangs();
        logger.info(`[${createSystemActiveTag}] 将为以下语言创建系统活动: ${languages.join(', ')}`);

        let totalSuccess = 0;
        let totalSkip = 0;

        // 为每种语言创建系统活动
        for (let langIndex = 0; langIndex < languages.length; langIndex++) {
            const language = languages[langIndex];
            logger.info(`\n[${createSystemActiveTag}] ========== 创建${language}语言的系统活动 (${langIndex + 1}/${languages.length}) ==========`);

            // 创建临时data对象，包含当前语言
            const langData = { ...data, language: language };

            // 第一步：查询系统活动列表，获取活动ID
            const activityList = querySystemActivities(langData);
            if (!activityList || activityList.length === 0) {
                logger.error(`[${createSystemActiveTag}] 查询${language}语言的系统活动列表失败`);
                totalSkip++;
                continue;
            }

            logger.info(`[${createSystemActiveTag}] 查询到 ${activityList.length} 个${language}语言的系统活动`);

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

                // 上传图片（只在第一次上传，后续语言复用）
                let imgUrl = null;
                if (langIndex === 0) {
                    try {
                        const uploadRes = uploadFile(filePath, token);
                        if (uploadRes && uploadRes.status === 200) {
                            const uploadData = JSON.parse(uploadRes.body);
                            if (uploadData.code === 0 && uploadData.data && uploadData.data.length > 0) {
                                imgUrl = uploadData.data[0].src;
                                logger.info(`[${createSystemActiveTag}] 图片上传成功: ${jumpTypeItem.pageType}.png`);
                                // 缓存图片URL供其他语言使用
                                jumpTypeItem.cachedImgUrl = imgUrl;
                            }
                        }
                    } catch (uploadError) {
                        const errorMsg = getErrorMessage(uploadError);
                        logger.error(`[${createSystemActiveTag}] 图片上传失败: ${jumpTypeItem.title}, 错误: ${errorMsg}`);
                        skipCount++;
                        continue;
                    }
                } else {
                    // 使用缓存的图片URL
                    imgUrl = jumpTypeItem.cachedImgUrl;
                }

                if (!imgUrl) {
                    logger.error(`[${createSystemActiveTag}] 图片URL不存在: ${jumpTypeItem.title}，跳过该活动`);
                    skipCount++;
                    continue;
                }

                // 更新活动
                const updateResult = updateSystemActivity(langData, activity.id, imgUrl, jumpTypeItem, i);
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

            logger.info(`[${createSystemActiveTag}] ${language}语言活动更新完成，成功: ${successCount}, 跳过: ${skipCount}`);

            // 第三步：等待3秒后启用所有活动
            sleep(3);
            const enableResult = enableSystemActivities(langData, activityList);

            totalSuccess += successCount;
            totalSkip += skipCount;

            // 语言之间间隔2秒
            if (langIndex < languages.length - 1) {
                logger.info(`[${createSystemActiveTag}] 等待2秒后处理下一个语言...`);
                sleep(2);
            }
        }

        logger.info(`\n[${createSystemActiveTag}] ========== 所有语言的系统活动创建完成 ==========`);
        logger.info(`[${createSystemActiveTag}] 总成功: ${totalSuccess}, 总跳过: ${totalSkip}`);

        return {
            success: totalSuccess > 0,
            tag: createSystemActiveTag,
            message: `系统活动创建完成，成功: ${totalSuccess}, 跳过: ${totalSkip}`,
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
    const language = data.language || "en"; // 从data中读取语言，默认英语
    const api = '/api/ActivityInformation/GetPageList';
    const payload = {
        pageNo: 1,
        pageSize: 50,
        sysLanguage: language,
        orderBy: "Desc"
        // 注意：不要添加 activityType 参数，会导致查询结果为空
    };

    try {
        logger.info(`[${createSystemActiveTag}] 开始查询系统活动列表，语言: ${language}...`);
        logger.info(`[${createSystemActiveTag}] 查询参数: ${JSON.stringify(payload)}`);

        let result = sendQueryRequest(payload, api, createSystemActiveTag, false, token);

        // 打印原始响应用于调试
        logger.info(`[${createSystemActiveTag}] 查询响应类型: ${typeof result}`);
        if (result) {
            const resultStr = JSON.stringify(result);
            logger.info(`[${createSystemActiveTag}] 查询响应长度: ${resultStr.length}`);
            logger.info(`[${createSystemActiveTag}] 查询响应前500字符: ${resultStr.substring(0, 500)}`);
        } else {
            logger.error(`[${createSystemActiveTag}] 查询响应为空或null`);
            return [];
        }

        if (typeof result !== 'object') {
            try {
                result = JSON.parse(result);
            } catch (parseError) {
                logger.error(`[${createSystemActiveTag}] JSON解析失败: ${parseError.message}`);
                return [];
            }
        }

        const activityList = [];

        // 检查多种可能的响应格式
        let dataList = null;
        if (result && result.list && Array.isArray(result.list)) {
            dataList = result.list;
        } else if (result && result.data && Array.isArray(result.data)) {
            dataList = result.data;
        } else if (result && result.data && result.data.list && Array.isArray(result.data.list)) {
            dataList = result.data.list;
        } else if (Array.isArray(result)) {
            dataList = result;
        }

        if (dataList && dataList.length > 0) {
            logger.info(`[${createSystemActiveTag}] 查询到 ${dataList.length} 条系统活动记录`);

            dataList.forEach(item => {
                activityList.push({
                    id: item.id,
                    pageType: item.pageType,
                    title: item.titile || item.title
                });
                systemActiveIds.push(item.id);
            });
        } else {
            logger.warn(`[${createSystemActiveTag}] 查询结果为空或没有list字段，语言: ${language}`);
            logger.warn(`[${createSystemActiveTag}] 响应结构: ${JSON.stringify(Object.keys(result || {}))}`);
            logger.warn(`[${createSystemActiveTag}] 完整响应: ${JSON.stringify(result)}`);
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
    const language = data.language || "en"; // 从data中读取语言，默认英语
    const api = '/api/ActivityInformation/Update';

    const payload = {
        "imgUrl": imgUrl,
        "informationType": 2,
        "title": jumpTypeItem.title,
        "sort": sortIndex,
        "displayTarget": 1,
        "pageType": jumpTypeItem.pageType,
        "pageId": 0,
        "sysLanguage": language,
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
    const language = data.language || "en"; // 从data中读取语言，默认英语

    let allSuccess = true;
    let successCount = 0;

    activityList.forEach(activity => {
        try {
            const result = enableSystemActive(data, activity.id, 1, language);
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
