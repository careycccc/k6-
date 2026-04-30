// ============================================
// 租户语言配置
// ============================================
//
// 数组顺序 = 优先级：
//   - 第一个是该租户的主语言（验证码优先使用，getTimeRandom 默认使用）
//   - 后续是降级语言（验证码发送失败时依次尝试）
//   - 活动创建的 translations 使用全部语言
//
// 新增租户语言只需在此处添加/修改一条记录，无需修改其他代码。
// ============================================

/**
 * 租户语言优先级配置
 *
 * 同时服务两个用途：
 *   1. 活动创建 translations：使用数组中所有语言
 *   2. 验证码发送降级重试：按数组顺序逐个尝试，失败自动切换下一个
 *
 * key: 租户ID (字符串)
 * value: 语言代码数组（按优先级排列，特殊语言放前面）
 */
export const TENANT_LANGUAGES = {
    '3001': ['hi', 'en', 'zh'],   // 印地语优先 → 英语 → 中文
    '3002': ['en', 'zh'], // 乌尔都语优先（区号 92）→ 印地语 → 英语 → 中文
    '3003': ['es', 'en', 'zh'],   // 西班牙语优先 → 英语 → 中文
    '3004': ['hi', 'en', 'zh'],   // 印地语优先 → 英语 → 中文
    '3006': ['bn', 'en', 'zh'],   // 孟加拉语优先 → 英语 → 中文
    '3007': ['ur', 'bn', 'en'],   // 乌尔都语优先 → 孟加拉语 → 英语
};

/**
 * 全局默认语言（当租户ID未配置时使用）
 */
export const GLOBAL_DEFAULT_LANGUAGES = ['en', 'zh', 'hi'];

// ============================================================
// 向后兼容：保留旧名称导出，避免现有代码报错
// ============================================================
export const TENANT_DEFAULT_LANGUAGES = TENANT_LANGUAGES;
export const TENANT_VERIFYCODE_LANGUAGES = {
    ...TENANT_LANGUAGES,
    'default': ['en']
};

/**
 * 根据租户ID获取语言列表（活动创建用，包含所有语言）
 * @param {string|number} tenantId
 * @returns {string[]}
 */
export function getTenantDefaultLanguages(tenantId) {
    if (!tenantId || tenantId === 'default') {
        return GLOBAL_DEFAULT_LANGUAGES.slice();
    }
    return (TENANT_LANGUAGES[String(tenantId)] || GLOBAL_DEFAULT_LANGUAGES).slice();
}

/**
 * 根据租户ID获取验证码发送语言优先级列表
 * 按顺序逐个尝试，失败自动切换下一个，全部失败才是真正的错误
 * @param {string|number} tenantId
 * @returns {string[]}
 */
export function getTenantVerifyCodeLanguages(tenantId) {
    const langs = getTenantDefaultLanguages(tenantId);
    // 确保最后有 en 兜底（如果没有的话）
    if (!langs.includes('en')) langs.push('en');
    return langs;
}

/**
 * 获取租户的主语言（数组第一个，用于 getTimeRandom 默认值）
 * @param {string|number} tenantId
 * @returns {string}
 */
export function getTenantPrimaryLanguage(tenantId) {
    const langs = getTenantDefaultLanguages(tenantId);
    return langs[0] || 'en';
}

/**
 * 打印租户语言配置（调试用）
 */
export function printTenantLanguageConfig() {
    console.log('========== 租户语言配置 ==========');
    Object.entries(TENANT_LANGUAGES).forEach(([tenantId, langs]) => {
        console.log(`租户 ${tenantId}: ${langs.join(' → ')}`);
    });
    console.log('全局默认: ' + GLOBAL_DEFAULT_LANGUAGES.join(' → '));
    console.log('==================================');
}
