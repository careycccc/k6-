import http from 'k6/http';
import { check, sleep } from 'k6';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { logger } from '../../../libs/utils/logger.js';

/**
 * 创建图片上传函数的工厂
 * 
 * 使用方法：
 * 1. 在模块顶层调用此函数创建上传器
 * 2. 传入相对于调用模块的图片路径
 * 3. 返回的函数可以在 VU 代码中调用
 * 
 * @param {string} imagePath - 相对于调用模块的图片路径
 * @param {string} activityName - 活动名称（用于日志）
 * @returns {Function} 上传函数 (token) => { success, file, src, error }
 * 
 * @example
 * // 在模块顶层
 * const uploadChampionImage = createImageUploader('../../uploadFile/img/champion/1.png', 'champion');
 * 
 * // 在 VU 代码中
 * export function myTest(data) {
 *   const result = uploadChampionImage(data.token);
 *   if (result.success) {
 *     console.log('上传成功:', result.file);
 *   }
 * }
 */
export function createImageUploader(imagePath, activityName) {
    // 在模块初始化阶段预加载图片内容
    let imageContent;
    let fileName;

    try {
        // 注意：k6 会显示关于 open() 路径解析的警告，这是正常的
        // 警告提示未来版本会改变路径解析方式，但当前版本功能正常
        imageContent = open(imagePath, 'b');
        fileName = imagePath.split('/').pop();
        logger.info(`[${activityName}] 图片预加载成功: ${imagePath}`);
    } catch (error) {
        logger.warn(`[${activityName}] 图片预加载失败（文件不存在）: ${imagePath}`);
        // 返回一个总是失败的函数，并标记为预加载失败
        const failedUploader = function (token) {
            return {
                success: false,
                error: `Image preload failed: ${error.message}`
            };
        };
        failedUploader.preloadFailed = true;
        return failedUploader;
    }

    // 返回实际的上传函数（在 VU 代码中调用）
    return function uploadImage(token) {
        // 内部上传执行函数
        const executeUpload = () => {
            try {
                // 构建表单数据
                const formData = {
                    files: http.file(imageContent, fileName, 'image/png'),
                    fileType: 'other',
                    customPath: '',
                };

                const headerUrl = ENV_CONFIG.BASE_ADMIN_URL;
                const host = headerUrl.replace(/^(https?:\/\/)?([^:\/\s]+).*$/, '$2');

                // 设置请求头
                const params = {
                    headers: {
                        'Host': `${host}`,
                        'ignorecanceltoken': 'true',
                        'referer': `${headerUrl}/`,
                        'sec-ch-ua-mobile': '?0',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                        'accept': 'application/json, text/plain, */*',
                        'origin': `${headerUrl}/`,
                        'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
                        'accept-language': 'zh-CN,zh;q=0.9',
                        'authorization': `Bearer ${token}`,
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-site': 'same-origin',
                        'accept-encoding': 'gzip, deflate, br, zstd',
                        'priority': 'u=1, i',
                        'domainurl': `${headerUrl}/`,
                        'sec-fetch-mode': 'cors',
                        'sec-ch-ua-platform': '"Windows"',
                    },
                };

                // 发送POST请求
                const res = http.post(`${ENV_CONFIG.BASE_ADMIN_URL}/api/UploadFile/UploadToOss`, formData, params);

                // 检查响应
                check(res, {
                    'status is 200': (r) => r.status === 200,
                });

                if (res.status === 200) {
                    const data = JSON.parse(res.body);
                    if (data.code === 0 && data.data && data.data.length > 0) {
                        return {
                            success: true,
                            file: data.data[0].title,
                            src: data.data[0].src
                        };
                    } else {
                        return {
                            success: false,
                            error: `Upload failed: ${data.msg || 'Unknown error'}`
                        };
                    }
                } else {
                    return {
                        success: false,
                        error: `HTTP ${res.status}`
                    };
                }
            } catch (error) {
                const errorMsg = error && error.message ? error.message : String(error);
                return {
                    success: false,
                    error: `Upload exception: ${errorMsg}`
                };
            }
        };

        // 第一次尝试上传
        let result = executeUpload();

        // 如果第一次失败，等待2秒后重试一次
        if (!result.success) {
            logger.warn(`[${activityName}] 图片上传失败: ${result.error}，等待2秒后重试`);
            sleep(2);

            logger.info(`[${activityName}] 重试上传图片: ${fileName}`);
            result = executeUpload();

            if (!result.success) {
                logger.error(`[${activityName}] 图片重试上传仍然失败: ${result.error}`);
            } else {
                logger.info(`[${activityName}] 图片重试上传成功`);
            }
        }

        return result;
    };
}

/**
 * 通用的活动创建辅助函数
 * 处理图片上传和缓存逻辑
 * 
 * @param {Object} data - 包含 token 的数据对象
 * @param {string} cacheKey - 用于缓存图片路径的键名（如 'championImagePath'）
 * @param {Function} uploadFn - 上传函数
 * @param {string} activityTag - 活动标签（用于日志）
 * @returns {Object} { success, imagePath, error }
 */
export function handleImageUpload(data, cacheKey, uploadFn, activityTag) {
    // 检查是否已经上传了图片
    let imagePath = data[cacheKey];

    if (!imagePath) {
        logger.info(`[${activityTag}] 未检测到图片资源，开始上传图片...`);

        const uploadResult = uploadFn(data.token);

        if (uploadResult.success) {
            imagePath = uploadResult.file;
            logger.info(`[${activityTag}] 图片上传成功: ${imagePath}`);
            return { success: true, imagePath };
        } else {
            logger.error(`[${activityTag}] 图片上传失败: ${uploadResult.error}`);
            return {
                success: false,
                error: uploadResult.error
            };
        }
    } else {
        logger.info(`[${activityTag}] 使用已上传的图片: ${imagePath}`);
        return { success: true, imagePath };
    }
}

/**
 * 安全地获取错误信息
 * @param {*} error 错误对象
 * @returns {string} 错误信息字符串
 */
export function getErrorMessage(error) {
    if (!error) return '未知错误';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
}
