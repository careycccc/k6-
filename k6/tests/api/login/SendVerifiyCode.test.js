import { sleep } from 'k6';
import { tenantRequest, tenantQueryRequest } from '../../../libs/http/tenantRequest.js';

/**
 * 发送验证码
 * @param {number} verifyCodeType 
 * @param {string} userName 手机号码或邮箱
 * @param {number} codeType 验证码类型 18是登录验证 19是注册验证
 * @param {string} customFrontUrl - 自定义前台域名（可选，用于多租户）
 * @returns {object} 响应结果
 */
export function sendVerificationCode(verifyCodeType, userName, codeType, customFrontUrl = null) {
  console.log(`[SendVerificationCode] 发送验证码请求: ${userName}, verifyCodeType: ${verifyCodeType}, codeType: ${codeType}`);
  console.log(`[SendVerificationCode] customFrontUrl: ${customFrontUrl || '使用默认前台域名'}`);

  const response = tenantRequest('/api/Home/SendVerifiyCode', {
    verifyCodeType: verifyCodeType,
    phoneOrEmail: userName,
    codeType: codeType
  }, {
    isDesk: true
  });

  console.log(`[SendVerificationCode] 响应状态: ${response.status}`);
  console.log(`[SendVerificationCode] 响应msgCode: ${response.msgCode}`);
  console.log(`[SendVerificationCode] 响应msg: ${response.msg}`);
  console.log(`[SendVerificationCode] 完整响应体: ${JSON.stringify(response.raw)}`);

  if (response.msgCode === 0) {
    console.log(`[SendVerificationCode] ✅ 验证码发送成功: ${userName}`);
  } else {
    console.error(`[SendVerificationCode] ❌ 验证码发送失败: ${userName}, code=${response.msgCode}, msg=${response.msg}`);
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
 * 发送并获取验证码
 * @param {number} verifyCodeType 
 * @param {number} codeType 验证码类型 18是登录验证 1是注册验证. 2是邮箱验证
 * @param {string} userName 手机号码或邮箱
 * @param {string} adminToken 后台登录 token（必须从外部传入）
 * @param {string} customFrontUrl - 自定义前台域名（可选，用于多租户发送验证码）
 * @param {string} customAdminUrl - 自定义后台域名（可选，用于多租户查询验证码）
 * @returns {string|null} 验证码
 */
export function sendToGetVerCode(verifyCodeType, codeType, userName, adminToken, customFrontUrl = null, customAdminUrl = null) {
  console.log(`[SendVerifyCode] 发送验证码: ${userName}, codeType: ${codeType}`);

  const sendResponse = sendVerificationCode(verifyCodeType, userName, codeType, customFrontUrl);

  if (!adminToken) {
    console.error('[SendVerifyCode] 后台登录失败，无法获取验证码：adminToken 为空');
    return null;
  }

  // 检查发送响应
  if (sendResponse) {
    const sendCode = sendResponse.code !== undefined ? sendResponse.code : sendResponse.msgCode;
    if (sendCode !== 0) {
      console.error(`[SendVerifyCode] 验证码发送失败，无法继续: code=${sendCode}, msg=${sendResponse.msg}`);
      return null;
    }
  }

  // 等待验证码生成（2秒）
  console.log('[SendVerifyCode] 等待验证码生成（2秒）...');
  sleep(2);

  // 获取验证码（带重试机制）
  let verificationCode = getVerificationCode(userName, adminToken, codeType, customAdminUrl);

  // 如果第一次没获取到，再等待2秒重试一次
  if (!verificationCode) {
    console.log('[SendVerifyCode] 第一次未获取到验证码，等待2秒后重试...');
    sleep(2);
    verificationCode = getVerificationCode(userName, adminToken, codeType, customAdminUrl);
  }

  if (!verificationCode) {
    console.error(`[SendVerifyCode] ❌ 获取验证码失败: ${userName}`);
    return null;
  }

  console.log(`[SendVerifyCode] ✅ 验证码获取成功: ${userName} -> ${verificationCode}`);
  return verificationCode;
}
