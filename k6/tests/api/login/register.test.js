import { sendToGetVerCode } from './SendVerifiyCode.test.js';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString, generateFbp, generateFbc } from '../../utils/utils.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { probeResponse } from '../../../libs/monitor/perfIntegration.js';
import { PERF_METRICS, ERROR_COUNTERS } from '../../../libs/monitor/perfMetrics.js';

// ============================================================
// 最近一次注册错误（供调用方按错误类型决定「是否值得重试」的快速失败逻辑）
// - k6 中每个 VU 是独立 JS 运行时，模块级变量为「每 VU 私有」；同一 VU 内迭代串行执行，
//   注册函数返回后同步读取本变量即当次结果，无并发竞态。
// - 注册函数对外返回值保持不变（成功返回对象、失败仍返回 null），完全向后兼容。
// ============================================================
let _lastRegisterError = null;

/**
 * 取最近一次注册失败的错误详情。
 * @returns {{type:'business'|'network'|'parse', code:number|null, msgCode:number|null, msg:string}|null} 成功时为 null
 */
export function getLastRegisterError() {
    return _lastRegisterError;
}

/**
 * 是否为「访问过于频繁」限流错误——全项目统一约定：msgCode===13 / msg 含 "Too frequent access"。
 * 只有这类（及网络/解析类瞬时错误）才值得退避重试；其它业务错误应快速失败。
 * @param {object|null} err getLastRegisterError() 的返回值
 * @returns {boolean}
 */
export function isRateLimitError(err) {
    if (!err) return false;
    if (err.msgCode === 13 || err.code === 13) return true;
    const m = (err.msg || '').toLowerCase();
    return m.includes('too frequent') || m.includes('try again later');
}

// ============================================================
// 无验证码版本（主流程）
// 后端已支持直接注册，无需预先发送验证码，code 字段传空字符串即可
// ============================================================

/**
 * 手机号注册 - 前台总代注册方式（无验证码）
 * 对应 Golang 的 NewGeneralAgentRegister
 * @param {string} userName - 手机号
 * @param {object} data - setup 返回的数据对象（兼容保留，不再用 token）
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @param {string} deviceOverride - 强制指定 deviceId（可选，不传则为空字符串）
 * @param {string} browserOverride - 强制指定 browserId（可选，不传则每次随机生成）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function phoneRegister(userName, data, password = 'qwer1234', inviteCode = '', captchaId = null, deviceOverride = '', browserOverride = '') {
    console.log(`[PhoneRegister] ========== 开始手机号注册流程（无验证码）==========`);
    // console.log(`[PhoneRegister] 用户名: ${userName}`);
    // console.log(`[PhoneRegister] 密码: ${password}`);
    // console.log(`[PhoneRegister] 邀请码: ${inviteCode || '(空)'}`);

    const api = "/api/Home/Register";
    const deviceId = deviceOverride || '';
    const browserId = browserOverride || generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: "",
        captchaId: captchaId,
        deviceId: deviceId,
        browserId: browserId,
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

   // console.log(`[PhoneRegister] 注册 payload:`, JSON.stringify(payload, null, 2));

    const httpResponse = httpClient.post(api, payload, {}, true);

    // console.log(`[PhoneRegister] ========== 注册响应 ==========`);
    // console.log(`[PhoneRegister] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    // console.log(`[PhoneRegister] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponse(httpResponse, userName);
}

/**
 * 手机号注册 - 邀请注册方式（无验证码）
 * @param {string} userName - 手机号
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象（兼容保留，不再用 token）
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 *   - registerUrl: 注册域名
 * @param {string} deviceOverride - 强制指定 deviceId（可选，不传则每次随机生成）
 * @param {string} browserOverride - 强制指定 browserId（可选，不传则每次随机生成）
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function phoneRegisterByInvite(userName, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null, deviceOverride = '', browserOverride = '') {
        console.log(`[PhoneRegisterByInvite] ========== 开始手机号邀请注册流程（无验证码）==========`);
        // console.log(`[PhoneRegisterByInvite] 用户名: ${userName}`);
        // console.log(`[PhoneRegisterByInvite] 邀请码: ${inviteCode}`);
        // console.log(`[PhoneRegisterByInvite] 密码: ${password}`);

    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;
    const api = "/api/Home/Register";
    const timeData = getTimeRandom();
    const deviceId = deviceOverride || generateCryptoRandomString(16);
    const browserId = browserOverride || generateCryptoRandomString(32);

    const payload = {
        userName: userName,
        inviteCode: inviteCode,
        loginType: "Mobile",
        turnstileToken: turnstileToken,
        password: password,
        code: "",
        deviceId: deviceId,
        browserId: browserId,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // console.log(`[PhoneRegisterByInvite] 注册 payload:`, JSON.stringify(payload, null, 2));
    // console.log(`[PhoneRegisterByInvite] ⚠️  当前 ENV_CONFIG.BASE_DESK_URL = ${ENV_CONFIG.BASE_DESK_URL}`);

    let httpResponse;
    if (customRegisterUrl) {
        const fullUrl = customRegisterUrl + api;
        console.log(`[PhoneRegisterByInvite] 使用自定义注册URL: ${fullUrl}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        console.log(`[PhoneRegisterByInvite] 使用默认注册URL: ${ENV_CONFIG.BASE_DESK_URL}${api}`);
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    //console.log(`[PhoneRegisterByInvite] ========== 注册响应 ==========`);
    //console.log(`[PhoneRegisterByInvite] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    //console.log(`[PhoneRegisterByInvite] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponseWithToken(httpResponse, userName);
}

/**
 * 邮箱注册 - 前台总代注册方式（无验证码）
 * 对应 Golang 的 EmailRegisterApi
 * @param {string} email - 邮箱地址
 * @param {object} data - setup 返回的数据对象（兼容保留，不再用 token）
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} inviteCode - 邀请码，默认为空字符串（前台总代注册时为空）
 * @param {string} captchaId - 验证码ID，默认为 null
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function emailRegister(email, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    console.log(`[EmailRegister] ========== 开始邮箱注册流程（无验证码）==========`);
    // console.log(`[EmailRegister] 邮箱: ${email}`);
    // console.log(`[EmailRegister] 密码: ${password}`);
    // console.log(`[EmailRegister] 邀请码: ${inviteCode || '(空)'}`);

    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        loginType: "Email",
        userName: email,
        password: password,
        inviteCode: inviteCode,
        code: "",
        captchaId: null,
        deviceId: "",
        browserId: browserId,
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    //console.log(`[EmailRegister] 注册 payload:`, JSON.stringify(payload, null, 2));

    const httpResponse = httpClient.post(api, payload, {}, true);

    // console.log(`[EmailRegister] ========== 注册响应 ==========`);
    // console.log(`[EmailRegister] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    // console.log(`[EmailRegister] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponse(httpResponse, email);
}

/**
 * 邮箱注册 - 邀请注册方式（无验证码）
 * @param {string} email - 邮箱地址
 * @param {string} inviteCode - 邀请码（邀请注册必须提供）
 * @param {object} data - setup 返回的数据对象（兼容保留，不再用 token）
 * @param {string} password - 密码，默认为 'qwer1234'
 * @param {string} turnstileToken - Turnstile 验证令牌，默认为空字符串
 * @param {object} customUrls - 自定义URL配置（可选，用于多租户）
 *   - registerUrl: 注册域名
 * @returns {object} 返回包含 headers 和 data 的响应对象
 */
export function emailRegisterByInvite(email, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    console.log(`[EmailRegisterByInvite] ========== 开始邮箱邀请注册流程（无验证码）==========`);
    // console.log(`[EmailRegisterByInvite] 邮箱: ${email}`);
    // console.log(`[EmailRegisterByInvite] 邀请码: ${inviteCode}`);
    // console.log(`[EmailRegisterByInvite] 密码: ${password}`);

    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;
    const api = "/api/Home/Register";
    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);

    const payload = {
        userName: email,
        inviteCode: inviteCode,
        loginType: "Email",
        turnstileToken: turnstileToken,
        password: password,
        code: "",
        deviceId: deviceId,
        browserId: browserId,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // console.log(`[EmailRegisterByInvite] 注册 payload:`, JSON.stringify(payload, null, 2));
    // console.log(`[EmailRegisterByInvite] ⚠️  当前 ENV_CONFIG.BASE_DESK_URL = ${ENV_CONFIG.BASE_DESK_URL}`);

    let httpResponse;
    if (customRegisterUrl) {
        const fullUrl = customRegisterUrl + api;
        console.log(`[EmailRegisterByInvite] 使用自定义注册URL: ${fullUrl}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        console.log(`[EmailRegisterByInvite] 使用默认注册URL: ${ENV_CONFIG.BASE_DESK_URL}${api}`);
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    //console.log(`[EmailRegisterByInvite] ========== 注册响应 ==========`);
    //console.log(`[EmailRegisterByInvite] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    //console.log(`[EmailRegisterByInvite] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponseWithToken(httpResponse, email);
}

/**
 * 通用埋点注册方式（无验证码）(Event Identity Register)
 * 支持通过 options 切换不同的埋点配置 (如 ID 21 或 22)
 * @param {string} userName - 手机号 (包含区号)
 * @param {object} data - 包含 envConfig 的 setup 对象（兼容保留，不再用 token）
 * @param {object} options - 额外参数
 *   - password: 密码 (默认 qwer1234)
 *   - pixelId: Pixel ID (默认 D7GEL23C77U0PCJMRE8G)
 *   - eventConfigId: 事件配置ID (默认 22)
 *   - eventType: 事件类型 (默认 6)
 *   - packageName: 包名 (默认 com.ar3004.fb.app)
 *   - inviteCode: 邀请码 (默认空)
 *   - registerUrl: 自定义注册域名 (可选)
 * @returns {object} 注册结果
 */
export function eventIdentityRegister(userName, data, options = {}) {
    const {
        password = 'qwer1234',
        pixelId = 'D7GEL23C77U0PCJMRE8G',
        eventConfigId = 22,
        eventType = 6,
        packageName = 'com.ar3004.fb.app',
        registerUrl = null,
        inviteCode = ""
    } = options;

    console.log(`[EventRegister] ========== 开始埋点注册流程（无验证码，ID: ${eventConfigId}）==========`);

    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api = "/api/Home/Register";

    const eventIdentityInfo = JSON.stringify({
        PixelId: pixelId,
        Fbp: "",
        Fbc: "",
        AdjustDeviceId: deviceId
    });

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: "",
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
        language: "en",
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    // 签名 payload
    const signPayload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: "",
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
        language: "en",
        random: timeData.random
    };

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);

    return handleRegisterResponse(httpResponse, userName, deviceId);
}

/**
 * 游客注册/登录 (AutoLogin)
 *
 * 2026-10-27新增FB归因支持：游客注册这个接口原本的payload契约里完全没有归因
 * 字段的位置(不同于 facebookRegister.js 的 /api/Home/Register，那边payload
 * 顶层本来就有 campaignId/adSetId/adId)。这次新增的 adAttribution 顶层对象
 * 是针对3003商户真实抓包实测确认的结构——不是文档里 ad.campaignId 那种点号
 * 扁平写法，是独立的嵌套对象，字段名也是小写的 adsetId/adsetName(不是旧代码
 * 风格的 adSetId/adSetName)。同时验证过落地页URL的真实来源：
 *   https://3003.arplatsaassit3.club/indexpt1?fbclid=...&p1=campaignName&p2=campaignId
 *   &p3=adsetName&p4=adsetId&p5=adName&p6=adId&...
 * p1~p6 逐项对应 adAttribution 的6个字段，fbclid 则是 eventIdentityInfo.Fbc
 * (格式 fb.1.<时间戳>.<fbclid>) 的真实来源——这套映射关系已用真实数据核对过，
 * 不是猜测。
 *
 * @param {object} options - 额外参数
 *   - packageName: 包名 (必需，如 'com.ar3007.fb.app')
 *   - inviteCode: 邀请码 (默认空)
 *   - registerDevice: 设备号 (如果不传，将自动随机生成)
 *   - eventConfigId: 事件配置ID (默认 100061)
 *   - eventType: 事件类型 (默认 99)
 *   - pixelId: Facebook Pixel ID (默认 "0"，即"无归因"的旧行为；传真实值才算走FB归因)
 *   - fbp: Facebook Browser ID，不传且 pixelId!=="0" 时自动用 generateFbp() 生成
 *   - fbclid: 从广告落地页URL拿到的真实点击ID原始值；连同 fbc 一起传时以 fbc 为准，
 *     只传 fbclid 则用 generateFbc(fbclid) 自动拼出标准格式
 *   - fbc: Facebook Click ID 完整值(fb.1.<ts>.<fbclid>)，优先级高于 fbclid
 *   - adAttribution: { campaignId, campaignName, adsetId, adsetName, adId, adName } ——
 *     不传则不带这个字段，保持无归因的纯游客注册老行为
 * @returns {object} 返回包含 token 和响应数据的对象
 */
export function guestRegister(options = {}) {
    const {
        packageName,
        inviteCode = "",
        registerDevice = generateCryptoRandomString(16),
        eventConfigId = 100061,
        eventType = 99,
        pixelId = "0",
        fbp,
        fbclid,
        fbc,
        adAttribution = null
    } = options;

    // console.log(`[GuestRegister] ========== 开始游客注册/登录流程 ==========`);
    // console.log(`[GuestRegister] packageName: ${packageName}`);
    // console.log(`[GuestRegister] registerDevice: ${registerDevice}`);
    // console.log(`[GuestRegister] inviteCode: ${inviteCode || '(空)'}`);

    if (!packageName) {
        console.error(`[GuestRegister] ❌ 缺少必填参数 packageName`);
        return null;
    }

    const api = "/api/Home/AutoLogin";
    const timeData = getTimeRandom();
    const lang = timeData.language || ENV_CONFIG.LANGUAGE || "ur";

    // pixelId传了真实值(不是旧默认"0")才视为"要走FB归因"，这时才需要Fbp兜底生成——
    // 不要在调用方根本没打算测归因的场景(pixelId仍是默认"0")下也悄悄生成一个假Fbp，
    // 那会让"无归因"的老用例意外带上追踪数据，破坏既有行为。
    const resolvedFbp = fbp !== undefined ? fbp : (pixelId !== "0" ? generateFbp() : "");
    const resolvedFbc = fbc !== undefined ? fbc : (fbclid ? generateFbc(fbclid) : "");

    // 实际发送的完整 payload（字段顺序贴近3003真实抓包，方便对照排查）
    const payload = {
        registerDevice: registerDevice,
        registerFingerprint: "",
        inviteCode: inviteCode,
        eventIdentity: [
            {
                eventConfigId: eventConfigId,
                eventType: eventType,
                eventIdentityInfo: JSON.stringify({
                    PixelId: pixelId,
                    Fbp: resolvedFbp,
                    Fbc: resolvedFbc,
                    Ttcsid: "",
                    AdjustDeviceId: ""
                })
            }
        ],
        packageName: packageName,
        language: lang,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };
    if (adAttribution) {
        payload.adAttribution = {
            campaignName: adAttribution.campaignName || "",
            campaignId: adAttribution.campaignId || "",
            adsetName: adAttribution.adsetName || "",
            adsetId: adAttribution.adsetId || "",
            adName: adAttribution.adName || "",
            adId: adAttribution.adId || ""
        };
    }

    // eventIdentity 不参与签名(沿用本项目其他含eventIdentity的注册接口的既有
    // 规则：数组+内部还套了一层JSON字符串化，复杂度高，容易和后端JSON序列化
    // 对不上)。
    //
    // adAttribution 必须参与签名——2026-10-27用3003真实抓包的签名值离线反推
    // 确认过(拿真实signature倒推字段组合方式，而不是靠一次次发请求试错)：
    // 后端的验签算法会"递归"排序嵌套对象，但本项目 SignatureUtil.sortObject
    // (libs/utils/signature.js)只对顶层键排序，不会进嵌套对象内部排序——这
    // 正是最初两次尝试("整体嵌套不排内部"、"拍平到顶层")都报 Wrong signature
    // 的根因。必须手动把 adAttribution 内部的6个字段也按字母顺序排好，再整体
    // 作为嵌套对象塞进signPayload，顶层sortObject处理adAttribution这个键时
    // 才不会再去打乱已经排好的内部顺序。已用真实签名值核对一致：
    //   JSON.stringify应为 {"adAttribution":{"adId":...,"adName":...,
    //   "adsetId":...,"adsetName":...,"campaignId":...,"campaignName":...},
    //   "language":...,"packageName":...,"random":...,"registerDevice":...}
    const signPayload = {
        registerDevice: registerDevice,
        registerFingerprint: "",
        inviteCode: inviteCode,
        packageName: packageName,
        language: lang,
        random: timeData.random
    };
    if (adAttribution) {
        const a = payload.adAttribution;
        signPayload.adAttribution = {
            adId: a.adId, adName: a.adName, adsetId: a.adsetId,
            adsetName: a.adsetName, campaignId: a.campaignId, campaignName: a.campaignName
        };
    }

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    //console.log(`[GuestRegister] 请求 payload:`, JSON.stringify(payload, null, 2));

    // 使用 sign: false 避免底层重复签名
    const httpResponse = httpClient.post(api, payload, { sign: false }, true);

    return handleRegisterResponseWithToken(httpResponse, "Guest_" + registerDevice);
}

/**
 * 3003商户「游客注册+FB归因」真实验证过的参数组合——2026-10-27从开发提供的
 * 真实落地页URL + 真实套壳包抓包逐项核对确认，不是编造的测试数据：
 *   落地页：https://3003.arplatsaassit3.club/indexpt1?originhost=2rvupe85.com
 *           &fbclid=...&p1=campaignName&p2=campaignId&p3=adsetName&p4=adsetId
 *           &p5=adName&p6=adId&utm_source=fb&utm_medium=paid...
 *   抓包：POST /api/Home/AutoLogin，响应 code:0 成功创建新用户，adAttribution
 *         的6个字段和落地页 p1~p6 逐项比对完全一致。
 * campaignId/adsetId/adId 是真实FB广告后台的ID，不是 fbAdConfig.js 里那种虚拟
 * 造数用的假数据——如果广告在FB后台下线/改名，这组值可能过期，需要重新核对。
 * 用法：guestRegister({ ...TENANT_3003_FB_ATTRIBUTION, fbclid: '<新抓的fbclid>' })
 * （fbclid每次点击都不同，不要一直复用同一个旧值，仅复用 adAttribution/pixelId/
 * eventConfigId/packageName 这几项相对稳定的配置）。
 */
export const TENANT_3003_FB_ATTRIBUTION = {
    packageName: 'com.ar3003.fb.app',
    eventConfigId: 100052,
    eventType: 1,
    pixelId: '4183253858586287',
    adAttribution: {
        campaignName: 'CL102-FBW2A-06',
        campaignId: '120250189821190498',
        adsetName: '新销量广告组',
        adsetId: '120250189821180498',
        adName: '新销量广告 - 广告副本',
        adId: '120250189851160498'
    }
};

// ============================================================
// 带验证码版本（保留备用，后缀 WithCode）
// ============================================================

/**
 * 手机号注册 - 前台总代注册方式（发送验证码）
 */
export function phoneRegisterWithCode(userName, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    console.log(`[PhoneRegisterWithCode] ========== 开始手机号注册流程（发送验证码）==========`);
    console.log(`[PhoneRegisterWithCode] 用户名: ${userName}`);

    const verifyCode = sendToGetVerCode(1, 1, userName, data.token);
    if (!verifyCode) {
        console.error('[PhoneRegisterWithCode] 手机号注册失败：未能获取到验证码');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    console.log(`[PhoneRegisterWithCode] 验证码: "${codeStr}"`);

    const api = "/api/Home/Register";
    const browserId = generateCryptoRandomString(32);
    const timeData = getTimeRandom();

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: captchaId,
        deviceId: "",
        browserId: browserId,
        packageName: "",
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    console.log(`[PhoneRegisterWithCode] 注册 payload:`, JSON.stringify(payload, null, 2));

    const httpResponse = httpClient.post(api, payload, {}, true);

    console.log(`[PhoneRegisterWithCode] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    console.log(`[PhoneRegisterWithCode] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponse(httpResponse, userName);
}

/**
 * 手机号注册 - 邀请注册方式（发送验证码）
 */
export function phoneRegisterByInviteWithCode(userName, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    console.log(`[PhoneRegisterByInviteWithCode] ========== 开始手机号邀请注册流程（发送验证码）==========`);
    console.log(`[PhoneRegisterByInviteWithCode] 用户名: ${userName}`);

    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    const verifyCode = sendToGetVerCode(1, 19, userName, data.token, customFrontUrl, customAdminUrl);
    if (!verifyCode) {
        console.error('[PhoneRegisterByInviteWithCode] 邀请注册失败：未能获取到验证码');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    console.log(`[PhoneRegisterByInviteWithCode] 验证码: "${codeStr}"`);

    const api = "/api/Home/Register";
    const timeData = getTimeRandom();

    const payload = {
        userName: userName,
        inviteCode: inviteCode,
        loginType: "Mobile",
        turnstileToken: turnstileToken,
        password: password,
        code: codeStr,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    console.log(`[PhoneRegisterByInviteWithCode] 注册 payload:`, JSON.stringify(payload, null, 2));

    let httpResponse;
    if (customRegisterUrl) {
        const fullUrl = customRegisterUrl + api;
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    console.log(`[PhoneRegisterByInviteWithCode] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    console.log(`[PhoneRegisterByInviteWithCode] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponseWithToken(httpResponse, userName);
}

/**
 * 邮箱注册 - 前台总代注册方式（发送验证码）
 */
export function emailRegisterWithCode(email, data, password = 'qwer1234', inviteCode = '', captchaId = null) {
    console.log(`[EmailRegisterWithCode] ========== 开始邮箱注册流程（发送验证码）==========`);
    console.log(`[EmailRegisterWithCode] 邮箱: ${email}`);

    const verifyCode = sendToGetVerCode(2, 2, email, data.token);
    if (!verifyCode) {
        console.error('[EmailRegisterWithCode] 邮箱注册失败：未能获取到验证码');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    console.log(`[EmailRegisterWithCode] 验证码: "${codeStr}"`);

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
        signature: "",
        timestamp: timeData.timestamp
    };

    console.log(`[EmailRegisterWithCode] 注册 payload:`, JSON.stringify(payload, null, 2));

    const httpResponse = httpClient.post(api, payload, {}, true);

    console.log(`[EmailRegisterWithCode] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    console.log(`[EmailRegisterWithCode] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponse(httpResponse, email);
}

/**
 * 邮箱注册 - 邀请注册方式（发送验证码）
 * 修复了原版本中 httpResponse 先打印后发请求的 bug
 */
export function emailRegisterByInviteWithCode(email, inviteCode, data, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    console.log(`[EmailRegisterByInviteWithCode] ========== 开始邮箱邀请注册流程（发送验证码）==========`);
    console.log(`[EmailRegisterByInviteWithCode] 邮箱: ${email}`);
    console.log(`[EmailRegisterByInviteWithCode] 邀请码: ${inviteCode}`);

    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    const verifyCode = sendToGetVerCode(2, 20, email, data.token, customFrontUrl, customAdminUrl);
    if (!verifyCode) {
        console.error('[EmailRegisterByInviteWithCode] 邮箱邀请注册失败：未能获取到验证码');
        return null;
    }

    const codeStr = String(verifyCode).trim();
    console.log(`[EmailRegisterByInviteWithCode] 验证码: "${codeStr}"`);

    const api = "/api/Home/Register";
    const timeData = getTimeRandom();

    const payload = {
        userName: email,
        inviteCode: inviteCode,
        loginType: "Email",
        turnstileToken: turnstileToken,
        password: password,
        code: codeStr,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    console.log(`[EmailRegisterByInviteWithCode] 注册 payload:`, JSON.stringify(payload, null, 2));
    console.log(`[EmailRegisterByInviteWithCode] ⚠️  当前 ENV_CONFIG.BASE_DESK_URL = ${ENV_CONFIG.BASE_DESK_URL}`);

    let httpResponse;
    if (customRegisterUrl) {
        const fullUrl = customRegisterUrl + api;
        console.log(`[EmailRegisterByInviteWithCode] 使用自定义注册URL: ${fullUrl}`);
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        console.log(`[EmailRegisterByInviteWithCode] 使用默认注册URL: ${ENV_CONFIG.BASE_DESK_URL}${api}`);
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    console.log(`[EmailRegisterByInviteWithCode] 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);
    console.log(`[EmailRegisterByInviteWithCode] 响应体: ${httpResponse ? httpResponse.body : 'N/A'}`);

    return handleRegisterResponseWithToken(httpResponse, email);
}

/**
 * 通用埋点注册方式（发送验证码）(Event Identity Register)
 */
export function eventIdentityRegisterWithCode(userName, data, options = {}) {
    const {
        password = 'qwer1234',
        pixelId = 'D7GEL23C77U0PCJMRE8G',
        eventConfigId = 22,
        eventType = 6,
        packageName = 'com.ar3004.fb.app',
        registerUrl = null,
        customFrontUrl = null,
        inviteCode = ""
    } = options;

    console.log(`[EventRegisterWithCode] ========== 开始埋点注册流程（发送验证码，ID: ${eventConfigId}）==========`);

    const verifyCode = sendToGetVerCode(1, 1, userName, data.token, customFrontUrl);
    if (!verifyCode) return null;

    const codeStr = String(verifyCode).trim();
    const timeData = getTimeRandom();
    const deviceId = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api = "/api/Home/Register";

    const eventIdentityInfo = JSON.stringify({
        PixelId: pixelId,
        Fbp: "",
        Fbc: "",
        AdjustDeviceId: deviceId
    });

    const payload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
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
        language: "en",
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    const signPayload = {
        loginType: "Mobile",
        userName: userName,
        password: password,
        inviteCode: inviteCode,
        code: codeStr,
        captchaId: null,
        deviceId: deviceId,
        browserId: browserId,
        packageName: packageName,
        language: "en",
        random: timeData.random
    };

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    const httpResponse = registerUrl
        ? httpClient.post(api, payload, { fullUrl: registerUrl + api, sign: false }, true)
        : httpClient.post(api, payload, { sign: false }, true);

    return handleRegisterResponse(httpResponse, userName, deviceId);
}


// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 通用响应处理（返回 headers 直接来自响应）
 */
function handleRegisterResponse(httpResponse, userName, deviceId = null) {
    console.log(`[RegisterResponse] 状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);

    probeResponse(httpResponse, 'Register', {
        trendObj: PERF_METRICS.REGISTER,
        errorCounter: ERROR_COUNTERS.REGISTER_FAIL,
        successCheck: (r) => r && (r.code === 0 || r.msgCode === 0)
    });

    if (!httpResponse || !httpResponse.body) {
        _lastRegisterError = { type: 'network', code: null, msgCode: null, msg: '接口无响应' };
        console.error(`[RegisterResponse] ❌ 接口无响应`);
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        _lastRegisterError = { type: 'parse', code: null, msgCode: null, msg: e.message };
        console.error(`[RegisterResponse] ❌ 解析响应体失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;

    if (statusCode === 0) {
        _lastRegisterError = null;
        //console.log(`[RegisterResponse] ✅ 注册成功: ${userName}`);
        return {
            headers: httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg,
            ...(deviceId !== null && { deviceId })
        };
    } else {
        _lastRegisterError = { type: 'business', code: parsedBody.code ?? null, msgCode: parsedBody.msgCode ?? null, msg: parsedBody.msg || '' };
        console.error(`[RegisterResponse] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        console.error(`[RegisterResponse] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
        return null;
    }
}

/**
 * 带 token 提取的响应处理（邀请注册类优先用响应 data.token 构造 Authorization header）
 */
function handleRegisterResponseWithToken(httpResponse, userName) {
    console.log(`[RegisterResponse] 状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);

    probeResponse(httpResponse, 'Register', {
        trendObj: PERF_METRICS.REGISTER,
        errorCounter: ERROR_COUNTERS.REGISTER_FAIL,
        successCheck: (r) => r && (r.code === 0 || r.msgCode === 0)
    });

    if (!httpResponse || !httpResponse.body) {
        _lastRegisterError = { type: 'network', code: null, msgCode: null, msg: '接口无响应' };
        console.error(`[RegisterResponse] ❌ 接口无响应`);
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        _lastRegisterError = { type: 'parse', code: null, msgCode: null, msg: e.message };
        console.error(`[RegisterResponse] ❌ 解析响应体失败: ${e.message}`);
        return null;
    }

    //console.log(`[RegisterResponse] 解析后的响应: ${JSON.stringify(parsedBody, null, 2)}`);

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;

    if (statusCode === 0) {
        _lastRegisterError = null;
        //console.log(`[RegisterResponse] ✅ 注册成功: ${userName}`);
        const token = parsedBody.data && parsedBody.data.token ? parsedBody.data.token : null;
        return {
            headers: token ? { 'Authorization': `Bearer ${token}` } : httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg
        };
    } else {
        _lastRegisterError = { type: 'business', code: parsedBody.code ?? null, msgCode: parsedBody.msgCode ?? null, msg: parsedBody.msg || '' };
        console.error(`[RegisterResponse] ❌ 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        console.error(`[RegisterResponse] 完整错误响应: ${JSON.stringify(parsedBody, null, 2)}`);
        return null;
    }
}
