// ============================================
// 租户默认语言配置
// ============================================
//
// 每个租户的默认语言配置
// 如果通过环境变量 LANGUAGES 指定了语言，则优先使用环境变量
// 否则使用租户的默认语言配置
//
// ============================================

/**
 * 租户默认语言映射表
 * key: 租户ID (字符串)
 * value: 语言代码数组
 */
export const TENANT_DEFAULT_LANGUAGES = {
    '3001': ['zh', 'en', 'hi'],  // 中文、英语、印地语
    '3002': ['zh', 'en', 'pt'],  // 中文、英语、葡萄牙语
    '3003': ['zh', 'en', 'es'],  // 中文、英语、西班牙语
    '3004': ['zh', 'en', 'hi'],  // 中文、英语、印地语
    '3006': ['zh', 'en', 'bn'],  // 中文、英语、孟加拉语
    '3007': ['zh', 'en', 'ur'],  // 中文、英语、乌尔都语
};

/**
 * 全局默认语言（当租户ID未配置时使用）
 */
export const GLOBAL_DEFAULT_LANGUAGES = ['zh', 'en', 'hi'];

/**
 * 根据租户ID获取默认语言列表
 * @param {string|number} tenantId - 租户ID
 * @returns {string[]} 语言代码数组
 */
export function getTenantDefaultLanguages(tenantId) {
    if (!tenantId || tenantId === 'default') {
        return GLOBAL_DEFAULT_LANGUAGES.slice();
    }
    const id = String(tenantId);
    return (TENANT_DEFAULT_LANGUAGES[id] || GLOBAL_DEFAULT_LANGUAGES).slice();
}

/**
 * 打印租户语言配置（调试用）
 */
export function printTenantLanguageConfig() {
    console.log('========== 租户语言配置 ==========');
    Object.entries(TENANT_DEFAULT_LANGUAGES).forEach(([tenantId, langs]) => {
        console.log(`租户 ${tenantId}: ${langs.join(', ')}`);
    });
    console.log('全局默认: ' + GLOBAL_DEFAULT_LANGUAGES.join(', '));
    console.log('==================================');
}
