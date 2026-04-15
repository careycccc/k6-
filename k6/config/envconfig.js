// ============================================
// 环境配置文件 - 多租户配置
// ============================================
//
// 地址说明:
//   BASE_DESK_URL        前台地址（普通注册/总代注册/登录等）
//   BASE_ADMIN_URL       管理后台地址
//   INVITE_REGISTER_URL  邀请注册专用地址（发验证码 + 注册，与前台不同域）
//                        ⚠️ 3001-3003 待补充，先留空
//
// 语言配置:
//   语言与租户已解耦，请勿在此文件配置 LANGUAGE
//   通过 K6 环境变量指定：  -e LANGUAGES=zh,en,hi
//   不指定时默认使用：         zh,en,hi（中文、英语、印地语）
//   详见 config/languageConfig.js
// ============================================

// 3001 环境配置
export const ENV_3001 = {
    BASE_ADMIN_URL: "https://ar666999.club",          // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit1.club",     // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "https://3001.zc-arplatsaassit.com",                          // ⚠️ 邀请注册地址（待补充）
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3001",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3001,
    LimitedPermissions: "carey3001_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3001_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3002 环境配置
export const ENV_3002 = {
    BASE_ADMIN_URL: "https://arsitasdfghjklg.com",    // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit2.club",     // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "https://3002.zc-arplatsaassit.com",
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3002",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3002,
    LimitedPermissions: "carey3002_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3002_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3003 环境配置
export const ENV_3003 = {
    BASE_ADMIN_URL: "https://3003-tenantadmin.ar666999.club",       // 管理后台地址
    BASE_DESK_URL: "https://3003.arplatsaassit3.club",     // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "https://3003.zc-arplatsaassit.com",  // 邀请注册地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3003",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3003,
    LimitedPermissions: "carey3003_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3003_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3004 环境配置（当前默认）
export const ENV_3004 = {
    BASE_ADMIN_URL: "https://arsitasdfghjklusa.com",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit4.club",     // 前台地址（普通注册/总代注册）
    INVITE_REGISTER_URL: "https://3004.zc-arplatsaassit.com",  // 邀请注册地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3004",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3004,
    LimitedPermissions: "carey3004_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3004_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3005 环境配置
export const ENV_3005 = {
    BASE_ADMIN_URL: "https://arsitasdfghj.com",  // 管理后台地址
    BASE_DESK_URL: "https://arplatsaassit3.club",              // 前台地址
    INVITE_REGISTER_URL: "https://3005.zc-arplatsaassit.com", // 邀请注册地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey3005",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3005,
    LimitedPermissions: "carey3005_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey3005_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "52",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3006 环境配置
export const ENV_3006 = {
    BASE_ADMIN_URL: "https://3006-tenantadmin.ar666999.club",  // 管理后台地址
    BASE_DESK_URL: "https://3006.arplatsaassit4.club",         // 前台地址
    INVITE_REGISTER_URL: "https://3006.zc-arplatsaassit.com",   // 邀请注册地址
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
    COUNTRY_CODE: "880",  // 孟加拉国区号
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 3007 环境配置
export const ENV_3007 = {
    BASE_ADMIN_URL: "https://3007-tenantadmin.ar666999.club",  // 管理后台地址
    BASE_DESK_URL: "https://3007.arplatsaassit4.club",         // 前台地址
    INVITE_REGISTER_URL: "https://3007.zc-arplatsaassit.com",   // 邀请注册地址
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
    COUNTRY_CODE: "92",  // 巴基斯坦区号
    RECHARGE_AMOUNT_MIN: 200,
    RECHARGE_AMOUNT_MAX: 500
};

// 3101 UAT 环境配置
export const ENV_3101 = {
    BASE_ADMIN_URL: "https://3101-tenantadmin.arplatsaasuat.com",    // 管理后台地址
    BASE_DESK_URL: "https://arplatsaaspagesuat.club",               // 前台地址
    INVITE_REGISTER_URL: "https://3101-register-uat.arplatsaasuat.com", // 邀请注册地址
    PAGESIZE: 200,
    PAGENO: 1,
    ADMIN_USERNAME: "carey_3101",
    ADMIN_PASSWORD: "qwer1234",
    START_TIME: "2026-01-08 00:00:00",
    END_TIME: "2026-01-08 23:59:59",
    TENANTID: 3101,
    LimitedPermissions: "carey_3101_001",
    LimitedPermissionsPassWord: "qwer1234",
    WorkOrderRole: "carey_3101_001",
    WorkOrderRolePasswrod: "qwer1234",
    COUNTRY_CODE: "91",
    RECHARGE_AMOUNT_MIN: 2000,
    RECHARGE_AMOUNT_MAX: 5000
};

// 默认使用 3004 环境
export const ENV_CONFIG = ENV_3004;

// 环境映射表 - 用于根据租户ID获取配置
export const ENV_MAP = {
    '3001': ENV_3001,
    '3002': ENV_3002,
    '3003': ENV_3003,
    '3004': ENV_3004,
    '3005': ENV_3005,
    '3006': ENV_3006,
    '3007': ENV_3007,
    '3101': ENV_3101
};

/**
 * 根据租户ID获取环境配置
 * @param {string} tenantId - 租户ID (如 "3001", "3002", "3003", "3004")
 * @returns {object} 环境配置对象
 */
export function getEnvByTenantId(tenantId) {
    return ENV_MAP[tenantId] || ENV_CONFIG;
}




// 3001 darkPurple
// 前台：arplatsaassit1.club
// 后台：ar666999.club
// 注册：3001.zc-arplatsaassit.com

// 3002 darkRed
// 前台：arplatsaassit2.club
// 后台：arsitasdfghjklg.com
// 注册：3002.zc-arplatsaassit.com

// 3003 lightBlue
// 前台：3003.arplatsaassit3.club
// 后台：3003-tenantadmin.ar666999.club
// 注册：3003.zc-arplatsaassit.com

// 3004 777blue
// 前台：arplatsaassit4.club
// 后台：arsitasdfghjklusa.com
// 注册：3004.zc-arplatsaassit.com

// 3005 darkBlue07
// 前台：arplatsaassit3.club
// 后台：arsitasdfghj.com
// 注册：3005.zc-arplatsaassit.com

// 3006 deepYellow
// 前台：3006.arplatsaassit4.club
// 后台：3006-tenantadmin.ar666999.club
// 注册：3006.zc-arplatsaassit.com

// 3107 deepOrange
// 前台：3007.arplatsaassit4.club
// 后台：3007-tenantadmin.ar666999.club
// 注册：3007.zc-arplatsaassit.com

// 3101 UAT
// 前台：arplatsaaspagesuat.club
// 后台：3101-tenantadmin.arplatsaasuat.com
// 注册：3101-register-uat.arplatsaasuat.com