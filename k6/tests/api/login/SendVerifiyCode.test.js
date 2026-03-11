import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';

/**
 * 发送验证码
 * @param {number} verifyCodeType 
 * @param {string} userName 手机号码或邮箱
 * @param {number} codeType 验证码类型 18是登录验证 1是注册验证
 * @returns {object} 响应结果 (token 或 data 或 result)
 */
export function sendVerificationCode(verifyCodeType, userName, codeType) {
  const api = '/api/Home/SendVerifiyCode';
  const payload = {
    verifyCodeType: verifyCodeType,
    phoneOrEmail: userName,
    codeType: codeType
  };

  // 前台请求发送验证码，isDesk = true
  return sendRequest(payload, api, 'SendVerifiyCode', true, '');
}

/**
 * 获取验证码 (后台查询)
 * @param {string} userName 手机号码或邮箱 
 * @param {string} adminToken 后台登录 token
 * @returns {string|null} 验证码，如果未找到则返回 null
 */
export function getVerificationCode(userName, adminToken) {
  const api = '/api/Users/GetVerifyCodePageList';
  const payload = {
    mobileOrEmail: userName
  };

  // 后台查询验证码，isDesk = false
  const responseData = sendQueryRequest(payload, api, 'GetVerifyCodePageList', false, adminToken);

  if (responseData && responseData.list && responseData.list.length > 0) {
    return responseData.list[0].number;
  }
  return null;
}

/**
 * 发送并获取验证码
 * @param {number} verifyCodeType 
 * @param {number} codeType 验证码类型 18是登录验证 1是注册验证. 2是邮箱验证
 * @param {string} userName 手机号码或邮箱
 * @param {string} adminToken 后台登录 token（必须从外部传入）
 * @returns {string|null} 验证码
 */
export function sendToGetVerCode(verifyCodeType, codeType, userName, adminToken) {
  // 1. 发送验证码
  sendVerificationCode(verifyCodeType, userName, codeType);

  if (!adminToken) {
    console.error('后台登录失败，无法获取验证码：adminToken 为空');
    return null;
  }

  // 等待验证码生成，避免查询过快 (与 Go 代码中 time.Sleep 对应)
  sleep(2);

  // 2. 获取验证码
  const verficationCode = getVerificationCode(userName, adminToken);

  return verficationCode;
}
