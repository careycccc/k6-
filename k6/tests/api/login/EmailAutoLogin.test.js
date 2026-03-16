import { generateCryptoRandomString } from '../../utils/utils.js';
import { sendRequest } from '../../api/common/request.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';

const tag = 'EmailAutoLogin';

/**
 * 邮箱自动登录 - 发送验证码
 * @param {string} email - 邮箱地址
 * @param {object} data - 包含 adminToken 的数据对象
 * @returns {string} 验证码
 */
export function sendEmailAutoLoginVerifyCode(email, data) {
    console.log('[EmailAutoLogin] 发送自动登录验证码，邮箱:', email);

    // verifyCodeType=2 表示邮箱，codeType=18 表示登录验证码
    const verifyCode = sendToGetVerCode(2, 18, email, data.token);

    if (!verifyCode) {
        console.error('[EmailAutoLogin] 获取自动登录验证码失败');
        return null;
    }

    console.log('[EmailAutoLogin] 自动登录验证码获取成功:', verifyCode);
    return verifyCode;
}

/**
 * 邮箱自动登录
 * @param {string} userName - 邮箱地址
 * @param {string} verifyCode - 验证码
 * @returns {string} token
 */
export function EmailAutoLogin(userName, verifyCode) {
    console.log('[EmailAutoLogin] 开始邮箱自动登录，用户:', userName);

    const api = '/api/Home/EmailAutoLogin';
    const registerFingerprint = generateCryptoRandomString(32);

    const payload = {
        userName: userName,
        verifyCode: verifyCode,
        registerDevice: "",
        registerFingerprint: registerFingerprint,
        inviteCode: "",
        packageName: ""
    };

    const token = sendRequest(payload, api, tag, true);

    if (token) {
        console.log('[EmailAutoLogin] 自动登录成功');
    } else {
        console.error('[EmailAutoLogin] 自动登录失败');
    }

    return token;
}

/**
 * 完整的邮箱自动登录流程
 * @param {string} email - 邮箱地址
 * @param {object} data - 包含 adminToken 的数据对象
 * @returns {string} 登录成功后的 token
 */
export function emailAutoLoginFlow(email, data) {
    console.log('[EmailAutoLogin] 开始完整的邮箱自动登录流程');

    // 1. 发送并获取验证码
    const verifyCode = sendEmailAutoLoginVerifyCode(email, data);
    if (!verifyCode) {
        console.error('[EmailAutoLogin] 验证码获取失败，无法继续登录');
        return null;
    }

    // 2. 使用验证码登录
    const token = EmailAutoLogin(email, verifyCode);

    if (token) {
        console.log('[EmailAutoLogin] 完整登录流程成功');
    } else {
        console.error('[EmailAutoLogin] 完整登录流程失败');
    }

    return token;
}
