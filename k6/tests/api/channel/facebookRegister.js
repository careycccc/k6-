/**
 * Facebook 埋点注册核心函数
 *
 * 与 Adjust 的差异：
 *   - eventType: 1（Adjust 是 2）
 *   - eventIdentityInfo 中 Fbp 字段需动态生成（格式：fb.1.<timestamp>.<random>）
 *   - PixelId 为 Facebook Pixel ID
 */

import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString, generateFbp } from '../../utils/utils.js';
import { sendToGetVerCode } from '../login/SendVerifiyCode.test.js';

// generateFbp 已提取到 tests/utils/utils.js 共享（2026-10-27），guestRegister 等
// 场景也要用同一份实现，不再在这里单独定义一份。

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
 *   - campaignId:     FB广告系列ID（默认空，FB广告分析归因用）
 *   - adSetId:        FB广告组ID（默认空）
 *   - adId:           FB广告ID（默认空）
 * @returns {object|null} 注册结果，含 { headers, data, code, msg, deviceId }
 *
 * ⚠️ campaignId/adSetId/adId 是假设字段名，需要和后端对齐：现在按最合理的猜测
 * 放在 payload 顶层(和 eventIdentity 平级)。等后端接口文档出来后，如果字段名
 * 或位置不同，改动范围只在这个函数的 payload/signPayload 构造处。
 */
export function facebookIdentityRegister(userName, data, options = {}) {
    const {
        password = 'qwer1234',
        pixelId = '2010850729480687',
        eventConfigId = 200018,
        eventType = 1,
        packageName = 'com.ar3004.fb.app',
        inviteCode = '',
        registerUrl = null,
        customFrontUrl = null,
        campaignId = '',
        adSetId = '',
        adId = ''
    } = options;

    console.log(`[FbRegister] ========== 开始 Facebook 埋点注册 (ID: ${eventConfigId}) ==========`);
    console.log(`[FbRegister] 账号: ${userName} | 包名: ${packageName} | pixelId: ${pixelId}`);

    // 1. 获取验证码
    const verifyCode = sendToGetVerCode(1, 1, userName, data.token, customFrontUrl);
    if (!verifyCode) {
        console.error('[FbRegister] ❌ 获取验证码失败');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api = '/api/Home/Register';

    // 2. 动态生成 Fbp
    const fbp = generateFbp();
    console.log(`[FbRegister] 生成 Fbp: ${fbp}`);

    // 3. 组装 Facebook 专属的 eventIdentityInfo
    //    与 Adjust 的区别：Fbp 有动态值，eventType=1
    const eventIdentityInfo = JSON.stringify({
        PixelId: pixelId,
        Fbp: fbp,
        Fbc: '',
        Ttclid: '',
        Ttcsid: '',
        AdjustDeviceId: ''
    });

    // 4. 组装完整 payload
    const payload = {
        loginType: 'Mobile',
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
        campaignId: campaignId,
        adSetId: adSetId,
        adId: adId,
        eventIdentity: [
            {
                eventConfigId: eventConfigId,
                eventType: eventType,
                eventIdentityInfo: eventIdentityInfo
            }
        ],
        language: 'en',
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // 5. 签名（这里是手动列举字段的签名机制，不是自动过滤剩余字段——
    // campaignId/adSetId/adId 必须也加进 signPayload，否则签名会和实际
    // payload 不一致导致后端验签失败）
    const signPayload = {
        loginType: 'Mobile',
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
        campaignId: campaignId,
        adSetId: adSetId,
        adId: adId,
        language: 'en',
        random: timeData.random
    };

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    console.log(`[FbRegister] eventIdentityInfo: ${eventIdentityInfo}`);

    // 6. 发送请求
    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);

    // 7. 处理响应
    //console.log(`[FbRegister] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
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
        //console.log(`[FbRegister] ✅ 注册成功: ${userName}`);
        return {
            headers: httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg,
            deviceId: deviceId
        };
    } else {
        console.error(`[FbRegister] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }
}
