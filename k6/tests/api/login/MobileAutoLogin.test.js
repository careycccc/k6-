import { generateCryptoRandomString } from '../../utils/utils.js';
import { sendRequest } from '../../api/common/request.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';

const tag = 'MobileAutoLogin';

/**
 * 手机号自动登录 - 发送验证码
 * @param {string} phoneNumber - 手机号
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @returns {string} 验证码
 */
export function sendMobileAutoLoginVerifyCode(phoneNumber, data) {
    console.log('[MobileAutoLogin] 发送自动登录验证码，手机号:', phoneNumber);

    // 使用 codeType=18 发送自动登录验证码
    // verifyCodeType=1 表示手机号，codeType=18 表示自动登录验证码
    const verifyCode = sendToGetVerCode(1, 18, phoneNumber, data.token);

    if (!verifyCode) {
        console.error('[MobileAutoLogin] 获取自动登录验证码失败');
        return null;
    }

    console.log('[MobileAutoLogin] 自动登录验证码获取成功:', verifyCode);
    return verifyCode;
}

/**
 * 手机号自动登录
 * @param {string} userName - 手机号
 * @param {string} verifyCode - 验证码
 * @returns {string} token
 */
export function MobileAutoLogin(userName, verifyCode) {
    console.log('[MobileAutoLogin] 开始手机号自动登录，用户:', userName);

    const api = '/api/Home/MobileAutoLogin';
    const registerFingerprint = generateCryptoRandomString(32);

    const payload = {
        userName: userName,
        verifyCode: verifyCode,
        registerDevice: "",
        registerFingerprint: registerFingerprint,
        inviteCode: "",
        packageName: ""
    };

    //console.log('[MobileAutoLogin] 登录请求 payload:', JSON.stringify(payload));

    const token = sendRequest(payload, api, tag, true);

    if (token) {
        console.log('[MobileAutoLogin] 自动登录成功');
    } else {
        console.error('[MobileAutoLogin] 自动登录失败');
    }

    return token;
}

/**
 * 完整的手机号自动登录流程
 * @param {string} phoneNumber - 手机号
 * @param {object} data - setup 返回的数据对象，包含 adminToken
 * @returns {string} 登录成功后的 token
 */
export function mobileAutoLoginFlow(phoneNumber, data) {
    console.log('[MobileAutoLogin] 开始完整的手机号自动登录流程');

    // 1. 发送验证码
    const verifyCode = sendMobileAutoLoginVerifyCode(phoneNumber, data);
    if (!verifyCode) {
        console.error('[MobileAutoLogin] 验证码获取失败，无法继续登录');
        return null;
    }

    // 2. 使用验证码进行自动登录
    const token = MobileAutoLogin(phoneNumber, verifyCode);

    if (token) {
        console.log('[MobileAutoLogin] 完整登录流程成功');
    } else {
        console.error('[MobileAutoLogin] 完整登录流程失败');
    }

    return token;
}