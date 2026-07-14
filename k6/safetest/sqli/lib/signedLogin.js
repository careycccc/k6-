/**
 * safetest/sqli/lib/signedLogin.js
 * 登录接口的「签名请求」封装：复用项目现有签名算法，并额外返回响应耗时（时间盲注判定必需）。
 *
 * 复用点：
 *   - libs/utils/signature.js 的 SignedHttpClient.signData（空密钥），与 libs/http/tenantRequest.js
 *     完全一致的签名方式（filter 去空/去 signature|timestamp|track → sort → 紧凑 JSON → MD5 大写）。
 *   - 签名对「当前 payload 的字段值」计算，因此注入串会被如实签名 → 通过签名网关 → 抵达后端 SQL。
 *
 * 两个入口：
 *   frontendLogin(userName, password) → POST {DESK}/api/Home/Login   (前台会员, isDesk=true)
 *   backendLogin(userName, pwd)        → POST {ADMIN}/api/Login/Login (后台管理, isDesk=false)
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { getSafeEnv, baseOf } from '../../lib/env.js';
import { generateCryptoRandomString, getTimeRandom } from '../../../tests/utils/utils.js';

// 空密钥签名器，等同 tenantRequest 内部使用的实例
const signer = new SignedHttpClient();

// 每次运行使用固定 browserId，降低基线耗时抖动、忠实还原前台客户端
const RUN_BROWSER_ID = generateCryptoRandomString(32);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/**
 * 底层：补全 random/language/timestamp → 签名 → POST，返回结构化响应（含耗时）。
 */
function post(baseUrl, api, payload) {
  const t = getTimeRandom();
  const body = { ...payload, random: t.random, language: t.language, timestamp: t.timestamp };
  const signed = signer.signData(body); // 追加 signature（覆盖当前注入值）
  const headers = {
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
    'User-Agent': UA,
    Domainurl: baseUrl,
    Referrer: baseUrl,
  };
  const res = http.post(baseUrl + api, JSON.stringify(signed), { headers, timeout: '30s' });

  let parsed = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch (e) {
    parsed = null; // 非 JSON 响应（可能就是报错页）保留在 bodyText 里
  }
  return {
    status: res.status,
    duration: res.timings.duration, // ms —— 时间盲注核心指标（纯服务端往返，不含退避 sleep）
    msgCode: parsed ? (parsed.msgCode !== undefined ? parsed.msgCode : parsed.code) : null,
    msg: parsed ? parsed.msg : null,
    bodyText: res.body || '',
    len: (res.body || '').length,
    token: parsed && parsed.data && parsed.data.token ? parsed.data.token : null,
    raw: parsed,
  };
}

// 平台对高频请求敏感（msgCode=13 / "Too frequent"）；命中则退避重试
function isRateLimited(r) {
  return r.msgCode === 13 || /too frequent|frequent|频繁|try again later/i.test(r.bodyText || '');
}

function withBackoff(fn, maxRetry = 4) {
  let r = fn();
  let tries = 0;
  while (isRateLimited(r) && tries < maxRetry) {
    const wait = 2 + tries * 2; // 2s,4s,6s,8s
    console.warn(`[sqli] 命中限流，退避 ${wait}s 后重试 (${tries + 1}/${maxRetry})`);
    sleep(wait);
    r = fn();
    tries++;
  }
  return r;
}

export function frontendLogin(userName, password) {
  const env = getSafeEnv();
  const base = baseOf(env.BASE_DESK_URL);
  return withBackoff(() =>
    post(base, '/api/Home/Login', {
      userName,
      password,
      loginType: 'Mobile',
      deviceId: '',
      browserId: RUN_BROWSER_ID,
      packageName: '',
    })
  );
}

export function backendLogin(userName, pwd) {
  const env = getSafeEnv();
  const base = baseOf(env.BASE_ADMIN_URL);
  return withBackoff(() => post(base, '/api/Login/Login', { userName, pwd }));
}

// 端点抽象：injection vector 固定为 userName（登录前的 SQL 查询点）
export const ENDPOINTS = {
  frontend: {
    key: 'frontend',
    name: '前台会员登录 /api/Home/Login',
    run: (u, p) => frontendLogin(u, p),
  },
  backend: {
    key: 'backend',
    name: '后台管理登录 /api/Login/Login',
    run: (u, p) => backendLogin(u, p),
  },
};
