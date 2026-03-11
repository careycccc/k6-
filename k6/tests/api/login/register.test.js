import { sendRequest } from '../common/request.js';
import { generateCryptoRandomString } from '../../utils/utils.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';

/**
 * 手机号注册 - 前台总代注册方式
 * 对应 Golang 的 NewGeneralAgentRegister
 * @param {string} userName - 手机号
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @returns {object} 返回响应包含的 token 或数据
 */
export function phoneRegister(userName, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 1, codeType = 1 (1是注册验证)
    const verifyCode = sendToGetVerCode(1, 1, userName, data.token);

    if (!verifyCode) {
        console.error('手机号注册失败：未能获取到验证码');
        return null;
    }

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: verifyCode,
        captchaId: captchaId,
        deviceId: "",
        browserId: browserId,
        packageName: ""
    };

    // 3. 发起前台注册请求
    const response = sendRequest(payload, api, 'PhoneRegister', true, '');
    return response;
}

/**
 * 手机号注册 - 邀请注册方式
 * @param {string} userName - 手机号
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @returns {object} 返回响应包含的 token 或数据
 */
export function phoneRegisterByInvite(userName, inviteCode, data, password = 'qwer1234', turnstileToken = '') {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 1, codeType = 19 (19是邀请注册验证)
    const verifyCode = sendToGetVerCode(1, 19, userName, data.token);

    if (!verifyCode) {
        console.error('邀请注册失败：未能获取到验证码');
        return null;
    }

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);

    const payload = {
        userName: userName,
        inviteCode: inviteCode,    // 邀请码（邀请注册必须提供）
        loginType: "Mobile",
        turnstileToken: turnstileToken,
        password: password,
        code: verifyCode,
        deviceId: "",
        browserId: browserId,
        packageName: ""
    };

    // 3. 发起前台注册请求
    const response = sendRequest(payload, api, 'PhoneRegisterByInvite', true, '');
    return response;
}

/**
 * 邮箱注册 - 前台总代注册方式
 * 对应 Golang 的 EmailRegisterApi
 * @param {string} email - 邮箱地址
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @returns {object} 返回响应包含的 token 或数据
 */
export function emailRegister(email, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 2, codeType = 2 (2是邮箱验证)
    const verifyCode = sendToGetVerCode(2, 2, email, data.token);

    if (!verifyCode) {
        console.error('邮箱注册失败：未能获取到验证码');
        return null;
    }

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);

    const payload = {
        loginType: "Email",        // 登录类型
        userName: email,           // 电子邮箱地址
        password: password,        // 密码
        inviteCode: inviteCode,    // 邀请码（前台总代注册时为空）
        code: verifyCode,          // 验证码
        captchaId: captchaId,      // 验证码ID
        deviceId: "",
        browserId: browserId,
        packageName: ""
    };

    // 3. 发起前台注册请求
    const response = sendRequest(payload, api, 'EmailRegister', true, '');
    return response;
}

/**
 * 邮箱注册 - 邀请注册方式
 * @param {string} email - 邮箱地址
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @returns {object} 返回响应包含的 token 或数据
 */
export function emailRegisterByInvite(email, inviteCode, data, password = 'qwer1234', turnstileToken = '') {
    // 1. 发送并获取验证码
    // 参数对照：VerifyCodeType = 2, codeType = 20 (20是邮箱邀请注册验证)
    const verifyCode = sendToGetVerCode(2, 20, email, data.token);

    if (!verifyCode) {
        console.error('邮箱邀请注册失败：未能获取到验证码');
        return null;
    }

    // 2. 组装注册请求负载
    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);

    const payload = {
        userName: email,
        inviteCode: inviteCode,    // 邀请码（邀请注册必须提供）
        loginType: "Email",
        turnstileToken: turnstileToken,
        password: password,
        code: verifyCode,
        deviceId: "",
        browserId: browserId,
        packageName: ""
    };

    // 3. 发起前台注册请求
    const response = sendRequest(payload, api, 'EmailRegisterByInvite', true, '');
    return response;
}