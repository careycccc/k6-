/**
 * Facebook 埋点注册核心函数
 *
 * 与 Adjust 的差异：
 *   - eventType: 1（Adjust 是 2）
 *   - eventIdentityInfo 中 Fbp 字段需动态生成（格式：fb.1.<timestamp>.<random>）
 *   - PixelId 为 Facebook Pixel ID
 */

import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { sendToGetVerCode } from '../login/SendVerifiyCode.test.js';

/**
 * 生成 Facebook Fbp 参数
 * 格式：fb.1.<毫秒时间戳>.<随机整数>
 * 参考：https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 */
function generateFbp() {
    const ts   = Date.now();
    const rand = Math.floor(Math.random() * 1e18);
    return `fb.1.${ts}.${rand}`;
}

/**
 * Facebook 埋点注册
 *
 * @param {string} userName  - 手机号（含区号）
 * @param {object} data      - 含 token 和 envConfig 的 setup 对象
 * @param {object} options   - 额外参数
 *   - password:       密码（默认 qwer1234）
 *   - pixelId:        Facebook Pixel ID（默认 2010850729480687）
 *   - eventConfigId:  事件配置ID（默认 200018）
 *   - eventType:      事件类型（默认 1）
 *   - packageName:    包名（默认 com.ar3004.fb.app）
 *   - inviteCode:     邀请码（默认空）
 *   - registerUrl:    自定义注册域名（可选）
 *   - customFrontUrl: 自定义前台域名（可选，用于发送验证码）
 * @returns {object|null} 注册结果，含 { headers, data, code, msg, deviceId }
 */
export function facebookIdentityRegister(userName, data, options = {}) {
    const {
        password       = 'qwer1234',
        pixelId        = '2010850729480687',
        eventConfigId  = 200018,
        eventType      = 1,
        packageName    = 'com.ar3004.fb.app',
        inviteCode     = '',
        registerUrl    = null,
        customFrontUrl = null
    } = options;

    console.log(`[FbRegister] ========== 开始 Facebook 埋点注册 (ID: ${eventConfigId}) ==========`);
    console.log(`[FbRegister] 账号: ${userName} | 包名: ${packageName} | pixelId: ${pixelId}`);

    // 1. 获取验证码
    const verifyCode = sendToGetVerCode(1, 1, userName, data.token, customFrontUrl);
    if (!verifyCode) {
        console.error('[FbRegister] ❌ 获取验证码失败');
        return null;
    }

    const codeStr   = String(verifyCode).trim();
    const timeData  = getTimeRandom();
    const deviceId  = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api       = '/api/Home/Register';

    // 2. 动态生成 Fbp
    const fbp = generateFbp();
    console.log(`[FbRegister] 生成 Fbp: ${fbp}`);

    // 3. 组装 Facebook 专属的 eventIdentityInfo
    //    与 Adjust 的区别：Fbp 有动态值，eventType=1
    const eventIdentityInfo = JSON.stringify({
        PixelId:        pixelId,
        Fbp:            fbp,
        Fbc:            '',
        Ttclid:         '',
        Ttcsid:         '',
        AdjustDeviceId: ''
    });

    // 4. 组装完整 payload
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

    // 5. 签名
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

    const signClient   = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature  = signedParams.signature;
    payload.timestamp  = signedParams.timestamp;

    console.log(`[FbRegister] eventIdentityInfo: ${eventIdentityInfo}`);

    // 6. 发送请求
    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);

    // 7. 处理响应
    console.log(`[FbRegister] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    if (!httpResponse || !httpResponse.body) {
        console.error('[FbRegister] ❌ 接口无响应');
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string'
            ? JSON.parse(httpResponse.body)
            : httpResponse.body;
    } catch (e) {
        console.error(`[FbRegister] ❌ 解析响应体失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode === 0) {
        console.log(`[FbRegister] ✅ 注册成功: ${userName}`);
        return {
            headers:  httpResponse.headers,
            data:     parsedBody.data,
            code:     statusCode,
            msg:      parsedBody.msg,
            deviceId: deviceId
        };
    } else {
        console.error(`[FbRegister] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}
