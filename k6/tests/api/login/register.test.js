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
    console.log(`[PhoneRegister] ========== 开始手机号注册流程 ==========`);
    console.log(`[PhoneRegister] 用户名: ${userName}`);
    console.log(`[PhoneRegister] 密码: ${password}`);
    console.log(`[PhoneRegister] 邀请码: ${inviteCode || '(空)'}`);
    console.log(`[PhoneRegister] 环境配置: ${JSON.stringify(data.envConfig)}`);

    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 1, codeType = 1 (1是手机前台注册验证)
    console.log(`[PhoneRegister] 准备发送验证码: verifyCodeType=1, codeType=1`);
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

    console.log(`[PhoneRegister] 注册 payload:`, JSON.stringify(payload, null, 2));
    console.log(`[PhoneRegister] 请求API: ${api}`);
    console.log(`[PhoneRegister] 请求URL: ${data.envConfig.BASE_DESK_URL}${api}`);

    // 3. 直接使用 httpClient 发起请求，获取完整响应（包含 headers）
    const httpResponse = httpClient.post(api, payload, {}, true);

    console.log(`[PhoneRegister] ========== 注册响应 ==========`);
    console.log(`[PhoneRegister] 响应状态码: ${httpResponse.status}`);
    console.log(`[PhoneRegister] 响应体: ${httpResponse.body}`);
    console.log(`[PhoneRegister] 响应Headers: ${JSON.stringify(httpResponse.headers)}`);

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

    console.log(`[PhoneRegister] 解析后的响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
        console.error(`[PhoneRegister] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
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
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 *   - frontUrl: 前台域名（用于发送验证码）
 *   - adminUrl: 后台域名（用于查询验证码）
 *   - registerUrl: 注册域名（用于注册请求）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function phoneRegisterByInvite(userName, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    console.log(`[PhoneRegisterByInvite] ========== 开始手机号邀请注册流程 ==========`);
    console.log(`[PhoneRegisterByInvite] 用户名: ${userName}`);
    console.log(`[PhoneRegisterByInvite] 邀请码: ${inviteCode}`);
    console.log(`[PhoneRegisterByInvite] 密码: ${password}`);

    // 1. 发送并获取验证码
    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    console.log(`[PhoneRegisterByInvite] 准备发送验证码: verifyCodeType=1, codeType=19`);
    const verifyCode = sendToGetVerCode(1, 19, userName, data.token, customFrontUrl, customAdminUrl);

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

    console.log(`[PhoneRegisterByInvite] 注册 payload:`, JSON.stringify(payload, null, 2));

    // 3. 发送请求
    let httpResponse;
    if (customRegisterUrl) {
        // 使用自定义注册URL（多租户）
        const fullUrl = customRegisterUrl + api;
        console.log(`[PhoneRegisterByInvite] 使用自定义注册API: ${fullUrl}`);
        console.log(`[PhoneRegisterByInvite] 完整请求URL: ${fullUrl}`);
        console.log(`[PhoneRegisterByInvite] 完整请求Payload: ${JSON.stringify(payload)}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        // 使用默认URL
        console.log(`[PhoneRegisterByInvite] 使用默认注册API: ${api}`);
        console.log(`[PhoneRegisterByInvite] 完整请求URL: ${api}`);
        console.log(`[PhoneRegisterByInvite] 完整请求Payload: ${JSON.stringify(payload)}`);
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    // 4. 打印响应结果
    console.log(`[PhoneRegisterByInvite] ========== 注册响应 ==========`);
    console.log(`[PhoneRegisterByInvite] 响应状态码: ${httpResponse.status}`);
    console.log(`[PhoneRegisterByInvite] 响应体: ${httpResponse.body}`);
    console.log(`[PhoneRegisterByInvite] 响应Headers: ${JSON.stringify(httpResponse.headers)}`);

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

    console.log(`[PhoneRegisterByInvite] 解析后的响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
        console.error(`[PhoneRegisterByInvite] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
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
    console.log(`[EmailRegister] ========== 开始邮箱注册流程 ==========`);
    console.log(`[EmailRegister] 邮箱: ${email}`);
    console.log(`[EmailRegister] 密码: ${password}`);
    console.log(`[EmailRegister] 邀请码: ${inviteCode || '(空)'}`);

    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 2, codeType = 2 (2是邮箱前台注册验证)
    console.log(`[EmailRegister] 准备发送验证码: verifyCodeType=2, codeType=2`);
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

    console.log(`[EmailRegister] 注册 payload:`, JSON.stringify(payload, null, 2));
    console.log(`[EmailRegister] 请求API: ${api}`);
    console.log(`[EmailRegister] 请求URL: ${data.envConfig.BASE_DESK_URL}${api}`);

    // 3. 直接使用 httpClient 发起请求，获取完整响应（包含 headers）
    const httpResponse = httpClient.post(api, payload, {}, true);

    console.log(`[EmailRegister] ========== 注册响应 ==========`);
    console.log(`[EmailRegister] 响应状态码: ${httpResponse.status}`);
    console.log(`[EmailRegister] 响应体: ${httpResponse.body}`);
    console.log(`[EmailRegister] 响应Headers: ${JSON.stringify(httpResponse.headers)}`);

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

    console.log(`[EmailRegister] 解析后的响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
        console.error(`[EmailRegister] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
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
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function emailRegisterByInvite(email, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    console.log(`[EmailRegisterByInvite] ========== 开始邮箱邀请注册流程 ==========`);
    console.log(`[EmailRegisterByInvite] 邮箱: ${email}`);
    console.log(`[EmailRegisterByInvite] 邀请码: ${inviteCode}`);
    console.log(`[EmailRegisterByInvite] 密码: ${password}`);

    // 1. 发送并获取验证码
    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    console.log(`[EmailRegisterByInvite] 准备发送验证码: verifyCodeType=2, codeType=19`);
    const verifyCode = sendToGetVerCode(2, 19, email, data.token, customFrontUrl, customAdminUrl);

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

    console.log(`[EmailRegisterByInvite] 注册 payload:`, JSON.stringify(payload, null, 2));

    // 3. 发送请求
    let httpResponse;
    if (customRegisterUrl) {
        // 使用自定义注册URL（多租户）
        const fullUrl = customRegisterUrl + api;
        console.log(`[EmailRegisterByInvite] 使用自定义注册API: ${fullUrl}`);
        console.log(`[EmailRegisterByInvite] 完整请求URL: ${fullUrl}`);
        console.log(`[EmailRegisterByInvite] 完整请求Payload: ${JSON.stringify(payload)}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        // 使用默认URL
        console.log(`[EmailRegisterByInvite] 使用默认注册API: ${api}`);
        console.log(`[EmailRegisterByInvite] 完整请求URL: ${api}`);
        console.log(`[EmailRegisterByInvite] 完整请求Payload: ${JSON.stringify(payload)}`);
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    // 4. 打印响应结果
    console.log(`[EmailRegisterByInvite] ========== 注册响应 ==========`);
    console.log(`[EmailRegisterByInvite] 响应状态码: ${httpResponse.status}`);
    console.log(`[EmailRegisterByInvite] 响应体: ${httpResponse.body}`);
    console.log(`[EmailRegisterByInvite] 响应Headers: ${JSON.stringify(httpResponse.headers)}`);

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

    console.log(`[EmailRegisterByInvite] 解析后的响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
        console.error(`[EmailRegisterByInvite] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
        return null;
    }
}
