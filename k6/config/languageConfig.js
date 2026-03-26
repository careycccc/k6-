// ============================================
// 多语言配置 - 语言与租户解耦
// ============================================
//
// 使用方法（通过环境变量指定语言）：
//   不指定 LANGUAGES → 默认使用 zh,en,hi（中文、英语、印地语）
//   k6 run -e LANGUAGES=pt              → 只用葡萄牙语
//   k6 run -e LANGUAGES=en,vi,ms        → 英语 + 越南语 + 马来语
//   k6 run -e LANGUAGES=zh,en,hi,es,pt  → 5种语言
//
// 新增语言只需在 SUPPORTED_LANGUAGES 中添加一条记录，
// 所有活动创建文件自动生效（无需逐一修改）。
// ============================================

/**
 * 所有支持的语言定义
 * code    - 语言代码（传给后端 API 的值）
 * name    - 语言名称（中文，用于日志）
 * default - 是否是默认激活语言
 */
export const SUPPORTED_LANGUAGES = {
    zh: { code: 'zh', name: '中文',         default: true  },
    en: { code: 'en', name: '英语',         default: true  },
    hi: { code: 'hi', name: '印地语',       default: true  },
    es: { code: 'es', name: '西班牙语',     default: false },
    pt: { code: 'pt', name: '葡萄牙语',     default: false },
    vi: { code: 'vi', name: '越南语',       default: false },
    ur: { code: 'ur', name: '乌尔都语',     default: false },
    ms: { code: 'ms', name: '马来语',       default: false },
    bn: { code: 'bn', name: '孟加拉语',     default: false },
};

/** 默认语言列表（不指定时使用） */
const DEFAULT_LANGS = Object.values(SUPPORTED_LANGUAGES)
    .filter(l => l.default)
    .map(l => l.code);

/**
 * 获取当前激活的语言代码列表
 * 优先读取环境变量 LANGUAGES（逗号分隔），否则返回默认语言列表
 *
 * @returns {string[]} 语言代码数组，如 ['zh', 'en', 'hi']
 */
export function getActiveLangs() {
    const envLangs = typeof __ENV !== 'undefined' ? __ENV.LANGUAGES : null;

    if (!envLangs || envLangs.trim() === '') {
        return DEFAULT_LANGS.slice(); // 返回副本
    }

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

    if (valid.length === 0) {
        console.warn(`[LanguageConfig] ⚠️  LANGUAGES 中无有效语言，回退到默认语言: ${DEFAULT_LANGS.join(',')}`);
        return DEFAULT_LANGS.slice();
    }

    console.log(`[LanguageConfig] 激活语言: ${valid.join(', ')}`);
    return valid;
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
