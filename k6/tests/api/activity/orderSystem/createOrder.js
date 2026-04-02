import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { sendRequest } from '../../common/request.js';
import { createImageUploader, getErrorMessage } from '../../uploadFile/uploadFactory.js';
import { orderSystemConfig } from './oderyconfig.js';
import { getActiveLangs } from '../../../../config/languageConfig.js';

export const createOrderTag = 'createOrder';

// 在模块顶层创建工单图片上传器
// 尝试创建所有25个上传器，如果图片不存在会返回失败的上传器（警告级别）
// 运行时会自动跳过失败的上传器
const orderImageUploaders = {};

for (let i = 1; i <= 25; i++) {
    const imgName = `${i}.png`;
    orderImageUploaders[imgName] = createImageUploader(`../../uploadFile/img/order/${imgName}`, createOrderTag);
}

logger.info(`[${createOrderTag}] 图片上传器初始化完成，已尝试加载 25 个图片上传器`);

// 等所有25个图片都准备好后，改为：
// const orderImageUploaders = {};
// for (let i = 1; i <= 25; i++) {
//     orderImageUploaders[`${i}.png`] = createImageUploader(`../../uploadFile/img/order/${i}.png`, createOrderTag);
// }

/**
 * 中文到英语、印地语、西班牙语、孟加拉语和乌尔都语的翻译映射
 */
const TRANSLATIONS = {
    '外部链接-已登陆': {
        en: 'External Link - Logged In',
        hi: 'बाहरी लिंक - लॉग इन किया हुआ',
        es: 'Enlace externo - Conectado',
        bn: 'বাহ্যিক লিঙ্ক - লগ ইন করা',
        ur: 'بیرونی لنک - لاگ ان ہے'
    },
    '外部链接-未登陆': {
        en: 'External Link - Not Logged In',
        hi: 'बाहरी लिंक - लॉग इन नहीं',
        es: 'Enlace externo - No conectado',
        bn: 'বাহ্যিক লিঙ্ক - লগ ইন নয়',
        ur: 'بیرونی لنک - لاگ ان نہیں'
    },
    '一对一客服-已登陆': {
        en: 'One-on-One Customer Service - Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग इन किया हुआ',
        es: 'Servicio al cliente uno a uno - Conectado',
        bn: 'এক-এক গ্রাহক সেবা - লগ ইন করা',
        ur: 'ون آن ون کسٹمر سروس - لاگ ان ہے'
    },
    '一对一客服-未登陆': {
        en: 'One-on-One Customer Service - Not Logged In',
        hi: 'एक-से-एक ग्राहक सेवा - लॉग इन नहीं',
        es: 'Servicio al cliente uno a uno - No conectado',
        bn: 'এক-এক গ্রাহক সেবা - লগ ইন নয়',
        ur: 'ون آن ون کسٹمر سروس - لاگ ان نہیں'
    },
    '存款未到账自动化': {
        en: 'Deposit Not Received - Automated',
        hi: 'जमा प्राप्त नहीं हुआ - स्वचालित',
        es: 'Depósito no recibido - Automatizado',
        bn: 'জমা প্রাপ্ত হয়নি - স্বয়ংক্রিয়',
        ur: 'ڈپازٹ موصول نہیں ہوئی - خودکار'
    },
    '取款未到账': {
        en: 'Withdrawal Not Received',
        hi: 'निकासी प्राप्त नहीं हुई',
        es: 'Retiro no recibido',
        bn: 'উত্তোলন প্রাপ্ত হয়নি',
        ur: 'نکلوائی موصول نہیں ہوئی'
    },
    '修改真实姓名半自动': {
        en: 'Modify Real Name - Semi-Automated',
        hi: 'वास्तविक नाम संशोधित करें - अर्ध-स्वचालित',
        es: 'Modificar nombre real - Semiautomático',
        bn: 'প্রকৃত নাম পরিবর্তন - আধা-স্বয়ংক্রিয়',
        ur: 'اصل نام تبدیل کریں - نیم خودکار'
    },
    '修改登录密码半自动-已登陆': {
        en: 'Change Login Password - Semi-Automated - Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन किया हुआ',
        es: 'Cambiar contraseña de inicio de sesión - Semiautomático - Conectado',
        bn: 'লগইন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয় - লগ ইন করা',
        ur: 'لاگ ان پاس ورڈ تبدیل کریں - نیم خودکار - لاگ ان ہے'
    },
    '修改登录密码半自动-未登陆': {
        en: 'Change Login Password - Semi-Automated - Not Logged In',
        hi: 'लॉगिन पासवर्ड बदलें - अर्ध-स्वचालित - लॉग इन नहीं',
        es: 'Cambiar contraseña de inicio de sesión - Semiautomático - No conectado',
        bn: 'লগইন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয় - লগ ইন নয়',
        ur: 'لاگ ان پاس ورڈ تبدیل کریں - نیم خودکار - لاگ ان نہیں'
    },
    '忘记会员账号': {
        en: 'Forgot Member Account',
        hi: 'सदस्य खाता भूल गए',
        es: 'Olvidé mi cuenta de miembro',
        bn: 'সদস্য অ্যাকাউন্ট ভুলে গেছি',
        ur: 'ممبر اکاؤنٹ بھول گئے'
    },
    '忘记登录密码': {
        en: 'Forgot Login Password',
        hi: 'लॉगिन पासवर्ड भूल गए',
        es: 'Olvidé mi contraseña de inicio de sesión',
        bn: 'লগইন পাসওয়ার্ড ভুলে গেছি',
        ur: 'لاگ ان پاس ورڈ بھول گئے'
    },
    '会员账号解冻半自动': {
        en: 'Unfreeze Member Account - Semi-Automated',
        hi: 'सदस्य खाता अनफ्रीज करें - अर्ध-स्वचालित',
        es: 'Descongelar cuenta de miembro - Semiautomático',
        bn: 'সদস্য অ্যাকাউন্ট আনফ্রিজ - আধা-স্বয়ংক্রিয়',
        ur: 'ممبر اکاؤنٹ ان فریز کریں - نیم خودکار'
    },
    '修改IFSC自动化': {
        en: 'Modify IFSC - Automated',
        hi: 'IFSC संशोधित करें - स्वचालित',
        es: 'Modificar IFSC - Automatizado',
        bn: 'IFSC পরিবর্তন - স্বয়ংক্রিয়',
        ur: 'IFSC تبدیل کریں - خودکار'
    },
    '修改银行名称自动化': {
        en: 'Modify Bank Name - Automated',
        hi: 'बैंक का नाम संशोधित करें - स्वचालित',
        es: 'Modificar nombre del banco - Automatizado',
        bn: 'ব্যাংকের নাম পরিবর্তন - স্বয়ংক্রিয়',
        ur: 'بینک کا نام تبدیل کریں - خودکار'
    },
    '删除USDT半自动': {
        en: 'Delete USDT - Semi-Automated',
        hi: 'USDT हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar USDT - Semiautomático',
        bn: 'USDT মুছুন - আধা-স্বয়ংক্রিয়',
        ur: 'USDT حذف کریں - نیم خودکار'
    },
    '删除银行卡半自动': {
        en: 'Delete Bank Card - Semi-Automated',
        hi: 'बैंक कार्ड हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar tarjeta bancaria - Semiautomático',
        bn: 'ব্যাংক কার্ড মুছুন - আধা-স্বয়ংক্রিয়',
        ur: 'بینک کارڈ حذف کریں - نیم خودکار'
    },
    '删除PIX自动化': {
        en: 'Delete PIX - Automated',
        hi: 'PIX हटाएं - स्वचालित',
        es: 'Eliminar PIX - Automatizado',
        bn: 'PIX মুছুন - স্বয়ংক্রিয়',
        ur: 'PIX حذف کریں - خودکار'
    },
    '删除电子钱包半自动': {
        en: 'Delete E-Wallet - Semi-Automated',
        hi: 'ई-वॉलेट हटाएं - अर्ध-स्वचालित',
        es: 'Eliminar billetera electrónica - Semiautomático',
        bn: 'ই-ওয়ালেট মুছুন - আধা-স্বয়ংক্রিয়',
        ur: 'ای والیٹ حذف کریں - نیم خودکار'
    },
    '新增USDT半自动': {
        en: 'Add USDT - Semi-Automated',
        hi: 'USDT जोड़ें - अर्ध-स्वचालित',
        es: 'Agregar USDT - Semiautomático',
        bn: 'USDT যোগ করুন - আধা-স্বয়ংক্রিয়',
        ur: 'USDT شامل کریں - نیم خودکار'
    },
    '删除银行卡自动化': {
        en: 'Delete Bank Card - Automated',
        hi: 'बैंक कार्ड हटाएं - स्वचालित',
        es: 'Eliminar tarjeta bancaria - Automatizado',
        bn: 'ব্যাংক কার্ড মুছুন - স্বয়ংক্রিয়',
        ur: 'بینک کارڈ حذف کریں - خودکار'
    },
    '删除USDT自动化': {
        en: 'Delete USDT - Automated',
        hi: 'USDT हटाएं - स्वचालित',
        es: 'Eliminar USDT - Automatizado',
        bn: 'USDT মুছুন - স্বয়ংক্রিয়',
        ur: 'USDT حذف کریں - خودکار'
    },
    '删除电子钱包自动化': {
        en: 'Delete E-Wallet - Automated',
        hi: 'ई-वॉलेट हटाएं - स्वचालित',
        es: 'Eliminar billetera electrónica - Automatizado',
        bn: 'ই-ওয়ালেট মুছুন - স্বয়ংক্রিয়',
        ur: 'ای والیٹ حذف کریں - خودکار'
    },
    '修改提现密码自动化': {
        en: 'Change Withdrawal Password - Automated',
        hi: 'निकासी पासवर्ड बदलें - स्वचालित',
        es: 'Cambiar contraseña de retiro - Automatizado',
        bn: 'উত্তোলন পাসওয়ার্ড পরিবর্তন - স্বয়ংক্রিয়',
        ur: 'نکلوائی پاس ورڈ تبدیل کریں - خودکار'
    },
    '修改提现密码半自动化': {
        en: 'Change Withdrawal Password - Semi-Automated',
        hi: 'निकासी पासवर्ड बदलें - अर्ध-स्वचालित',
        es: 'Cambiar contraseña de retiro - Semiautomático',
        bn: 'উত্তোলন পাসওয়ার্ড পরিবর্তন - আধা-স্বয়ংক্রিয়',
        ur: 'نکلوائی پاس ورڈ تبدیل کریں - نیم خودکار'
    },
    '其他问题': {
        en: 'Other Issues',
        hi: 'अन्य समस्याएं',
        es: 'Otros problemas',
        bn: 'অন্যান্য সমস্যা',
        ur: 'دیگر مسائل'
    }
};

/**
 * 创建工单表单
 * @param {*} data 
 * @returns {Object} 创建结果
 * 
 * 返回格式说明：
 * - success: true  表示工单创建成功
 * - success: false 表示跳过该工单，不进行创建
 */
export function createOrder(data) {
    logger.info(`[${createOrderTag}] 开始创建工单表单`);

    try {
        const token = data.token;

        if (!token) {
            logger.error(`[${createOrderTag}] Token 不存在，无法创建工单表单`);
            return {
                success: false,
                tag: createOrderTag,
                message: 'Token 不存在，跳过工单表单创建'
            };
        }

        const result = createOrderForms(data);

        if (result.success) {
            logger.info(`[${createOrderTag}] 工单表单创建成功`);
            return {
                success: true,
                tag: createOrderTag,
                message: result.message
            };
        } else {
            logger.error(`[${createOrderTag}] 工单表单创建失败: ${result.message}`);
            return {
                success: false,
                tag: createOrderTag,
                message: result.message
            };
        }

    } catch (error) {
        const errorMsg = getErrorMessage(error);
        logger.error(`[${createOrderTag}] 创建工单表单时发生错误: ${errorMsg}`);
        return {
            success: false,
            tag: createOrderTag,
            message: `创建工单表单失败: ${errorMsg}`
        };
    }
}

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
        // 通过测试上传器来检查哪些图片实际可用
        const validConfigs = [];
        const skippedConfigs = [];

        logger.info(`[${createOrderTag}] 开始检测可用的图片文件...`);

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
                logger.warn(`[${createOrderTag}] 工单 "${config.name}" 的上传器不存在`);
            }
        }

        if (skippedConfigs.length > 0) {
            logger.warn(`[${createOrderTag}] 共跳过 ${skippedConfigs.length} 个工单（图片不存在）: ${skippedConfigs.slice(0, 5).join(', ')}${skippedConfigs.length > 5 ? '...' : ''}`);
        }

        logger.info(`[${createOrderTag}] 配置中共有 ${orderSystemConfig.length} 个工单`);
        logger.info(`[${createOrderTag}] 检测到 ${validConfigs.length} 个可用工单（图片存在）`);

        // 遍历配置，为每个工单创建表单
        for (let i = 0; i < validConfigs.length; i++) {
            const config = validConfigs[i];
            const orderName = config.name;
            const sort = config.oderby;
            const orderType = config.type || 1;
            const configFields = config.fields || [];

            logger.info(`[${createOrderTag}] 创建工单 ${i + 1}/${validConfigs.length}: ${orderName} (sort=${sort}, type=${orderType})`);

            // 获取图片上传器
            const uploader = orderImageUploaders[config.img];
            if (!uploader) {
                logger.error(`[${createOrderTag}] 工单 "${orderName}" 的图片上传器不存在（图片: ${config.img}），跳过`);
                failedCount++;
                continue;
            }

            logger.info(`[${createOrderTag}] 上传图片 ${config.img}`);
            const uploadResult = uploader(token);

            if (!uploadResult.success) {
                logger.error(`[${createOrderTag}] 图片 ${config.img} 上传失败（已重试）: ${uploadResult.error}，跳过该工单`);
                failedCount++;
                continue;
            }

            // 使用完整的URL（src字段），然后提取相对路径
            const fullUrl = uploadResult.src || uploadResult.file;
            const iconPath = fullUrl.replace(/^https?:\/\/[^\/]+\//, '');
            logger.info(`[${createOrderTag}] 图片上传成功: ${iconPath}`);

            // 等待2秒避免频繁访问
            sleep(2);

            // 获取翻译
            const translation = TRANSLATIONS[orderName];
            if (!translation) {
                logger.error(`[${createOrderTag}] 工单 "${orderName}" 没有翻译配置，跳过`);
                failedCount++;
                continue;
            }

            // 判断是否需要登录
            // 只有名称中明确包含"未登陆"的才是 isLoginForm: 0
            // 其他所有工单（包括"已登陆"和没有明确说明的）都是 isLoginForm: 1
            const isLoginForm = orderName.includes('未登陆') ? 0 : 1;

            // 构建fields数组
            const buildFields = (lang) => {
                return configFields.map(field => {
                    // 根据语言选择字段名
                    let fieldName = '';
                    if (lang === 'en') {
                        fieldName = field.nameEn;
                    } else if (lang === 'es') {
                        fieldName = field.nameEs || field.nameEn;
                    } else if (lang === 'bn') {
                        fieldName = field.nameBn || field.nameEn;
                    } else if (lang === 'ur') {
                        fieldName = field.nameUr || field.nameEn;
                    } else {
                        // 其他语言（如 hi, zh 等）使用英语作为后备
                        fieldName = field.nameEn;
                    }

                    return {
                        "id": 0,
                        "name": {
                            "id": 0,
                            "text": fieldName
                        },
                        "type": field.type,
                        "isRequired": 1,
                        "isDefault": true
                    };
                });
            };

            // 构建outLinks数组（只有type=1才有）
            const buildOutLinks = (lang) => {
                if (orderType === 1) {
                    return [
                        { "name": "google", "link": "https://www.google.com", "id": 0 },
                        { "name": "git", "link": "https://github.com/", "id": 0 }
                    ];
                }
                return [];
            };

            // 构建payload
            // 工单系统不需要 sysLanguage 字段
            const activeLangs = getActiveLangs();

            const payload = {
                "type": orderType,
                "iconPath": iconPath,
                "isLoginForm": isLoginForm,
                "dailySubmissionLimit": 0,
                "state": 1,
                "sort": sort,
                "translationData": activeLangs.map(lang => {
                    // 对于不支持的语言，使用英语作为后备
                    let titleText = '';
                    if (lang === 'zh') {
                        titleText = orderName;
                    } else if (translation[lang]) {
                        titleText = translation[lang];
                    } else {
                        // 不支持的语言使用英语
                        titleText = translation.en || orderName;
                    }

                    return {
                        "language": lang,
                        "formTitles": {
                            "id": 0,
                            "text": titleText
                        },
                        "fields": buildFields(lang),
                        "outLinks": buildOutLinks(lang)
                    };
                }),
                "fieldIdsToRemove": []
            };

            const result = sendRequest(payload, api, createOrderTag, false, token);

            // 检查返回结果
            if (result && result.msgCode === 0) {
                successCount++;
                logger.info(`[${createOrderTag}] 工单 "${orderName}" 创建成功`);
            } else {
                failedCount++;
                logger.error(`[${createOrderTag}] 工单 "${orderName}" 创建失败: ${result?.msg || '未知错误'}`);
            }

            // 等待3秒再创建下一个，避免频繁访问
            if (i < validConfigs.length - 1) {
                sleep(3);
            }
        }

        logger.info(`[${createOrderTag}] 工单表单创建完成: 成功=${successCount}, 失败=${failedCount}`);

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
        logger.error(`[${createOrderTag}] 创建工单表单时发生错误: ${errorMsg}`);
        return {
            success: false,
            message: `创建工单表单失败: ${errorMsg}`
        };
    }
}
