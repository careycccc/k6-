/**
 * 获取用户信息
 * POST api/User/GetUserInfo
 *
 * 响应新增字段（向后兼容）：
 *   gender          - 性别，0=男 1=女
 *   parentInviteCode - 上级邀请码；无上级时为空串 ""
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e USERNAME=916043957059 getUserInfo.test.js
 *
 * 环境变量：
 *   TENANT_ID  租户ID（默认 3004）
 *   USERNAME   前台用户账号（手机号或邮箱，必填）
 */

import { check } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../userAccountApi.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

export const options = {
  scenarios: {
    get_user_info: {
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
  //console.log(`[${label}] 完整响应：`);
  console.log(response.body);
  console.log(`${'─'.repeat(55)}`);
}

export function setup() {
  const tenantId = __ENV.TENANT_ID || '3004';
  const userName = __ENV.USERNAME  || '';

  if (!userName) throw new Error('[Setup] 请通过 -e USERNAME=<账号> 指定前台账号');

  console.log(`\n${'='.repeat(55)}`);
  console.log(`[Setup] GetUserInfo | 租户: ${tenantId} | 账号: ${userName}`);
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
  return { tenantId, userName, userToken };
}

export default function (data) {
  const { tenantId, userName, userToken } = data;

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  console.log(`\n[GetUserInfo] 账号: ${userName}`);

  const res = postWithToken('/api/User/GetUserInfo', {}, userToken);
  printResponse('GetUserInfo', res);

  const body = JSON.parse(res.body);
  check(body, {
    'code=1':                          (b) => b.code === 1,
    'data.gender 存在':                (b) => b.data && b.data.gender !== undefined,
    'data.gender 合法 (0=男 / 1=女)':  (b) => b.data && (b.data.gender === 0 || b.data.gender === 1),
    'data.parentInviteCode 存在':      (b) => b.data && b.data.parentInviteCode !== undefined,
    'data.parentInviteCode 为字符串':  (b) => b.data && typeof b.data.parentInviteCode === 'string',
  });
}
