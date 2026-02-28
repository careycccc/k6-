import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { createImageUploader, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { orderSystemConfig } from './oderyconfig.js';

export const createOrdersystemTag = 'createOrdersystem';

// 在模块顶层创建FAQ图片上传器
const uploadFaqImage1 = createImageUploader('../../uploadFile/img/faq/1.png', createOrdersystemTag);
const uploadFaqImage2 = createImageUploader('../../uploadFile/img/faq/2.png', createOrdersystemTag);

// 在模块顶层创建工单图片上传器
// 尝试创建所有25个上传器，如果图片不存在会返回失败的上传器（警告级别）
// 运行时会自动跳过失败的上传器
const orderImageUploaders = {};

for (let i = 1; i <= 25; i++) {
    const imgName = `${i}.png`;
    orderImageUploaders[imgName] = createImageUploader(`../../uploadFile/img/order/${imgName}`, createOrdersystemTag);
}

logger.info(`[${createOrdersystemTag}] 图片上传器初始化完成，已尝试加载 25 个图片上传器`);

/**
 * 创建工单系统
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示活动创建成功
 * - success: false 表示跳过该活动，不进行创建
 */
export function createOrdersystem(data) {
    logger.info(`[${createOrdersystemTag}] 开始创建工单系统`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createOrdersystemTag}] Token 不存在，无法创建工单系统`);
            return {
                success: false,
                tag: createOrdersystemTag,
                message: 'Token 不存在，跳过工单系统创建'
            };
        }

        // 步骤1：创建FAQ模块1 - 账户问题
        logger.info(`[${createOrdersystemTag}] ========== 步骤1：创建FAQ模块1 - 账户问题 ==========`);
        const module1Result = createFaqModule1(data);
        if (!module1Result.success) {
            return {
                success: false,
                tag: createOrdersystemTag,
                message: `创建FAQ模块1失败: ${module1Result.message}`
            };
        }

        // 等待3秒避免频繁访问
        sleep(3);

        // 步骤2：创建FAQ模块2 - 游戏问题
        logger.info(`[${createOrdersystemTag}] ========== 步骤2：创建FAQ模块2 - 游戏问题 ==========`);
        const module2Result = createFaqModule2(data);
        if (!module2Result.success) {
            return {
                success: false,
                tag: createOrdersystemTag,
                message: `创建FAQ模块2失败: ${module2Result.message}`
            };
        }

        // 等待3秒避免频繁访问
        sleep(3);

        // 步骤3：查询FAQ模块列表并保存ID
        logger.info(`[${createOrdersystemTag}] ========== 步骤3：查询FAQ模块列表 ==========`);
        const queryResult = queryFaqModules(data);
        if (!queryResult.success) {
            logger.warn(`[${createOrdersystemTag}] 查询FAQ模块列表失败，跳过子问题创建: ${queryResult.message}`);
            return {
                success: true,
                tag: createOrdersystemTag,
                message: '工单系统创建成功（未创建子问题）'
            };
        }

        const moduleIds = queryResult.moduleIds;
        logger.info(`[${createOrdersystemTag}] 获取到 ${moduleIds.length} 个模块ID`);

        // 等待3秒避免频繁访问
        sleep(3);

        // 步骤4：为每个模块创建FAQ子问题
        logger.info(`[${createOrdersystemTag}] ========== 步骤4：创建FAQ子问题 ==========`);
        const faqResult = createFaqQuestions(data, moduleIds);
        if (!faqResult.success) {
            logger.warn(`[${createOrdersystemTag}] 创建FAQ子问题失败: ${faqResult.message}`);
        }

        // 等待3秒避免频繁访问
        sleep(3);

        // 步骤5：创建工单表单
        logger.info(`[${createOrdersystemTag}] ========== 步骤5：创建工单表单 ==========`);
        const orderFormsResult = createOrderForms(data);
        if (!orderFormsResult.success) {
            logger.warn(`[${createOrdersystemTag}] 创建工单表单失败: ${orderFormsResult.message}`);
        }

        logger.info(`[${createOrdersystemTag}] 工单系统创建成功`);
        return {
            success: true,
            tag: createOrdersystemTag,
            message: '工单系统创建成功'
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 创建工单系统时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createOrdersystemTag,
            message: `创建工单系统失败: ${errorMsg}`
        };
    }
}

/**
 * 创建FAQ模块1 - 账户问题
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createFaqModule1(data) {
    const token = data.token;
    const api = '/api/FaqModule/Add';

    try {
        logger.info(`[${createOrdersystemTag}] 创建FAQ模块1 - 账户问题`);

        const payload = {
            "sort": 1,
            "state": 1,
            "translations": [
                {
                    "language": "hi",
                    "moduleName": "खाते की समस्या"
                },
                {
                    "language": "en",
                    "moduleName": "Account problem"
                },
                {
                    "language": "zh",
                    "moduleName": "账户问题"
                }
            ]
        };

        logger.info(`[${createOrdersystemTag}] FAQ模块1 payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createOrdersystemTag, false, token);

        logger.info(`[${createOrdersystemTag}] FAQ模块1创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createOrdersystemTag}] FAQ模块1创建成功`);
            return { success: true };
        } else {
            logger.error(`[${createOrdersystemTag}] FAQ模块1创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `FAQ模块1创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 创建FAQ模块1时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建FAQ模块1失败: ${errorMsg}`
        };
    }
}

/**
 * 创建FAQ模块2 - 游戏问题
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createFaqModule2(data) {
    const token = data.token;
    const api = '/api/FaqModule/Add';

    try {
        logger.info(`[${createOrdersystemTag}] 创建FAQ模块2 - 游戏问题`);

        const payload = {
            "sort": 2,
            "state": 1,
            "translations": [
                {
                    "language": "hi",
                    "moduleName": "गेम संबंधी समस्याएँ"
                },
                {
                    "language": "en",
                    "moduleName": "Game issues"
                },
                {
                    "language": "zh",
                    "moduleName": "游戏问题"
                }
            ]
        };

        logger.info(`[${createOrdersystemTag}] FAQ模块2 payload: ${JSON.stringify(payload)}`);

        const result = sendRequest(payload, api, createOrdersystemTag, false, token);

        logger.info(`[${createOrdersystemTag}] FAQ模块2创建响应: ${JSON.stringify(result)}`);

        // 检查返回结果
        if (result && result.msgCode === 0) {
            logger.info(`[${createOrdersystemTag}] FAQ模块2创建成功`);
            return { success: true };
        } else {
            logger.error(`[${createOrdersystemTag}] FAQ模块2创建失败: ${result?.msg || '未知错误'}`);
            return {
                success: false,
                message: `FAQ模块2创建失败: ${result?.msg || '未知错误'}`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 创建FAQ模块2时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建FAQ模块2失败: ${errorMsg}`
        };
    }
}



/**
 * 查询FAQ模块列表
 * @param {*} data
 * @returns {Object} 查询结果 { success, moduleIds, message }
 */
function queryFaqModules(data) {
    const token = data.token;
    const api = '/api/FaqModule/GetPageList';

    try {
        logger.info(`[${createOrdersystemTag}] 查询FAQ模块列表`);

        const payload = {};

        const result = sendQueryRequest(payload, api, createOrdersystemTag, false, token);

        if (!result) {
            logger.error(`[${createOrdersystemTag}] 查询FAQ模块列表失败: 响应为空`);
            return {
                success: false,
                message: '查询FAQ模块列表失败: 响应为空'
            };
        }

        //logger.info(`[${createOrdersystemTag}] 查询响应: ${JSON.stringify(result)}`);

        // 解析响应
        let moduleList;
        if (result.msgCode !== undefined) {
            if (result.msgCode !== 0) {
                logger.error(`[${createOrdersystemTag}] 查询FAQ模块列表失败: ${result.msg}`);
                return {
                    success: false,
                    message: `查询FAQ模块列表失败: ${result.msg || '未知错误'}`
                };
            }
            // 从 data.list 中获取列表
            moduleList = result.data?.list || result.list || [];
        } else {
            moduleList = result.list || [];
        }

        if (!moduleList || !Array.isArray(moduleList) || moduleList.length === 0) {
            logger.warn(`[${createOrdersystemTag}] FAQ模块列表为空`);
            return {
                success: false,
                message: 'FAQ模块列表为空'
            };
        }

        logger.info(`[${createOrdersystemTag}] 查询到 ${moduleList.length} 个FAQ模块`);

        // 提取前2项模块的ID
        const moduleIds = [];
        const maxItems = Math.min(2, moduleList.length);

        for (let i = 0; i < maxItems; i++) {
            const module = moduleList[i];
            if (module.id) {
                moduleIds.push(module.id);
                logger.info(`[${createOrdersystemTag}] 模块 ${i + 1}: ID=${module.id}, Name="${module.moduleName}"`);
            }
        }

        if (moduleIds.length === 0) {
            logger.warn(`[${createOrdersystemTag}] 未找到有效的模块ID`);
            return {
                success: false,
                message: '未找到有效的模块ID'
            };
        }

        return {
            success: true,
            moduleIds: moduleIds,
            message: `成功获取 ${moduleIds.length} 个模块ID`
        };

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 查询FAQ模块列表时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `查询失败: ${errorMsg}`
        };
    }
}

/**
 * 为每个模块创建FAQ子问题
 * @param {*} data
 * @param {Array} moduleIds 模块ID列表
 * @returns {Object} 创建结果 { success, message }
 */
function createFaqQuestions(data, moduleIds) {
    const token = data.token;
    const api = '/api/Faq/Add';

    try {
        let successCount = 0;
        let failedCount = 0;

        // 为每个模块创建一个FAQ子问题
        for (let i = 0; i < moduleIds.length; i++) {
            const moduleId = moduleIds[i];
            logger.info(`[${createOrdersystemTag}] 为模块 ${i + 1}/${moduleIds.length} (ID=${moduleId}) 创建FAQ子问题`);

            // 上传图片（只上传一次，3个语言共用）
            const uploader = i === 0 ? uploadFaqImage1 : uploadFaqImage2;
            const imageName = i === 0 ? '1.png' : '2.png';

            logger.info(`[${createOrdersystemTag}] 上传图片 ${imageName}`);
            let uploadResult = uploader(token);

            // 如果上传失败，等待2秒后重试一次
            if (!uploadResult.success) {
                logger.warn(`[${createOrdersystemTag}] 图片 ${imageName} 第1次上传失败: ${uploadResult.error}，等待2秒后重试`);
                sleep(2);

                logger.info(`[${createOrdersystemTag}] 重试上传图片 ${imageName}`);
                uploadResult = uploader(token);

                if (!uploadResult.success) {
                    logger.error(`[${createOrdersystemTag}] 图片 ${imageName} 第2次上传仍然失败: ${uploadResult.error}，跳过该模块`);
                    failedCount++;
                    continue;
                }

                logger.info(`[${createOrdersystemTag}] 图片 ${imageName} 重试上传成功`);
            }

            // 使用完整的URL（src字段），而不是相对路径（file字段）
            const imageUrl = uploadResult.src || uploadResult.file;
            logger.info(`[${createOrdersystemTag}] 图片上传成功: ${imageUrl}`);

            // 等待2秒避免频繁访问
            sleep(2);

            // 构建问题内容 - 根据模块索引和语言提供不同的翻译
            // 第1个模块（i=0）：游戏问题
            // 第2个模块（i=1）：账号问题
            const translations = i === 0 ? [
                {
                    "language": "hi",
                    "question": "गेम संबंधी समस्याएँ",  // 游戏问题的印地语
                    "answer": `<p>गेम संबंधी समस्याएँ<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3}" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "en",
                    "question": "Game issues",  // 游戏问题的英语
                    "answer": `<p>Game issues<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3 + 1}" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "zh",
                    "question": "游戏问题",  // 游戏问题的中文
                    "answer": `<p>游戏问题<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3 + 2}" style="vertical-align: baseline;"></p>`
                }
            ] : [
                {
                    "language": "hi",
                    "question": "खाते की समस्या",  // 账号问题的印地语
                    "answer": `<p>खाते की समस्या<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3}" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "en",
                    "question": "Account problem",  // 账号问题的英语
                    "answer": `<p>Account problem<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3 + 1}" style="vertical-align: baseline;"></p>`
                },
                {
                    "language": "zh",
                    "question": "账号问题",  // 账号问题的中文
                    "answer": `<p>账号问题<img data-src="${imageUrl}" src="${imageUrl}" data-image-id="img${i * 3 + 2}" style="vertical-align: baseline;"></p>`
                }
            ];

            const payload = {
                "sort": 2,
                "state": 1,
                "moduleId": moduleId,
                "translations": translations
            };

            //logger.info(`[${createOrdersystemTag}] FAQ子问题 payload: ${JSON.stringify(payload)}`);

            const result = sendRequest(payload, api, createOrdersystemTag, false, token);

            //logger.info(`[${createOrdersystemTag}] FAQ子问题创建响应: ${JSON.stringify(result)}`);

            // 检查返回结果
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createOrdersystemTag}] 模块 ID=${moduleId} 的FAQ子问题创建成功`);
            } else {
                failedCount++;
                logger.error(`[${createOrdersystemTag}] 模块 ID=${moduleId} 的FAQ子问题创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待3秒再创建下一个，避免频繁访问
            if (i < moduleIds.length - 1) {
                sleep(3);
            }
        }

        logger.info(`[${createOrdersystemTag}] FAQ子问题创建完成: 成功=${successCount}, 失败=${failedCount}`);

        if (successCount > 0) {
            return {
                success: true,
                message: `FAQ子问题创建完成: 成功=${successCount}, 失败=${failedCount}`
            };
        } else {
            return {
                success: false,
                message: `所有FAQ子问题创建失败`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 创建FAQ子问题时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建FAQ子问题失败: ${errorMsg}`
        };
    }
}

/**
 * 中文到英语和印地语的翻译映射
 */
const TRANSLATIONS = {
    '外部链接-已登陆': {
        en: 'External Link - Logged In',
        hi: 'बाहरी लिंक - लॉग इन किया हुआ'
    },
    '外部链接-未登陆': {
        en: 'External Link - Not Logged In',
        hi: 'बाहरी लिंक - लॉग इन नहीं'
    },
    '一对一客服-已登陆': {
        en: 'One-on-One Customer Service - Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग इन किया हुआ'
    },
    '一对一客服-未登陆': {
        en: 'One-on-One Customer Service - Not Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग इन नहीं'
    },
    '存款未到账自动化': {
        en: 'Deposit Not Received - Automated',
        hi: 'जमा प्राप्त नहीं हुआ - स्वचालित'
    },
    '取款未到账': {
        en: 'Withdrawal Not Received',
        hi: 'निकासी प्राप्त नहीं हुई'
    },
    '修改真实姓名半自动': {
        en: 'Modify Real Name - Semi-Automated',
        hi: 'वास्तविक नाम संशोधित करें - अर्ध-स्वचालित'
    },
    '修改登录密码半自动-已登陆': {
        en: 'Change Login Password - Semi-Automated - Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन किया हुआ'
    },
    '修改登录密码半自动-未登陆': {
        en: 'Change Login Password - Semi-Automated - Not Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन नहीं'
    },
    '忘记会员账号': {
        en: 'Forgot Member Account',
        hi: 'सदस्य खाता भूल गए'
    },
    '忘记登录密码': {
        en: 'Forgot Login Password',
        hi: 'लॉगिन पासवर्ड भूल गए'
    },
    '会员账号解冻半自动': {
        en: 'Unfreeze Member Account - Semi-Automated',
        hi: 'सदस्य खाता अनफ्रीज करें - अर्ध-स्वचालित'
    },
    '修改IFSC自动化': {
        en: 'Modify IFSC - Automated',
        hi: 'IFSC संशोधित करें - स्वचालित'
    },
    '修改银行名称自动化': {
        en: 'Modify Bank Name - Automated',
        hi: 'बैंक का नाम संशोधित करें - स्वचालित'
    },
    '删除USDT半自动': {
        en: 'Delete USDT - Semi-Automated',
        hi: 'USDT हटाएं - अर्ध-स्वचालित'
    },
    '删除银行卡半自动': {
        en: 'Delete Bank Card - Semi-Automated',
        hi: 'बैंक कार्ड हटाएं - अर्ध-स्वचालित'
    },
    '删除PIX自动化': {
        en: 'Delete PIX - Automated',
        hi: 'PIX हटाएं - स्वचालित'
    },
    '删除电子钱包半自动': {
        en: 'Delete E-Wallet - Semi-Automated',
        hi: 'ई-वॉलेट हटाएं - अर्ध-स्वचालित'
    },
    '新增USDT半自动': {
        en: 'Add USDT - Semi-Automated',
        hi: 'USDT जोड़ें - अर्ध-स्वचालित'
    },
    '删除银行卡自动化': {
        en: 'Delete Bank Card - Automated',
        hi: 'बैंक कार्ड हटाएं - स्वचालित'
    },
    '删除USDT自动化': {
        en: 'Delete USDT - Automated',
        hi: 'USDT हटाएं - स्वचालित'
    },
    '删除电子钱包自动化': {
        en: 'Delete E-Wallet - Automated',
        hi: 'ई-वॉलेट हटाएं - स्वचालित'
    },
    '修改提现密码自动化': {
        en: 'Change Withdrawal Password - Automated',
        hi: 'निकासी पासवर्ड बदलें - स्वचालित'
    },
    '修改提现密码半自动化': {
        en: 'Change Withdrawal Password - Semi-Automated',
        hi: 'निकासी पासवर्ड बदलें - अर्ध-स्वचालित'
    },
    '其他问题': {
        en: 'Other Issues',
        hi: 'अन्य समस्याएं'
    }
};

/**
 * 创建工单表单
 * @param {*} data
 * @returns {Object} 创建结果 { success, message }
 */
function createOrderForms(data) {
    const token = data.token;
    const api = '/api/TenantForm/Create';

    try {
        let successCount = 0;
        let failedCount = 0;

        // 根据实际存在的图片文件过滤配置
        // 检查上传器的 preloadFailed 属性来判断图片是否存在
        const validConfigs = [];
        const skippedConfigs = [];

        logger.info(`[${createOrdersystemTag}] 开始检测可用的图片文件...`);

        for (const config of orderSystemConfig) {
            const uploader = orderImageUploaders[config.img];

            // 检查上传器是否标记为预加载失败
            if (uploader && uploader.preloadFailed === true) {
                // 图片预加载失败，跳过此配置
                skippedConfigs.push(config.name);
            } else if (uploader) {
                // 图片存在，添加到有效配置
                validConfigs.push(config);
            } else {
                // 上传器不存在（不应该发生）
                skippedConfigs.push(config.name);
                logger.warn(`[${createOrdersystemTag}] 工单 "${config.name}" 的上传器不存在`);
            }
        }

        if (skippedConfigs.length > 0) {
            logger.warn(`[${createOrdersystemTag}] 共跳过 ${skippedConfigs.length} 个工单（图片不存在）: ${skippedConfigs.slice(0, 5).join(', ')}${skippedConfigs.length > 5 ? '...' : ''}`);
        }

        logger.info(`[${createOrdersystemTag}] 配置中共有 ${orderSystemConfig.length} 个工单`);
        logger.info(`[${createOrdersystemTag}] 检测到 ${validConfigs.length} 个可用工单（图片存在）`);

        // 遍历配置，为每个工单创建表单
        for (let i = 0; i < validConfigs.length; i++) {
            const config = validConfigs[i];
            const orderName = config.name;
            const sort = config.oderby;
            const orderType = config.type || 1;
            const configFields = config.fields || [];

            logger.info(`[${createOrdersystemTag}] 创建工单 ${i + 1}/${validConfigs.length}: ${orderName} (sort=${sort}, type=${orderType})`);

            // 获取图片上传器
            const uploader = orderImageUploaders[config.img];
            if (!uploader) {
                logger.error(`[${createOrdersystemTag}] 工单 "${orderName}" 的图片上传器不存在（图片: ${config.img}），跳过`);
                failedCount++;
                continue;
            }

            logger.info(`[${createOrdersystemTag}] 上传图片 ${config.img}`);
            const uploadResult = uploader(token);

            if (!uploadResult.success) {
                logger.error(`[${createOrdersystemTag}] 图片 ${config.img} 上传失败（已重试）: ${uploadResult.error}，跳过该工单`);
                failedCount++;
                continue;
            }

            // 使用完整的URL（src字段），然后提取相对路径
            const fullUrl = uploadResult.src || uploadResult.file;
            const iconPath = fullUrl.replace(/^https?:\/\/[^\/]+\//, '');
            logger.info(`[${createOrdersystemTag}] 图片上传成功: ${iconPath}`);

            // 等待2秒避免频繁访问
            sleep(2);

            // 获取翻译
            const translation = TRANSLATIONS[orderName];
            if (!translation) {
                logger.error(`[${createOrdersystemTag}] 工单 "${orderName}" 没有翻译配置，跳过`);
                failedCount++;
                continue;
            }

            // 判断是否需要登录
            // 只有名称中明确包含"未登陆"的才是 isLoginForm: 0
            // 其他所有工单（包括"已登陆"和没有明确说明的）都是 isLoginForm: 1
            const isLoginForm = orderName.includes('未登陆') ? 0 : 1;

            // 构建fields数组
            const buildFields = (lang) => {
                return configFields.map(field => ({
                    "id": 0,
                    "name": {
                        "id": 0,
                        "text": lang === 'en' ? field.nameEn : ""
                    },
                    "type": field.type,
                    "isRequired": 1,
                    "isDefault": true
                }));
            };

            // 构建outLinks数组（只有type=1才有）
            const buildOutLinks = (lang) => {
                if (orderType === 1 && lang === 'en') {
                    return [
                        { "name": "google", "link": "https://www.google.com", "id": 0 },
                        { "name": "git", "link": "https://github.com/", "id": 0 }
                    ];
                }
                return [];
            };

            // 构建payload
            const payload = {
                "type": orderType,
                "iconPath": iconPath,
                "isLoginForm": isLoginForm,
                "dailySubmissionLimit": 0,
                "state": 1,
                "sort": sort,
                "translationData": [
                    {
                        "language": "hi",
                        "formTitles": {
                            "id": 0,
                            "text": translation.hi
                        },
                        "fields": buildFields('hi'),
                        "outLinks": buildOutLinks('hi')
                    },
                    {
                        "language": "en",
                        "formTitles": {
                            "id": 0,
                            "text": translation.en
                        },
                        "fields": buildFields('en'),
                        "outLinks": buildOutLinks('en')
                    },
                    {
                        "language": "zh",
                        "formTitles": {
                            "id": 0,
                            "text": orderName
                        },
                        "fields": buildFields('zh'),
                        "outLinks": buildOutLinks('zh')
                    }
                ],
                "fieldIdsToRemove": []
            };

            const result = sendRequest(payload, api, createOrdersystemTag, false, token);

            // 检查返回结果
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createOrdersystemTag}] 工单 "${orderName}" 创建成功`);
            } else {
                failedCount++;
                logger.error(`[${createOrdersystemTag}] 工单 "${orderName}" 创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待3秒再创建下一个，避免频繁访问
            if (i < validConfigs.length - 1) {
                sleep(3);
            }
        }

        logger.info(`[${createOrdersystemTag}] 工单表单创建完成: 成功=${successCount}, 失败=${failedCount}`);

        if (successCount > 0) {
            return {
                success: true,
                message: `工单表单创建完成: 成功=${successCount}, 失败=${failedCount}`
            };
        } else {
            return {
                success: false,
                message: `所有工单表单创建失败`
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrdersystemTag}] 创建工单表单时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建工单表单失败: ${errorMsg}`
        };
    }
}
