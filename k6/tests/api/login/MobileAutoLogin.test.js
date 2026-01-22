import { generateCryptoRandomString } from '../../utils/utils.js';
import { sendRequest } from '../../api/common/request.js';

const tag = 'MobileAutoLogin'

/**
 * @param {string} userName 账号
 * @param {string} verifyCode  验证码
 * @returns {string} token
*/
export function MobileAutoLogin(userName, verifyCode) {
    const api = '/api/Home/MobileAutoLogin'
    const registerFingerprint = generateCryptoRandomString(32)
    const payload = {
        inviteCode: "",
        packageName: "",
        registerDevice: "",
        registerFingerprint,
        userName,
        verifyCode
    }
    const token = sendRequest(payload, api, tag, true)
    return token
}