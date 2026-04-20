/**
 * TikTok 埋点注册统一配置文件
 *
 * ============================================================
 * 设计原则
 * ============================================================
 *
 * 维度一：PACKAGE_CONFIGS（包类型维度）
 *   通过 -e PACKAGE_TYPE=21/22/2 指定，适用于"同一个包跨多个租户"的场景。
 *   新增包类型 → 在此追加一条，脚本无需改动。
 *
 * 维度二：TENANT_EVENT_CONFIGS（租户维度，优先级更高）
 *   当某个租户有独立的 eventConfigId / pixelId / packageName 时在此配置。
 *   新增租户专属配置 → 在此追加一条，脚本无需改动。
 *
 * 查找优先级（getEventConfig 函数）：
 *   TENANT_EVENT_CONFIGS[tenantId]          ← 最高优先级
 *     > PACKAGE_CONFIGS[packageType]        ← 次优先
 *     > PACKAGE_CONFIGS['22']               ← 兜底默认
 *
 * ============================================================
 * 快速索引
 * ============================================================
 *
 *  包类型  │ eventConfigId │ 租户       │ 说明
 * ─────────┼───────────────┼────────────┼──────────────────────
 *  21      │ 21            │ 通用       │ 老包
 *  22      │ 22            │ 通用       │ 新包（默认）
 *  2       │ 2             │ 3101 专项  │ 3101 TikTok 专项包
 *  3       │ 3             │ 3101 专项  │ 3101 TikTok 新包
 *  24      │ 24            │ 3004 专项  │ 3004 TikTok 新包
 * ─────────┼───────────────┼────────────┼──────────────────────
 *  租户    │ eventConfigId │ packageType│ 说明
 * ─────────┼───────────────┼────────────┼──────────────────────
 *  3004    │ 23            │ 专属       │ 3004 TikTok
 *  3101    │ 1             │ 专属       │ 3101 UAT
 *
 * ============================================================
 * 新增配置指引
 * ============================================================
 *
 * 新增包类型（如 id=30）：
 *   在 PACKAGE_CONFIGS 里追加：
 *   '30': { id: 30, pixelId: 'xxx', packageName: 'com.ar3004.fb.app', inviteCode: 'xxx', desc: '...' }
 *
 * 新增租户专属配置（如租户 3002）：
 *   在 TENANT_EVENT_CONFIGS 里追加：
 *   '3002': { id: 5, pixelId: 'xxx', packageName: 'com.ar3002.fb.app', inviteCode: 'xxx', desc: '...' }
 *
 * 新增后无需改动任何脚本文件。
 */

// ============================================================
// 维度一：包类型配置
// 适用场景：同一个包跨多个租户，通过 -e PACKAGE_TYPE= 指定
// ============================================================
export const PACKAGE_CONFIGS = {
    // 老包
    '21': {
        id: 21,
        pixelId: 'D7G8J3JC77UBV63HPUH0',
        packageName: 'com.ar3004.fb.app',
        inviteCode: 'FXNDMAN',
        registerDomain: 'https://tiktok.arplatsaassit4.club',  // 发验证码 + 注册的域名
        desc: '📦 老包 (ID: 21)'
    },
    // 新包（默认）
    '22': {
        id: 22,
        pixelId: 'D7GEL23C77U0PCJMRE8G',
        packageName: 'com.ar3004.fb.app',
        inviteCode: 'CPWHUUN',
        registerDomain: 'https://tiktok.arplatsaassit4.club',
        desc: '🚀 新包 (ID: 22)'
    },
    // 3101 TikTok 专项包
    '2': {
        id: 2,
        pixelId: 'D7HNBRBC77UFJPI0A9L0',
        packageName: 'com.ar3101.fb.app',
        inviteCode: 'Y2M5T3N',
        registerDomain: 'https://arplatsaaspagesuat.club',
        desc: '🎯 3101 TikTok 专项包 (ID: 2)'
    },
    // 3101 TikTok 新包
    '3': {
        id: 3,
        pixelId: 'D7IRN23C77U02SC968QG',
        packageName: 'com.ar3101.fb.app',
        inviteCode: 'X2X8DEN',
        registerDomain: 'https://arplatsaaspagesuat.club',
        desc: '🎯 3101 TikTok 新包 (ID: 3)'
    },
    // 3004 TikTok 新包
    '24': {
        id: 24,
        pixelId: 'D7ITB8RC77UDQIAF27TG',
        packageName: 'com.ar3004.fb.app',
        inviteCode: 'mzyfSKN',
        registerDomain: 'https://tiktok.arplatsaassit4.club',
        desc: '🎯 3004 TikTok 新包 (ID: 24)'
    }
};

// ============================================================
// 维度二：租户专属配置（优先级高于包类型配置）
// 适用场景：某个租户有独立的 eventConfigId / pixelId / packageName
// ============================================================
export const TENANT_EVENT_CONFIGS = {
    // 3004 TikTok 埋点
    '3004': {
        id: 23,
        pixelId: 'D7HMG53C77UEMEL8D1OG',
        packageName: 'com.ar3004.fb.app',
        inviteCode: 'JCGW4YN',
        registerDomain: 'https://tiktok.arplatsaassit4.club',
        desc: '🎯 3004 TikTok (ID: 23)'
    },
    // 3101 UAT 环境
    '3101': {
        id: 1,
        pixelId: 'D7HIJKBC77UFJ111MTQG',
        packageName: 'com.ar3101.fb.app',
        inviteCode: '',
        registerDomain: 'https://arplatsaaspagesuat.club',  // 3101 UAT tiktok 域名
        desc: '🧪 3101 UAT (ID: 1)'
    }

    // 新增租户专属配置示例：
    // '3002': {
    //     id: 5,
    //     pixelId: 'XXXXXXXXXXXXXXXX',
    //     packageName: 'com.ar3002.fb.app',
    //     inviteCode: 'XXXXX',
    //     desc: '3002 专属包 (ID: 5)'
    // },
};

// ============================================================
// 核心查找函数
// ============================================================

/**
 * 获取埋点注册配置
 *
 * 查找优先级：
 *   1. PACKAGE_CONFIGS[packageType]    明确指定包类型时优先（最高）
 *   2. TENANT_EVENT_CONFIGS[tenantId]  未指定包类型时，用租户专属兜底
 *   3. PACKAGE_CONFIGS['22']           最终兜底默认
 *
 * 设计意图：
 *   - 明确传 -e PACKAGE_TYPE=2  → 走包类型配置，租户专属不干扰
 *   - 不传 PACKAGE_TYPE         → 走租户专属配置（如 3101 UAT、3004 TikTok）
 *   - 两者都没有                → 默认包类型 22
 *
 * @param {string} tenantId    - 租户ID，如 '3101'
 * @param {string} packageType - 包类型，如 '21'/'22'/'2'；传 '' 或不传表示未指定
 * @returns {{ id, pixelId, packageName, inviteCode, desc }}
 */
export function getEventConfig(tenantId, packageType = '') {
    // 1. 明确指定了包类型 → 包类型优先
    if (packageType && PACKAGE_CONFIGS[packageType]) {
        const cfg = PACKAGE_CONFIGS[packageType];
        console.log(`[EventConfig] 租户 ${tenantId} → 包类型 [${packageType}]: ${cfg.desc}`);
        return cfg;
    }

    // 2. 未指定包类型 → 租户专属配置
    if (tenantId && TENANT_EVENT_CONFIGS[tenantId]) {
        const cfg = TENANT_EVENT_CONFIGS[tenantId];
        console.log(`[EventConfig] 租户 ${tenantId} → 专属配置: ${cfg.desc}`);
        return cfg;
    }

    // 3. 兜底
    console.warn(`[EventConfig] 未匹配到配置 (tenantId=${tenantId}, packageType=${packageType})，使用默认包类型 22`);
    return PACKAGE_CONFIGS['22'];
}

/**
 * 打印所有已注册的配置（调试用）
 */
export function printAllConfigs() {
    console.log('\n========== TikTok 埋点配置总览 ==========');
    console.log('--- 包类型配置 ---');
    for (const [type, cfg] of Object.entries(PACKAGE_CONFIGS)) {
        console.log(`  PACKAGE_TYPE=${type}: ${cfg.desc} | pixelId=${cfg.pixelId} | inviteCode=${cfg.inviteCode}`);
    }
    console.log('--- 租户专属配置 ---');
    for (const [tenantId, cfg] of Object.entries(TENANT_EVENT_CONFIGS)) {
        console.log(`  TENANT_ID=${tenantId}: ${cfg.desc} | pixelId=${cfg.pixelId} | inviteCode=${cfg.inviteCode || '(无)'}`);
    }
    console.log('==========================================\n');
}
