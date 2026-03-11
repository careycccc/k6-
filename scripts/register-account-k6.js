/**
 * K6 账号注册脚本
 * 使用 K6 运行时执行
 * 
 * 用法：
 *   k6 run -e TENANT=3002 -e TYPE=phone -e COUNT=1 scripts/register-account-k6.js
 */

import { phoneRegister, emailRegister } from '../k6/tests/api/login/register.test.js';
import { generateRandomPhone, generateRandomEmail } from '../k6/tests/utils/accountGenerator.js';
import { getEnvByTenantId } from '../k6/config/envconfig.js';
import { getTimeRandom, generateCryptoRandomString } from '../k6/tests/utils/utils.js';
import { SignedHttpClient } from '../k6/libs/utils/signature.js';
import http from 'k6/http';
import { sleep } from 'k6';

// 从环境变量获取参数
const TENANT = __ENV.TENANT || '3004';
const TYPE = __ENV.TYPE || 'phone';
const COUNT = parseInt(__ENV.COUNT || '1', 10);

// 使用指定配置进行手机号注册
function phoneRegisterWithConfig(userName, envConfig, adminToken) {
    // 1. 发送验证码
    const verifyCode = sendVerifyCodeWithConfig(1, 1, userName, envConfig, adminToken);
    if (!verifyCode) {
        console.error('[K6注册] 获取验证码失败');
        return null;
    }

    // 2. 注册
    const api = '/api/Home/Register';
    const fullUrl = envConfig.BASE_DESK_URL + api;

    const timeData = getTimeRandom();
    const browserId = generateCryptoRandomString(32);

    const requestData = {
        loginType: "Mobile",
        userName: userName,
        password: "qwer1234",
        inviteCode: "",
        code: verifyCode,
        captchaId: null,
        deviceId: "",
        browserId: browserId,
        packageName: "",
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    const response = http.post(fullUrl, JSON.stringify(signedData), {
        headers: {
            'Content-Type': 'application/json',
            'Domainurl': envConfig.BASE_DESK_URL,
            'Referrer': envConfig.BASE_DESK_URL
        }
    });

    console.log(`[K6注册] 注册响应状态: ${response.status}`);
    console.log(`[K6注册] 注册响应体: ${response.body}`);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            console.log(`[K6注册] 解析后的响应: ${JSON.stringify(result)}`);
            if (result.msgCode === 0 && result.data && result.data.token) {
                return result.data.token;
            } else {
                console.error(`[K6注册] 注册失败: msgCode=${result.msgCode}, msg=${result.msg || '未知错误'}`);
                return null;
            }
        } catch (e) {
            console.error(`[K6注册] 解析注册响应失败: ${e.message}`);
            return null;
        }
    } else {
        console.error(`[K6注册] 注册请求失败: ${response.status} ${response.body}`);
        return null;
    }
}

// 使用指定配置查询验证码
function getVerificationCodeWithConfig(userName, envConfig, adminToken) {
    const api = '/api/Users/GetVerifyCodePageList';
    const fullUrl = envConfig.BASE_ADMIN_URL + api;

    const timeData = getTimeRandom();
    const requestData = {
        pageNo: 1,
        pageSize: 200,
        orderBy: 'Desc',
        mobileOrEmail: userName,
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp
    };

    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    const response = http.post(fullUrl, JSON.stringify(signedData), {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`,
            'Domainurl': envConfig.BASE_ADMIN_URL,
            'Referrer': envConfig.BASE_ADMIN_URL
        }
    });

    if (response.status >= 200 && response.status < 300 && response.body) {
        try {
            const body = JSON.parse(response.body);
            if (body.data && body.data.list && body.data.list.length > 0) {
                return body.data.list[0].number;
            }
            console.error(`[K6注册] 查询验证码为空，响应: ${response.body}`);
        } catch (e) {
            console.error(`[K6注册] 查询验证码解析失败: ${e.message}`);
        }
    } else {
        console.error(`[K6注册] 查询验证码失败: ${response.status} ${response.body}`);
    }
    return null;
}

// 使用指定配置发送验证码
function sendVerifyCodeWithConfig(verifyCodeType, codeType, userName, envConfig, adminToken) {
    const api = '/api/Home/SendVerifiyCode';
    const fullUrl = envConfig.BASE_DESK_URL + api;

    const timeData = getTimeRandom();
    const requestData = {
        verifyCodeType: verifyCodeType,
        codeType: codeType,
        phoneOrEmail: userName,
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    const response = http.post(fullUrl, JSON.stringify(signedData), {
        headers: {
            'Content-Type': 'application/json',
            'Domainurl': envConfig.BASE_DESK_URL,
            'Referrer': envConfig.BASE_DESK_URL
        }
    });

    if (response.status === 200) {
        // 验证码接口返回空响应体是正常的
        console.log(`[K6注册] 验证码发送成功`);

        sleep(2);

        const code = getVerificationCodeWithConfig(userName, envConfig, adminToken);
        if (code) {
            console.log(`[K6注册] 成功获取验证码: ${code}`);
            return code;
        }
        return null;
    } else {
        console.error(`[K6注册] 发送验证码失败: ${response.status} ${response.body}`);
        return null;
    }
}
function AdminLoginWithConfig(envConfig) {
    const api = '/api/Login/Login';
    const data = {
        userName: envConfig.ADMIN_USERNAME,
        pwd: envConfig.ADMIN_PASSWORD
    };

    // 构建完整的 URL
    const fullUrl = envConfig.BASE_ADMIN_URL + api;

    // 构建请求数据
    const timeData = getTimeRandom();
    const requestData = {
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp,
        ...data
    };

    // 使用签名工具生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    // 直接使用 http 模块发送请求
    const response = http.post(fullUrl, JSON.stringify(signedData), {
        headers: {
            'Content-Type': 'application/json',
            'Domainurl': envConfig.BASE_ADMIN_URL,
            'Referrer': envConfig.BASE_ADMIN_URL
        }
    });

    console.log(`[K6注册] 登录响应状态: ${response.status}`);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            if (result.msgCode === 0 && result.data && result.data.token) {
                const token = result.data.token;
                // 安全地处理 token 显示
                const tokenDisplay = token && typeof token === 'string' && token.length > 20
                    ? token.substring(0, 20) + '...'
                    : token;
                console.log(`[K6注册] 后台登录成功，token: ${tokenDisplay}`);
                return token;
            } else {
                console.error(`[K6注册] 登录失败: msgCode=${result.msgCode}, msg=${result.msg || '未知错误'}`);
                return null;
            }
        } catch (e) {
            console.error(`[K6注册] 解析登录响应失败: ${e.message}`);
            return null;
        }
    } else {
        console.error(`[K6注册] 登录请求失败: 状态码=${response.status}`);
        if (response.body) {
            console.error(`[K6注册] 响应内容: ${response.body}`);
        } else {
            console.error(`[K6注册] 响应体为空`);
        }
        return null;
    }
}

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {},
};

export function setup() {
    console.log(`========================================`);
    console.log(`[K6注册] 租户: ${TENANT}, 类型: ${TYPE}, 数量: ${COUNT}`);

    // 获取租户配置
    const envConfig = getEnvByTenantId(TENANT);
    if (!envConfig) {
        throw new Error(`租户 ${TENANT} 的配置不存在`);
    }

    console.log(`[K6注册] 后台地址: ${envConfig.BASE_ADMIN_URL}`);
    console.log(`[K6注册] 前台地址: ${envConfig.BASE_DESK_URL}`);

    // 后台登录
    console.log(`[K6注册] 正在登录后台...`);
    const adminToken = AdminLoginWithConfig(envConfig);

    if (!adminToken) {
        // 抛出更具体的错误信息
        throw new Error(`租户 ${TENANT} 后台登录失败`);
    }

    console.log(`[K6注册] 后台登录成功`);

    return { token: adminToken, envConfig: envConfig };
}

export default function (data) {
    const accounts = [];
    const errors = [];  // 收集详细错误信息

    for (let i = 0; i < COUNT; i++) {
        console.log(`[K6注册] 正在注册第 ${i + 1}/${COUNT} 个账号...`);

        let userName;
        if (TYPE === 'phone') {
            userName = generateRandomPhone();
        } else {
            userName = generateRandomEmail();
        }

        console.log(`[K6注册] 生成的账号: ${userName}`);

        // 执行注册
        let response;
        try {
            if (TYPE === 'phone') {
                response = phoneRegisterWithConfig(userName, data.envConfig, data.token);
            } else {
                // TODO: 添加邮箱注册函数
                response = emailRegister(userName, data);
            }

            console.log(`[K6注册] 注册响应类型:`, typeof response);
            console.log(`[K6注册] 注册响应:`, JSON.stringify(response));

            // 检查响应是否包含 token
            let token = null;
            if (response) {
                if (typeof response === 'string') {
                    // 如果响应是字符串，可能就是 token
                    token = response;
                } else if (response.token) {
                    token = response.token;
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
                    amount: data.envConfig.BASE_DESK_URL  // 使用 amount 字段传递前台地址
                };

                accounts.push(accountInfo);
                // 安全地处理 token 显示
                const tokenDisplay = token && typeof token === 'string' && token.length > 20
                    ? token.substring(0, 20) + '...'
                    : token;
                console.log(`[K6注册] ✅ 第 ${i + 1} 个账号注册成功，token: ${tokenDisplay}`);
            } else {
                const errorDetail = {
                    index: i + 1,
                    username: userName,
                    reason: '响应中没有 token',
                    response: response ? JSON.stringify(response) : 'null'
                };
                errors.push(errorDetail);
                console.error(`[K6注册] ❌ 第 ${i + 1} 个账号注册失败: 响应中没有 token`);
                console.error(`[K6注册] 完整响应:`, JSON.stringify(response));
            }
        } catch (error) {
            const errorDetail = {
                index: i + 1,
                username: userName,
                reason: error.message || '未知错误',
                stack: error.stack || ''
            };
            errors.push(errorDetail);
            console.error(`[K6注册] ❌ 第 ${i + 1} 个账号注册异常:`, error.message);
            console.error(`[K6注册] 错误堆栈:`, error.stack);
        }
    }

    // 输出结果（JSON 格式）
    console.log('__RESULT_START__');
    console.log(JSON.stringify({
        success: true,
        count: accounts.length,
        accounts: accounts,
        errors: errors,  // 包含详细错误信息
        tenant: TENANT,
        type: TYPE
    }, null, 2));
    console.log('__RESULT_END__');

    console.log(`[K6注册] 注册完成，成功: ${accounts.length}/${COUNT}, 失败: ${errors.length}`);
    console.log(`========================================`);
}