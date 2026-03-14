import { sendRequest } from '../common/request.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';

/**
 * 手机号注册 - 前台总代注册方式
 * 对应 Golang 的 NewGeneralAgentRegister
 * @param {string} userName - 手机号
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function phoneRegister(userName, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 1, codeType = 1 (1是注册验证)
    const verifyCode = sendToGetVerCode(1, 1, userName, data.token);

    if (!verifyCode) {
        console.error('[PhoneRegister] 手机号注册失败：未能获取到验证码');
        return null;
    }

    // 确保验证码是字符串类型
    const codeStr = String(verifyCode).trim();
    console.log(`[PhoneRegister] 准备注册: ${userName}`);
    console.log(`[PhoneRegister] 验证码: "${codeStr}" (长度: ${codeStr.length})`);

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const timeData = getTimeRandom();

    const payload = {
        userName: userName,
        inviteCode: inviteCode,
        loginType: "Mobile",
        turnstileToken: "",
        password: password,
        code: codeStr,
        captchaId: captchaId,
        language: timeData.language,
        random: timeData.random,
        timestamp: timeData.timestamp
    };

    console.log(`[PhoneRegister] 注册 payload:`, JSON.stringify(payload));

    // 3. 直接使用 httpClient 发起请求，获取完整响应（包含 headers）
    const httpResponse = httpClient.post(api, payload, {}, true);

    if (!httpResponse) {
        console.error(`[PhoneRegister] ❌ 注册失败：响应为空`);
        return null;
    }

    // 解析响应体
    let parsedBody = null;
    if (httpResponse.body) {
        try {
            parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
        } catch (e) {
            console.error(`[PhoneRegister] ❌ 响应体解析失败: ${e.message}`);
            return null;
        }
    }

    // 检查注册结果
    const statusCode = parsedBody ? (parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode) : null;

    if (statusCode === 0) {
        console.log(`[PhoneRegister] ✅ 注册成功: ${userName}`);

        // 返回包含 headers 和 data 的对象
        return {
            headers: httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        console.error(`[PhoneRegister] ❌ 注册失败: ${userName}`);
        console.error(`[PhoneRegister] 错误详情: code=${statusCode}, msg=${parsedBody ? parsedBody.msg : 'N/A'}`);
        console.error(`[PhoneRegister] 使用的验证码: ${codeStr}`);
        return null;
    }
}

/**
 * 手机号注册 - 邀请注册方式
 * @param {string} userName - 手机号
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {string} customApiUrl - 自定义API完整URL（可选，用于多租户）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
/**
 * 手机号注册 - 邀请注册方式
 * @param {string} userName - 手机号
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 *   - frontUrl: 前台域名（用于发送验证码）
 *   - adminUrl: 后台域名（用于查询验证码）
 *   - registerUrl: 注册域名（用于注册请求）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function phoneRegisterByInvite(userName, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    // 1. 发送并获取验证码
    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    const verifyCode = sendToGetVerCode(1, 1, userName, data.token, customFrontUrl, customAdminUrl);

    if (!verifyCode) {
        console.error('[PhoneRegisterByInvite] 邀请注册失败：未能获取到验证码');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    console.log(`[PhoneRegisterByInvite] 准备注册: ${userName}`);
    console.log(`[PhoneRegisterByInvite] 验证码: "${codeStr}"`);
    console.log(`[PhoneRegisterByInvite] 邀请码: ${inviteCode}`);

    // 2. 组装payload
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: null,
        deviceId: "",
        browserId: browserId,
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    console.log(`[PhoneRegisterByInvite] 注册 payload:`, JSON.stringify(payload));

    // 3. 发送请求
    let httpResponse;
    if (customRegisterUrl) {
        // 使用自定义注册URL（多租户）
        const fullUrl = customRegisterUrl + api;
        console.log(`[PhoneRegisterByInvite] 使用自定义注册API: ${fullUrl}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        // 使用默认URL
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    if (!httpResponse || !httpResponse.body) {
        console.error(`[PhoneRegisterByInvite] ❌ 注册失败：响应为空`);
        return null;
    }

    // 4. 解析响应
    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        console.error(`[PhoneRegisterByInvite] ❌ 响应解析失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody ? (parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode) : null;

    if (statusCode === 0) {
        console.log(`[PhoneRegisterByInvite] ✅ 注册成功: ${userName}`);
        const token = parsedBody.data && parsedBody.data.token ? parsedBody.data.token : null;
        return {
            headers: token ? { 'Authorization': `Bearer ${token}` } : httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        console.error(`[PhoneRegisterByInvite] ❌ 注册失败: ${userName}`);
        console.error(`[PhoneRegisterByInvite] 错误: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}

/**
 * 邮箱注册 - 前台总代注册方式
 * 对应 Golang 的 EmailRegisterApi
 * @param {string} email - 邮箱地址
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function emailRegister(email, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 2, codeType = 2 (2是邮箱验证)
    const verifyCode = sendToGetVerCode(2, 2, email, data.token);

    if (!verifyCode) {
        console.error('[EmailRegister] 邮箱注册失败：未能获取到验证码');
        return null;
    }

    // 确保验证码是字符串类型
    const codeStr = String(verifyCode).trim();
    console.log(`[EmailRegister] 准备注册: ${email}`);
    console.log(`[EmailRegister] 验证码: "${codeStr}" (长度: ${codeStr.length})`);

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const timeData = getTimeRandom();

    const payload = {
        userName: email,
        inviteCode: inviteCode,
        loginType: "Email",
        turnstileToken: "",
        password: password,
        code: codeStr,
        captchaId: null,
        language: timeData.language,
        random: timeData.random,
        timestamp: timeData.timestamp
    };

    console.log(`[EmailRegister] 注册 payload:`, JSON.stringify(payload));

    // 3. 直接使用 httpClient 发起请求，获取完整响应（包含 headers）
    const httpResponse = httpClient.post(api, payload, {}, true);

    if (!httpResponse) {
        console.error(`[EmailRegister] ❌ 注册失败：响应为空`);
        return null;
    }

    // 解析响应体
    let parsedBody = null;
    if (httpResponse.body) {
        try {
            parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
        } catch (e) {
            console.error(`[EmailRegister] ❌ 响应体解析失败: ${e.message}`);
            return null;
        }
    }

    // 检查注册结果
    const statusCode = parsedBody ? (parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode) : null;

    if (statusCode === 0) {
        console.log(`[EmailRegister] ✅ 注册成功: ${email}`);

        // 返回包含 headers 和 data 的对象
        return {
            headers: httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        console.error(`[EmailRegister] ❌ 注册失败: ${email}`);
        console.error(`[EmailRegister] 错误详情: code=${statusCode}, msg=${parsedBody ? parsedBody.msg : 'N/A'}`);
        console.error(`[EmailRegister] 使用的验证码: ${codeStr}`);
        return null;
    }
}

/**
 * 邮箱注册 - 邀请注册方式
 * @param {string} email - 邮箱地址
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {string} customApiUrl - 自定义API完整URL（可选，用于多租户）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
/**
 * 邮箱注册 - 邀请注册方式
 * @param {string} email - 邮箱地址
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function emailRegisterByInvite(email, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    // 1. 发送并获取验证码
    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    const verifyCode = sendToGetVerCode(2, 2, email, data.token, customFrontUrl, customAdminUrl);

    if (!verifyCode) {
        console.error('[EmailRegisterByInvite] 邮箱邀请注册失败：未能获取到验证码');
        return null;
    }

    // 确保验证码是字符串类型
    const codeStr = String(verifyCode).trim();
    console.log(`[EmailRegisterByInvite] 准备注册: ${email}`);
    console.log(`[EmailRegisterByInvite] 验证码: "${codeStr}" (长度: ${codeStr.length})`);
    console.log(`[EmailRegisterByInvite] 邀请码: ${inviteCode}`);

    // 2. 组装注册请求负载（匹配成功的payload结构）
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        loginType: "Email",
        userName: email,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: null,
        deviceId: "",
        browserId: browserId,
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    console.log(`[EmailRegisterByInvite] 注册 payload:`, JSON.stringify(payload));

    // 3. 发送请求
    let httpResponse;
    if (customRegisterUrl) {
        // 使用自定义注册URL（多租户）
        const fullUrl = customRegisterUrl + api;
        console.log(`[EmailRegisterByInvite] 使用自定义注册API: ${fullUrl}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        // 使用默认URL
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    if (!httpResponse || !httpResponse.body) {
        console.error(`[EmailRegisterByInvite] ❌ 注册失败：响应为空`);
        return null;
    }

    // 4. 解析响应
    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        console.error(`[EmailRegisterByInvite] ❌ 响应解析失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody ? (parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode) : null;

    if (statusCode === 0) {
        console.log(`[EmailRegisterByInvite] ✅ 注册成功: ${email}`);
        const token = parsedBody.data && parsedBody.data.token ? parsedBody.data.token : null;
        return {
            headers: token ? { 'Authorization': `Bearer ${token}` } : httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        console.error(`[EmailRegisterByInvite] ❌ 注册失败: ${email}`);
        console.error(`[EmailRegisterByInvite] 错误: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}
