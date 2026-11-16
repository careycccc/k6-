/**
 * verifyFinancialRecord.js —— 一次性诊断脚本：验证"未结算但已派奖"的异常注单，
 * 其派奖金额是否真的已经计入会员账户的账变流水。
 *
 * 背景：betVerifyInteractive.js 核对170545账号时，后台"游戏投注订单"界面按
 * 未结算状态筛出2笔订单（Wild Bounty Showdown投注12派奖10.8、Wild Bandito
 * 投注18派奖46.8），净盈亏27.6恰好等于"账变口径"与"注单口径"游戏盈亏的差额。
 * 本脚本直接用后台管理员token查 /api/Financial/GetPageList（账变模块通用
 * 查询接口，payload/响应结构取自 k6/tests/api/agentL3/inviteCondition/api.js
 * :getInviteOkRewardCount 已验证过的写法），查这个会员在对应时间窗口内的全部
 * 账变记录，人工核对是否存在金额=10.8/46.8的记录、createTime是否对得上。
 *
 * 登录脚手架复刻自 collect-tagged-users.js / betVerifyInteractive.js，只读
 * .env 取账号密码/密钥，不写不删任何文件；只调只读查询接口。
 *
 * 运行方式：
 *   TENANT=3004 USER_ID=170545 node k6/playwrith/verifyFinancialRecord.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[诊断] ❌ 找不到 ${envPath}`);
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

const TENANT = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const ADMIN_URL = process.env.ADMIN_URL || ENV_FILE[`ENV_${TENANT}_BASE_ADMIN_URL`];
const ADMIN_USER = process.env.ADMIN_USER || ENV_FILE[`ENV_${TENANT}_ADMIN_USERNAME`];
const ADMIN_PWD = process.env.ADMIN_PWD || ENV_FILE[`ENV_${TENANT}_ADMIN_PASSWORD`] || '';
const LANG = process.env.LANG_CODE || 'zh';
const USER_ID = process.env.USER_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_SECRET || ENV_FILE[`ENV_${TENANT}_GOOGLE_SECRET`] || '';

if (!USER_ID) {
  console.error('[诊断] ❌ 请通过环境变量 USER_ID 指定要核对的会员ID');
  process.exit(1);
}
if (!ADMIN_URL || !ADMIN_USER) {
  console.error(`[诊断] ❌ 租户 ${TENANT} 的后台地址/管理员账号配置不完整，请检查 .env`);
  process.exit(1);
}

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
  const base = { ...payload, random, language: payload.language || LANG };
  const signature = sign(base);
  return { ...base, timestamp: Math.floor(Date.now() / 1000), signature };
}

async function post(baseUrl, api, payload, token) {
  const headers = { 'Content-Type': 'application/json', 'Domainurl': baseUrl, 'Referrer': baseUrl };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}${api}`, { method: 'POST', headers, body: JSON.stringify(withSign(payload)) });
  const text = await resp.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  const code = j ? (j.msgCode !== undefined ? j.msgCode : j.code) : null;
  return { status: resp.status, code, data: j ? j.data : null, msg: j ? j.msg : null };
}
const postAdmin = (api, payload, token) => post(ADMIN_URL, api, payload, token);

async function adminLogin() {
  let login;
  const baseSec = Math.floor(Date.now() / 1000);
  for (const off of (GOOGLE_SECRET ? [0, -1, 1] : [null])) {
    const payload = { userName: ADMIN_USER, pwd: ADMIN_PWD };
    if (off !== null) {
      payload.vCode = totp(GOOGLE_SECRET, off, baseSec);
      console.log(`[诊断] 🔐 vCode=${payload.vCode}${off ? ` (窗口${off > 0 ? '+' : ''}${off})` : ''}`);
    }
    login = await postAdmin('/api/Login/Login', payload);
    if ((login.code === 0 && login.data && login.data.token) || !(login.code === 1119 || login.code === 11 || /vcode/i.test(login.msg || ''))) break;
    if (off !== null) console.log(`[诊断]   窗口${off} 被拒: ${login.msg}`);
  }
  return login;
}

async function main() {
  console.log(`[诊断] 登录租户${TENANT}后台 ${ADMIN_URL} ...`);
  const login = await adminLogin();
  if (!login || login.code !== 0 || !login.data || !login.data.token) {
    console.error(`[诊断] ❌ 后台登录失败: ${JSON.stringify(login)}`);
    process.exit(1);
  }
  const token = login.data.token;
  console.log('[诊断] ✅ 登录成功\n');

  // 探针阶段先查全天，用已知确定存在的"首充赠送1777.00"记录验证接口本身
  // 是否覆盖这个会员——如果连这条都查不到，说明不是时间窗口/类型过滤的问题，
  // 而是这个接口本身不适用（searchUserIdType/userId传参方式不对，或者这个
  // userId在此接口下根本没有记录）。
  const WIDE_PROBE = process.env.WIDE_PROBE === '1';
  const startTime = WIDE_PROBE
    ? new Date('2026-11-16T00:00:00').getTime()
    : new Date('2026-11-16T16:30:00').getTime();
  const endTime = WIDE_PROBE
    ? new Date('2026-11-17T00:00:00').getTime()
    : new Date('2026-11-16T17:10:00').getTime();

  // financialTypeList是否必填、支持哪些枚举值未知，先尝试不传(查全部类型)。
  const api = '/api/Financial/GetPageList';
  const basePayload = {
    searchUserIdType: 1,
    userId: Number(USER_ID),
    startTime,
    endTime,
    pageNo: 1,
    pageSize: 200,
    orderBy: 'Desc',
  };

  console.log(`[诊断] 查询 ${api}（userId=${USER_ID}, ${new Date(startTime).toLocaleString('zh-CN')} ~ ${new Date(endTime).toLocaleString('zh-CN')}）...`);
  let r = await postAdmin(api, basePayload, token);
  console.log(`[诊断] 响应 status=${r.status} code=${r.code} msg=${r.msg}`);

  if (r.code !== 0) {
    console.log('[诊断] 不传financialTypeList失败，尝试传入游戏相关类型枚举值再查一次...');
    r = await postAdmin(api, { ...basePayload, financialTypeList: ['GameEnd', 'GameBet', 'GameCombineEnd'] }, token);
    console.log(`[诊断] 响应(带financialTypeList) status=${r.status} code=${r.code} msg=${r.msg}`);
  }

  if (r.code !== 0 || !r.data) {
    console.error(`[诊断] ❌ 查询失败，无法继续: ${JSON.stringify(r)}`);
    process.exit(1);
  }

  const list = r.data.list || [];
  console.log(`\n[诊断] 共查到 ${r.data.totalCount !== undefined ? r.data.totalCount : list.length} 条账变记录，本页返回 ${list.length} 条：\n`);
  for (const rec of list) {
    const ts = rec.createTime ? new Date(Number(rec.createTime)).toLocaleString('zh-CN') : '未知时间';
    console.log(`  ${ts}  金额=${rec.amount}  账变前=${rec.beforeAmount}  账变后=${rec.backAmount}  类型字段(原始)=${JSON.stringify({ type: rec.type, financialType: rec.financialType, remark: rec.remark })}`);
  }

  console.log('\n[诊断] 首条记录完整原始JSON（确认字段名）：');
  console.log(JSON.stringify(list[0] || null, null, 2));

  const target1 = list.filter((rec) => Math.abs(Number(rec.amount) - 10.8) < 0.01);
  const target2 = list.filter((rec) => Math.abs(Number(rec.amount) - 46.8) < 0.01);
  console.log(`\n[诊断] 匹配 amount≈10.8 的记录: ${target1.length} 条`);
  console.log(`[诊断] 匹配 amount≈46.8 的记录: ${target2.length} 条`);
  if (target1.length > 0) console.log('  ' + JSON.stringify(target1, null, 2));
  if (target2.length > 0) console.log('  ' + JSON.stringify(target2, null, 2));

  // 按截图里两笔"未结算"订单的orderNo前缀精确匹配，看是否有多条记录(免费旋转/
  // 加码等)共同构成后台"游戏投注订单"页面显示的派奖金额。
  const ORDER_PREFIXES = ['100002_6afae7f9f36674f3', '100002_6afae7ecef89f85d'];
  for (const prefix of ORDER_PREFIXES) {
    const matched = list.filter((rec) => (rec.orderNo || '').startsWith(prefix));
    const sum = matched.reduce((s, rec) => s + Number(rec.amount || 0), 0);
    console.log(`\n[诊断] orderNo前缀 ${prefix} 匹配到 ${matched.length} 条记录，amount之和=${sum.toFixed(2)}`);
    for (const rec of matched) {
      console.log(`    ${new Date(Number(rec.createTime)).toLocaleString('zh-CN')}  type=${rec.type}  amount=${rec.amount}  orderNo=${rec.orderNo}`);
    }
  }
}

main().catch((e) => { console.error('[诊断] 异常:', e); process.exit(1); });
