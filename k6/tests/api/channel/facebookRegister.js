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
 *   - campaignId / campaignName: FB广告系列ID/名称（默认空，FB广告分析归因用）
 *   - adSetId / adSetName:       FB广告组ID/名称（默认空）
 *   - adId / adName:             FB广告ID/名称（默认空）
 * @returns {object|null} 注册结果，含 { headers, data, code, msg, deviceId }
 *
 * 归因字段的真实契约(2026-11-03 对照 k6-go pkg/login/channelregister.go 的
 * AdAttribution + register.test.js 的 guestRegister 抓包注释确认，不是猜测)：
 *   - 后端 Register 接口认的是顶层 `adAttribution` 嵌套对象，6个字段(3个ID+
 *     3个Name)全部传：campaignId/campaignName/adsetId/adsetName/adId/adName
 *     ——注意是 adsetId/adsetName(小写s，adset是一个单词)，不是 adSetId/adSetName。
 *   - 6个字段全空等同于不传，不是广告带来的用户不要带这个对象。
 *   - adAttribution 必须参与签名(只有 eventIdentity 排除出签名)，且本项目
 *     SignatureUtil.sortObject 不递归排序嵌套对象，必须手动把内部6个字段按字母
 *     序摆好(adId/adName/adsetId/adsetName/campaignId/campaignName)。
 * 之前把三个ID摊平放在 payload 顶层、字段名还用 adSetId，后端完全不认识——
 * 注册能成功(顶层未知字段被忽略)，但归因记录一条都不会生成。
 * 本函数的选项名仍沿用旧的 adSetId/adSetName(调用方不用改)，内部转换成后端的
 * adsetId/adsetName。
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
        campaignId = '',
        campaignName = '',
        adSetId = '',
        adSetName = '',
        adId = '',
        adName = ''
    } = options;

    console.log(`[FbRegister] ========== 开始 Facebook 埋点注册 (ID: ${eventConfigId}) ==========`);
    console.log(`[FbRegister] 账号: ${userName} | 包名: ${packageName} | pixelId: ${pixelId}`);

    // 2026-11-03：/api/Home/Register 本身支持埋点注册(带eventIdentity)+code传空字符串
    // 直接跳过验证码——参照 register.test.js 的 eventIdentityRegister（同样走
    // eventIdentity+code:""，注释明确写"无验证码"）和 k6-go 的
    // ChannelIdentityRegisterNoCode，之前这里强制 sendToGetVerCode 在当前测试
    // 环境里会因为 "this verification method is not enabled"(msgCode 13011)
    // 直接注册失败。
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

    // 3.5 广告归因：6个字段全空等同于不传(不要带空对象)，否则带 adAttribution 嵌套对象。
    // 后端字段名是 adsetId/adsetName(小写s)，这里把选项名 adSetId/adSetName 转过去。
    const hasAttribution = !!(campaignId || campaignName || adSetId || adSetName || adId || adName);
    const adAttribution = hasAttribution
        ? {
            campaignName: campaignName,
            campaignId: campaignId,
            adsetName: adSetName,
            adsetId: adSetId,
            adName: adName,
            adId: adId
        }
        : null;

    // 4. 组装完整 payload
    const payload = {
        loginType: 'Mobile',
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: '',
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
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
    if (adAttribution) payload.adAttribution = adAttribution;

    // 5. 签名：eventIdentity 不参与签名(沿用本项目其他含eventIdentity的注册接口
    // 的既有规则)；adAttribution 必须参与签名(k6-go 实测第一版想当然排除它，报
    // Wrong signature)。后端验签会递归排序嵌套对象，而本项目 SignatureUtil.sortObject
    // 只对顶层键排序、不进嵌套对象内部排序，所以这里必须手动把 adAttribution 内部
    // 6个字段按字母序摆好(adId/adName/adsetId/adsetName/campaignId/campaignName)，
    // 做法和 register.test.js 的 guestRegister 完全一致(已用真实抓包签名值核对过)。
    const signPayload = {
        loginType: 'Mobile',
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: '',
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
        language: 'en',
        random: timeData.random
    };
    if (adAttribution) {
        signPayload.adAttribution = {
            adId: adAttribution.adId,
            adName: adAttribution.adName,
            adsetId: adAttribution.adsetId,
            adsetName: adAttribution.adsetName,
            campaignId: adAttribution.campaignId,
            campaignName: adAttribution.campaignName
        };
    }

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
