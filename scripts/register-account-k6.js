/**
 * K6 账号注册脚本
 * 使用 K6 运行时执行
 * 
 * 用法：
 *   k6 run -e TENANT=3002 -e TYPE=phone -e COUNT=1 scripts/register-account-k6.js
 * 
 * 环境变量说明：
 *   TENANT: 租户ID (如 3001, 3002, 3003, 3004)
 *   TYPE: 账号类型 (phone 或 email)
 *   COUNT: 注册数量
 */

import { phoneRegister, emailRegister } from '../k6/tests/api/login/register.test.js';
import { AdminLogin } from '../k6/tests/api/login/adminlogin.test.js';
import { generateRandomPhone, generateRandomEmail } from '../k6/tests/utils/accountGenerator.js';
import { getEnvByTenantId } from '../k6/config/envconfig.js';

// 从环境变量获取参数
const TENANT = __ENV.TENANT || '3004';
const TYPE = __ENV.TYPE || 'phone';
const COUNT = parseInt(__ENV.COUNT || '1', 10);

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {},
};

export function setup() {
    console.log(`========================================`);
    console.log(`[K6注册] ========== SETUP开始 ==========`);
    console.log(`[K6注册] 租户: ${TENANT}, 类型: ${TYPE}, 数量: ${COUNT}`);
    console.log(`[K6注册] 环境变量 __ENV.TENANT: ${__ENV.TENANT}`);
    console.log(`[K6注册] 环境变量 __ENV.TENANT_ID: ${__ENV.TENANT_ID}`);
    console.log(`[K6注册] 环境变量 __ENV.LANGUAGE: ${__ENV.LANGUAGE || '(未设置，将使用默认值)'}`);

    // 获取租户配置
    const envConfig = getEnvByTenantId(TENANT);
    if (!envConfig) {
        throw new Error(`租户 ${TENANT} 的配置不存在`);
    }

    console.log(`[K6注册] ========== 租户配置 ==========`);
    console.log(`[K6注册] 后台地址: ${envConfig.BASE_ADMIN_URL}`);
    console.log(`[K6注册] 前台地址: ${envConfig.BASE_DESK_URL}`);
    console.log(`[K6注册] 管理员账号: ${envConfig.ADMIN_USERNAME}`);
    console.log(`[K6注册] 国家代码: ${envConfig.COUNTRY_CODE}`);
    console.log(`[K6注册] 完整配置: ${JSON.stringify(envConfig, null, 2)}`);

    // 后台登录
    console.log(`[K6注册] ========== 后台登录 ==========`);
    console.log(`[K6注册] 正在登录后台...`);
    const adminToken = AdminLogin();

    if (!adminToken) {
        throw new Error(`租户 ${TENANT} 后台登录失败`);
    }

    console.log(`[K6注册] 后台登录成功`);
    console.log(`[K6注册] AdminToken: ${adminToken.substring(0, 20)}...`);

    console.log(`[K6注册] ========== SETUP完成 ==========`);

    return { token: adminToken, envConfig: envConfig };
}

export default function (data) {
    const accounts = [];
    const errors = [];

    for (let i = 0; i < COUNT; i++) {
        console.log(`[K6注册] 正在注册第 ${i + 1}/${COUNT} 个账号...`);

        let userName;
        if (TYPE === 'phone') {
            // 使用租户配置中的国家代码
            const countryCode = data.envConfig.COUNTRY_CODE || '91';
            console.log(`[K6注册] 使用国家代码: ${countryCode}`);
            userName = generateRandomPhone(countryCode);
        } else {
            userName = generateRandomEmail();
        }

        console.log(`[K6注册] 生成的账号: ${userName}`);

        try {
            let response;
            if (TYPE === 'phone') {
                // 使用 phoneRegister - 前台总代注册方式
                response = phoneRegister(userName, data);
            } else {
                // 使用 emailRegister - 前台总代注册方式
                response = emailRegister(userName, data);
            }
            // 从响应中提取 token
            let token = null;
            if (response) {
                if (response.headers && response.headers.Authorization) {
                    token = response.headers.Authorization.replace('Bearer ', '').trim();
                } else if (response.data && response.data.token) {
                    token = response.data.token;
                }
            }

            if (token) {
                const accountInfo = {
                    username: userName,
                    password: 'qwer1234',
                    platform: TENANT,
                    token: token,
                    type: TYPE,
                    amount: data.envConfig.BASE_DESK_URL
                };

                accounts.push(accountInfo);
                const tokenDisplay = token.length > 20 ? token.substring(0, 20) + '...' : token;
                console.log(`[K6注册] ✅ 第 ${i + 1} 个账号注册成功，token: ${tokenDisplay}`);
            } else {
                const errorDetail = {
                    index: i + 1,
                    username: userName,
                    reason: '响应中没有 token',
                    response: response ? JSON.stringify(response) : 'null',
                    errorMessage: 'verification method is not enabled' // 添加后端错误信息
                };
                errors.push(errorDetail);
                console.error(`[K6注册] ❌ 第 ${i + 1} 个账号注册失败: 响应中没有 token`);
            }
        } catch (error) {
            const errorDetail = {
                index: i + 1,
                username: userName,
                reason: error.message || '未知错误',
                stack: error.stack || '',
                errorMessage: error.message || ''
            };
            errors.push(errorDetail);
            console.error(`[K6注册] ❌ 第 ${i + 1} 个账号注册异常:`, error.message);
        }
    }

    // 输出结果（JSON 格式）
    console.log('__RESULT_START__');
    console.log(JSON.stringify({
        success: true,
        count: accounts.length,
        accounts: accounts,
        errors: errors,
        tenant: TENANT,
        type: TYPE
    }, null, 2));
    console.log('__RESULT_END__');

    console.log(`[K6注册] 注册完成，成功: ${accounts.length}/${COUNT}, 失败: ${errors.length}`);
    console.log(`========================================`);
}
