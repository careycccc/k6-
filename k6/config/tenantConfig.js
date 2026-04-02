// ============================================
// 租户扩展配置文件 - 3006和3007
// ============================================

// 3006 环境配置
export const ENV_3006 = {
    BASE_ADMIN_URL: "https://3006-tenantadmin.ar666999.club",  // 管理后台地址
    BASE_DESK_URL: "https://3006.arplatsaassit4.club",         // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "",                                    // 邀请注册地址（待补充）
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3006",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3006,
    LimitedPermissions: "carey3006_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3006_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91"
};

// 3007 环境配置
export const ENV_3007 = {
    BASE_ADMIN_URL: "https://3007-tenantadmin.ar666999.club",  // 管理后台地址
    BASE_DESK_URL: "https://3007.arplatsaassit4.club",         // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "https://3007-reg.arplatsaassit4.club", // 邀请注册地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3007",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3007,
    LimitedPermissions: "carey3007_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3007_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "92"  // 巴基斯坦区号
};

// 租户扩展映射表
export const TENANT_EXT_MAP = {
    '3006': ENV_3006,
    '3007': ENV_3007
};

/**
 * 获取扩展租户配置
 * @param {string} tenantId - 租户ID (如 "3006", "3007")
 * @returns {object} 环境配置对象
 */
export function getTenantExtConfig(tenantId) {
    return TENANT_EXT_MAP[tenantId];
}
