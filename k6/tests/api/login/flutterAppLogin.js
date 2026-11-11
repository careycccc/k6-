/**
 * Flutter App 专属登录/注册方式
 *
 * ★ 2026-11-10 用户提供的真实 Flutter App 抓包（三组：验证码自动登录、密码登录、
 * 验证码自动注册），不是编造数据。核心发现：Flutter App 调用 /api/Home/
 * MobileAutoLogin、/api/Home/Login 时，跟项目里现有的 H5/浏览器版本（
 * MobileAutoLogin.test.js、desklogin.test.js、concurrentBindVerify.js 等）相比，
 * 关键字段完全不同：
 *
 *   字段            H5/浏览器版本(现有实现)        Flutter App 版本(本次实测)
 *   ────────────────────────────────────────────────────────────────────────
 *   packageName     ""（空）                      "com.ar3004.fb.app"（真实包名，按租户区分）
 *   deviceId        ""（空，/api/Home/Login）      "0befc06adaaace22"（16位十六进制设备指纹）
 *   browserId       随机32位（/api/Home/Login）    ""（空，与deviceId角色互换）
 *   registerDevice  ""（空，MobileAutoLogin）      "0befc06adaaace22"（同上，与deviceId同值）
 *   eventIdentity   不传此字段                     [{"eventConfigId":200060,"eventType":99}]
 *   isOnlyLogin     不传此字段（MobileAutoLogin）   false
 *
 * 这组对比目前是项目里第一个、也是唯一一个能把"这次登录/注册请求是不是来自 Flutter
 * App"跟"是不是来自 H5/浏览器"区分开的实锤证据——此前讨论"怎么判断会员下载/登录
 * 用的是 PWA、套壳包还是 Flutter App"时，全项目搜不到任何区分字段（packageName 在
 * 所有已知 H5 场景里都是空字符串），这次抓包补上了 Flutter 这一侧的证据。注意：
 * 套壳包是否也传非空 packageName、是否也带同一组 eventIdentity，本次未抓包验证，
 * 不能直接套用这个结论；只确认了"Flutter App 会传"这一件事。
 *
 * 另外两个字段只在 Flutter 版本的响应里见到过（H5 版本的现有代码从未解析过，不代表
 * H5 响应里一定没有这两个字段，只是没人验证/用过）：
 *   lotteryLoginUrl  直接给出 ARLottery 的游戏登录URL（带Token），如果要在 Flutter
 *                    场景下复用 runbet/betToken.js 的投注链路，这个字段可能可以
 *                    跳过单独调 GetGameUrl 这一步——未验证，待后续需要时再确认。
 *   webSocketUrl     形如 wss://wss-sit.mggametransit.com/event/realtime?Token=...
 *                    的实时推送地址，本次抓包未验证具体协议和用途。
 *
 * 真实抓包里的 token / refreshToken / signature 具体值不落库（敏感凭证，没有留档
 * 必要，且有效期从数小时到几十天不等，没有长期保存的意义）——这里只记录字段结构、
 * 取值规则和用途。
 *
 * 发验证码这一步（sendToGetVerCode 的 codeType=18）本次没有抓到 Flutter 独立的请求
 * 包，沿用现有 H5 版本一致的调用方式——没有证据表明这一步会因客户端类型不同而不同，
 * 也没有证据证明一定相同，如果后续验证码环节报错，应该优先怀疑这个假设。
 *
 * 用法：
 *   import { flutterAutoLoginFlow, flutterAutoLoginOrRegister, flutterPasswordLogin }
 *     from './flutterAppLogin.js';
 *
 *   // 验证码自动登录/注册（手机号没注册过会自动创建账号）
 *   const data = flutterAutoLoginFlow(phoneNumber, { token: adminToken });
 *   // data.token / data.userId / data.isNewRegister / data.lotteryLoginUrl / data.webSocketUrl
 *
 *   // 已知验证码，跳过发送步骤
 *   const data2 = flutterAutoLoginOrRegister(phoneNumber, verifyCode);
 *
 *   // 账号密码登录（账号必须已存在）
 *   const data3 = flutterPasswordLogin(phoneNumber, 'qwer1234');
 */

import { httpClient } from '../../../libs/http/client.js';
import { sendToGetVerCode } from './SendVerifiyCode.test.js';
import { getTimeRandom } from '../../utils/utils.js';

const TAG = 'FlutterAppLogin';

// 按租户维护的 Flutter App 包名；目前只实测过 3004 这一个，其它租户未验证，
// 没有配置时 getFlutterPackageName 会返回空字符串（退化成跟 H5 一样不可区分，
// 调用方应该自行判断这种情况是否可接受，不要假设空值也能通过业务校验）
const FLUTTER_PACKAGE_NAME_BY_TENANT = {
    '3004': 'com.ar3004.fb.app'
};

// Flutter 登录/注册请求固定携带的归因标记，三组真实抓包（验证码自动登录×1、
// 密码登录×1、验证码自动注册×1）里完全一致，很可能是后端判断"这是 Flutter App"
// 的关键依据之一（具体业务含义——这个 eventConfigId 在后台 EventConfig 里配置
// 的是什么——未做进一步确认，仅记录实测值）
const FLUTTER_EVENT_IDENTITY = [{ eventConfigId: 200060, eventType: 99 }];

/** 生成跟真实抓包格式一致的十六进制设备指纹（如 "0befc06adaaace22"，16个十六进制字符） */
function generateFlutterDeviceId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getFlutterPackageName(tenantId) {
    return FLUTTER_PACKAGE_NAME_BY_TENANT[String(tenantId)] || '';
}

/** 解析登录/注册响应，成功返回完整 data（含 token/refreshToken/lotteryLoginUrl/
 *  webSocketUrl/userId/isNewRegister 等全部字段），失败返回 null */
function handleFlutterLoginResponse(httpResponse, userName) {
    console.log(`[${TAG}] ${userName} 响应状态码: ${httpResponse ? httpResponse.status : 'N/A'}`);

    if (!httpResponse || !httpResponse.body) {
        console.error(`[${TAG}] ❌ ${userName} 接口无响应`);
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        console.error(`[${TAG}] ❌ ${userName} 解析响应体失败: ${e.message}`);
        return null;
    }

    if (parsedBody.msgCode === 0 && parsedBody.data && parsedBody.data.token) {
        return parsedBody.data;
    }

    console.error(`[${TAG}] ❌ ${userName} 失败: msgCode=${parsedBody.msgCode} msg=${parsedBody.msg}`);
    return null;
}

/**
 * Flutter App 专属：发送自动登录验证码（与 H5 版本共用同一个底层发送逻辑，
 * 见 MobileAutoLogin.test.js 的 sendMobileAutoLoginVerifyCode）
 * @param {string} phoneNumber
 * @param {object} data - 含 adminToken 的数据对象；data.forceTenant=true 时表示
 *   data.token 是商户自己登录拿到的（非集团token），避免被自动路由去集团域名
 * @returns {string|null} 验证码
 */
export function sendFlutterAutoLoginVerifyCode(phoneNumber, data) {
    console.log(`[${TAG}] 发送自动登录验证码，手机号:`, phoneNumber);
    const verifyCode = sendToGetVerCode(1, 18, phoneNumber, data.token, null, null, !!data.forceTenant);
    if (!verifyCode) {
        console.error(`[${TAG}] 获取自动登录验证码失败`);
        return null;
    }
    console.log(`[${TAG}] 验证码获取成功:`, verifyCode);
    return verifyCode;
}

/**
 * Flutter App 专属：验证码自动登录/注册（二合一）
 * 对应真实抓包：POST /api/Home/MobileAutoLogin
 * isOnlyLogin=false：手机号已注册过就直接登录，没注册过就自动创建账号再登录
 * （本次实测两种情况都验证过：已存在手机号返回 isNewRegister=false；全新手机号
 * 返回 isNewRegister=true，且这种情况下响应里 lotteryLoginUrl 是空字符串）
 * @param {string} userName - 手机号
 * @param {string} verifyCode - 验证码
 * @param {object} [options]
 * @param {string} [options.tenantId='3004'] - 决定 packageName 取哪个租户的包名
 * @param {boolean} [options.isOnlyLogin=false]
 * @returns {object|null} 成功返回完整 data，失败返回 null
 */
export function flutterAutoLoginOrRegister(userName, verifyCode, options = {}) {
    const tenantId = options.tenantId || '3004';
    const isOnlyLogin = options.isOnlyLogin || false;
    console.log(`[${TAG}] 开始 Flutter 自动登录/注册，用户:${userName} isOnlyLogin:${isOnlyLogin}`);

    const api = '/api/Home/MobileAutoLogin';
    const timeData = getTimeRandom();
    // eventIdentity 不参与签名计算——沿用项目里其他含 eventIdentity 接口的既有规则
    // （facebookRegister.js/adjustRegister.js 同款模式）：先用不含 eventIdentity 的
    // signPayload 算出签名，再把签名结果塞进完整 payload，用 {sign:false} 禁止
    // httpClient.post 内部再次自动签名（否则会把 eventIdentity 也纳入签名计算，
    // 跟服务端预期不一致，报 msgCode=3 Wrong signature——已实测踩过这个坑）。
    const signPayload = {
        userName,
        verifyCode,
        registerDevice: generateFlutterDeviceId(),
        isOnlyLogin,
        packageName: getFlutterPackageName(tenantId),
        language: timeData.language,
        random: timeData.random
    };
    const payload = { ...signPayload, eventIdentity: FLUTTER_EVENT_IDENTITY };

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    const httpResponse = httpClient.post(api, payload, { sign: false }, true);
    const data = handleFlutterLoginResponse(httpResponse, userName);
    if (data) {
        console.log(`[${TAG}] ✅ 登录/注册成功 isNewRegister=${data.isNewRegister} userId=${data.userId}`);
    }
    return data;
}

/**
 * Flutter App 专属：账号密码登录
 * 对应真实抓包：POST /api/Home/Login
 * 跟现有 H5 版本（desklogin.test.js、concurrentBindVerify.js 等）的核心差异：
 * deviceId/browserId 角色互换（Flutter 传真实 deviceId、browserId 留空；
 * H5 传随机生成的 browserId、deviceId 留空）
 * @param {string} userName - 手机号
 * @param {string} password
 * @param {object} [options]
 * @param {string} [options.tenantId='3004']
 * @returns {object|null} 成功返回完整 data，失败返回 null
 */
export function flutterPasswordLogin(userName, password, options = {}) {
    const tenantId = options.tenantId || '3004';
    console.log(`[${TAG}] 开始 Flutter 密码登录，用户:${userName}`);

    const api = '/api/Home/Login';
    const timeData = getTimeRandom();
    // eventIdentity 不参与签名，做法同 flutterAutoLoginOrRegister
    const signPayload = {
        loginType: 'Mobile',
        userName,
        deviceId: generateFlutterDeviceId(),
        browserId: '',
        password,
        packageName: getFlutterPackageName(tenantId),
        language: timeData.language,
        random: timeData.random
    };
    const payload = { ...signPayload, eventIdentity: FLUTTER_EVENT_IDENTITY };

    const signClient = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature = signedParams.signature;
    payload.timestamp = signedParams.timestamp;

    const httpResponse = httpClient.post(api, payload, { sign: false }, true);
    const data = handleFlutterLoginResponse(httpResponse, userName);
    if (data) {
        console.log(`[${TAG}] ✅ 密码登录成功 userId=${data.userId}`);
    }
    return data;
}

/**
 * 完整流程：发验证码 → Flutter 自动登录/注册
 * @param {string} phoneNumber
 * @param {object} data - 含 adminToken（同 sendFlutterAutoLoginVerifyCode 用法）
 * @param {object} [options] - 透传给 flutterAutoLoginOrRegister
 * @returns {object|null} 成功返回完整 data，失败返回 null
 */
export function flutterAutoLoginFlow(phoneNumber, data, options = {}) {
    console.log(`[${TAG}] 开始完整的 Flutter 自动登录/注册流程`);

    const verifyCode = sendFlutterAutoLoginVerifyCode(phoneNumber, data);
    if (!verifyCode) {
        console.error(`[${TAG}] 验证码获取失败，无法继续登录`);
        return null;
    }

    return flutterAutoLoginOrRegister(phoneNumber, verifyCode, options);
}
