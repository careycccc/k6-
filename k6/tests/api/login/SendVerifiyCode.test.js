import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom } from '../../utils/utils.js';

/**
 * 发送验证码
 * @param {number} verifyCodeType 
 * @param {string} userName 手机号码或邮箱
 * @param {number} codeType 验证码类型 18是登录验证 1是注册验证
 * @param {string} customFrontUrl - 自定义前台域名（可选，用于多租户）
 * @returns {object} 响应结果 (token 或 data 或 result)
 */
export function sendVerificationCode(verifyCodeType, userName, codeType, customFrontUrl = null) {
  const api = '/api/Home/SendVerifiyCode';
  const timeData = getTimeRandom();

  const payload = {
    verifyCodeType: verifyCodeType,
    phoneOrEmail: userName,
    codeType: codeType,
    language: timeData.language,
    random: timeData.random,
    signature: '',
    timestamp: timeData.timestamp
  };

  console.log(`[SendVerificationCode] 发送验证码请求: ${userName}, verifyCodeType: ${verifyCodeType}, codeType: ${codeType}`);

  // 前台请求发送验证码，isDesk = true
  let response;
  if (customFrontUrl) {
    // 使用自定义前台域名

    const fullUrl = customFrontUrl + api;
    console.log(`[SendVerificationCode] 使用自定义前台域名: ${fullUrl}`);

    const httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    if (httpResponse && httpResponse.body) {
      response = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    }
  } else {
    // 使用默认域名
    response = sendRequest(payload, api, 'SendVerifiyCode', true, '');
  }

  // 检查发送结果
  if (response) {
    const statusCode = response.code !== undefined ? response.code : response.msgCode;
    if (statusCode === 0) {
      console.log(`[SendVerificationCode] ✅ 验证码发送成功: ${userName}`);
    } else {
      console.error(`[SendVerificationCode] ❌ 验证码发送失败: ${userName}, code=${statusCode}, msg=${response.msg}`);
    }
  }

  return response;
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
  const api = '/api/Users/GetVerifyCodePageList';
  const payload = {
    mobileOrEmail: userName,
    pageNo: 1,
    pageSize: 20,
    orderBy: 'Desc'
  };

  console.log(`[GetVerifyCode] 查询验证码: ${userName}, 期望codeType: ${expectedCodeType}`);
  console.log(`[GetVerifyCode] Debug - adminToken存在: ${!!adminToken}, 长度: ${adminToken ? adminToken.length : 0}`);

  // 后台查询验证码，isDesk = false
  let responseData;
  if (customAdminUrl) {
    // 使用自定义后台域名 - 需要手动构建完整的请求数据
    const fullUrl = customAdminUrl + api;
    console.log(`[GetVerifyCode] 使用自定义后台域名: ${fullUrl}`);

    // 设置 token 后再发送请求
    if (adminToken) {
      httpClient.setAuthToken(adminToken);
      console.log(`[GetVerifyCode] Debug - Authorization header已设置: ${httpClient.defaultHeaders['Authorization'] ? 'yes' : 'no'}`);
    } else {
      console.error(`[GetVerifyCode] Debug - adminToken为空，无法设置认证头`);
    }

    // ✅ 添加 random、timestamp、signature（与 sendQueryRequest 保持一致）
    const timeData = getTimeRandom();
    const fullPayload = {
      ...payload,
      random: timeData.random,
      language: timeData.language,
      signature: '',
      timestamp: timeData.timestamp
    };

    const httpResponse = httpClient.post(api, fullPayload, { fullUrl: fullUrl }, false);

    console.log(`[GetVerifyCode] Debug - 响应状态: ${httpResponse ? httpResponse.status : 'null'}`);

    if (httpResponse && httpResponse.body) {
      responseData = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    }
  } else {
    // 使用默认域名
    responseData = sendQueryRequest(payload, api, 'GetVerifyCodePageList', false, adminToken);
  }

  // 检查响应
  if (!responseData) {
    console.error(`[GetVerifyCode] 查询验证码失败：响应为空, 账号: ${userName}`);
    return null;
  }

  // 响应可能是完整响应 {code, data, msg} 或者直接是 data 部分
  let dataObj = responseData;

  // 如果响应包含 code/msgCode 字段，说明是完整响应，需要提取 data
  if (responseData.code !== undefined || responseData.msgCode !== undefined) {
    const statusCode = responseData.code !== undefined ? responseData.code : responseData.msgCode;
    if (statusCode !== 0) {
      console.error(`[GetVerifyCode] 查询验证码失败: code=${statusCode}, msg=${responseData.msg}, 账号: ${userName}`);
      return null;
    }
    dataObj = responseData.data;
  }

  // 检查 list 数据
  if (!dataObj || !dataObj.list || dataObj.list.length === 0) {
    console.error(`[GetVerifyCode] 未找到验证码: ${userName}`);
    return null;
  }

  // 查找匹配的验证码：
  // 1. 如果指定了 expectedCodeType，则必须匹配 codeType
  // 2. 检查验证码是否过期
  // 3. 取最新的（list[0]，因为已按时间倒序排列）
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

  const verifyCode = String(verifyCodeItem.number); // 确保是字符串类型

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
  // 1. 发送验证码
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

  // 2. 获取验证码（带重试机制，传入 codeType 进行匹配）
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
