/**
 * walletTransferRaceVerify.js —— 场景5：主钱包↔游戏钱包转账(GameTransIn/GameTransOut)中间态资金安全测试
 * Node 独立脚本，不进 k6 VU（需要精确并发和"请求发出后主动掐断"，k6 做不到后者）。
 *
 * 两种模式：
 *   MODE=probe（默认，第0步）：依次单独调用 开游戏(GetGameUrl) / 回收余额(RecoverSaasBalance)，
 *     每步前后对比后台余额和账变，确认到底是哪个动作触发了 GameTransIn/GameTransOut；最后有一步
 *     手动配合环节，提示你在窗口期内手动投注一次，脚本同时观察账变。
 *   MODE=race（第1步）：制造碰撞，每个用例结束后回收两次余额，用"资金守恒 + 账变链条连续性"判定：
 *     a UP+CQ9+GameBox 三个不同厂商并发开游戏——测的是同一笔主钱包余额能不能被三个厂商同时"抢"到
 *       各自游戏钱包里，造成余额被重复花/算错/变负。每轮结束先强制回收+二次结算再对比下一轮，避免
 *       上一轮延迟入账的账变串到下一轮被误判。
 *     b 开游戏与回收余额对撞
 *     c 开游戏请求发出后几十毫秒主动断开
 *     d 下注与回收余额对撞——半自动：项目里只有 ARLottery(彩票) 有现成的自动下注API，UP/GameBox/CQ9
 *       这些游戏的下注发生在真实游戏客户端里，脚本没法自动发起。所以这个用例改成"脚本打倒计时+循环
 *       回收余额，你在窗口期内手动点一次投注"，靠人配合制造碰撞时机，不是脚本独自做到毫秒级精确对撞。
 *       用例d开始前会自动开一次游戏A/B，把地址打印在终端——用内置浏览器打开，整个用例d期间保持打开。
 *
 * gameId 参数不是写死的固定值——是 POST /api/ThirdGame/GetGameListPageList（后台token，payload
 * {vendorCode, pageNo, pageSize}）返回列表里每条记录的 id 字段。2026-11-18实测确认(3004)：
 *   UP:jili_35_ols2:104567(Crazy777)  GameBox:20003:1152(Mini Roulette)  CQ9:70:100155(Wanbao Dino)
 * 换厂商/游戏前，先用这个接口查一次该厂商的游戏列表，确认 gameCode 对应的 id，state=0 的是禁用游戏。
 *
 * ⚠️ 对抗性测试：只用专门测试账号、小余额、测试环境。同一账号重复登录会顶号，运行期间不要在浏览器
 * 登录这个账号。会员账号密码由运行者用环境变量传入，脚本不落盘；.env 只读（后台账号/谷歌密钥）。
 *
 * 用法（Git Bash，手机号不带区号）：
 *   MEMBER_ACCOUNT=<手机号> MEMBER_PASSWORD=<密码> node k6/playwrith/walletTransferRaceVerify.js
 *   MODE=race CASES=a,b,c,d MEMBER_ACCOUNT=<手机号> MEMBER_PASSWORD=<密码> node k6/playwrith/walletTransferRaceVerify.js
 * PowerShell：
 *   $env:MODE="race"; $env:MEMBER_ACCOUNT="<手机号>"; $env:MEMBER_PASSWORD="<密码>"; node k6/playwrith/walletTransferRaceVerify.js
 *
 * 可选参数：TENANT(默认3004)  GAME_A(默认 UP:jili_35_ols2:104567)  GAME_B(默认 CQ9:70:100155)
 *   GAME_C(默认 GameBox:20003:1152，用例a专用的第三个厂商，格式都是 厂商:游戏码:gameId)
 *   ROUNDS(默认 a/b=10轮、c=5轮、d=3轮)  SETTLE_MS(每次操作后等多久再查，默认3000)
 *   ABORT_MS(用例c掐断时机，默认50)  D_WINDOW_MS(用例d每轮给你手动投注的时间，默认15000)
 *   D_RECOVER_INTERVAL_MS(用例d窗口期内回收余额的间隔，默认800)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[转账核对] ❌ 找不到 ${envPath}`);
    process.exit(1);
  }
  const map = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    let value = t.slice(idx + 1).trim();
    if (value.length >= 2) {
      const f = value[0], l = value[value.length - 1];
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) value = value.slice(1, -1);
    }
    map[t.slice(0, idx).trim()] = value;
  }
  return map;
}
const ENV_FILE = loadEnvFile();

const TENANT = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const ADMIN_URL = process.env.ADMIN_URL || ENV_FILE[`ENV_${TENANT}_BASE_ADMIN_URL`];
const DESK_URL = process.env.DESK_URL || ENV_FILE[`ENV_${TENANT}_BASE_DESK_URL`];
const ADMIN_USER = process.env.ADMIN_USER || ENV_FILE[`ENV_${TENANT}_ADMIN_USERNAME`];
const ADMIN_PWD = process.env.ADMIN_PWD || ENV_FILE[`ENV_${TENANT}_ADMIN_PASSWORD`] || '';
const GOOGLE_SECRET = process.env.GOOGLE_SECRET || ENV_FILE[`ENV_${TENANT}_GOOGLE_SECRET`] || '';
const COUNTRY_CODE = process.env.COUNTRY_CODE || ENV_FILE[`ENV_${TENANT}_COUNTRY_CODE`] || '91';
const MEMBER_ACCOUNT = process.env.MEMBER_ACCOUNT || '';
const MEMBER_PASSWORD = process.env.MEMBER_PASSWORD || '';
const MODE = (process.env.MODE || 'probe').toLowerCase();
const CASES = (process.env.CASES || 'a,b,c,d').split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const ROUNDS_ENV = process.env.ROUNDS ? parseInt(process.env.ROUNDS, 10) : null;
const SETTLE_MS = parseInt(process.env.SETTLE_MS || '3000', 10);
const ABORT_MS = parseInt(process.env.ABORT_MS || '50', 10);
const D_WINDOW_MS = parseInt(process.env.D_WINDOW_MS || '15000', 10);
const D_RECOVER_INTERVAL_MS = parseInt(process.env.D_RECOVER_INTERVAL_MS || '800', 10);
const LANG = 'zh';

function parseGame(spec, fallback) {
  const [vendorCode, gameCode, gameId] = (spec || fallback).split(':');
  return { vendorCode, gameCode, gameId: Number(gameId) };
}
const GAME_A = parseGame(process.env.GAME_A, 'UP:jili_35_ols2:104567');
const GAME_B = parseGame(process.env.GAME_B, 'CQ9:70:100155');
const GAME_C = parseGame(process.env.GAME_C, 'GameBox:20003:1152');
const gameLabel = (g) => `${g.vendorCode}/${g.gameCode}`;

// 资金守恒时要剔除的账变：转账只是钱在两个钱包之间挪，不该改变合计；游戏输赢在用例d里改用后台注单口径
const GAME_TYPES = new Set(['GameBet', 'GameEnd', 'GameCombineEnd', 'GameTransIn', 'GameTransOut']);

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => round2(n).toFixed(2);
const signed = (n) => `${round2(n) > 0 ? '+' : ''}${fmt(n)}`;
const nearly = (a, b) => Math.abs(round2(a) - round2(b)) < 0.01;
const ts = (ms) => new Date(Number(ms)).toLocaleString('zh-CN', { hour12: false });
const keyOf = (r) => r.id || `${r.orderNo}|${r.type}|${r.createTime}|${r.amount}`;
const byTime = (a, b) => (Number(a.createTime) - Number(b.createTime)) || String(keyOf(a)).localeCompare(String(keyOf(b)));

const report = [];
function out(line = '') {
  console.log(line);
  report.push(line);
}

// ───── 签名 / TOTP / 请求（同 betVerifyInteractive.js，全站同一套签名口径） ─────
function base32Decode(str) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '')) {
    const i = a.indexOf(ch);
    if (i >= 0) bits += i.toString(2).padStart(5, '0');
  }
  const by = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(by);
}
function totp(secret, windowOffset, baseSec) {
  let ctr = Math.floor(baseSec / 30) + windowOffset;
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { buf[i] = ctr & 0xff; ctr = Math.floor(ctr / 256); }
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
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
  const base = { ...payload, random: Math.floor(1e11 + Math.random() * 9e11), language: payload.language || LANG };
  return { ...base, timestamp: Math.floor(Date.now() / 1000), signature: sign(base) };
}

async function call(url, payload, { token, headers = {}, signal, method = 'POST' } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const startMs = Date.now();
  try {
    const body = method === 'POST' ? JSON.stringify(withSign(payload || {})) : undefined;
    const resp = await fetch(url, { method, headers: h, body, signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    const code = json ? (json.msgCode !== undefined ? json.msgCode : json.code) : null;
    return { ok: true, status: resp.status, code, json, data: json ? json.data : null, msg: json ? json.msg : null, headers: resp.headers, startMs, endMs: Date.now() };
  } catch (e) {
    return { ok: false, aborted: e.name === 'AbortError', error: e.message, startMs, endMs: Date.now() };
  }
}
const adminPost = (api, payload) => call(ADMIN_URL + api, payload, { token: adminToken, headers: { Domainurl: ADMIN_URL, Referrer: ADMIN_URL } });
const deskPost = (api, payload, token, opts = {}) =>
  call(DESK_URL + api, payload, { token, headers: { Domainurl: DESK_URL, Referer: DESK_URL, Origin: DESK_URL }, ...opts });

// ───── 登录 ─────
let adminToken = null;
async function adminLogin() {
  const baseSec = Math.floor(Date.now() / 1000);
  let r;
  for (const off of (GOOGLE_SECRET ? [0, -1, 1] : [null])) {
    const payload = { userName: ADMIN_USER, pwd: ADMIN_PWD };
    if (off !== null) payload.vCode = totp(GOOGLE_SECRET, off, baseSec);
    r = await call(ADMIN_URL + '/api/Login/Login', payload, { headers: { Domainurl: ADMIN_URL, Referrer: ADMIN_URL } });
    if (r.code === 0 && r.data && r.data.token) return r.data.token;
    if (!(r.code === 1119 || r.code === 11 || /vcode/i.test(r.msg || ''))) break;
  }
  throw new Error(`后台登录失败: ${r ? (r.msg || r.error) : 'null'}`);
}

// 会员token大约55秒失效(见 frontend-token-ttl-refresh)，超过40秒就重登一次；本脚本独占这个账号，重登不影响别人
let memberToken = null;
let memberTokenAt = 0;
async function freshMemberToken(force = false) {
  if (!force && memberToken && Date.now() - memberTokenAt < 40000) return memberToken;
  const r = await deskPost('/api/Home/Login', {
    userName: COUNTRY_CODE + MEMBER_ACCOUNT, password: MEMBER_PASSWORD, loginType: 'Mobile',
    deviceId: '', browserId: crypto.randomBytes(16).toString('hex'), packageName: '',
  });
  if (!(r.code === 0 && r.data && r.data.token)) throw new Error(`会员登录失败: ${r.msg || r.error || r.status}`);
  memberToken = r.data.token;
  memberTokenAt = Date.now();
  return memberToken;
}

// ───── 被测动作 ─────
function openGame(game, token, opts = {}) {
  return deskPost('/api/ThirdGame/GetGameUrl', {
    gameCode: game.gameCode, vendorCode: game.vendorCode, gameId: game.gameId,
    returnUrl: `${DESK_URL}/game/allGames`, deviceType: 'PC',
    deviceTypeId: crypto.randomBytes(16).toString('hex'), language: 'en',
  }, token, opts);
}
const recover = (token, opts = {}) => deskPost('/api/ThirdGame/RecoverSaasBalance', {}, token, opts);

// 各请求在同一个事件循环tick里依次发起(fetch调用即发送)，毫秒级间隔，是脚本能做到的最大"同时"
function fire(pairs) {
  return Promise.all(pairs.map(([name, fn]) => fn().then((res) => ({ name, res }))));
}

// ───── 后台观测（只读，逐个串行查，见 k6-query-no-http-batch） ─────
const DAY_START = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); })();
let USER_ID = null;

async function lookupUserId() {
  const r = await adminPost('/api/Users/GetPageList', { account: COUNTRY_CODE + MEMBER_ACCOUNT, pageNo: 1, pageSize: 10 });
  const u = r.data && r.data.list && r.data.list[0];
  if (!u) throw new Error(`后台查不到账号 ${COUNTRY_CODE}${MEMBER_ACCOUNT}`);
  return u.userId;
}

async function readWallet() {
  const r = await adminPost('/api/Users/GetUserDetail', { userId: String(USER_ID) });
  const f = r.data && r.data.accountFundsRsp;
  if (!f) throw new Error(`GetUserDetail 没有 accountFundsRsp: ${r.msg || r.error}`);
  const wallet = Number(f.walletBalance) || 0;
  const arGame = Number(f.arGameAmount) || 0;
  return { wallet, arGame, total: round2(wallet + arGame), freeze: Number(f.freezeAmount) || 0 };
}

// 账变接口的 orderBy 不生效(已实测)，客户端按 createTime 重排
async function fetchLedger() {
  const seen = new Set();
  const records = [];
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const r = await adminPost('/api/Financial/GetPageList', {
      searchUserIdType: 1, userId: Number(USER_ID), startTime: DAY_START, endTime: Date.now(),
      pageNo, pageSize: 200, orderBy: 'Desc',
    });
    if (r.code !== 0 || !r.data) throw new Error(`账变查询失败: ${r.msg || r.error}`);
    const list = r.data.list || [];
    for (const rec of list) {
      const k = keyOf(rec);
      if (!seen.has(k)) { seen.add(k); records.push(rec); }
    }
    if (pageNo >= (Number(r.data.totalPage) || 1) || list.length === 0) break;
  }
  return records.sort(byTime);
}

async function snapshot() {
  const w = await readWallet();
  const ledger = await fetchLedger();
  return { ...w, ledger, ids: new Set(ledger.map(keyOf)), at: Date.now() };
}

// gameCodes不传时不过滤厂商/游戏，返回这段时间内该账号的全部注单——半自动用例d里
// 用户可能投注GAME_A或GAME_B任一款，不该只盯着其中一个码，漏掉用户实际点的那一注。
async function fetchOrdersSince(sinceMs, gameCodes = null) {
  const orders = [];
  const seen = new Set();
  for (let pageNo = 1; pageNo <= 10; pageNo++) {
    const r = await adminPost('/api/ThirdGame/GetBetRecordPageList', {
      queryTimeType: 'BetTime', userId: String(USER_ID), beginTimeUnix: sinceMs - 5000, endTimeUnix: Date.now(),
      pageNo, pageSize: 200, orderBy: 'Desc', sortField: 'BetTime',
    });
    if (r.code !== 0 || !r.data) break;
    const list = r.data.list || [];
    for (const o of list) {
      if (o.orderNo && !seen.has(o.orderNo)) { seen.add(o.orderNo); orders.push(o); }
    }
    if (pageNo >= (Number(r.data.totalPage) || 1) || list.length === 0) break;
  }
  return gameCodes ? orders.filter((o) => gameCodes.has(o.gameCode)) : orders;
}

async function waitOrdersSettled(sinceMs, gameCodes, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  let orders = [];
  while (true) {
    orders = await fetchOrdersSince(sinceMs, gameCodes);
    const unsettled = orders.filter((o) => Number(o.orderState) !== 1).length;
    // 注单进 GetBetRecordPageList 这个报表接口有延迟，哪怕已经下注甚至结算了也可能暂时查不到——
    // 空数组的"未结算数"天然是0，不能把"第一次就查到0笔"当成"确实没人下注/已经查完了"直接退出，
    // 必须真查到过订单、且全部结算完才提前返回；查不到订单就老老实实等到超时为止。
    if ((orders.length > 0 && unsettled === 0) || Date.now() > deadline) {
      const settled = orders.filter((o) => Number(o.orderState) === 1);
      const gameNet = round2(settled.reduce((s, o) => s + Number(o.winAmount || 0) - Number(o.betAmount || 0), 0));
      return { count: orders.length, unsettled, gameNet, orders };
    }
    await sleep(5000);
  }
}

// ───── 分析 ─────
function newRecords(before, after) {
  return after.ledger.filter((r) => !before.ids.has(keyOf(r)));
}

function summarize(before, after, recs) {
  let net = 0, transIn = 0, transOut = 0, otherNet = 0;
  for (const r of recs) {
    const a = Number(r.amount) || 0;
    net += a;
    if (r.type === 'GameTransIn') transIn += Math.abs(a);
    else if (r.type === 'GameTransOut') transOut += Math.abs(a);
    if (!GAME_TYPES.has(r.type)) otherNet += a;
  }
  return {
    dw: round2(after.wallet - before.wallet), dg: round2(after.arGame - before.arGame), dt: round2(after.total - before.total),
    net: round2(net), transIn: round2(transIn), transOut: round2(transOut), otherNet: round2(otherNet),
  };
}

function typeSummary(recs) {
  const g = {};
  for (const r of recs) {
    if (!g[r.type]) g[r.type] = { n: 0, amt: 0 };
    g[r.type].n += 1;
    g[r.type].amt += Number(r.amount) || 0;
  }
  return Object.keys(g).map((t) => `${t}×${g[t].n}(${signed(g[t].amt)})`).join('、');
}

function recLine(r) {
  return `${ts(r.createTime)} ${r.type} ${signed(r.amount)} 账变前${fmt(r.beforeAmount)}→后${fmt(r.backAmount)} 厂商=${r.vendorCode || '-'} 单号=${r.orderNo || '-'}`;
}

function callText({ name, res }) {
  if (!res) return `${name}: 无结果`;
  if (res.aborted) return `${name}: 已主动中断(${res.endMs - res.startMs}ms)`;
  if (!res.ok) return `${name}: 请求异常 ${res.error}`;
  const j = res.json;
  const code = j ? `code=${j.code}/msgCode=${j.msgCode}` : `HTTP${res.status}`;
  return `${name}: ${code} ${res.msg || ''}`.trim();
}

function timingText(calls) {
  const starts = calls.map((c) => c.res && c.res.startMs).filter(Boolean);
  if (starts.length < 2) return '';
  const t0 = Math.min(...starts);
  return '发出时差 ' + calls.map((c) => `${c.name}+${c.res.startMs - t0}ms`).join(' ');
}

// 账变链条：每条"账变前"应该等于上一条"账变后"。两个并发操作如果都基于同一个旧余额写入(丢失更新)，
// 会出现两条记录从同一个余额出发，链条就接不上。
function chainCheck(beforeLedger, segRecords) {
  const issues = [];
  for (const r of segRecords) {
    if (!nearly(Number(r.backAmount) - Number(r.beforeAmount), Number(r.amount))) {
      issues.push(`单条记录自身对不上：${recLine(r)}`);
    }
  }
  const remaining = [...segRecords].sort(byTime);
  if (remaining.length === 0) return issues;
  const anchor = beforeLedger.length ? beforeLedger[beforeLedger.length - 1] : null;
  let cur = anchor ? Number(anchor.backAmount) : Number(remaining[0].beforeAmount);
  while (remaining.length) {
    let idx = remaining.findIndex((r) => nearly(r.beforeAmount, cur));
    if (idx < 0) {
      issues.push(`链条断裂：上一条结束余额 ${fmt(cur)}，没有记录从这个余额开始；最早的剩余记录是 ${recLine(remaining[0])}`);
      idx = 0;
    }
    cur = Number(remaining[idx].backAmount);
    remaining.splice(idx, 1);
  }
  return issues;
}

function duplicateCheck(recs) {
  const cnt = {};
  for (const r of recs) {
    if (!r.orderNo) continue;
    const k = `${r.orderNo}|${r.type}`;
    cnt[k] = (cnt[k] || 0) + 1;
  }
  return Object.keys(cnt).filter((k) => cnt[k] > 1).map((k) => `${k.replace('|', ' ')} 出现${cnt[k]}次`);
}

// ───── 第0步：探测 ─────
async function runProbe() {
  out('## 第0步：确认是哪个动作触发了转账');
  let prev = await snapshot();
  out(`初始：主钱包 ${fmt(prev.wallet)}  游戏钱包 ${fmt(prev.arGame)}  合计 ${fmt(prev.total)}  冻结 ${fmt(prev.freeze)}`);
  const rows = [];

  async function step(title, fn, waitMs = SETTLE_MS) {
    const tok = await freshMemberToken();
    const calls = fn ? await fn(tok) : [];
    await sleep(waitMs);
    const snap = await snapshot();
    const recs = newRecords(prev, snap);
    const t = summarize(prev, snap, recs);
    out(`\n### ${title}`);
    for (const c of calls) out(`- 调用 ${callText(c)}`);
    out(`- 主钱包 ${fmt(prev.wallet)}→${fmt(snap.wallet)}  游戏钱包 ${fmt(prev.arGame)}→${fmt(snap.arGame)}  合计 ${fmt(prev.total)}→${fmt(snap.total)}`);
    if (recs.length === 0) {
      out('- 没有新增账变');
    } else {
      out(`- 新增账变 ${recs.length} 条，净额 ${signed(t.net)}（${nearly(t.net, t.dw) ? '等于' : '不等于'}主钱包变化，${nearly(t.net, t.dt) ? '等于' : '不等于'}合计变化）：`);
      for (const r of recs) out(`  - ${recLine(r)}`);
    }
    rows.push({ title, types: typeSummary(recs) });
    prev = snap;
    return calls;
  }

  const opened = await step(`开游戏 ${gameLabel(GAME_A)}`, async (tok) => [{ name: 'GetGameUrl', res: await openGame(GAME_A, tok) }]);
  await step('回收余额', async (tok) => [{ name: 'RecoverSaasBalance', res: await recover(tok) }]);
  await step(`开游戏 ${gameLabel(GAME_B)}`, async (tok) => [{ name: 'GetGameUrl', res: await openGame(GAME_B, tok) }]);
  await step('回收余额', async (tok) => [{ name: 'RecoverSaasBalance', res: await recover(tok) }]);

  // UP/GameBox/CQ9 没有脚本能调的下注API，这一步靠人配合：游戏地址已经打开过，这里只是给出提示和等待时机
  const urlA = opened[0].res.data && opened[0].res.data.url;
  if (urlA) {
    out('\n### 手动配合：观察真实下注会不会触发转账');
    out(`- 游戏地址：${urlA}`);
    console.log('\n>>> 请用内置浏览器打开上面的地址，手动投注一次，完成后回这里按回车（直接回车可跳过这一步）<<<');
    try {
      await rl.question('按回车继续... ');
    } catch (e) {
      out(`- （输入流不可用，跳过手动配合：${e.message}）`);
    }
    await step('下注后回收余额', async (tok) => [{ name: 'RecoverSaasBalance', res: await recover(tok) }]);
  }

  out('\n## 探测结论（每一步产生了哪些账变）');
  for (const r of rows) out(`- ${r.title}：${r.types || '无账变'}`);
  out('\n出现 GameTransIn/GameTransOut 的那一步，就是触发转账的动作。确认后再用 MODE=race 跑碰撞测试。');
}

// ───── 第1步：碰撞 ─────
const CASE_DEFS = {
  a: {
    // 测的是你要的那个点：同一笔主钱包余额，能不能被UP/CQ9/GameBox三个不同厂商在同一瞬间都"抢"到手，
    // 变成三边都入账导致余额被重复花/算错甚至变负。recoverInRound=true：每轮结束先强制回收+二次结算
    // 再对比，不然上一轮的延迟到账记录会串到下一轮，"转入超过余额"会被延迟入账误判成假阳性。
    title: '三个不同厂商并发开游戏（UP+CQ9+GameBox 同时抢同一笔余额）', rounds: 10, recoverInRound: true,
    round: (tok) => fire([
      [`开${gameLabel(GAME_A)}`, () => openGame(GAME_A, tok)],
      [`开${gameLabel(GAME_B)}`, () => openGame(GAME_B, tok)],
      [`开${gameLabel(GAME_C)}`, () => openGame(GAME_C, tok)],
    ]),
  },
  b: {
    title: '开游戏与回收余额对撞', rounds: 10,
    round: (tok, i) => {
      const open = ['开游戏A', () => openGame(GAME_A, tok)];
      const rec = ['回收余额', () => recover(tok)];
      return fire(i % 2 ? [open, rec] : [rec, open]);
    },
  },
  c: {
    title: `开游戏请求发出 ${ABORT_MS}ms 后主动断开`, rounds: 5, recoverInRound: true,
    round: async (tok) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ABORT_MS);
      const res = await openGame(GAME_A, tok, { signal: ctrl.signal });
      clearTimeout(timer);
      return [{ name: '开游戏A(掐断)', res }];
    },
  },
  d: {
    title: '手动下注与回收余额对撞（半自动）', rounds: 3,
    // race模式不会像probe那样先单独开过游戏，用例d自己完全没调用openGame——不开一次游戏，
    // 你根本没有链接可以点进去投注。这里在跑分轮次之前先开A/B各一次，把地址打印出来。
    setup: async (tok) => {
      const a = await openGame(GAME_A, tok);
      const b = await openGame(GAME_B, tok);
      out('\n### 用例d准备：打开游戏A/B地址（整个用例期间都可以用这两个链接手动投注）');
      const urlA = a.data && a.data.url;
      const urlB = b.data && b.data.url;
      if (urlA) out(`- 游戏A(${gameLabel(GAME_A)})：${urlA}`); else out(`- 游戏A打开失败：${a.msg || a.error || a.status}`);
      if (urlB) out(`- 游戏B(${gameLabel(GAME_B)})：${urlB}`); else out(`- 游戏B打开失败：${b.msg || b.error || b.status}`);
      console.log('\n>>> 请用内置浏览器打开上面任一链接（或两个都开），整个用例d期间保持打开 <<<');
    },
    round: async (tok, i) => {
      console.log(`\n>>> 第${i}轮：接下来 ${(D_WINDOW_MS / 1000).toFixed(1)} 秒内，请在游戏A(${gameLabel(GAME_A)})或游戏B(${gameLabel(GAME_B)})里手动投注一次，脚本同时循环回收余额 <<<`);
      const deadline = Date.now() + D_WINDOW_MS;
      let n = 0;
      let last = null;
      while (Date.now() < deadline) {
        n += 1;
        last = await recover(tok);
        await sleep(D_RECOVER_INTERVAL_MS);
      }
      return [{ name: `回收余额(循环${n}次)`, res: last }];
    },
  },
};

async function runCase(key) {
  const def = CASE_DEFS[key];
  const rounds = ROUNDS_ENV || def.rounds;
  out(`\n## 用例${key}：${def.title}（${rounds}轮）`);
  const caseStartMs = Date.now();
  const start = await snapshot();
  out(`起点：主钱包 ${fmt(start.wallet)}  游戏钱包 ${fmt(start.arGame)}  合计 ${fmt(start.total)}`);
  const anomalies = [];
  let inTransitRounds = 0;
  let prev = start;

  if (def.setup) {
    await def.setup(await freshMemberToken());
    await sleep(SETTLE_MS);
    prev = await snapshot();
  }

  for (let i = 1; i <= rounds; i++) {
    const roundStart = prev;
    const tok = await freshMemberToken();
    const calls = await def.round(tok, i);
    await sleep(SETTLE_MS);
    const snap = await snapshot();
    const recs = newRecords(prev, snap);
    const t = summarize(prev, snap, recs);
    out(`- 第${i}轮 ${timingText(calls)}`.trimEnd());
    for (const c of calls) out(`  - ${callText(c)}`);
    out(`  - 主钱包${signed(t.dw)} 游戏钱包${signed(t.dg)} 合计${signed(t.dt)} | 转入游戏 ${fmt(t.transIn)} 转回主钱包 ${fmt(t.transOut)} 其他账变 ${signed(t.otherNet)}`);

    // 真实的"余额被重复转出/算错"必须看实际余额变化(dw)，不能只看账变记录里的transIn合计——
    // GameTransIn/Out账变可能延迟入账，串到下一轮的观察窗口里，用transIn合计判断会把"上一轮的延迟
    // 入账"误判成"本轮重复转出"（假阳性）。dw是真实快照差值，不受账变延迟入账影响。
    if (-t.dw > prev.wallet + 0.01) {
      anomalies.push(`🚨 第${i}轮主钱包实际减少 ${fmt(-t.dw)}，超过本轮开始时的余额 ${fmt(prev.wallet)}（钱包被转出超过余额，有变负数风险）`);
    }
    if (snap.wallet < -0.01 || snap.arGame < -0.01) {
      anomalies.push(`🚨 第${i}轮结束后余额出现负数：主钱包 ${fmt(snap.wallet)}  游戏钱包 ${fmt(snap.arGame)}`);
    }
    if (t.transIn > prev.wallet + 0.01 && nearly(t.dw, 0)) {
      out(`  - ⚠️ 账变记录显示转入游戏合计 ${fmt(t.transIn)} 超过本轮开始余额 ${fmt(prev.wallet)}，但主钱包实际没变化——大概率是之前某轮操作延迟入账，不是本轮真的重复转出`);
    }
    for (const d of duplicateCheck(recs)) anomalies.push(`⚠️ 第${i}轮同一单号同类型重复记账：${d}`);

    if (key !== 'd' && !nearly(t.dt, t.otherNet)) {
      inTransitRounds += 1;
      out(`  - ⚠️ 本轮合计余额变化与非游戏账变差 ${signed(t.dt - t.otherNet)}，钱可能暂时在途，以用例结束回收后的结论为准`);
    }

    prev = snap;
    if (def.recoverInRound) {
      if (recs.some((r) => r.type === 'GameTransIn')) out('  - 本轮确实触发了转入游戏(GameTransIn)账变');
      await recover(tok);
      await sleep(SETTLE_MS);
      const after = await snapshot();
      const whole = summarize(roundStart, after, newRecords(roundStart, after));
      out(`  - 回收后：本轮合计${signed(whole.dt)}  主钱包 ${fmt(after.wallet)}  游戏钱包 ${fmt(after.arGame)}`);
      if (!nearly(whole.dt, whole.otherNet)) {
        anomalies.push(`🚨 第${i}轮回收后，合计余额仍差 ${signed(whole.dt - whole.otherNet)}（钱卡在中间态没回来，或者凭空多出/少了）`);
      }
      if (after.wallet < -0.01 || after.arGame < -0.01) {
        anomalies.push(`🚨 第${i}轮回收后余额出现负数：主钱包 ${fmt(after.wallet)}  游戏钱包 ${fmt(after.arGame)}`);
      }
      prev = after;
    }
  }

  const tok = await freshMemberToken();
  await recover(tok);
  await sleep(SETTLE_MS);
  await recover(tok);
  await sleep(SETTLE_MS);

  let gameNet = 0;
  if (key === 'd') {
    out('- 等待注单结算（最多150秒）...');
    const st = await waitOrdersSettled(caseStartMs, new Set([GAME_A.gameCode, GAME_B.gameCode]));
    gameNet = st.gameNet;
    out(`- 后台注单 ${st.count} 笔，未结算 ${st.unsettled} 笔，已结算输赢 ${signed(gameNet)}（脚本不控制下注，笔数请自行核对是否与你实际手动投注的次数一致）`);
    if (st.unsettled > 0) anomalies.push(`⚠️ 等待超时仍有 ${st.unsettled} 笔未结算，资金守恒结论可能不准`);
  }

  const end = await snapshot();
  const all = newRecords(start, end);
  const tAll = summarize(start, end, all);
  const expected = round2(tAll.otherNet + gameNet);
  const consOk = nearly(tAll.dt, expected);
  const chainIssues = chainCheck(start.ledger, all);
  if (end.arGame > 0.01) anomalies.push(`⚠️ 两次回收后游戏钱包仍有 ${fmt(end.arGame)}`);

  out(`收尾（两次回收余额后）：主钱包 ${fmt(end.wallet)}  游戏钱包 ${fmt(end.arGame)}  合计 ${fmt(end.total)}`);
  out(`- 资金守恒：合计变化 ${signed(tAll.dt)}，应为 ${signed(expected)}（非游戏账变 ${signed(tAll.otherNet)}${key === 'd' ? ` + 注单输赢 ${signed(gameNet)}` : ''}）${consOk ? ' ✅' : ` 🚨 差 ${signed(tAll.dt - expected)}`}`);
  out(`- 转入游戏合计 ${fmt(tAll.transIn)}，转回主钱包合计 ${fmt(tAll.transOut)}，账变 ${all.length} 条`);
  out(`- 账变链条：${chainIssues.length === 0 ? '✅ 连续，没有丢失更新的迹象' : `🚨 ${chainIssues.length} 处异常（需人工确认）`}`);
  for (const s of chainIssues) out(`  - ${s}`);
  if (inTransitRounds > 0) out(`- 有 ${inTransitRounds} 轮出现过"钱暂时在途"，回收后${consOk ? '已全部回来' : '没有全部回来'}`);
  for (const a of anomalies) out(`- ${a}`);

  const severe = !consOk || chainIssues.length > 0 || anomalies.some((a) => a.startsWith('🚨'));
  const verdict = severe ? '🚨 发现问题' : (anomalies.length ? '⚠️ 有疑点' : '✅ 通过');
  out(`- **结论：${verdict}**`);
  return { key, title: def.title, rounds, consOk, chain: chainIssues.length, anomalies: anomalies.length, verdict };
}

async function runRace() {
  const results = [];
  for (const key of CASES) {
    if (!CASE_DEFS[key]) { out(`\n跳过未知用例 ${key}`); continue; }
    results.push(await runCase(key));
  }
  out('\n## 汇总');
  out('| 用例 | 轮数 | 资金守恒 | 账变链条 | 疑点数 | 结论 |');
  out('|---|---|---|---|---|---|');
  for (const r of results) {
    out(`| ${r.key} ${r.title} | ${r.rounds} | ${r.consOk ? '✅' : '🚨'} | ${r.chain === 0 ? '✅' : `🚨${r.chain}处`} | ${r.anomalies} | ${r.verdict} |`);
  }
}

async function main() {
  if (!MEMBER_ACCOUNT || !MEMBER_PASSWORD) {
    console.error('[转账核对] ❌ 请用环境变量 MEMBER_ACCOUNT（手机号不带区号）和 MEMBER_PASSWORD 指定专门的测试账号');
    process.exit(1);
  }
  if (!ADMIN_URL || !DESK_URL || !ADMIN_USER) {
    console.error(`[转账核对] ❌ 租户 ${TENANT} 的前台/后台地址或管理员账号配置不完整，请检查 .env`);
    process.exit(1);
  }
  if (!['probe', 'race'].includes(MODE)) {
    console.error(`[转账核对] ❌ MODE 只能是 probe 或 race，收到 ${MODE}`);
    process.exit(1);
  }

  out(`# 钱包转账中间态核对报告（${MODE === 'probe' ? '第0步：探测触发点' : '第1步：碰撞测试'}）`);
  out(`- 时间：${new Date().toLocaleString('zh-CN', { hour12: false })}  租户：${TENANT}`);
  out(`- 游戏A：${gameLabel(GAME_A)}  游戏B：${gameLabel(GAME_B)}  每次操作后等待 ${SETTLE_MS}ms${MODE === 'race' ? `  用例：${CASES.join(',')}` : ''}`);

  adminToken = await adminLogin();
  USER_ID = await lookupUserId();
  await freshMemberToken(true);
  out(`- 会员ID：${USER_ID}（已登录，运行期间不要在浏览器登录这个账号）`);

  if (MODE === 'probe') await runProbe();
  else await runRace();

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const outPath = path.join(__dirname, `钱包转账核对报告_${MODE}_${stamp}.md`);
  fs.writeFileSync(outPath, report.join('\n') + '\n', 'utf-8');
  console.log(`\n[转账核对] 报告已写入 ${outPath}`);
}

main()
  .catch((e) => {
    console.error('[转账核对] 运行失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
