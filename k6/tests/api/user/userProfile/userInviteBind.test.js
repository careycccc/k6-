/**
 * 自助绑定上级邀请码
 * POST api/User/UserInviteBind
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e USERNAME=912026060900 -e INVITE_CODE=7K2VFCN userInviteBind.test.js
 *
 * 环境变量：
 *   TENANT_ID   租户ID（默认 3004）
 *   USERNAME    前台用户账号（手机号或邮箱，必填）
 *   INVITE_CODE 上级邀请码（必填）
 */

import { check } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../userAccountApi.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

export const options = {
  scenarios: {
    invite_bind: {
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
  const tenantId  = __ENV.TENANT_ID   || '3004';
  const userName  = __ENV.USERNAME    || '';
  const inviteCode = __ENV.INVITE_CODE || '';

  if (!userName)   throw new Error('[Setup] 请通过 -e USERNAME=<账号> 指定前台账号');
  if (!inviteCode) throw new Error('[Setup] 请通过 -e INVITE_CODE=<邀请码> 指定上级邀请码');

  console.log(`\n${'='.repeat(55)}`);
  console.log(`[Setup] UserInviteBind | 租户: ${tenantId} | 账号: ${userName} | inviteCode: ${inviteCode}`);
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
  return { tenantId, userName, userToken, inviteCode };
}

export default function (data) {
  const { tenantId, userName, userToken, inviteCode } = data;

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  console.log(`\n[UserInviteBind] 账号: ${userName} | inviteCode: ${inviteCode}`);

  const res = postWithToken('/api/User/UserInviteBind', { inviteCode }, userToken);
  printResponse('UserInviteBind', res);

  const body = JSON.parse(res.body);
  check(body, {
    'code=1':    (b) => b.code === 1,
    'msgCode=0': (b) => b.msgCode === 0,
  });
}
