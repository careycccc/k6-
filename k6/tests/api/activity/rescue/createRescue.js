import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, handleImageUpload, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { sleep } from 'k6';

export const createRescueTag = 'createRescue';
export const createRescue2Tag = 'createRescue2';

// 在模块顶层预加载图片（用于活动封面）
const uploadRescueImage = createImageUploader('../../uploadFile/img/rescue/1.png', 'rescue');
const uploadRescueImage2 = createImageUploader('../../uploadFile/img/rescue/2.png', 'rescue2');

// 预加载规则描述图片（多语言）- 第一个活动
const uploadRescueRuleHi = createImageUploader('../../uploadFile/img/rescue/rule_hi.png', 'rescue_rule_hi');
const uploadRescueRuleEn = createImageUploader('../../uploadFile/img/rescue/rule_en.png', 'rescue_rule_en');
const uploadRescueRuleZh = createImageUploader('../../uploadFile/img/rescue/rule_zh.png', 'rescue_rule_zh');

// 预加载规则描述图片（多语言）- 第二个活动
const uploadRescue2RuleHi = createImageUploader('../../uploadFile/img/rescue/rule2_hi.png', 'rescue2_rule_hi');
const uploadRescue2RuleEn = createImageUploader('../../uploadFile/img/rescue/rule2_en.png', 'rescue2_rule_en');
const uploadRescue2RuleZh = createImageUploader('../../uploadFile/img/rescue/rule2_zh.png', 'rescue2_rule_zh');



/**
 * 格式化日期时间为 "YYYY-MM-DD HH:mm:ss" 格式
 * @param {Date} date 
 * @returns {string}
 */
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 计算活动开始时间（第二天00:00:00）
 * @returns {Date}
 */
function calculateStartTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
}

/**
 * 计算活动结束时间（开始时间后第5天的23:59:59）
 * @param {Date} startTime 
 * @returns {Date}
 */
function calculateEndTime(startTime) {
    const endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + 5);
    endTime.setHours(23, 59, 59, 0);
    return endTime;
}

/**
 * 创建亏损救援金活动（自动创建两个活动）
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createRescue(data) {
    logger.info(`[${createRescueTag}] 开始创建亏损救援金活动（共2个）`);

    const results = {
        activity1: null,
        activity2: null,
        success: false,
        tag: createRescueTag,
        message: ''
    };

    try {
        // 创建活动1：按比例返还 - JILI游戏
        logger.info(`[${createRescueTag}] ========== 创建活动1：按比例返还 - JILI游戏 ==========`);
        results.activity1 = createRescueActivity1(data);

        // 创建活动2：按金额返还 - AR彩票
        logger.info(`[${createRescueTag}] ========== 创建活动2：按金额返还 - AR彩票 ==========`);
        results.activity2 = createRescue2(data);

        // 检查是否至少有一个活动创建成功
        const activity1Success = results.activity1.success;
        const activity2Success = results.activity2.success;

        if (!activity1Success && !activity2Success) {
            results.success = false;
            results.message = '两个亏损救援金活动都创建失败，结束流程';
            logger.error(`[${createRescueTag}] ❌ ${results.message}`);
            return results;
        }

        // 至少有一个活动创建成功，继续查询和启用
        logger.info(`[${createRescueTag}] ========== 开始查询和启用活动 ==========`);

        // 查询和启用活动1
        if (activity1Success && results.activity1.activityName) {
            logger.info(`[${createRescueTag}] 查询活动1: ${results.activity1.activityName}`);
            const queryResult1 = queryRescueActivity(data, results.activity1.activityName);

            if (queryResult1.success && queryResult1.id) {
                logger.info(`[${createRescueTag}] 启用活动1 (ID: ${queryResult1.id})`);
                const enableResult1 = enableRescueActivity(data, queryResult1.id);
                results.activity1.enabled = enableResult1.success;
                results.activity1.enableMessage = enableResult1.message;
            } else {
                results.activity1.enabled = false;
                results.activity1.enableMessage = queryResult1.message;
            }
        }

        // 查询和启用活动2
        if (activity2Success && results.activity2.activityName) {
            logger.info(`[${createRescueTag}] 查询活动2: ${results.activity2.activityName}`);
            const queryResult2 = queryRescueActivity(data, results.activity2.activityName);

            if (queryResult2.success && queryResult2.id) {
                logger.info(`[${createRescueTag}] 启用活动2 (ID: ${queryResult2.id})`);
                const enableResult2 = enableRescueActivity(data, queryResult2.id);
                results.activity2.enabled = enableResult2.success;
                results.activity2.enableMessage = enableResult2.message;
            } else {
                results.activity2.enabled = false;
                results.activity2.enableMessage = queryResult2.message;
            }
        }

        // 汇总最终结果
        const activity1Enabled = results.activity1?.enabled || false;
        const activity2Enabled = results.activity2?.enabled || false;

        if (activity1Success && activity2Success && activity1Enabled && activity2Enabled) {
            results.success = true;
            results.message = '两个亏损救援金活动都创建并启用成功';
            logger.info(`[${createRescueTag}] ✅ ${results.message}`);
        } else if ((activity1Success && activity1Enabled) || (activity2Success && activity2Enabled)) {
            results.success = true;
            results.message = `部分活动创建并启用成功`;
            logger.warn(`[${createRescueTag}] ⚠️ ${results.message}`);
        } else {
            results.success = false;
            results.message = '活动创建成功但启用失败';
            logger.error(`[${createRescueTag}] ❌ ${results.message}`);
        }

        return results;

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRescueTag}] 创建亏损救援金活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRescueTag,
            message: `创建亏损救援金活动失败: ${errorMsg}`,
            activity1: results.activity1,
            activity2: results.activity2
        };
    }
}

/**
 * 创建亏损救援金活动1（按比例返还 - JILI游戏）
 * @param {*} data 
 * @returns {Object} 创建结果
 */
function createRescueActivity1(data) {
    const tag = 'createRescue1';
    logger.info(`[${tag}] 开始创建活动1`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${tag}] Token 不存在，无法创建活动1`);
            return {
                success: false,
                tag: tag,
                message: 'Token 不存在，跳过活动1创建'
            };
        }

        // 第一步：上传活动封面图片
        const imageUploadResult = handleImageUpload(
            data,
            'rescueImagePath',
            uploadRescueImage,
            tag
        );

        if (!imageUploadResult.success) {
            return {
                success: false,
                tag: tag,
                message: `图片上传失败: ${imageUploadResult.error}`
            };
        }

        const imageUrl = imageUploadResult.imagePath;
        logger.info(`[${tag}] 活动封面图片路径: ${imageUrl}`);

        // 上传规则描述图片（多语言）
        const ruleImageHi = handleImageUpload(data, 'rescueRuleImageHi', uploadRescueRuleHi, tag);
        const ruleImageEn = handleImageUpload(data, 'rescueRuleImageEn', uploadRescueRuleEn, tag);
        const ruleImageZh = handleImageUpload(data, 'rescueRuleImageZh', uploadRescueRuleZh, tag);

        if (!ruleImageHi.success || !ruleImageEn.success || !ruleImageZh.success) {
            return {
                success: false,
                tag: tag,
                message: '规则描述图片上传失败'
            };
        }

        // 获取完整的图片URL（用于规则描述）
        const baseUrl = 'https://sit.arsaassit-pub.club';
        const ruleImageHiUrl = `${baseUrl}/${ruleImageHi.imagePath}`;
        const ruleImageEnUrl = `${baseUrl}/${ruleImageEn.imagePath}`;
        const ruleImageZhUrl = `${baseUrl}/${ruleImageZh.imagePath}`;

        // 第二步：计算活动时间
        const startTime = calculateStartTime();
        const endTime = calculateEndTime(startTime);
        const startTimeStr = formatDateTime(startTime);
        const endTimeStr = formatDateTime(endTime);

        // 计算周期轮次时间戳（毫秒）
        const cycleRounds = [startTime.getTime(), endTime.getTime()];

        // 生成带时间戳的活动名称
        const timestamp = Date.now();
        const activityName = `亏损救援金-按比例返还-jili限制_${timestamp}`;

        logger.info(`[${tag}] 活动名称: ${activityName}`);
        logger.info(`[${tag}] 开始时间: ${startTimeStr}`);
        logger.info(`[${tag}] 结束时间: ${endTimeStr}`);

        // 第三步：构建请求payload
        const api = '/api/LossRelief/Add';
        const payload = {
            "activityName": activityName,
            "priority": 10,
            "imageUrl": imageUrl,
            "cycleRounds": cycleRounds,
            "startDate": startTimeStr,
            "endDate": endTimeStr,
            "cycleRoundDay": 1,
            "targetDetail": "3,4,5,6,7,8,9,10,11,12",
            "recivedLimitDay": 1,
            "codingMultiple": 3,
            "rewardConfigDetail": {
                "rewardType": 0,
                "rewardConfig": [
                    {
                        "index": 1,
                        "minLossAmount": 100,
                        "returnRate": 1,
                        "maxReturnAmount": 1
                    },
                    {
                        "index": 2,
                        "minLossAmount": 1000,
                        "returnRate": 2,
                        "maxReturnAmount": 15
                    },
                    {
                        "index": 3,
                        "minLossAmount": 10000,
                        "returnRate": 5,
                        "maxReturnAmount": 500
                    }
                ]
            },
            "limitGame": [
                {
                    "vendorCode": "JILI",
                    "gameCode": [
                        "113", "124", "108", "110", "180", "264", "172", "48", "181", "152",
                        "36", "10", "423", "375", "301", "14", "403", "49", "47", "259",
                        "303", "16", "118", "209", "193", "258", "6", "85", "38", "35",
                        "504", "92", "420", "51", "45", "378", "40", "302", "137", "208",
                        "176", "4", "76", "26", "164", "67", "408", "103", "424", "182",
                        "191", "87", "183", "58", "5", "144", "27", "32", "21", "166",
                        "33", "223", "300", "109", "379", "130", "123", "102", "637", "135",
                        "101", "78", "226", "299", "376", "240", "1", "2", "126", "13",
                        "77", "30", "547", "399", "263", "372", "136", "142", "17", "46",
                        "377", "146", "111", "422", "23", "198", "394", "125", "115", "74",
                        "374", "134", "9", "112", "43", "91", "529", "421", "536", "400",
                        "307", "214", "583", "392", "37", "228", "563", "145", "100", "252",
                        "44", "171", "238", "177", "148", "147", "143", "440", "149", "216",
                        "197", "204", "261", "469", "407", "459", "153", "225", "462", "230",
                        "473", "239", "604", "114", "389", "139", "441", "436", "698", "442",
                        "178", "224", "554", "116", "233", "122", "174", "397", "297", "241",
                        "272", "235", "150", "624", "217", "229", "254", "546", "324", "200",
                        "195", "419", "242", "551", "262", "439", "151", "305", "427", "232",
                        "106", "173", "236", "179"
                    ]
                }
            ],
            "translations": [
                {
                    "language": "hi",
                    "name": "हानि राहत कोष - आनुपातिक वापसी",
                    "ruleDescription": `<p><img data-src="${ruleImageHiUrl}" src="${ruleImageHiUrl}" data-image-id="img0" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "en",
                    "name": "Loss Relief Fund - Proportional Refund",
                    "ruleDescription": `<p><img data-src="${ruleImageEnUrl}" src="${ruleImageEnUrl}" data-image-id="img1" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "zh",
                    "name": "亏损救援金-按比例返还",
                    "ruleDescription": `<p><img data-src="${ruleImageZhUrl}" src="${ruleImageZhUrl}" data-image-id="img2" style="vertical-align: baseline;"></p>`
                }
            ],
            "random": Math.floor(Math.random() * 1000000000000),
            "language": "zh"
        };

        logger.info(`[${tag}] 发送创建请求...`);
        const result = sendRequest(payload, api, tag, false, token);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 活动1创建成功`);
            return {
                success: true,
                tag: tag,
                message: '活动1创建成功',
                activityName: activityName
            };
        } else {
            logger.error(`[${tag}] 活动1创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                tag: tag,
                message: `活动1创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 创建活动1时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: tag,
            message: `创建活动1失败: ${errorMsg}`
        };
    }
}


/**
 * 创建亏损救援金活动2（按金额返还-限制AR彩票）
 * @param {*} data 
 * @returns {Object} 创建结果
 */
export function createRescue2(data) {
    logger.info(`[${createRescue2Tag}] 开始创建亏损救援金活动2（按金额返还）`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createRescue2Tag}] Token 不存在，无法创建亏损救援金活动2`);
            return {
                success: false,
                tag: createRescue2Tag,
                message: 'Token 不存在，跳过亏损救援金活动2创建'
            };
        }

        // 检查图片文件是否存在
        const has2Png = !uploadRescueImage2.preloadFailed;
        const has1Png = !uploadRescueImage.preloadFailed;

        if (!has2Png && !has1Png) {
            logger.error(`[${createRescue2Tag}] 2.png 和 1.png 都不存在，跳过活动创建`);
            return {
                success: false,
                tag: createRescue2Tag,
                message: '图片文件不存在（2.png 和 1.png 都不存在），跳过活动创建'
            };
        }

        // 选择使用哪个图片上传器
        const imageUploader = has2Png ? uploadRescueImage2 : uploadRescueImage;
        const imageName = has2Png ? '2.png' : '1.png';
        logger.info(`[${createRescue2Tag}] 使用图片: ${imageName}`);

        // 第一步：上传活动封面图片
        const imageUploadResult = handleImageUpload(
            data,
            'rescue2ImagePath',
            imageUploader,
            createRescue2Tag
        );

        if (!imageUploadResult.success) {
            return {
                success: false,
                tag: createRescue2Tag,
                message: `图片上传失败: ${imageUploadResult.error}`
            };
        }

        const imageUrl = imageUploadResult.imagePath;
        logger.info(`[${createRescue2Tag}] 活动封面图片路径: ${imageUrl}`);

        // 上传规则描述图片（多语言）
        const ruleImageHi = handleImageUpload(data, 'rescue2RuleImageHi', uploadRescue2RuleHi, createRescue2Tag);
        const ruleImageEn = handleImageUpload(data, 'rescue2RuleImageEn', uploadRescue2RuleEn, createRescue2Tag);
        const ruleImageZh = handleImageUpload(data, 'rescue2RuleImageZh', uploadRescue2RuleZh, createRescue2Tag);

        if (!ruleImageHi.success || !ruleImageEn.success || !ruleImageZh.success) {
            return {
                success: false,
                tag: createRescue2Tag,
                message: '规则描述图片上传失败'
            };
        }

        // 获取完整的图片URL（用于规则描述）
        const baseUrl = 'https://sit.arsaassit-pub.club';
        const ruleImageHiUrl = `${baseUrl}/${ruleImageHi.imagePath}`;
        const ruleImageEnUrl = `${baseUrl}/${ruleImageEn.imagePath}`;
        const ruleImageZhUrl = `${baseUrl}/${ruleImageZh.imagePath}`;

        // 第二步：计算活动时间
        const startTime = calculateStartTime();
        const endTime = new Date(startTime);
        endTime.setDate(endTime.getDate() + 3); // 开始后第3天
        endTime.setHours(23, 59, 59, 0);

        const startTimeStr = formatDateTime(startTime);
        const endTimeStr = formatDateTime(endTime);

        // 计算周期轮次时间戳（毫秒）
        const cycleRounds = [startTime.getTime(), endTime.getTime()];

        // 生成带时间戳的活动名称
        const timestamp = Date.now();
        const activityName = `亏损救援金-按金额返还-限制AR彩票_${timestamp}`;

        logger.info(`[${createRescue2Tag}] 活动名称: ${activityName}`);
        logger.info(`[${createRescue2Tag}] 开始时间: ${startTimeStr}`);
        logger.info(`[${createRescue2Tag}] 结束时间: ${endTimeStr}`);

        // 第三步：构建请求payload
        const api = '/api/LossRelief/Add';
        const payload = {
            "activityName": activityName,
            "priority": 11,
            "imageUrl": imageUrl, // 相对路径
            "cycleRounds": cycleRounds,
            "startDate": startTimeStr,
            "endDate": endTimeStr,
            "cycleRoundDay": 2,
            "targetDetail": "0,1", // VIP等级 0-1
            "recivedLimitDay": 1,
            "codingMultiple": 2,
            "rewardConfigDetail": {
                "rewardType": 1, // 按金额返还
                "rewardConfig": [
                    {
                        "index": 1,
                        "minLossAmount": 1000,
                        "maxReturnAmount": 0,
                        "returnAmount": 10
                    },
                    {
                        "index": 2,
                        "minLossAmount": 2000,
                        "maxReturnAmount": 0,
                        "returnAmount": 50
                    },
                    {
                        "index": 3,
                        "minLossAmount": 5000,
                        "maxReturnAmount": 0,
                        "returnAmount": 1000
                    }
                ]
            },
            "limitGame": [
                {
                    "vendorCode": "ARLottery",
                    "gameCode": [
                        "D5_10M", "D5_1M", "D5_3M", "D5_5M",
                        "MotoRace_1M",
                        "LuckyWinGo_30S",
                        "K3_10M", "K3_1M", "K3_3M", "K3_5M",
                        "TrxWinGo_10M", "TrxWinGo_1M", "TrxWinGo_3M", "TrxWinGo_5M",
                        "WinGo_1M", "WinGo_30S", "WinGo_3M", "WinGo_5M"
                    ]
                }
            ],
            "translations": [
                {
                    "language": "hi",
                    "name": "हानि वसूली कोष - आनुपातिक आधार पर प्रतिपूर्ति",
                    "ruleDescription": `<p><img data-src="${ruleImageHiUrl}" src="${ruleImageHiUrl}" data-image-id="img3" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "en",
                    "name": "Loss Recovery Fund - Refunded on a Pro Rata Basis",
                    "ruleDescription": `<p><img data-src="${ruleImageEnUrl}" src="${ruleImageEnUrl}" data-image-id="img4" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "zh",
                    "name": "亏损救援金-按金额返还",
                    "ruleDescription": `<p><img data-src="${ruleImageZhUrl}" src="${ruleImageZhUrl}" data-image-id="img5" style="vertical-align: baseline;"></p>`
                }
            ],
            "random": Math.floor(Math.random() * 1000000000000),
            "language": "zh"
        };

        logger.info(`[${createRescue2Tag}] 发送创建请求...`);
        const result = sendRequest(payload, api, createRescue2Tag, false, token);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${createRescue2Tag}] 亏损救援金活动2创建成功`);
            return {
                success: true,
                tag: createRescue2Tag,
                message: '亏损救援金活动2创建成功',
                activityName: activityName
            };
        } else {
            logger.error(`[${createRescue2Tag}] 亏损救援金活动2创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                tag: createRescue2Tag,
                message: `亏损救援金活动2创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createRescue2Tag}] 创建亏损救援金活动2时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createRescue2Tag,
            message: `创建亏损救援金活动2失败: ${errorMsg}`
        };
    }
}


/**
 * 查询亏损救援金活动并获取ID
 * @param {*} data 
 * @param {string} activityName 活动名称
 * @returns {Object} 查询结果 { success, id, message }
 */
function queryRescueActivity(data, activityName) {
    const token = data.token;
    const api = '/api/LossRelief/GetPageList';
    const tag = 'queryRescue';

    try {
        logger.info(`[${tag}] 查询亏损救援金活动: ${activityName}`);

        const payload = {
            "activityName": activityName,
            "pageNo": 1,
            "pageSize": 20,
            "orderBy": "Desc"
        };

        const result = sendQueryRequest(payload, api, tag, false, token);

        if (!result) {
            logger.error(`[${tag}] 查询活动失败: 响应为空`);
            return {
                success: false,
                message: '查询活动失败: 响应为空'
            };
        }

        //logger.info(`[${tag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let activityList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${tag}] 查询活动失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询活动失败: ${result.msg || '未知错误'}`
                };
            }
            activityList = result.data?.list || result.list || [];
        } else {
            activityList = result.list || [];
        }

        if (!activityList || !Array.isArray(activityList) || activityList.length === 0) {
            logger.error(`[${tag}] 活动列表为空，无法继续操作`);
            return {
                success: false,
                message: '活动列表为空'
            };
        }

        logger.info(`[${tag}] 查询到 ${activityList.length} 个活动`);

        // 获取第一个活动的ID
        const targetActivity = activityList[0];
        const activityId = targetActivity.id;

        logger.info(`[${tag}] 获取到活动ID: ${activityId}`);

        return {
            success: true,
            id: activityId,
            message: `成功获取活动ID: ${activityId}`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 查询活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 启用亏损救援金活动
 * @param {*} data 
 * @param {number} activityId 活动ID
 * @returns {Object} 启用结果 { success, message }
 */
function enableRescueActivity(data, activityId) {
    const token = data.token;
    const api = '/api/LossRelief/UpdateState';
    const tag = 'enableRescue';

    try {
        logger.info(`[${tag}] 启用亏损救援金活动 (ID: ${activityId})`);

        const payload = {
            "id": activityId,
            "state": 1
        };

        const result = sendRequest(payload, api, tag, false, token);

        //logger.info(`[${tag}] 启用响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        const isSuccess = result === true || (result && result.msgCode === 0);

        if (isSuccess) {
            logger.info(`[${tag}] 活动启用成功`);
            return {
                success: true,
                message: '活动启用成功'
            };
        } else {
            logger.error(`[${tag}] 活动启用失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `活动启用失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${tag}] 启用活动时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `启用失败: ${errorMsg}`
        };
    }
}
