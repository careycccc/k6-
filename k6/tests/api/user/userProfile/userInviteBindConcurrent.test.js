/**
 * 并发绑定上级邀请码 - 竞态条件测试
 * POST api/User/UserInviteBind
 *
 * 测试目的：
 *   多个账号在同一时刻同时向同一个邀请码发起绑定，
 *   验证服务端是否存在竞态问题（重复绑定、数据错乱等）。
 *
 * 流程：
 *   setup  → 串行为每个账号完成验证码登录，收集 token 列表
 *   VU阶段 → 每个 VU 持有一个账号的 token，
 *             所有 VU 在 startTime 倒计时结束后同时发起绑定请求
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e USERNAMES=915257296098 -e INVITE_CODE=138351 userInviteBindConcurrent.test.js
 *
 * 环境变量：
 *   TENANT_ID   租户ID（默认 3004）
 *   USERNAMES   逗号分隔的账号列表（手机号或邮箱，至少2个）
 *   INVITE_CODE 目标邀请码（必填）
 */

import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../userAccountApi.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';

// ================================================================
// 解析账号列表，动态决定 VU 数
// ================================================================

const rawUsernames = __ENV.USERNAMES || '';
const usernameList = rawUsernames
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const vuCount = usernameList.length;

if (vuCount < 2) {
  throw new Error('请通过 -e USERNAMES=账号1,账号2,... 传入至少 2 个账号');
}

// ================================================================
// K6 选项：VU 数 = 账号数，所有 VU 同时只跑 1 次
// ================================================================

export const options = {
  scenarios: {
    concurrent_invite_bind: {
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
  console.log(`[${label}] 完整响应：`);
  console.log(response.body);
  console.log(`${'─'.repeat(60)}`);
}

// ================================================================
// Setup：串行登录所有账号，收集 token 列表
// ================================================================

export function setup() {
  const tenantId  = __ENV.TENANT_ID   || '3004';
  const inviteCode = __ENV.INVITE_CODE || '';

  if (!inviteCode) throw new Error('[Setup] 请通过 -e INVITE_CODE=<邀请码> 指定目标邀请码');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Setup] 并发绑定邀请码测试`);
  console.log(`[Setup] 租户: ${tenantId} | 目标邀请码: ${inviteCode}`);
  console.log(`[Setup] 账号数（并发数）: ${vuCount}`);
  console.log(`[Setup] 账号列表: ${usernameList.join(', ')}`);
  console.log(`${'='.repeat(60)}\n`);

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  // 管理员登录（查验证码用）
  const adminToken = tenantAdminLogin(tenantId);
  if (!adminToken) throw new Error('[Setup] 管理员登录失败');
  console.log('[Setup] ✅ 管理员登录成功\n');

  // 串行为每个账号完成验证码登录
  const userTokens = [];
  for (let i = 0; i < usernameList.length; i++) {
    const userName = usernameList[i];
    console.log(`[Setup] 登录账号 [${i + 1}/${usernameList.length}]: ${userName}`);

    const userToken = autoLoginByAccount(userName, adminToken);
    if (!userToken) {
      throw new Error(`[Setup] 账号登录失败: ${userName}`);
    }

    userTokens.push(userToken);
    console.log(`[Setup] ✅ 登录成功: ${userName}`);
  }

  console.log(`\n[Setup] 所有账号登录完毕，即将并发绑定邀请码: ${inviteCode}\n`);

  return {
    tenantId,
    inviteCode,
    userTokens,   // index 与 usernameList 对应
    usernames: usernameList,
  };
}

// ================================================================
// VU 主逻辑：每个 VU 对应一个账号，所有 VU 同时发起绑定
// ================================================================

export default function (data) {
  const { tenantId, inviteCode, userTokens, usernames } = data;

  if (tenantId !== '3004') {
    const env = getEnvByTenantId(tenantId);
    if (env) Object.assign(ENV_CONFIG, env);
  }

  // VU id 从 1 开始，映射到数组 index
  const idx       = exec.vu.idInInstance - 1;
  const userToken = userTokens[idx];
  const userName  = usernames[idx];

  if (!userToken) {
    console.error(`[VU ${exec.vu.idInInstance}] token 不存在，跳过`);
    return;
  }

  // ── 同步等待：让所有 VU 在同一时刻发起请求 ──────────────
  // k6 的 per-vu-iterations 会尽量同时启动所有 VU，
  // 这里再用 sleep(0) 让 JS 事件循环对齐一次，最小化时间差。
  sleep(0);

  const startMs = Date.now();
  console.log(`[VU ${exec.vu.idInInstance}] → 发起绑定 | 账号: ${userName} | inviteCode: ${inviteCode} | t=${startMs}`);

  const res = postWithToken('/api/User/UserInviteBind', { inviteCode }, userToken);

  const endMs  = Date.now();
  const costMs = endMs - startMs;

  printResponse(`VU${exec.vu.idInInstance} UserInviteBind`, res);
  console.log(`[VU ${exec.vu.idInInstance}] 耗时: ${costMs}ms | 账号: ${userName}`);

  const body = JSON.parse(res.body);
  check(body, {
    [`VU${exec.vu.idInInstance}(${userName}) HTTP 200`]:  () => res.status === 200,
    [`VU${exec.vu.idInInstance}(${userName}) code=1`]:    (b) => b.code === 1,
    [`VU${exec.vu.idInInstance}(${userName}) msgCode=0`]: (b) => b.msgCode === 0,
  });
}
