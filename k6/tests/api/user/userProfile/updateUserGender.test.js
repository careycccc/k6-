/**
 * 更新用户性别
 * POST api/User/UpdateUserGender
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e USERNAME=915564162732 -e GENDER=1 updateUserGender.test.js
 *
 * 环境变量：
 *   TENANT_ID  租户ID（默认 3004）
 *   USERNAME   前台用户账号（手机号或邮箱，必填）
 *   GENDER     性别值，0=男 1=女（必填）
 */

import { check } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../userAccountApi.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

export const options = {
  scenarios: {
    update_gender: {
      executor:    'per-vu-iterations',
      vus:         1,
      iterations:  1,
      maxDuration: '5m',
    },
  },
};

function postWithToken(api, bizPayload, userToken) {
  const { timestamp, random, language } = getTimeRandom();
  const payload = { language, random, timestamp, signature: '', ...bizPayload };
  httpClient.setAuthToken(userToken);
  return httpClient.post(api, payload, {}, true);
}

function printResponse(label, response) {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`[${label}] HTTP ${response.status}`);
  console.log(`[${label}] 完整响应：`);
  console.log(response.body);
  console.log(`${'─'.repeat(55)}`);
}

export function setup() {
  const tenantId = __ENV.TENANT_ID || '3004';
  const userName = __ENV.USERNAME  || '';
  const gender   = __ENV.GENDER    !== undefined ? parseInt(__ENV.GENDER, 10) : null;

  if (!userName) throw new Error('[Setup] 请通过 -e USERNAME=<账号> 指定前台账号');
  if (gender === null) throw new Error('[Setup] 请通过 -e GENDER=0 或 -e GENDER=1 指定性别');

  console.log(`\n${'='.repeat(55)}`);
  console.log(`[Setup] UpdateUserGender | 租户: ${tenantId} | 账号: ${userName} | gender: ${gender}`);
  console.log(`${'='.repeat(55)}\n`);

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  const adminToken = tenantAdminLogin(tenantId);
  if (!adminToken) throw new Error('[Setup] 管理员登录失败');

  const userToken = autoLoginByAccount(userName, adminToken);
  if (!userToken) throw new Error(`[Setup] 前台登录失败: ${userName}`);

  console.log(`[Setup] ✅ 登录成功: ${userName}\n`);
  return { tenantId, userName, userToken, gender };
}

export default function (data) {
  const { tenantId, userName, userToken, gender } = data;

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  console.log(`\n[UpdateUserGender] 账号: ${userName} | gender: ${gender}`);

  const res = postWithToken('/api/User/UpdateUserGender', { gender }, userToken);
  printResponse('UpdateUserGender', res);

  const body = JSON.parse(res.body);
  check(body, {
    'code=1':    (b) => b.code === 1,
    'msgCode=0': (b) => b.msgCode === 0,
  });
}
