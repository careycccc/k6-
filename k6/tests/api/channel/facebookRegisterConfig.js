/**
 * Facebook 埋点注册配置文件
 *
 * ============================================================
 * 快速索引
 * ============================================================
 *
 *  包类型      │ eventConfigId │ 租户  │ 说明
 * ─────────────┼───────────────┼───────┼──────────────────────
 *  fb_001      │ 200018        │ 通用  │ Facebook 默认包
 *
 * ============================================================
 * 新增配置指引
 * ============================================================
 *
 * 新增包类型（如 fb_002）：
 *   在 FB_PACKAGE_CONFIGS 里追加一条，脚本无需改动。
 *
 * 新增租户专属配置：
 *   在 FB_TENANT_CONFIGS 里追加一条，脚本无需改动。
 */

// ============================================================
// 维度一：包类型配置
// ============================================================
export const FB_PACKAGE_CONFIGS = {
    'fb_001': {
        id: 200018,
        eventType: 1,
        pixelId: '2010850729480687',
        packageName: 'com.ar3004.fb.app',
        inviteCode: '',
        registerDomain: '',   // 留空则使用租户前台地址
        desc: '📘 Facebook 默认包 (ID: 200018)'
    }

    // 新增示例：
    // 'fb_002': {
    //     id: 200019,
    //     eventType: 1,
    //     pixelId: 'xxxxxxxxxxxxxxxxx',
    //     packageName: 'com.ar3004.fb2.app',
    //     inviteCode: '',
    //     registerDomain: '',
    //     desc: '📘 Facebook 包2 (ID: 200019)'
    // }
};

// ============================================================
// 维度二：租户专属配置（优先级高于包类型配置）
// ============================================================
export const FB_TENANT_CONFIGS = {
    // 示例：
    // '3007': {
    //     id: 200020,
    //     eventType: 1,
    //     pixelId: 'xxxxxxxxxxxxxxxxx',
    //     packageName: 'com.ar3007.fb.app',
    //     inviteCode: '',
    //     registerDomain: '',
    //     desc: '📘 3007 Facebook 专属包'
    // }
};

// ============================================================
// 核心查找函数
// ============================================================

/**
 * 获取 Facebook 埋点注册配置
 *
 * 查找优先级：
 *   1. FB_PACKAGE_CONFIGS[packageType]   明确指定包类型时优先
 *   2. FB_TENANT_CONFIGS[tenantId]       未指定包类型时，用租户专属兜底
 *   3. FB_PACKAGE_CONFIGS['fb_001']      最终兜底默认
 *
 * @param {string} tenantId    - 租户ID
 * @param {string} packageType - 包类型，如 'fb_001'；传 '' 表示未指定
 * @returns {{ id, eventType, pixelId, packageName, inviteCode, registerDomain, desc }}
 */
export function getFbConfig(tenantId, packageType = '') {
    if (packageType && FB_PACKAGE_CONFIGS[packageType]) {
        const cfg = FB_PACKAGE_CONFIGS[packageType];
        console.log(`[FbConfig] 租户 ${tenantId} → 包类型 [${packageType}]: ${cfg.desc}`);
        return cfg;
    }

    if (tenantId && FB_TENANT_CONFIGS[tenantId]) {
        const cfg = FB_TENANT_CONFIGS[tenantId];
        console.log(`[FbConfig] 租户 ${tenantId} → 专属配置: ${cfg.desc}`);
        return cfg;
    }

    console.warn(`[FbConfig] 未匹配到配置 (tenantId=${tenantId}, packageType=${packageType})，使用默认 fb_001`);
    return FB_PACKAGE_CONFIGS['fb_001'];
}
