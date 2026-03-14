/**
 * 多租户邀请测试配置
 * 
 * 此文件定义了不同租户的邀请测试配置
 * AI可以通过读取此文件识别可用的租户和配置
 */

/**
 * 租户配置对象
 * @typedef {Object} TenantConfig
 * @property {string} tenantId - 租户ID
 * @property {string} name - 租户名称
 * @property {string} rootInviteCode - 总代邀请码
 * @property {number[]} defaultLevels - 默认层级配置 [第1层人数, 第2层人数, ...]
 * @property {string} description - 租户描述
 * @property {boolean} enabled - 是否启用
 * @property {string} registerApiUrl - 注册API的完整URL（可选，如果不同于默认前台域名）
 */

/**
 * 租户配置列表
 */
export const TENANT_CONFIGS = {
    '3001': {
        tenantId: '3001',
        name: '租户3001',
        rootInviteCode: '',  // ⚠️ 需要提供3001的总代邀请码
        defaultLevels: [2, 2],
        description: '租户3001的邀请测试配置',
        enabled: true,
        frontUrl: 'https://arplatsaassit1.club',
        registerApiUrl: 'https://arplatsaassit1.club',
        adminUrl: 'https://ar666999.club',
        adminUsername: 'carey3001',
        adminPassword: 'qwer1234'
    },
    '3002': {
        tenantId: '3002',
        name: '租户3002',
        rootInviteCode: '85YJGZW',
        defaultLevels: [2, 2],
        description: '租户3002的邀请测试配置',
        enabled: true,
        frontUrl: 'https://arplatsaassit2.club',
        registerApiUrl: 'https://arplatsaassit2.club',
        adminUrl: 'https://arsitasdfghjklg.com',
        adminUsername: 'carey3002',
        adminPassword: 'qwer1234'
    },
    '3003': {
        tenantId: '3003',
        name: '租户3003',
        rootInviteCode: '',  // ⚠️ 需要提供3003的总代邀请码
        defaultLevels: [2, 2],
        description: '租户3003的邀请测试配置',
        enabled: true,
        frontUrl: 'https://arplatsaassit3.club',
        registerApiUrl: 'https://arplatsaassit3.club',
        adminUrl: 'https://arsitasdfghj.com',
        adminUsername: 'carey3003',
        adminPassword: 'qwer1234'
    },
    '3004': {
        tenantId: '3004',
        name: '租户3004',
        rootInviteCode: 'W5LU89N',
        defaultLevels: [2, 2],
        description: '租户3004的邀请测试配置（默认）',
        enabled: true,
        registerApiUrl: null  // 使用默认前台域名
    },
    // 可以继续添加更多租户
};

/**
 * 获取租户配置
 * @param {string} tenantId - 租户ID
 * @returns {TenantConfig|null} 租户配置对象
 */
export function getTenantConfig(tenantId) {
    const config = TENANT_CONFIGS[tenantId];

    if (!config) {
        console.warn(`[TenantConfig] 未找到租户配置: ${tenantId}`);
        return null;
    }

    if (!config.enabled) {
        console.warn(`[TenantConfig] 租户已禁用: ${tenantId}`);
        return null;
    }

    return config;
}

/**
 * 获取所有启用的租户ID列表
 * @returns {string[]} 租户ID数组
 */
export function getEnabledTenants() {
    return Object.keys(TENANT_CONFIGS).filter(id => TENANT_CONFIGS[id].enabled);
}

/**
 * 验证租户配置是否完整
 * @param {string} tenantId - 租户ID
 * @returns {boolean} 配置是否有效
 */
export function validateTenantConfig(tenantId) {
    const config = getTenantConfig(tenantId);

    if (!config) {
        return false;
    }

    if (!config.rootInviteCode) {
        console.error(`[TenantConfig] 租户 ${tenantId} 缺少 rootInviteCode`);
        return false;
    }

    if (!config.defaultLevels || config.defaultLevels.length === 0) {
        console.error(`[TenantConfig] 租户 ${tenantId} 缺少 defaultLevels 配置`);
        return false;
    }

    return true;
}

/**
 * 打印租户配置信息
 * @param {string} tenantId - 租户ID
 */
export function printTenantConfig(tenantId) {
    const config = getTenantConfig(tenantId);

    if (!config) {
        console.log(`❌ 租户 ${tenantId} 配置不存在`);
        return;
    }

    console.log('\n========== 租户配置信息 ==========');
    console.log(`租户ID: ${config.tenantId}`);
    console.log(`租户名称: ${config.name}`);
    console.log(`总代邀请码: ${config.rootInviteCode || '未配置'}`);
    console.log(`默认层级: ${config.defaultLevels.join(' -> ')}`);
    console.log(`描述: ${config.description}`);
    console.log(`状态: ${config.enabled ? '✅ 启用' : '❌ 禁用'}`);
    console.log('===================================\n');
}
