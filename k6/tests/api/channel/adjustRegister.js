/**
 * Adjust 埋点注册核心函数
 *
 * 与 TikTok 的 eventIdentityRegister 并列，专门处理 Adjust 渠道的注册逻辑。
 * 主要差异：eventIdentityInfo 中多了 Ttclid / Ttcsid 字段，eventType 为 2。
 */

import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { sendToGetVerCode } from '../login/SendVerifiyCode.test.js';

/**
 * Adjust 埋点注册
 *
 * @param {string} userName  - 手机号（含区号）
 * @param {object} data      - 含 token 和 envConfig 的 setup 对象
 * @param {object} options   - 额外参数
 *   - password:       密码（默认 qwer1234）
 *   - pixelId:        Adjust PixelId（默认 uyyiyutewe）
 *   - eventConfigId:  事件配置ID（默认 200015）
 *   - eventType:      事件类型（默认 2）
 *   - packageName:    包名（默认 com.ar3004.adcarey_adjust_001.app）
 *   - inviteCode:     邀请码（默认空）
 *   - registerUrl:    自定义注册域名（可选）
 *   - customFrontUrl: 自定义前台域名（可选，用于发送验证码）
 * @returns {object|null} 注册结果，含 { headers, data, code, msg, deviceId }
 */
export function adjustIdentityRegister(userName, data, options = {}) {
    const {
        password       = 'qwer1234',
        pixelId        = 'uyyiyutewe',
        eventConfigId  = 200015,
        eventType      = 2,
        packageName    = 'com.ar3004.adcarey_adjust_001.app',
        inviteCode     = '',
        registerUrl    = null,
        customFrontUrl = null
    } = options;

    console.log(`[AdjustRegister] ========== 开始 Adjust 埋点注册 (ID: ${eventConfigId}) ==========`);
    console.log(`[AdjustRegister] 账号: ${userName} | 包名: ${packageName} | pixelId: ${pixelId}`);

    // 1. 获取验证码
    const verifyCode = sendToGetVerCode(1, 1, userName, data.token, customFrontUrl);
    if (!verifyCode) {
        console.error('[AdjustRegister] ❌ 获取验证码失败');
        return null;
    }

    const codeStr   = String(verifyCode).trim();
    const timeData  = getTimeRandom();
    const deviceId  = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api       = '/api/Home/Register';

    // 2. 组装 Adjust 专属的 eventIdentityInfo
    //    与 TikTok 的区别：多了 Ttclid / Ttcsid 字段
    const eventIdentityInfo = JSON.stringify({
        PixelId:        pixelId,
        Fbp:            '',
        Fbc:            '',
        Ttclid:         '',
        Ttcsid:         '',
        AdjustDeviceId: ''
    });

    // 3. 组装完整 payload
    const payload = {
        loginType:     'Mobile',
        userName:      userName,
        password:      password,
        inviteCode:    inviteCode,
        code:          codeStr,
        captchaId:     null,
        deviceId:      deviceId,
        browserId:     browserId,
        packageName:   packageName,
        eventIdentity: [
            {
                eventConfigId: eventConfigId,
                eventType:     eventType,
                eventIdentityInfo: eventIdentityInfo
            }
        ],
        language:  'en',
        random:    timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // 4. 签名（与 TikTok 保持一致，只对基础字段签名）
    const signPayload = {
        loginType:   'Mobile',
        userName:    userName,
        password:    password,
        inviteCode:  inviteCode,
        code:        codeStr,
        captchaId:   null,
        deviceId:    deviceId,
        browserId:   browserId,
        packageName: packageName,
        language:    'en',
        random:      timeData.random
    };

    const signClient  = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature  = signedParams.signature;
    payload.timestamp  = signedParams.timestamp;

    console.log(`[AdjustRegister] eventIdentityInfo: ${eventIdentityInfo}`);

    // 5. 发送请求
    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);

    // 6. 处理响应
    console.log(`[AdjustRegister] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    if (!httpResponse || !httpResponse.body) {
        console.error('[AdjustRegister] ❌ 接口无响应');
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string'
            ? JSON.parse(httpResponse.body)
            : httpResponse.body;
    } catch (e) {
        console.error(`[AdjustRegister] ❌ 解析响应体失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode === 0) {
        console.log(`[AdjustRegister] ✅ 注册成功: ${userName}`);
        return {
            headers:  httpResponse.headers,
            data:     parsedBody.data,
            code:     statusCode,
            msg:      parsedBody.msg,
            deviceId: deviceId
        };
    } else {
        console.error(`[AdjustRegister] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}
