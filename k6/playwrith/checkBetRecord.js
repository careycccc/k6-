/**
 * checkBetRecord.js — 一次性诊断脚本：查某个 userId 后台真实的投注记录(GetBetRecordPageList)，
 * 跟 k6 脚本自己打印的 amount*betMultiple 估算值做对比，核实"投注金额"字段到底是什么。
 *
 * 背景：runInviteByTenant.test.js 跑完后，脚本自己日志打印"投注成功金额=amount*betMultiple"
 * （纯客户端猜测，从没验证过后端是否真的这么算），用户反馈后台看到的投注金额总是10，需要
 * 查后端真实返回的 betAmount/validAmount 字段核实，而不是继续信脚本自己的猜测值。
 *
 * 用法：
 *   node checkBetRecord.js --tenant 3006 --userId 118666
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[checkBetRecord] 找不到 ${envPath}`);
    process.exit(1);
  }
  const map = {};
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    let value = t.slice(idx + 1).trim();
    if (value.length >= 2) {
      const f = value[0], l = value[value.length - 1];
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}
const ENV_FILE = loadEnvFile();

function argVal(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const TENANT = argVal('tenant', '3006');
const USER_ID = parseInt(argVal('userId', '0'), 10);
const ADMIN_URL = ENV_FILE[`ENV_${TENANT}_BASE_ADMIN_URL`];
const ADMIN_USER = ENV_FILE[`ENV_${TENANT}_ADMIN_USERNAME`];
const ADMIN_PWD = ENV_FILE[`ENV_${TENANT}_ADMIN_PASSWORD`];
const GOOGLE_SECRET = ENV_FILE[`ENV_${TENANT}_GOOGLE_SECRET`] || '';

function base32Decode(str) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = '';
  for (const ch of str) { const i = a.indexOf(ch); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); }
  const by = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(by);
}
function totp(secret, windowOffset = 0, baseSec) {
  const key = base32Decode(secret);
  const t = (baseSec === undefined ? Math.floor(Date.now() / 1000) : baseSec);
  let ctr = Math.floor(t / 30) + windowOffset;
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = ctr & 0xff; ctr = Math.floor(ctr / 256); }
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}
function sign(fields) {
  const exclude = new Set(['signature', 'timestamp', 'track']);
  const o = {};
  Object.keys(fields).sort().forEach((k) => {
    const v = fields[k];
    if (exclude.has(k) || v === null || v === undefined || v === '') return;
    o[k] = v;
  });
  return crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').toUpperCase();
}
function withSign(payload) {
  const random = Math.floor(1e11 + Math.random() * 9e11);
  const base = { ...payload, random, language: payload.language || 'en' };
  const signature = sign(base);
  return { ...base, timestamp: Math.floor(Date.now() / 1000), signature };
}
async function post(baseUrl, api, payload, token) {
  const headers = { 'Content-Type': 'application/json', 'Domainurl': baseUrl, 'Referrer': baseUrl };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}${api}`, { method: 'POST', headers, body: JSON.stringify(withSign(payload)) });
  const text = await resp.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* 非JSON */ }
  const code = j ? (j.msgCode !== undefined ? j.msgCode : j.code) : null;
  return { status: resp.status, code, data: j ? j.data : null, msg: j ? j.msg : null, text };
}

async function adminLogin() {
  let login;
  const baseSec = Math.floor(Date.now() / 1000);
  for (const off of (GOOGLE_SECRET ? [0, -1, 1] : [null])) {
    const payload = { userName: ADMIN_USER, pwd: ADMIN_PWD };
    if (off !== null) { payload.vCode = totp(GOOGLE_SECRET, off, baseSec); console.log(`[checkBetRecord] vCode=${payload.vCode}`); }
    login = await post(ADMIN_URL, '/api/Login/Login', payload);
    if ((login.code === 0 && login.data && login.data.token) || !(login.code === 1119 || login.code === 11 || /vcode/i.test(login.msg || ''))) break;
  }
  return login;
}

(async () => {
  if (!USER_ID) { console.error('请传 --userId'); process.exit(1); }
  console.log(`[checkBetRecord] 租户=${TENANT} 后台=${ADMIN_URL} 账号=${ADMIN_USER} userId=${USER_ID}`);

  const login = await adminLogin();
  if (!login || login.code !== 0 || !login.data || !login.data.token) {
    console.error('[checkBetRecord] 登录失败:', JSON.stringify(login));
    process.exit(1);
  }
  const token = login.data.token;
  console.log('[checkBetRecord] 登录成功');

  // 1) 先用 GetUserDetail 确认一下该用户的充值/盈亏等概览字段，辅助判断
  const detail = await post(ADMIN_URL, '/api/Users/GetUserDetail', { userId: USER_ID }, token);
  console.log('\n===== GetUserDetail 原始响应 =====');
  console.log(JSON.stringify(detail.data, null, 2));

  // 2) 真实投注记录：不限定游戏/厂商，查最近一天，orderState 不传(查全部状态)，
  //    也不传 queryTimeType（先看默认返回全不全，再决定要不要加 SettleTime 限定）
  const now = Date.now();
  const payload = {
    userId: USER_ID,
    beginTimeUnix: now - 24 * 60 * 60 * 1000,
    endTimeUnix: now,
    pageNo: 1,
    pageSize: 50,
    orderBy: 'Desc'
  };
  const bet = await post(ADMIN_URL, '/api/ThirdGame/GetBetRecordPageList', payload, token);
  console.log('\n===== GetBetRecordPageList 原始响应 =====');
  console.log(JSON.stringify(bet.data, null, 2));
})();
