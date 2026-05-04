/**
 * Adjust 埋点注册配置文件
 *
 * 与 TikTok 配置（eventRegisterConfig.js）并列，专门管理 Adjust 渠道的包配置。
 *
 * ============================================================
 * 快速索引
 * ============================================================
 *
 *  包类型       │ eventConfigId │ 租户       │ 说明
 * ──────────────┼───────────────┼────────────┼──────────────────────
 *  adjust_001   │ 200015        │ 通用       │ Adjust 默认包
 *
 * ============================================================
 * 新增配置指引
 * ============================================================
 *
 * 新增包类型（如 adjust_002）：
 *   在 ADJUST_PACKAGE_CONFIGS 里追加一条，脚本无需改动。
 *
 * 新增租户专属配置：
 *   在 ADJUST_TENANT_CONFIGS 里追加一条，脚本无需改动。
 */

// ============================================================
// 维度一：包类型配置
// ============================================================
export const ADJUST_PACKAGE_CONFIGS = {
    'adjust_001': {
        id: 200015,
        eventType: 2,
        pixelId: 'uyyiyutewe',
        packageName: 'com.ar3004.adcarey_adjust_001.app',
        inviteCode: '',
        registerDomain: '',   // 留空则使用租户前台地址
        desc: '📱 Adjust 默认包 (ID: 200015)'
    }

    // 新增示例：
    // 'adjust_002': {
    //     id: 200016,
    //     eventType: 2,
    //     pixelId: 'xxxxxxxxxx',
    //     packageName: 'com.ar3004.adcarey_adjust_002.app',
    //     inviteCode: '',
    //     registerDomain: '',
    //     desc: '📱 Adjust 包2 (ID: 200016)'
    // }
};

// ============================================================
// 维度二：租户专属配置（优先级高于包类型配置）
// ============================================================
export const ADJUST_TENANT_CONFIGS = {
    // 示例：
    // '3004': {
    //     id: 200015,
    //     eventType: 2,
    //     pixelId: 'uyyiyutewe',
    //     packageName: 'com.ar3004.adcarey_adjust_001.app',
    //     inviteCode: '',
    //     registerDomain: '',
    //     desc: '📱 3004 Adjust 专属包'
    // }
};

// ============================================================
// 核心查找函数
// ============================================================

/**
 * 获取 Adjust 埋点注册配置
 *
 * 查找优先级：
 *   1. ADJUST_PACKAGE_CONFIGS[packageType]   明确指定包类型时优先
 *   2. ADJUST_TENANT_CONFIGS[tenantId]       未指定包类型时，用租户专属兜底
 *   3. ADJUST_PACKAGE_CONFIGS['adjust_001']  最终兜底默认
 *
 * @param {string} tenantId    - 租户ID
 * @param {string} packageType - 包类型，如 'adjust_001'；传 '' 表示未指定
 * @returns {{ id, eventType, pixelId, packageName, inviteCode, registerDomain, desc }}
 */
export function getAdjustConfig(tenantId, packageType = '') {
    if (packageType && ADJUST_PACKAGE_CONFIGS[packageType]) {
        const cfg = ADJUST_PACKAGE_CONFIGS[packageType];
        console.log(`[AdjustConfig] 租户 ${tenantId} → 包类型 [${packageType}]: ${cfg.desc}`);
        return cfg;
    }

    if (tenantId && ADJUST_TENANT_CONFIGS[tenantId]) {
        const cfg = ADJUST_TENANT_CONFIGS[tenantId];
        console.log(`[AdjustConfig] 租户 ${tenantId} → 专属配置: ${cfg.desc}`);
        return cfg;
    }

    console.warn(`[AdjustConfig] 未匹配到配置 (tenantId=${tenantId}, packageType=${packageType})，使用默认 adjust_001`);
    return ADJUST_PACKAGE_CONFIGS['adjust_001'];
}
