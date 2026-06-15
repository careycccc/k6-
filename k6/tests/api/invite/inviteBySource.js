import { httpClient } from '../../../libs/http/client.js';
import { getUserDetail } from '../activity/memberLimitAdapter/api.js';
import { getTimeRandom } from '../../utils/utils.js';

/**
 * 支持携带指定设备和指纹的下级注册
 */
export function phoneRegisterBySource(userName, inviteCodeOrUserId, password = 'qwer1234', customUrls = null, targetDevice = '', targetFingerprint = '') {
    const api = "/api/Home/Register";
    const timeData = getTimeRandom(); // 使用项目统一的时间/random生成，确保类型正确

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: String(inviteCodeOrUserId),
        code: "",
        captchaId: null,
        deviceId: targetDevice || "",
        browserId: targetFingerprint || "",
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    let httpResponse;
    if (customUrls && customUrls.registerUrl) {
        const fullUrl = customUrls.registerUrl + api;
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    if (!httpResponse || !httpResponse.body) return null;

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) { return null; }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode === 0) {
        const token = parsedBody.data && parsedBody.data.token ? parsedBody.data.token : null;
        return {
            headers: token ? { 'Authorization': `Bearer ${token}` } : httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        console.error(`[PhoneRegisterBySource] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}

/**
 * 校验并获取上级的设备号与指纹
 * @param {string} adminToken
 * @param {string|number} rootUserId
 * @param {string} matchMode - 支持: FINGERPRINT, DEVICE, BOTH
 */
export function validateAndGetSuperiorSource(adminToken, rootUserId, matchMode) {
    const mode = (matchMode || '').toUpperCase();
    if (mode !== 'FINGERPRINT' && mode !== 'DEVICE' && mode !== 'BOTH') {
        return { requiredFingerprint: '', requiredDevice: '' };
    }

    if (!rootUserId) {
        throw new Error(`[Setup] ❌ 报错：开启了 MATCH_MODE=${mode}，但未传入 ROOT_USER_ID`);
    }

    console.log(`[Setup] 🔍 开启匹配模式: ${mode}，正在获取上级(userId: ${rootUserId})的设备/指纹信息...`);
    const userDetailRes = getUserDetail(adminToken, rootUserId);
    
    // 注意：底层的 sendQueryRequest 成功时直接返回了 response.data，去掉了外层的 code 和 msg
    if (!userDetailRes || !userDetailRes.registerSourceRsp) {
        throw new Error(`[Setup] ❌ 报错：获取上级 userId=${rootUserId} 详情信息失败`);
    }

    const registerSource = userDetailRes.registerSourceRsp || {};
    const fp = registerSource.registerFingerprint || '';
    const dv = registerSource.registerDevice || '';

    if ((mode === 'FINGERPRINT' || mode === 'BOTH') && !fp) {
        throw new Error(`[Setup] ❌ 报错：上级 userId=${rootUserId} 没有对应的注册指纹(registerFingerprint)`);
    }
    if ((mode === 'DEVICE' || mode === 'BOTH') && !dv) {
        throw new Error(`[Setup] ❌ 报错：上级 userId=${rootUserId} 没有对应的注册设备号(registerDevice)`);
    }

    const requiredFingerprint = mode === 'FINGERPRINT' || mode === 'BOTH' ? fp : '';
    const requiredDevice = mode === 'DEVICE' || mode === 'BOTH' ? dv : '';

    console.log(`[Setup] ✅ 上级匹配信息提取成功: 指纹[${requiredFingerprint}] 设备号[${requiredDevice}]`);

    return { requiredFingerprint, requiredDevice };
}




