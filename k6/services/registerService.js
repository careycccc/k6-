/**
 * 账号注册服务
 * 提供多租户账号注册功能
 */

import { AdminLogin } from '../tests/api/login/adminlogin.test.js';
import { phoneRegister, emailRegister } from '../tests/api/login/register.test.js';
import { generateRandomPhone, generateRandomEmail } from '../tests/utils/accountGenerator.js';
import { getEnvByTenantId } from '../config/envconfig.js';
import { httpClient } from '../libs/http/client.js';

/**
 * 为指定租户注册账号
 * @param {string} tenantId - 租户ID (如 "3001", "3002", "3003", "3004")
 * @param {string} registerType - 注册类型 ("phone" 或 "email")
 * @param {number} count - 注册数量，默认1个
 * @param {string} password - 密码，默认 "qwer1234"
 * @returns {object[]} 账号信息列表
 */
export function registerAccountsForTenant(tenantId, registerType = 'phone', count = 1, password = 'qwer1234') {
    console.log(`========================================`);
    console.log(`[注册服务] 开始为租户 ${tenantId} 注册 ${count} 个${registerType === 'phone' ? '手机号' : '邮箱'}账号`);

    // 1. 获取租户环境配置
    const envConfig = getEnvByTenantId(tenantId);
    if (!envConfig) {
        throw new Error(`租户 ${tenantId} 的配置不存在`);
    }

    console.log(`[注册服务] 使用环境配置:`, {
        adminUrl: envConfig.BASE_ADMIN_URL,
        deskUrl: envConfig.BASE_DESK_URL,
        tenantId: envConfig.TENANTID
    });

    // 2. 临时切换环境配置（设置 httpClient 的 baseUrl）
    const originalAdminUrl = process.env.BASE_ADMIN_URL;
    const originalDeskUrl = process.env.BASE_DESK_URL;

    // 动态设置环境变量
    process.env.BASE_ADMIN_URL = envConfig.BASE_ADMIN_URL;
    process.env.BASE_DESK_URL = envConfig.BASE_DESK_URL;

    try {
        // 3. 后台登录获取 adminToken
        console.log(`[注册服务] 正在登录后台...`);

        // 临时修改 httpClient 的配置
        httpClient.adminBaseUrl = envConfig.BASE_ADMIN_URL;
        httpClient.deskBaseUrl = envConfig.BASE_DESK_URL;

        const adminToken = AdminLogin();
        if (!adminToken) {
            throw new Error(`租户 ${tenantId} 后台登录失败`);
        }

        console.log(`[注册服务] 后台登录成功，token: ${adminToken.substring(0, 20)}...`);

        const data = { token: adminToken };
        const accounts = [];

        // 4. 批量注册账号
        for (let i = 0; i < count; i++) {
            console.log(`[注册服务] 正在注册第 ${i + 1}/${count} 个账号...`);

            let userName, accountType;

            if (registerType === 'phone') {
                userName = generateRandomPhone();
                accountType = '手机号';
            } else {
                userName = generateRandomEmail();
                accountType = '邮箱';
            }

            console.log(`[注册服务] 生成的${accountType}: ${userName}`);

            // 执行注册
            let response;
            if (registerType === 'phone') {
                response = phoneRegister(userName, data, password);
            } else {
                response = emailRegister(userName, data, password);
            }

            if (response && response.token) {
                const accountInfo = {
                    username: userName,
                    password: password,
                    platform: tenantId,
                    token: response.token,
                    type: registerType,
                    createdAt: new Date().toISOString()
                };

                accounts.push(accountInfo);
                console.log(`[注册服务] ✅ 第 ${i + 1} 个账号注册成功: ${userName}`);
            } else {
                console.error(`[注册服务] ❌ 第 ${i + 1} 个账号注册失败: ${userName}`);
                console.error(`[注册服务] 响应:`, response);
            }
        }

        console.log(`[注册服务] 注册完成，成功: ${accounts.length}/${count}`);
        console.log(`========================================`);

        return accounts;

    } finally {
        // 5. 恢复原始环境配置
        if (originalAdminUrl) process.env.BASE_ADMIN_URL = originalAdminUrl;
        if (originalDeskUrl) process.env.BASE_DESK_URL = originalDeskUrl;
    }
}

/**
 * 注册单个手机号账号
 * @param {string} tenantId - 租户ID
 * @param {string} password - 密码
 * @returns {object} 账号信息
 */
export function registerPhoneAccount(tenantId, password = 'qwer1234') {
    const accounts = registerAccountsForTenant(tenantId, 'phone', 1, password);
    return accounts.length > 0 ? accounts[0] : null;
}

/**
 * 注册单个邮箱账号
 * @param {string} tenantId - 租户ID
 * @param {string} password - 密码
 * @returns {object} 账号信息
 */
export function registerEmailAccount(tenantId, password = 'qwer1234') {
    const accounts = registerAccountsForTenant(tenantId, 'email', 1, password);
    return accounts.length > 0 ? accounts[0] : null;
}
