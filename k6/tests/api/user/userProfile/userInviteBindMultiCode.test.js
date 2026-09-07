/**
 * 单账号并发绑定多个邀请码 - 竞态条件测试
 * POST api/User/UserInviteBind
 *
 * 测试目的：
 *   同一个账号在同一时刻并发向多个邀请码发起绑定，
 *   验证服务端是否存在竞态问题（绑定多个上级、数据错乱等）。
 *
 * 流程：
 *   setup  → 账号验证码登录一次，获得 userToken
 *   VU阶段 → 每个 VU 共用同一个 token，各持一个邀请码，同时发起绑定
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004  -e USERNAME=916001199743 -e INVITE_CODES=LX7ZUPN,G5TZ64N,BCFYFHN userInviteBindMultiCode.test.js
 *
 * 环境变量：
 *   TENANT_ID    租户ID（默认 3004）
 *   USERNAME     前台账号（手机号或邮箱，必填）
 *   INVITE_CODES 逗号分隔的邀请码列表（至少 2 个，必填）
 */

import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../userAccountApi.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

// ================================================================
// 解析邀请码列表，动态决定 VU 数
// ================================================================

const rawCodes    = __ENV.INVITE_CODES || '';
const inviteCodeList = rawCodes
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const vuCount = inviteCodeList.length;

if (vuCount < 2) {
  throw new Error('请通过 -e INVITE_CODES=码1,码2,... 传入至少 2 个邀请码');
}

// ================================================================
// K6 选项：VU 数 = 邀请码数，所有 VU 同时只跑 1 次
// ================================================================

export const options = {
  scenarios: {
    concurrent_multi_code_bind: {
      executor:    'per-vu-iterations',
      vus:         vuCount,
      iterations:  1,
      maxDuration: '10m',
    },
  },
};

// ================================================================
// 工具函数
// ================================================================

function postWithToken(api, bizPayload, userToken) {
  const { timestamp, random, language } = getTimeRandom();
  const payload = { language, random, timestamp, signature: '', ...bizPayload };
  httpClient.setAuthToken(userToken);
  return httpClient.post(api, payload, {}, true);
}

function printResponse(label, response) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${label}] HTTP ${response.status}`);
  //console.log(`[${label}] 完整响应：`);
  console.log(response.body);
  console.log(`${'─'.repeat(60)}`);
}

// ================================================================
// Setup：只登录一次，把同一个 token 分发给所有 VU
// ================================================================

export function setup() {
  const tenantId = __ENV.TENANT_ID || '3004';
  const userName = __ENV.USERNAME  || '';

  if (!userName) throw new Error('[Setup] 请通过 -e USERNAME=<账号> 指定前台账号');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Setup] 单账号并发多邀请码绑定测试`);
  console.log(`[Setup] 租户: ${tenantId} | 账号: ${userName}`);
  console.log(`[Setup] 邀请码数（并发数）: ${vuCount}`);
  console.log(`[Setup] 邀请码列表: ${inviteCodeList.join(', ')}`);
  console.log(`${'='.repeat(60)}\n`);

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  // 管理员登录（查验证码用）
  const adminToken = tenantAdminLogin(tenantId);
  if (!adminToken) throw new Error('[Setup] 管理员登录失败');
  console.log('[Setup] ✅ 管理员登录成功');

  // 账号只登录一次
  const userToken = autoLoginByAccount(userName, adminToken);
  if (!userToken) throw new Error(`[Setup] 前台登录失败: ${userName}`);
  console.log(`[Setup] ✅ 前台登录成功: ${userName}`);
  console.log(`[Setup] 同一 token 将被 ${vuCount} 个 VU 并发使用\n`);

  return {
    tenantId,
    userName,
    userToken,            // 所有 VU 共享同一个 token
    inviteCodes: inviteCodeList,
  };
}

// ================================================================
// VU 主逻辑：所有 VU 共用同一 token，各自绑定不同邀请码
// ================================================================

export default function (data) {
  const { tenantId, userName, userToken, inviteCodes } = data;

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  // VU id 从 1 开始，映射到邀请码数组 index
  const idx        = exec.vu.idInInstance - 1;
  const inviteCode = inviteCodes[idx];

  if (!inviteCode) {
    console.error(`[VU ${exec.vu.idInInstance}] 邀请码不存在，跳过`);
    return;
  }

  // 对齐所有 VU，尽量同一时刻发起请求
  sleep(0);

  const startMs = Date.now();
  console.log(`[VU ${exec.vu.idInInstance}] → 发起绑定 | 账号: ${userName} | inviteCode: ${inviteCode} | t=${startMs}`);

  const res    = postWithToken('/api/User/UserInviteBind', { inviteCode }, userToken);
  const costMs = Date.now() - startMs;

  printResponse(`VU${exec.vu.idInInstance} UserInviteBind(${inviteCode})`, res);
  console.log(`[VU ${exec.vu.idInInstance}] 耗时: ${costMs}ms | inviteCode: ${inviteCode}`);

  const body = JSON.parse(res.body);
  check(body, {
    [`VU${exec.vu.idInInstance}(${inviteCode}) HTTP 200`]:  () => res.status === 200,
    [`VU${exec.vu.idInInstance}(${inviteCode}) code=1`]:    (b) => b.code === 1,
    [`VU${exec.vu.idInInstance}(${inviteCode}) msgCode=0`]: (b) => b.msgCode === 0,
  });
}
