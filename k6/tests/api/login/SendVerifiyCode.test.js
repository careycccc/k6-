import { sleep } from 'k6';
import http from 'k6/http';
import { tenantRequest, tenantQueryRequest } from '../../../libs/http/tenantRequest.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { getTimeRandom } from '../../utils/utils.js';
import { getTenantVerifyCodeLanguages } from '../../../config/tenantLanguageConfig.js';

/**
 * 发送验证码
 * @param {number} verifyCodeType
 * @param {string} userName 手机号码或邮箱
 * @param {number} codeType 验证码类型 19=邀请注册手机 20=邀请注册邮箱
 * @param {string} customFrontUrl - 自定义前台域名（邀请注册时传入专用域名）
 * @param {string} [language] - 指定语言（不传则从 getTimeRandom 获取）
 * @returns {object} 响应结果
 */
export function sendVerificationCode(verifyCodeType, userName, codeType, customFrontUrl = null, language = null) {
  console.log(`[SendVerificationCode] 发送验证码请求: ${userName}, verifyCodeType: ${verifyCodeType}, codeType: ${codeType}`);
  console.log(`[SendVerificationCode] customFrontUrl: ${customFrontUrl || '使用默认前台域名'}`);

  let response;

  if (customFrontUrl) {
    const url = `${customFrontUrl}/api/Home/SendVerifiyCode`;
    console.log(`[SendVerificationCode] 使用自定义域名发送: ${url}`);

    const timeData = getTimeRandom();

    // 语言优先级：外部传入 > getTimeRandom 随机
    let lang = language || timeData.language;
    if (language) {
      console.log(`[SendVerificationCode] 使用指定语言: ${lang}`);
    }

    const payload = {
      verifyCodeType: verifyCodeType,
      phoneOrEmail: userName,
      codeType: codeType,
      random: timeData.random,
      language: lang,
      timestamp: timeData.timestamp
    };

    const signClient = new SignedHttpClient();
    const signedPayload = signClient.signData(payload);

    const headers = {
      'Content-Type': 'application/json',
      'Domainurl': customFrontUrl,
      'Referrer': customFrontUrl
    };

    console.log(`[SendVerificationCode] 签名后payload: ${JSON.stringify(signedPayload, null, 2)}`);

    const rawResp = http.post(url, JSON.stringify(signedPayload), { headers });
    console.log(`[SendVerificationCode] 响应状态: ${rawResp.status}`);
    console.log(`[SendVerificationCode] 完整响应体: ${rawResp.body}`);

    let parsedBody = null;
    try {
      parsedBody = rawResp.body ? JSON.parse(rawResp.body) : null;
    } catch (e) {
      console.error(`[SendVerificationCode] 响应解析失败: ${e.message}`);
    }

    const msgCode = parsedBody ? (parsedBody.msgCode !== undefined ? parsedBody.msgCode : parsedBody.code) : null;
    const msg = parsedBody ? parsedBody.msg : null;

    console.log(`[SendVerificationCode] 响应msgCode: ${msgCode}`);
    console.log(`[SendVerificationCode] 响应msg: ${msg}`);

    if (msgCode === 0) {
      console.log(`[SendVerificationCode] ✅ 验证码发送成功: ${userName} (language=${lang})`);
    } else {
      console.error(`[SendVerificationCode] ❌ 验证码发送失败: ${userName}, code=${msgCode}, msg=${msg} (language=${lang})`);
    }

    return parsedBody;
  }

  // 无自定义域名：走原来的 tenantRequest 逻辑
  const timeData = getTimeRandom();
  const lang = language || timeData.language;

  response = tenantRequest('/api/Home/SendVerifiyCode', {
    verifyCodeType: verifyCodeType,
    phoneOrEmail: userName,
    codeType: codeType,
    language: lang
  }, {
    isDesk: true
  });

  console.log(`[SendVerificationCode] 响应状态: ${response.status}`);
  console.log(`[SendVerificationCode] 响应msgCode: ${response.msgCode}`);
  console.log(`[SendVerificationCode] 响应msg: ${response.msg}`);
  console.log(`[SendVerificationCode] 完整响应体: ${JSON.stringify(response.raw)}`);

  if (response.msgCode === 0) {
    console.log(`[SendVerificationCode] ✅ 验证码发送成功: ${userName} (language=${lang})`);
  } else {
    console.error(`[SendVerificationCode] ❌ 验证码发送失败: ${userName}, code=${response.msgCode}, msg=${response.msg} (language=${lang})`);
  }

  return response.raw;
}

/**
 * 获取验证码 (后台查询)
 * @param {string} userName 手机号码或邮箱 
 * @param {string} adminToken 后台登录 token
 * @param {number} expectedCodeType - 期望的验证码类型
 * @param {string} customAdminUrl - 自定义后台域名（可选，用于多租户）
 * @returns {string|null} 验证码，如果未找到则返回 null
 */
export function getVerificationCode(userName, adminToken, expectedCodeType = null, customAdminUrl = null) {
  console.log(`[GetVerifyCode] 查询验证码: ${userName}, 期望codeType: ${expectedCodeType}`);

  const response = tenantQueryRequest('/api/Users/GetVerifyCodePageList', {
    mobileOrEmail: userName
  }, {
    isDesk: false,
    token: adminToken
  });

  if (response.msgCode !== 0) {
    console.error(`[GetVerifyCode] 查询验证码失败: code=${response.msgCode}, msg=${response.msg}, 账号: ${userName}`);
    return null;
  }

  const dataObj = response.data;
  if (!dataObj || !dataObj.list || dataObj.list.length === 0) {
    console.error(`[GetVerifyCode] 未找到验证码: ${userName}`);
    return null;
  }

  // 查找匹配的验证码
  let verifyCodeItem = null;
  const currentTime = Date.now();

  for (let i = 0; i < dataObj.list.length; i++) {
    const item = dataObj.list[i];
    const isExpired = item.expirationTime && currentTime > item.expirationTime;

    console.log(`[GetVerifyCode] 检查验证码 [${i}]: number=${item.number}, codeType=${item.codeType}, createTime=${item.createTime}, expirationTime=${item.expirationTime}, 是否过期=${isExpired}`);

    // 如果指定了 expectedCodeType，必须匹配
    if (expectedCodeType !== null && item.codeType !== expectedCodeType) {
      console.log(`[GetVerifyCode] 跳过: codeType不匹配 (期望${expectedCodeType}, 实际${item.codeType})`);
      continue;
    }

    // 检查是否过期
    if (isExpired) {
      console.log(`[GetVerifyCode] 跳过: 验证码已过期`);
      continue;
    }

    // 找到第一个匹配且未过期的验证码
    verifyCodeItem = item;
    console.log(`[GetVerifyCode] 找到有效验证码: ${item.number}`);
    break;
  }

  if (!verifyCodeItem) {
    console.error(`[GetVerifyCode] 未找到有效验证码: ${userName}, expectedCodeType: ${expectedCodeType}`);
    return null;
  }

  const verifyCode = String(verifyCodeItem.number);
  console.log(`[GetVerifyCode] ✅ 获取验证码成功: ${userName} -> ${verifyCode} (类型: ${typeof verifyCode}, codeType: ${verifyCodeItem.codeType})`);

  return verifyCode;
}

/**
 * 发送并获取验证码（支持多语言降级重试）
 *
 * 语言优先级从 TENANT_VERIFYCODE_LANGUAGES 读取，按顺序逐个尝试：
 *   - 某个语言发送成功 → 继续获取验证码
 *   - 某个语言发送失败 → 自动切换下一个语言重试
 *   - 全部语言失败 → 返回 null（真正的错误）
 *
 * @param {number} verifyCodeType
 * @param {number} codeType 验证码类型 18=登录 1=注册 2=邮箱验证
 * @param {string} userName 手机号码或邮箱
 * @param {string} adminToken 后台登录 token
 * @param {string} customFrontUrl - 自定义前台域名（可选）
 * @param {string} customAdminUrl - 自定义后台域名（可选）
 * @returns {string|null} 验证码
 */
export function sendToGetVerCode(verifyCodeType, codeType, userName, adminToken, customFrontUrl = null, customAdminUrl = null) {
  console.log(`[SendVerifyCode] 发送验证码: ${userName}, codeType: ${codeType}`);

  if (!adminToken) {
    console.error('[SendVerifyCode] 后台登录失败，无法获取验证码：adminToken 为空');
    return null;
  }

  // 获取当前租户的验证码语言优先级列表
  const tenantId = typeof __ENV !== 'undefined' ? __ENV.TENANT_ID : null;
  const langList = getTenantVerifyCodeLanguages(tenantId);
  console.log(`[SendVerifyCode] 租户 ${tenantId || 'default'} 验证码语言优先级: [${langList.join(', ')}]`);

  for (let i = 0; i < langList.length; i++) {
    const lang = langList[i];
    const isLastLang = i === langList.length - 1;

    console.log(`[SendVerifyCode] 尝试语言 [${i + 1}/${langList.length}]: ${lang}`);

    const sendResponse = sendVerificationCode(verifyCodeType, userName, codeType, customFrontUrl, lang);

    if (!sendResponse) {
      console.error(`[SendVerifyCode] language=${lang}: 接口无响应或返回非JSON格式`);
      if (!isLastLang) {
        console.warn(`[SendVerifyCode] 切换到下一个语言重试...`);
        continue;
      }
      return null;
    }

    const sendCode = sendResponse.code !== undefined ? sendResponse.code : sendResponse.msgCode;
    if (sendCode !== 0) {
      console.warn(`[SendVerifyCode] language=${lang} 发送失败: code=${sendCode}, msg=${sendResponse.msg}`);
      if (!isLastLang) {
        console.warn(`[SendVerifyCode] 切换到下一个语言重试...`);
        continue;
      }
      console.error(`[SendVerifyCode] ❌ 所有语言均发送失败，真正的错误: ${userName}`);
      return null;
    }

    // 发送成功，等待验证码生成
    console.log(`[SendVerifyCode] language=${lang} 发送成功，等待验证码生成（2秒）...`);
    sleep(2);

    let verificationCode = getVerificationCode(userName, adminToken, codeType, customAdminUrl);

    if (!verificationCode) {
      console.log('[SendVerifyCode] 第一次未获取到验证码，等待2秒后重试...');
      sleep(2);
      verificationCode = getVerificationCode(userName, adminToken, codeType, customAdminUrl);
    }

    if (!verificationCode) {
      console.error(`[SendVerifyCode] ❌ 获取验证码失败: ${userName}`);
      return null;
    }

    console.log(`[SendVerifyCode] ✅ 验证码获取成功: ${userName} -> ${verificationCode} (language=${lang})`);
    return verificationCode;
  }

  return null;
}
