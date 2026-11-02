// ============================================
// 环境配置文件 - 多租户配置
// ============================================
//
// 2026-11-02：真实账号密码 / GOOGLE_SECRET 等敏感信息已迁移到项目根目录的
// .env 文件（不进 git，见 .env.example 模板），本文件只负责读取 + 组装，
// 不再写死任何真实凭据。解析逻辑在 envFileLoader.js。
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

import { getEnvValue, getEnvInt } from './envFileLoader.js';

/**
 * 按 ENV_<prefix>_<FIELD> 的命名约定，从 .env 组装出一个租户配置对象。
 * 字段名、默认值跟改造前的字面量完全对应，保证下游引用方不用改。
 */
function buildTenantEnv(prefix) {
    return {
        BASE_ADMIN_URL: getEnvValue(`${prefix}_BASE_ADMIN_URL`),
        BASE_DESK_URL: getEnvValue(`${prefix}_BASE_DESK_URL`),
        INVITE_REGISTER_URL: getEnvValue(`${prefix}_INVITE_REGISTER_URL`),
        PAGESIZE: getEnvInt(`${prefix}_PAGESIZE`, 200),
        PAGENO: getEnvInt(`${prefix}_PAGENO`, 1),
        ADMIN_USERNAME: getEnvValue(`${prefix}_ADMIN_USERNAME`),
        ADMIN_PASSWORD: getEnvValue(`${prefix}_ADMIN_PASSWORD`),
        START_TIME: getEnvValue(`${prefix}_START_TIME`),
        END_TIME: getEnvValue(`${prefix}_END_TIME`),
        TENANTID: getEnvInt(`${prefix}_TENANTID`),
        AGENT_MODE: getEnvInt(`${prefix}_AGENT_MODE`), // 代理模式：0=6级代理，1=3级代理。2026-10-30 总控 /api/Tenant/GetPageList 实测确认
        GOOGLE_SECRET: getEnvValue(`${prefix}_GOOGLE_SECRET`), // 后台谷歌验证码(TOTP)密钥
        LimitedPermissions: getEnvValue(`${prefix}_LIMITED_PERMISSIONS`),
        LimitedPermissionsPassWord: getEnvValue(`${prefix}_LIMITED_PERMISSIONS_PASSWORD`),
        WorkOrderRole: getEnvValue(`${prefix}_WORK_ORDER_ROLE`),
        WorkOrderRolePasswrod: getEnvValue(`${prefix}_WORK_ORDER_ROLE_PASSWORD`), // 字段名含历史拼写 "Passwrod"，下游有引用，不能改名
        COUNTRY_CODE: getEnvValue(`${prefix}_COUNTRY_CODE`),
        RECHARGE_AMOUNT_MIN: getEnvInt(`${prefix}_RECHARGE_AMOUNT_MIN`, 2000),
        RECHARGE_AMOUNT_MAX: getEnvInt(`${prefix}_RECHARGE_AMOUNT_MAX`, 5000),
    };
}

// 3001 环境配置
export const ENV_3001 = buildTenantEnv('ENV_3001');

// 3002 环境配置
export const ENV_3002 = buildTenantEnv('ENV_3002');

// 3003 环境配置
export const ENV_3003 = buildTenantEnv('ENV_3003');

// 3004 环境配置（当前默认）—— 3004 是目前唯一的 3 级代理商户（AGENT_MODE=1）
export const ENV_3004 = buildTenantEnv('ENV_3004');

// 3005 环境配置
export const ENV_3005 = buildTenantEnv('ENV_3005');

// 3006 环境配置（COUNTRY_CODE 880 = 孟加拉国区号）
export const ENV_3006 = buildTenantEnv('ENV_3006');

// 3007 环境配置（COUNTRY_CODE 92 = 巴基斯坦区号）
export const ENV_3007 = buildTenantEnv('ENV_3007');

// 3101 UAT 环境配置
export const ENV_3101 = buildTenantEnv('ENV_3101');

// 默认使用 3004 环境 —— 必须是直接引用（不能写成 {...ENV_3004} 这种拷贝）：
// 全仓约 100 余处代码会 Object.assign(ENV_CONFIG, 其他租户配置) 来运行时切租户，
// 依赖 ENV_CONFIG/ENV_3004/ENV_MAP['3004'] 是同一个对象实例这个副作用。
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

// 3007 deepOrange
// 前台：3007.arplatsaassit4.club
// 后台：3007-tenantadmin.ar666999.club
// 注册：3007.zc-arplatsaassit.com

// 3101 UAT
// 前台：arplatsaaspagesuat.club
// 后台：3101-tenantadmin.arplatsaasuat.com
// 注册：3101-register-uat.arplatsaasuat.com