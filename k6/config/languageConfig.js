// ============================================
// 多语言配置 - 语言与租户解耦
// ============================================
//
// 使用方法（通过环境变量指定语言）：
//   不指定 LANGUAGES → 根据租户ID使用对应的默认语言
//   k6 run -e LANGUAGES=pt              → 只用葡萄牙语
//   k6 run -e LANGUAGES=en,vi,ms        → 英语 + 越南语 + 马来语
//   k6 run -e LANGUAGES=zh,en,hi,es,pt  → 5种语言
//
// 租户默认语言配置在 tenantLanguageConfig.js 中定义
// 新增语言只需在 SUPPORTED_LANGUAGES 中添加一条记录，
// 所有活动创建文件自动生效（无需逐一修改）。
// ============================================

import { getTenantDefaultLanguages } from './tenantLanguageConfig.js';

/**
 * 所有支持的语言定义
 * code    - 语言代码（传给后端 API 的值）
 * name    - 语言名称（中文，用于日志）
 * default - 是否是默认激活语言
 */
export const SUPPORTED_LANGUAGES = {
    zh: { code: 'zh', name: '中文', default: true },
    en: { code: 'en', name: '英语', default: true },
    hi: { code: 'hi', name: '印地语', default: true },
    es: { code: 'es', name: '西班牙语', default: false },
    pt: { code: 'pt', name: '葡萄牙语', default: false },
    vi: { code: 'vi', name: '越南语', default: false },
    ur: { code: 'ur', name: '乌尔都语', default: false },
    ms: { code: 'ms', name: '马来语', default: false },
    bn: { code: 'bn', name: '孟加拉语', default: false },
};

/**
 * 获取当前激活的语言代码列表
 * 优先级：环境变量 LANGUAGES > 租户默认语言 > 全局默认语言
 *
 * @returns {string[]} 语言代码数组，如 ['zh', 'en', 'hi']
 */
export function getActiveLangs() {
    const envLangs = typeof __ENV !== 'undefined' ? __ENV.LANGUAGES : null;

    // 优先使用环境变量指定的语言
    if (envLangs && envLangs.trim() !== '') {
        const requested = envLangs.split(',').map(s => s.trim()).filter(Boolean);
        const valid = [];
        const invalid = [];

        for (const code of requested) {
            if (SUPPORTED_LANGUAGES[code]) {
                valid.push(code);
            } else {
                invalid.push(code);
            }
        }

        if (invalid.length > 0) {
            console.warn(`[LanguageConfig] ⚠️  不支持的语言代码: ${invalid.join(', ')}，已忽略。支持的语言: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
        }

        if (valid.length > 0) {
            console.log(`[LanguageConfig] 使用环境变量指定的语言: ${valid.join(', ')}`);
            return valid;
        }
    }

    // 尝试从租户ID获取默认语言
    const tenantId = typeof __ENV !== 'undefined' ? __ENV.TENANT_ID : null;
    if (tenantId) {
        const tenantLangs = getTenantDefaultLanguages(tenantId);
        console.log(`[LanguageConfig] 使用租户 ${tenantId} 的默认语言: ${tenantLangs.join(', ')}`);
        return tenantLangs.slice();
    }

    // 使用全局默认语言
    const globalDefault = getTenantDefaultLanguages('default');
    console.log(`[LanguageConfig] 使用全局默认语言: ${globalDefault.join(', ')}`);
    return globalDefault.slice();
}

/**
 * 构建通用 translations 数组
 * 根据当前激活语言，为每种语言调用 builder(langCode) 生成翻译条目
 *
 * @param {function(string): object} builder - 接收语言代码，返回翻译对象
 * @returns {object[]} translations 数组
 *
 * @example
 * // 用于 coupon/inmail 等
 * translations: buildTranslations(lang => ({
 *   language: lang,
 *   name: couponName,
 *   description: couponName
 * }))
 */
export function buildTranslations(builder) {
    return getActiveLangs().map(lang => builder(lang));
}

/**
 * 判断当前激活语言中是否包含某语言
 * @param {string} langCode
 * @returns {boolean}
 */
export function hasLang(langCode) {
    return getActiveLangs().includes(langCode);
}

/**
 * 打印当前语言配置（调试用）
 */
export function printLanguageConfig() {
    const active = getActiveLangs();
    console.log('========== 语言配置 ==========');
    console.log(`激活语言数: ${active.length}`);
    active.forEach(code => {
        const lang = SUPPORTED_LANGUAGES[code];
        console.log(`  ${code} - ${lang ? lang.name : '未知'}`);
    });
    console.log('==============================');
}
