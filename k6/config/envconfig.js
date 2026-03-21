// ============================================
// 环境配置文件 - 多租户配置
// ============================================

// 3001 环境配置
export const ENV_3001 = {
    BASE_ADMIN_URL: "https://ar666999.club",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit1.club",  // 前台地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3001",   // 系统管理员
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3001,
    LimitedPermissions: "carey3001_001",  // 小权限角色
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3001_001",  // 只有工单权限的角色
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",  // 默认区号
    LANGUAGE: "en"  // 语言：英语
};

// 3002 环境配置
export const ENV_3002 = {
    BASE_ADMIN_URL: "https://arsitasdfghjklg.com",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit2.club",  // 前台地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3002",   // 系统管理员
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3002,
    LimitedPermissions: "carey3002_001",  // 小权限角色
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3002_001",  // 只有工单权限的角色
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",  // 默认区号
    LANGUAGE: "en"  // 语言：英语
};

// 3003 环境配置
export const ENV_3003 = {
    BASE_ADMIN_URL: "https://arsitasdfghj.com",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit3.club",  // 前台地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3003",   // 系统管理员（修正为3003）
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3003,
    LimitedPermissions: "carey3003_001",  // 小权限角色
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3003_001",  // 只有工单权限的角色
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "52",  // 墨西哥区号
    LANGUAGE: "es"  // 语言：西班牙语
};

// 3004 环境配置（当前默认）
export const ENV_3004 = {
    BASE_ADMIN_URL: "https://arsitasdfghjklusa.com",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit4.club",  // 前台地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3004",   // 系统管理员
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3004,
    LimitedPermissions: "carey3004_001",  // 小权限角色
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3004_001",  // 只有工单权限的角色
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",  // 默认区号
    LANGUAGE: "en"  // 语言：英语
};

// 默认使用 3004 环境
export const ENV_CONFIG = ENV_3004;

// 环境映射表 - 用于根据租户ID获取配置
export const ENV_MAP = {
    '3001': ENV_3001,
    '3002': ENV_3002,
    '3003': ENV_3003,
    '3004': ENV_3004
};

/**
 * 根据租户ID获取环境配置
 * @param {string} tenantId - 租户ID (如 "3001", "3002", "3003", "3004")
 * @returns {object} 环境配置对象
 */
export function getEnvByTenantId(tenantId) {
    return ENV_MAP[tenantId] || ENV_CONFIG;
}
