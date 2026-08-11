/**
 * delivery-verify.js  —  Firebase 推送「送达闭环」验证（阶段一：送达数量 / 送达率）
 *
 * 目标：把后台「Firebase 推送记录」里的 送达数量 / 送达率 验证到可自动对齐。
 *
 * 与 batch-push-test.js 的区别（这是本脚本的核心升级点）：
 *   batch-push-test.js  → 靠浏览器 console 文本判断「收到」，只能大致看有没有收到。
 *   delivery-verify.js  → 用 context.on('request') 拦截前端 + Service Worker 发起的
 *                          「埋点上报网络请求」，按事件名 mp_notification_receive 精确计数，
 *                          这才是后台报表真正统计的东西（console 打日志 ≠ 埋点上报成功）。
 *                          同时保留 console 计数做「交叉验证」，两者差异本身就是测试发现。
 *
 * 数据链路（本脚本负责验证中间两段）：
 *   后台发送(userId数=R) ──FCM──> 云端受理(成功数) ──设备──> 端上收到(mp_notification_receive=D)
 *                                                                        │
 *                                                            送达率 = D / R
 *
 * 口径说明：
 *   R  就绪设备数：真实 Chrome 登录成功且 Firebase SW 已注册（能收推送）的账号数。
 *      —— 这是「本次发送目标」的基准。请让后台把推送发给「这批已登录的人」，R 才是发送金标准。
 *      —— 也可用 EXPECT_SENT=后台实际发送数量 覆盖分母，报表更准。
 *   D  送达真值：拦截到 ≥1 次 mp_notification_receive 上报的账号数（账号级去重）。
 *   送达率 = D / R
 *
 * ⚠️ 首次务必先跑「侦察模式」把上报端点/参数摸清（见文件末尾运行说明）：
 *      $env:ACCOUNT="8487563389"; $env:PASSWORD="qwer1234"; $env:DISCOVER="true"; node delivery-verify.js
 *   把打印出来的「🔎 侦察」请求 URL/body 贴回来，即可把匹配规则和「后台报表接口」补精确。
 *
 * Firebase / 真实浏览器限制（沿用 batch-push-test.js，同样重要）：
 *   - 必须真实 Chrome（channel:'chrome'）：内置 Chromium 缺 FCM 组件，收不到推送。
 *   - 必须持久化上下文 + notifications 权限，否则 SW 与 FCM token 丢失。
 *   - 已关闭后台标签节流，保证后台窗口的 SW 通道也能收到推送。
 *
 * 运行（PowerShell；TENANT 选租户，默认 3004，支持 3001-3007/3101）：
 *  // 验证单个账号点击推送，推送链接：https://arplatsaassit3.club/wallet/recharge
 *  $env:TENANT="3005"; $env:ACCOUNT="45773591964"; $env:PASSWORD="qwer1234"; $env:HEADLESS="false"; $env:CLICK="true"; node delivery-verify.js
 * 
 * 批量无头运行：$env:TENANT="3005"; $env:COUNT="100"; $env:CLICK="true"; $env:CLICK_RATE="80"; node delivery-verify.js
 * COUNT=50 表示最多尝试 50 个账号（2.txt 里按行列出，去掉区号，最多 500 个）。
 * CLICK=true 表示收到送达后自动模拟点击（接口级上报），CLICK_RATE=50 表示约一半点击。
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================
// 配置
// ============================================================
// ───── 多租户配置（前台地址 + 区号），摘自 k6/config/envconfig.js ─────
const TENANTS = {
  '3001': { desk: 'https://arplatsaassit1.club',      code: '91'  },
  '3002': { desk: 'https://arplatsaassit2.club',      code: '92'  },
  '3003': { desk: 'https://3003.arplatsaassit3.club', code: '91'  },
  '3004': { desk: 'https://arplatsaassit4.club',      code: '91'  },
  '3005': { desk: 'https://arplatsaassit3.club',      code: '52'  },
  '3006': { desk: 'https://3006.arplatsaassit4.club', code: '880' },
  '3007': { desk: 'https://3007.arplatsaassit4.club', code: '92'  },
  '3101': { desk: 'https://arplatsaaspagesuat.club',  code: '91'  },
};
const TENANT        = String(process.env.TENANT || process.env.TENANT_ID || '3004');
const TCFG          = TENANTS[TENANT] || TENANTS['3004'];
const BASE_URL      = process.env.BASE_URL || TCFG.desk;      // 前台地址（BASE_URL 显式覆盖优先）
const LOGIN_URL     = `${BASE_URL}/login`;
const PASSWORD      = process.env.PASSWORD || 'qwer1234';
const COUNTRY_CODE  = process.env.COUNTRY_CODE || TCFG.code;  // loadAccounts 去区号用
// 账号文件：多租户用 ACCOUNTS_FILE 指定对应租户的 2.txt；默认 firebase/2.txt
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE
  ? path.resolve(process.env.ACCOUNTS_FILE)
  : path.join(__dirname, '..', 'tests', 'api', 'activity', 'firebase', '2.txt');

// 最多读取/尝试的账号数（测试用 5，正式可改大，上限 500）
const MAX_ACCOUNTS  = Math.min(parseInt(process.env.COUNT || '5', 10), 500);

// ───── 压测式爬坡登录参数（沿用 batch-push-test.js）─────
const START_VUS     = parseInt(process.env.START_VUS || '5', 10);
const MAX_VUS       = parseInt(process.env.MAX_VUS || process.env.CONCURRENCY || '50', 10);
const RAMP_SECONDS  = parseInt(process.env.RAMP_SECONDS || '120', 10);
const STAGGER_MIN   = parseInt(process.env.STAGGER_MIN || '300', 10);
const STAGGER_MAX   = parseInt(process.env.STAGGER_MAX || '800', 10);
// 有头/无头：显式 HEADLESS 优先；未指定时侦察(DISCOVER)默认有头方便观察，正式默认无头
const HEADLESS      = process.env.HEADLESS !== undefined
  ? process.env.HEADLESS !== 'false'
  : process.env.DISCOVER !== 'true';
const LOGIN_TIMEOUT = parseInt(process.env.LOGIN_TIMEOUT || '20000', 10);

// ───── 送达验证参数 ─────
// 侦察模式：dump 所有疑似埋点/分析上报请求，用于首跑摸清端点与口径
const DISCOVER      = process.env.DISCOVER === 'true';
// 后台本次实际发送数量（分母）。不填则用「就绪设备数 R」当分母
const EXPECT_SENT   = process.env.EXPECT_SENT ? parseInt(process.env.EXPECT_SENT, 10) : null;
// 无人值守：跑满 DURATION 秒后自动输出报表并退出（不设则常驻等 Ctrl+C）
const DURATION      = process.env.DURATION ? parseInt(process.env.DURATION, 10) : null;
// 接口级点击模拟：CLICK=true 时，收到送达后自动构造 action=CLICK_ACTION 的 /api/Push/Report 上报（模拟点击）
const SIMULATE_CLICK = process.env.CLICK === 'true';
const CLICK_ACTION   = parseInt(process.env.CLICK_ACTION || '2', 10); // 点击的 action 值（推测 2，可配）
const CLICK_RATE     = process.env.CLICK_RATE !== undefined ? parseFloat(process.env.CLICK_RATE) : 100; // 点击概率(%)：100=全点，50=约一半，用于验证后台点击率

// 埋点事件名（后台报表统计的就是这些上报）
const EV_RECEIVE = 'mp_notification_receive';  // 送达（本阶段核心）
const EV_CLICK   = 'mp_notification_click';    // 点击（第二阶段，此处仅顺带侦察计数）

// 侦察时判定「疑似埋点/分析请求」的特征
const DISCOVER_HINT = /mp_notification|mp_firebase|google-analytics|analytics\.google|\/g\/collect|\/mp\/collect|\/collect\b|firebase.*log|report.*event|\/track/i;

// ============================================================
// 全局状态
// ============================================================
const results      = { success: [], fail: [] };  // 登录成功 / 失败 { account, reason }
const openContexts = [];                          // 保持存活的成功上下文
const readySet     = new Set();                   // Firebase SW 已就绪（可收推送）的账号
const netRecv      = new Map();                   // account -> { count, msgIds:Set } receive 上报次数 / 去重消息集
const consoleRecv  = new Map();                   // account -> count    console 兜底判定的收到次数
const netClick     = new Map();                   // account -> { count, msgIds:Set } click 上报次数 / 去重消息集
const discoverDump = new Map();                   // account -> [{method,url,body}] 侦察样本
const pushCtx      = new Map();                   // account -> { token, lastReport:{msgId,reportId,language} } 供点击模拟复用凭证
const clickSim     = new Map();                   // account -> { sent:Set, ok, fail } 接口级点击模拟结果
const clickDecided = new Map();                   // account -> Set<msgId> 已决策是否点击（防同一消息前台+SW双通道重复决策）
let   useChrome    = process.env.USE_CHROME !== 'false'; // USE_CHROME=false 强制内置 Chromium（调试用；内置缺 FCM 组件收不到真实推送）

// ============================================================
// 读取账号：去掉区号、去重、截断
// ============================================================
function loadAccounts() {
  // 单账号模式：设了 ACCOUNT/ACC 就只用它（账号+密码你自己指定），跳过 2.txt，原样使用不去区号。
  //   用法：$env:ACCOUNT="登录框里的账号"; $env:PASSWORD="密码"; node delivery-verify.js
  const single = process.env.ACCOUNT || process.env.ACC;
  if (single) return [single.trim()];

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    throw new Error(`账号文件不存在: ${ACCOUNTS_FILE}`);
  }
  const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
  const list = raw
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !s.includes('@'))                                // 跳过邮箱账号
    .map(s => (s.startsWith(COUNTRY_CODE) ? s.slice(COUNTRY_CODE.length) : s));

  const seen = new Set();
  const unique = [];
  for (const a of list) {
    if (!seen.has(a)) { seen.add(a); unique.push(a); }
  }
  return unique.slice(0, MAX_ACCOUNTS);
}

// ============================================================
// 启动浏览器上下文（优先真实 Chrome）
// ============================================================
async function launchContext(userDataDir) {
  const baseOpts = {
    headless: HEADLESS,
    permissions: ['notifications'],
    serviceWorkers: 'allow',
    viewport: { width: 390, height: 844 }, // 移动端 H5 视口：布局正常，规避桌面宽屏下元素不可交互
    args: [
      '--disable-infobars',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  };

  if (useChrome) {
    try {
      return await chromium.launchPersistentContext(userDataDir, { channel: 'chrome', ...baseOpts });
    } catch (e) {
      console.warn(
        `\n[⚠️ 警告] 无法启动本机 Chrome(channel=chrome): ${e.message}\n` +
        `         回退到内置 Chromium —— 可能收不到 Firebase 推送。建议安装 Google Chrome。\n`
      );
      useChrome = false;
    }
  }
  return await chromium.launchPersistentContext(userDataDir, baseOpts);
}

// ============================================================
// 解析 GA4 /g/collect 上报：一个请求 body 可能批量多个事件（以 en= 分隔）。
// 返回 hay 中指定事件的出现列表（每项为该事件的 ep.messageId，无则 null）。
//   GA4 body 形如：en=mp_notification_receive&_ee=1&ep.origin=firebase&...&ep.messageId=400704&...
//   注意精确切分：同一请求里 mp_notification_receive 与 mp_notification_display 会共存，不能整体算一次。
// ============================================================
function extractGa4EventMsgIds(hay, eventName) {
  const out = [];
  const parts = String(hay).split('en=');
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    if (seg.startsWith(eventName + '&') || seg === eventName ||
        seg.startsWith(eventName + '\r') || seg.startsWith(eventName + '\n') || seg.startsWith(eventName + ' ')) {
      const m = seg.match(/ep\.messageId=(\d+)/);
      out.push(m ? m[1] : null);
    }
  }
  return out;
}

// ============================================================
// 接口级点击模拟：复刻 signature.js 签名，构造 action=CLICK_ACTION 的 /api/Push/Report 上报
//   签名（已用真实送达 body 反算验证 MATCH，含 3004/en 与 3005/hi）：排除 signature/timestamp/track+空值 → key 排序 → JSON.stringify → MD5 大写（secret 空）
//   凭证在 body 里（reportId 或 token），随 body 参与签名；不走 Authorization 头。
// ============================================================
function signPushReport(fields) {
  const exclude = new Set(['signature', 'timestamp', 'track']);
  const filtered = {};
  Object.keys(fields).sort().forEach((k) => {
    const v = fields[k];
    if (exclude.has(k) || v === null || v === undefined || v === '') return;
    filtered[k] = v;
  });
  return crypto.createHash('md5').update(JSON.stringify(filtered)).digest('hex').toUpperCase();
}

async function simulateClick(context, account, msgId) {
  const lr = (pushCtx.get(account) || {}).lastReport;
  if (!lr || (!lr.reportId && !lr.bodyToken)) { console.log(`[🖱️ 点击模拟] ${account} 无 reportId/token（送达上报未解析到凭证），跳过`); return; }
  const language = lr.language || 'en';
  const random = Math.floor(1e11 + Math.random() * 9e11); // 保证 12 位（后台校验 Random 必须是 12 位数字）
  const timestamp = Math.floor(Date.now() / 1000);
  // 凭证在 body 里（非 Authorization 头）：优先 reportId 格式（400743 即此，签名已跨租户/多语言验证）；
  // 无 reportId 时回退 token 格式（token 进 body，随 body 参与签名）。
  const fields = lr.reportId
    ? { action: CLICK_ACTION, language, msgId, random, reportId: lr.reportId }
    : { action: CLICK_ACTION, language, msgId, random, token: lr.bodyToken };
  const body = JSON.stringify({ ...fields, timestamp, signature: signPushReport(fields) });
  try {
    const resp = await context.request.post(`${BASE_URL}/api/Push/Report`, {
      headers: { 'Content-Type': 'application/json', 'Domainurl': BASE_URL, 'Referrer': BASE_URL },
      data: body,
    });
    const txt = (await resp.text()).slice(0, 150);
    const rec = clickSim.get(account) || { sent: new Set(), ok: 0, fail: 0 };
    rec.sent.add(String(msgId));
    if (resp.ok()) rec.ok += 1; else rec.fail += 1;
    clickSim.set(account, rec);
    console.log(`[🖱️ 点击模拟·发送] ${account} action=${CLICK_ACTION} msgId=${msgId} 用${lr.reportId ? 'reportId' : 'token'} → HTTP ${resp.status()} ${txt}`);
  } catch (e) {
    console.log(`[🖱️ 点击模拟·失败] ${account} ${e.message}`);
  }
}

// ============================================================
// 网络拦截（context 级）：抓「前端 + Service Worker」发起的埋点上报
//   —— 后台报表统计的就是这些上报请求，这是本脚本相较 console 文本的核心升级。
//   —— context 级能覆盖 page 与 SW 发起的请求（serviceWorkers:'allow'）。
// ============================================================
function attachNetworkListener(context, account) {
  // 点击侦察：点通知后常新开页面（SW openWindow 带消息参数的 URL）。dump 打开/导航的 URL，
  // 摸清「点击跳转 URL」到底打开哪里、带什么消息参数，进而实现自动模拟点击（路径 a）。
  context.on('page', (newPage) => {
    const u0 = newPage.url();
    if (u0 && u0 !== 'about:blank') console.log(`[🔗 点击打开页面] ${account} → ${u0}`);
    newPage.on('framenavigated', (frame) => {
      if (frame === newPage.mainFrame() && frame.url() && frame.url() !== 'about:blank') {
        console.log(`[🔗 点击导航到] ${account} → ${frame.url()}`);
      }
    });
  });

  context.on('request', (req) => {
    const url = req.url();
    let post = '';
    try { post = req.postData() || ''; } catch (e) { /* 部分请求无 body */ }
    const hay = `${url} ${post}`;

    // 侦察：把疑似埋点/分析请求 dump 出来（每账号限量，避免刷屏）
    if (DISCOVER && DISCOVER_HINT.test(hay)) {
      const dl = discoverDump.get(account) || [];
      if (dl.length < 10) {
        dl.push({ method: req.method(), url, body: post.slice(0, 400) });
        discoverDump.set(account, dl);
        console.log(`[🔎 侦察] ${account} ${req.method()} ${url.slice(0, 140)}`);
        if (post) console.log(`         body: ${post.slice(0, 400)}`);
      }
    }

    // ★ 主站上报接口 /api/Push/Report —— 后台「送达/点击」报表的真实数据源（GA4 只是给 Google 的埋点）
    //   凭证在 body 里（不是 Authorization 头）：① reportId 格式（body 带 reportId，无 token）② token 格式（body 带 token）。
    //   action=1=送达。点击模拟优先复用 reportId 格式（已跨租户/多语言验证签名）。
    if (/\/api\/Push\/Report/i.test(url)) {
      let mid = null, action = null, reportId = null, language = 'en', bodyToken = null;
      try { const j = JSON.parse(post); mid = (j.msgId !== undefined ? j.msgId : j.msgID); action = j.action; reportId = j.reportId || null; if (j.language) language = j.language; bodyToken = j.token || null; } catch (e) { /* 非 JSON */ }
      const cred = reportId ? `reportId=${reportId}` : (bodyToken ? '[body-token]' : '[无凭证]');
      console.log(`[📡 Push/Report·主站上报] ${account} msgId=${mid} action=${action} ${cred}  body=${post.slice(0, 150)}`);
      // 记录凭证（reportId 优先），供接口级点击模拟复用
      if (action === 1 && mid != null && (reportId || bodyToken)) {
        const cur = pushCtx.get(account) || {};
        cur.lastReport = { msgId: mid, reportId, language, bodyToken };
        pushCtx.set(account, cur);
      }
      // 接口级点击模拟：收到「送达(action=1)」后，按 CLICK_RATE 概率决定是否模拟点击（每 msgId 只决策一次）
      if (SIMULATE_CLICK && action === 1 && mid != null) {
        const dec = clickDecided.get(account) || new Set();
        if (!dec.has(String(mid))) {
          dec.add(String(mid));
          clickDecided.set(account, dec);
          if (Math.random() * 100 < CLICK_RATE) {
            setTimeout(() => simulateClick(context, account, mid), 1500);
          } else {
            console.log(`[🖱️ 跳过点击] ${account} msgId=${mid}（按 CLICK_RATE=${CLICK_RATE}%）`);
          }
        }
      }
    }

    // 送达上报：解析 GA4 事件，按 messageId 记录（后台按设备/消息去重时用 msgIds.size）
    const recvHits = extractGa4EventMsgIds(hay, EV_RECEIVE);
    if (recvHits.length) {
      const rec = netRecv.get(account) || { count: 0, msgIds: new Set() };
      for (const mid of recvHits) { rec.count += 1; if (mid) rec.msgIds.add(mid); }
      netRecv.set(account, rec);
      console.log(`[📥 送达上报·网络] ${account}（msgId=${recvHits.join(',')} 累计 ${rec.count} 次 / ${rec.msgIds.size} 条去重）`);
    }

    // 点击上报：同样解析（第二阶段用）
    const clickHits = extractGa4EventMsgIds(hay, EV_CLICK);
    if (clickHits.length) {
      const rec = netClick.get(account) || { count: 0, msgIds: new Set() };
      for (const mid of clickHits) { rec.count += 1; if (mid) rec.msgIds.add(mid); }
      netClick.set(account, rec);
      console.log(`[🖱️ 点击上报·网络] ${account}（msgId=${clickHits.join(',')} 累计 ${rec.count} 次）`);
    }
  });
}

// ============================================================
// console 监听：就绪确认 + 送达兜底计数（交叉验证网络拦截，尤其 SW 后台通道）
// ============================================================
function attachConsoleListener(page, account) {
  let readyNotified = false;

  page.on('console', (msg) => {
    const text = msg.text();

    // 前台推送（Firebase onMessage）
    if (text.includes('onMessageFn received foreground message')) {
      consoleRecv.set(account, (consoleRecv.get(account) || 0) + 1);
      return;
    }
    // 后台推送（Service Worker 展示通知）
    if (text.includes('onMessageFn through Service Worker display notification')) {
      consoleRecv.set(account, (consoleRecv.get(account) || 0) + 1);
      return;
    }
    // 通用兜底（收到 SW 消息）
    if (text.includes('收到 SW 消息') && !text.includes('未处理')) {
      consoleRecv.set(account, (consoleRecv.get(account) || 0) + 1);
      return;
    }

    // Firebase 就绪：确认该设备已可接收推送（每账号只提示一次）
    if (!readyNotified &&
        (text.includes('firebase-messaging-sw.js注册结束') ||
         text.includes('[Firebase SW] Service Worker registered'))) {
      readyNotified = true;
      readySet.add(account);
      console.log(`[✅ Firebase就绪] ${account}（已可接收推送）`);
    }
  });
}

// ============================================================
// 解析登录失败原因
// ============================================================
function extractFailReason(loginResp) {
  if (!loginResp) return '登录后未跳转（疑似账号/密码错误或被验证码拦截）';
  try {
    const j = JSON.parse(loginResp.body);
    const msg  = j.msg || j.message || j.errMsg || '';
    const code = j.code !== undefined ? j.code : j.msgCode;
    if (msg) return `接口返回 msg=${msg}${code !== undefined ? ` code=${code}` : ''}`;
  } catch (e) { /* 非 JSON */ }
  return `登录后未跳转 (HTTP ${loginResp.status})`;
}

// ============================================================
// 稳健填值：应对「fake-password」等防自动填充/反自动化输入框
//   1) click 聚焦（触发去 readonly 的 JS）→ 常规 fill，读回值校验
//   2) 失败则注入式：native value setter + input/change/blur 事件（React/Vue 受控组件可识别）
// ============================================================
async function robustFill(page, selector, value) {
  const loc = page.locator(selector);
  // 常规路径：可见→聚焦→fill，读回值校验；任一步失败都 fallthrough 到注入式
  try {
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await loc.click({ timeout: 4000 });
    await loc.fill(value, { timeout: 5000 });
    if ((await loc.inputValue().catch(() => '')) === value) return;
  } catch (e) { /* 落到注入式兜底 */ }
  // 注入式兜底：元素只要在 DOM（不要求 visible/可交互）即可用 native setter 设值
  await page.waitForSelector(selector, { state: 'attached', timeout: 8000 }).catch(() => {});
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { sel: selector, val: value });
}

// 提交按钮点击：常规 → force → JS 兜底（应对 actionability 卡顿）
async function clickSubmit(page, selector) {
  const loc = page.locator(selector);
  try { await loc.click({ timeout: 5000 }); return; } catch (e) { /* next */ }
  try { await loc.click({ force: true, timeout: 5000 }); return; } catch (e) { /* next */ }
  await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click(); }, selector);
}

// ============================================================
// 单账号登录
// ============================================================
async function loginClient(account) {
  const userDataDir = path.join(__dirname, '.browser_profiles', `profile_${account}`);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  let context;
  try {
    context = await launchContext(userDataDir);
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // 先挂监听（网络 + console），避免漏掉初始化阶段的上报与就绪日志
    attachNetworkListener(context, account);
    attachConsoleListener(page, account);

    // 捕获登录接口返回，用于失败原因
    let loginResp = null;
    page.on('response', async (resp) => {
      try {
        if (resp.request().method() === 'POST' && /login|signin|sign-in/i.test(resp.url())) {
          loginResp = { status: resp.status(), body: await resp.text() };
        }
      } catch (e) { /* 响应体可能已释放 */ }
    });

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="form-input-userName"]', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500); // 等水合 / 防填充脚本就绪，避免 fake-password 框不可编辑
    await robustFill(page, '[data-testid="form-input-userName"]', account);
    await robustFill(page, '[data-testid="form-input-password"]', PASSWORD);
    await clickSubmit(page, '[data-testid="login-submit-btn"]');

    try {
      await page.waitForFunction(
        () => !location.pathname.includes('/login'),
        null,
        { timeout: LOGIN_TIMEOUT }
      );
    } catch (e) {
      const reason = extractFailReason(loginResp);
      results.fail.push({ account, reason });
      console.error(`[❌ 登录失败] ${account} → ${reason}`);
      await context.close();
      return;
    }

    results.success.push(account);
    openContexts.push({ account, context });
    console.log(`[✅ 登录成功] ${account}（保持存活，等待推送）`);

  } catch (error) {
    results.fail.push({ account, reason: error.message });
    console.error(`[❌ 异常] ${account} → ${error.message}`);
    if (context) { try { await context.close(); } catch (e) { /* ignore */ } }
  }
}

// 小工具
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// ============================================================
// 压测式爬坡登录调度器（沿用 batch-push-test.js）
// ============================================================
async function runRamp(accounts) {
  const total     = accounts.length;
  const rampMs    = RAMP_SECONDS * 1000;
  const startTime = Date.now();

  let idx = 0, inFlight = 0, done = 0;

  const targetConcurrency = () => {
    const t = Math.min(1, (Date.now() - startTime) / rampMs);
    return Math.max(1, Math.round(START_VUS + (MAX_VUS - START_VUS) * t));
  };

  const reporter = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(
      `[进度 ${elapsed}s] 已启动 ${idx}/${total}  完成 ${done}  ` +
      `当前并发 ${inFlight}/${targetConcurrency()}  ` +
      `成功 ${results.success.length}  失败 ${results.fail.length}`
    );
  }, 5000);

  while (idx < total) {
    if (inFlight < targetConcurrency()) {
      const account = accounts[idx++];
      inFlight++;
      loginClient(account).then(() => { inFlight--; done++; });
      await sleep(randBetween(STAGGER_MIN, STAGGER_MAX));
    } else {
      await sleep(100);
    }
  }
  while (done < total) await sleep(200);

  clearInterval(reporter);
}

// ============================================================
// 登录汇总
// ============================================================
function printSummary() {
  console.log('\n' + '='.repeat(55));
  console.log(`  批量登录汇总   成功: ${results.success.length}   失败: ${results.fail.length}   就绪: ${readySet.size}`);
  console.log('='.repeat(55));
  if (results.fail.length) {
    console.log(`❌ 失败账号 (${results.fail.length}):`);
    results.fail.forEach(f => console.log(`   ${f.account}  →  ${f.reason}`));
  }
  console.log('='.repeat(55) + '\n');
}

// ============================================================
// 【预留】拉取后台报表做自动断言
//   首跑侦察确认「Firebase 推送记录」查询接口后再实现（POST + 签名 + Bearer，
//   范式见 k6/tests/api/rptDashboard/rptDashboardApi.js）。届时可断言：
//     report.送达数量 == D（按后台去重口径折算）
//     report.送达率   == D / R
// ============================================================
async function fetchBackendReport(/* pushId */) {
  return null; // TODO: 首跑确认接口后实现
}

// ============================================================
// 送达闭环报表
// ============================================================
function printExitReport() {
  const R      = EXPECT_SENT || readySet.size || results.success.length;
  const RLabel = EXPECT_SENT ? `EXPECT_SENT=${EXPECT_SENT}` : (readySet.size ? `就绪设备数=${readySet.size}` : `登录成功数=${results.success.length}（就绪判定为空，降级）`);

  const netAccounts = [...netRecv.entries()].filter(([, r]) => r.count > 0).map(([a]) => a);
  const conAccounts = [...consoleRecv.entries()].filter(([, c]) => c > 0).map(([a]) => a);
  const D_net = netAccounts.length;
  const D_con = conAccounts.length;

  // 送达真值取「网络拦截」为准（后台统计的是上报）；console 用于交叉验证
  const D = D_net;
  const rate = R > 0 ? ((D / R) * 100).toFixed(2) : 'N/A';

  const netTotal = [...netRecv.values()].reduce((s, r) => s + r.count, 0);
  const clkAccounts = [...netClick.entries()].filter(([, r]) => r.count > 0).map(([a]) => a);

  // 交叉验证差异：某通道被一侧捕获、另一侧没有 —— 本身就是测试发现
  const onlyNet = netAccounts.filter(a => !conAccounts.includes(a));
  const onlyCon = conAccounts.filter(a => !netAccounts.includes(a));

  // 就绪但两通道都没收到 = 疑似未送达
  const readyArr = [...readySet];
  const notDelivered = (readySet.size ? readyArr : results.success)
    .filter(a => !netAccounts.includes(a) && !conAccounts.includes(a));

  console.log('\n' + '='.repeat(60));
  console.log('                Firebase 送达闭环报表（阶段一）');
  console.log('='.repeat(60));
  console.log(`  分母 R（发送/就绪基准）: ${R}   来源: ${RLabel}`);
  console.log('-'.repeat(60));
  console.log(`  送达账号数 D（网络拦截·账号级去重）: ${D_net}`);
  console.log(`  送达账号数（console 交叉验证）:      ${D_con}`);
  console.log(`  送达上报总次数（网络·未去重）:        ${netTotal}`);
  console.log('-'.repeat(60));
  console.log(`  ✅ 送达率 = D / R = ${D} / ${R} = ${rate}%`);
  console.log('-'.repeat(60));
  console.log('  与后台报表核对（人工，或补 fetchBackendReport 后自动）：');
  console.log(`    · 若后台按「设备/用户去重」→ 送达数量 应 ≈ ${D}，送达率 应 ≈ ${rate}%`);
  console.log(`    · 若后台按「事件累加」    → 送达数量 应 ≈ ${netTotal}`);
  console.log('-'.repeat(60));
  if (onlyNet.length || onlyCon.length) {
    console.log('  ⚠️ 网络 vs console 交叉验证存在差异（需关注 SW 通道是否漏抓上报）：');
    if (onlyNet.length) console.log(`     仅网络捕获(${onlyNet.length}): ${onlyNet.slice(0, 20).join(', ')}`);
    if (onlyCon.length) console.log(`     仅console捕获(${onlyCon.length}): ${onlyCon.slice(0, 20).join(', ')}`);
  } else {
    console.log('  ✅ 网络与 console 两侧计数账号一致（无通道漏抓）');
  }
  console.log('-'.repeat(60));
  if (notDelivered.length) {
    console.log(`  ❌ 就绪但未送达 (${notDelivered.length}): ${notDelivered.slice(0, 30).join(', ')}${notDelivered.length > 30 ? ' ...' : ''}`);
  }
  // ── 点击闭环（接口级模拟 C / 真实观测）──
  const simOk   = [...clickSim.values()].reduce((s, r) => s + r.ok, 0);
  const simFail = [...clickSim.values()].reduce((s, r) => s + r.fail, 0);
  if (SIMULATE_CLICK || simOk || simFail || clkAccounts.length) {
    const C    = simOk; // 点击真值：接口级模拟成功上报的账号/消息数
    const ctrD = D > 0 ? ((C / D) * 100).toFixed(2) : 'N/A';
    const ctrR = R > 0 ? ((C / R) * 100).toFixed(2) : 'N/A';
    console.log('-'.repeat(60));
    console.log(`  点击数 C（接口级模拟 action=${CLICK_ACTION} 成功）: ${C}${simFail ? `   失败 ${simFail}` : ''}`);
    if (clkAccounts.length) console.log(`  真实点击上报(GA4)账号: ${clkAccounts.length}`);
    console.log(`  ✅ 点击率 = C / D = ${C} / ${D} = ${ctrD}%   （或 C / R = ${ctrR}%）；目标点击概率 CLICK_RATE=${CLICK_RATE}%`);
    console.log(`  与后台核对：点击数量 应 ≈ ${C}；点击率按其口径 ≈ ${ctrD}%(点击/送达) 或 ${ctrR}%(点击/发送)`);
  }
  console.log('='.repeat(60) + '\n');

  if (DISCOVER) {
    console.log('='.repeat(60));
    console.log('                侦察样本（疑似埋点/分析上报）');
    console.log('='.repeat(60));
    if (discoverDump.size === 0) {
      console.log('  未捕获到任何疑似埋点请求。可能：埋点走 SW 未被拦截 / 事件名不同 / 还没触发推送。');
      console.log('  排查：确认已从后台发过推送；或放宽 DISCOVER_HINT 正则再跑。');
    } else {
      for (const [account, arr] of discoverDump.entries()) {
        console.log(`  [${account}]`);
        arr.forEach(s => {
          console.log(`    ${s.method} ${s.url.slice(0, 160)}`);
          if (s.body) console.log(`      body: ${s.body}`);
        });
      }
      console.log('\n  👉 请把上面的 URL/body 贴回，用于把「送达/点击」匹配规则与「后台报表接口」补精确。');
    }
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const accounts = loadAccounts();
  const singleMode = process.env.ACCOUNT || process.env.ACC;
  console.log(singleMode
    ? `单账号模式：${accounts[0]}（账号/密码由环境变量指定，跳过 2.txt）`
    : `读取到 ${accounts.length} 个账号（已去掉区号 ${COUNTRY_CODE}）`);
  console.log(`租户: ${TENANT}  前台: ${BASE_URL}  区号: ${COUNTRY_CODE}`);
  const clickCfg = SIMULATE_CLICK ? `action=${CLICK_ACTION} 概率=${CLICK_RATE}%(开)` : '关（需加 CLICK=true）';
  console.log(`配置: 爬坡 ${START_VUS}→${MAX_VUS}  无头=${HEADLESS}  侦察=${DISCOVER}  点击模拟=${clickCfg}`);
  if (EXPECT_SENT) console.log(`分母 EXPECT_SENT=${EXPECT_SENT}（后台实际发送数量）`);
  console.log('');

  const t0 = Date.now();
  await runRamp(accounts);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  printSummary();

  console.log('='.repeat(55));
  console.log(`✅ 登录完毕（共 ${accounts.length}，用时 ${elapsed}s）成功 ${results.success.length} 就绪 ${readySet.size} 失败 ${results.fail.length}`);
  console.log('='.repeat(55) + '\n');

  if (openContexts.length === 0) {
    console.log('没有任何账号登录成功，退出。');
    process.exit(0);
  }

  console.log(`>>> ${openContexts.length} 个浏览器保持存活中。`);
  console.log('>>> 现在请去后台把 Firebase 推送发给「这批已登录的人」（定向 targetType:6，userId 用同批 1.txt）。');
  if (DURATION) {
    console.log(`>>> DURATION=${DURATION}s：到时自动输出报表并退出。\n`);
    setTimeout(() => gracefulShutdown(`已到 DURATION=${DURATION}s`), DURATION * 1000);
  } else {
    console.log('>>> 收到的送达上报会实时打印；按 Ctrl+C 结束并输出送达闭环报表。\n');
  }

  await new Promise(() => {}); // 保持进程存活，持续计数
}

// 优雅退出：先出报表，再关浏览器（SIGINT 与 DURATION 共用）
let exiting = false;
async function gracefulShutdown(reason) {
  if (exiting) return;
  exiting = true;
  console.log(`\n${reason}，正在生成送达闭环报表并关闭浏览器...`);
  printExitReport();
  for (const { context } of openContexts) {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('收到退出信号'));

main().catch((err) => {
  console.error('运行失败:', err);
  process.exit(1);
});
