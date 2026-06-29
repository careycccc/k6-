/**
 * batch-push-test.js
 * 批量登录前台用户 + 监听 Firebase 推送
 *
 * 流程：
 *   1. 从 firebase/2.txt 读取账号（自动去掉区号 91），最多 MAX_ACCOUNTS 个
 *   2. 用真实 Chrome 批量登录（密码固定 qwer1234）
 *   3. 统计成功 / 失败，失败的详细打印账号 + 原因
 *   4. 登录成功的浏览器全部保持存活
 *   5. 你去后台手动发送 Firebase 消息，收到的推送实时打印（按账号区分）
 *   6. Ctrl+C 结束并关闭所有浏览器
 *
 * 运行：
 *   node k6/playwrith/batch-push-test.js
 *   COUNT=5 node k6/playwrith/batch-push-test.js          # 跑 500 个
 *   HEADLESS=true COUNT=20 node k6/playwrith/batch-push-test.js
 *
 * ⚠️ Firebase / 模拟浏览器限制（很重要）：
 *   - 必须用真实 Chrome（channel:'chrome'）。Playwright 自带的 Chromium 缺少
 *     Google FCM 推送组件，会报 firebase 初始化失败 / 收不到推送。
 *   - 必须有头（headless:false）。无头模式下 Service Worker/Push 常被禁用。
 *   - 必须持久化上下文 + notifications 权限，否则 SW 与 FCM token 会丢。
 *   - 后台标签会被 Chrome 冻结，已用启动参数关闭节流，保证后台也能收到推送。
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================================
// 配置
// ============================================================
const BASE_URL      = process.env.BASE_URL || 'https://arplatsaassit4.club';
const LOGIN_URL     = `${BASE_URL}/login`;
const PASSWORD      = process.env.PASSWORD || 'qwer1234';
const COUNTRY_CODE  = '91';                                  // 要去掉的固定区号
const ACCOUNTS_FILE = path.join(__dirname, '..', 'tests', 'api', 'activity', 'firebase', '2.txt');

// 最多读取/尝试的账号数（测试用 5，正式可改 500，上限 500）
const MAX_ACCOUNTS  = Math.min(parseInt(process.env.COUNT || '5', 10), 500);

// ───── 压测式爬坡登录参数 ─────
// 起始并发数（开始时同时登录的人数）
const START_VUS     = parseInt(process.env.START_VUS || '5', 10);
// 峰值并发数（爬坡到最高时同时登录的人数）
const MAX_VUS       = parseInt(process.env.MAX_VUS || process.env.CONCURRENCY || '50', 10);
// 爬坡时长(秒)：在这段时间内把并发从 START_VUS 线性升到 MAX_VUS
const RAMP_SECONDS  = parseInt(process.env.RAMP_SECONDS || '120', 10);
// 每个账号启动之间的随机错峰延迟(ms)，降低后台「请勿重复提交(code=11)」限流
const STAGGER_MIN   = parseInt(process.env.STAGGER_MIN || '300', 10);
const STAGGER_MAX   = parseInt(process.env.STAGGER_MAX || '800', 10);
// 默认无头（真 Chrome 的新版 headless 支持 SW/Push，console 日志照样可抓）；
// 想看浏览器窗口用 HEADLESS=false
const HEADLESS      = process.env.HEADLESS !== 'false';
// 登录跳转判定超时
const LOGIN_TIMEOUT = parseInt(process.env.LOGIN_TIMEOUT || '20000', 10);
// 推送去重窗口(ms)：同一条消息的「前台onMessage + 后台SW」两个通道在此窗口内只计 1 次
const DEDUPE_WINDOW = parseInt(process.env.DEDUPE_WINDOW || '2000', 10);

// ============================================================
// 全局状态
// ============================================================
const results      = { success: [], fail: [] };  // 登录成功账号 / 登录失败 { account, reason }
const openContexts = [];                          // 保持存活的成功上下文
const receivedPush = new Map();                   // account -> 收到推送的「消息」数（已去重）
const lastPushAt   = new Map();                   // account -> 最近一次推送时间戳（用于去重）
let   useChrome    = true;                         // 能否使用本机真实 Chrome

// ============================================================
// 读取账号：去掉区号、去重、截断
// ============================================================
function loadAccounts() {
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

  // 去重保序
  const seen = new Set();
  const unique = [];
  for (const a of list) {
    if (!seen.has(a)) { seen.add(a); unique.push(a); }
  }
  return unique.slice(0, MAX_ACCOUNTS);
}

// ============================================================
// 启动浏览器上下文（优先真实 Chrome，失败回退内置 Chromium 并告警）
// ============================================================
async function launchContext(userDataDir) {
  const baseOpts = {
    headless: HEADLESS,
    permissions: ['notifications'],
    serviceWorkers: 'allow',
    args: [
      '--disable-infobars',
      '--disable-extensions',
      // 关闭后台标签节流/冻结，保证后台窗口也能收到 Firebase 推送
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
        `         回退到 Playwright 内置 Chromium —— 内置 Chromium 可能导致 Firebase\n` +
        `         初始化失败 / 收不到推送。建议安装 Google Chrome。\n`
      );
      useChrome = false;
    }
  }
  return await chromium.launchPersistentContext(userDataDir, baseOpts);
}

// ============================================================
// 监听浏览器 console：Firebase 推送 + 初始化错误
// ============================================================
function attachConsoleListener(page, account) {
  // 每账号只提示一次的状态标记
  let firebaseReadyNotified = false;

  page.on('console', (msg) => {
    const text = msg.text();

    // 前台推送（Firebase onMessage）
    if (text.includes('onMessageFn received foreground message')) {
      printPush('🔥 前台推送', account, text);
      return;
    }
    // 后台推送（Service Worker 展示通知）
    if (text.includes('onMessageFn through Service Worker display notification')) {
      printPush('🔔 后台SW推送', account, text);
      return;
    }
    // 通用兜底（收到 SW 消息）
    if (text.includes('收到 SW 消息') && !text.includes('未处理')) {
      printPush('💬 SW消息', account, text);
      return;
    }

    // Firebase 就绪：正向确认能收推送了（每账号只提示一次）
    if (!firebaseReadyNotified &&
        (text.includes('firebase-messaging-sw.js注册结束') ||
         text.includes('[Firebase SW] Service Worker registered'))) {
      firebaseReadyNotified = true;
      console.log(`[✅ Firebase就绪] ${account}（已可接收推送）`);
      return;
    }

    // EngageLab 是另一条推送通道，init failed 与 Firebase 无关，直接忽略不打印
  });
}

function printPush(tag, account, text) {
  // 时间窗去重：同一条消息的前台/后台两个通道在 DEDUPE_WINDOW 内只计 1 次
  const now  = Date.now();
  const last = lastPushAt.get(account) || 0;
  const isDup = (now - last) <= DEDUPE_WINDOW;
  lastPushAt.set(account, now);

  if (!isDup) {
    receivedPush.set(account, (receivedPush.get(account) || 0) + 1);
  }
  const tail = isDup ? '（同一条消息的另一通道，不计数）' : `（第 ${receivedPush.get(account)} 条）`;

  console.log(`\n=========================================`);
  console.log(`[${tag}] 接收账号: ${account} ${tail}`);
  console.log(`[日志详情]: ${text}`);
  console.log(`=========================================\n`);
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
  } catch (e) { /* 非 JSON，忽略 */ }
  return `登录后未跳转 (HTTP ${loginResp.status})`;
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

    // 先挂监听，避免漏掉初始化阶段的 firebase 日志
    attachConsoleListener(page, account);

    // 捕获登录接口返回，用于失败原因
    let loginResp = null;
    page.on('response', async (resp) => {
      try {
        if (resp.request().method() === 'POST' && /login|signin|sign-in/i.test(resp.url())) {
          loginResp = { status: resp.status(), body: await resp.text() };
        }
      } catch (e) { /* 响应体可能已释放，忽略 */ }
    });

    // 登录操作
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-testid="form-input-userName"]', { timeout: 15000 });
    await page.fill('[data-testid="form-input-userName"]', account);
    await page.fill('[data-testid="form-input-password"]', PASSWORD);
    await page.click('[data-testid="login-submit-btn"]');

    // 成功判定：URL 离开 /login（跳到 https://arplatsaassit4.club/）
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

    // 成功：保持存活
    results.success.push(account);
    openContexts.push({ account, context });
    console.log(`[✅ 登录成功] ${account} （已保持存活，等待推送）`);

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
// 压测式爬坡登录调度器
// 并发数随时间从 START_VUS 线性升到 MAX_VUS（像 ramping-vus），
// 每个账号启动前加随机错峰延迟，降低后台限流。
// ============================================================
async function runRamp(accounts) {
  const total     = accounts.length;
  const rampMs    = RAMP_SECONDS * 1000;
  const startTime = Date.now();

  let idx      = 0;   // 下一个待登录账号下标
  let inFlight = 0;   // 当前正在登录的数量
  let done     = 0;   // 已完成（成功或失败）的数量

  // 当前时刻允许的并发数（线性爬坡）
  const targetConcurrency = () => {
    const t = Math.min(1, (Date.now() - startTime) / rampMs);
    return Math.max(1, Math.round(START_VUS + (MAX_VUS - START_VUS) * t));
  };

  // 进度播报（每 5s 一次，营造压测推进感）
  const reporter = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(
      `[进度 ${elapsed}s] 已启动 ${idx}/${total}  完成 ${done}  ` +
      `当前并发 ${inFlight}/${targetConcurrency()}  ` +
      `成功 ${results.success.length}  失败 ${results.fail.length}`
    );
  }, 5000);

  // 派发循环：只要还有未启动的账号，且并发未满，就启动下一个
  while (idx < total) {
    if (inFlight < targetConcurrency()) {
      const account = accounts[idx++];
      inFlight++;
      // 异步执行登录，完成后释放并发槽
      loginClient(account).then(() => { inFlight--; done++; });
      // 随机错峰，避免同一瞬间打爆登录接口
      await sleep(randBetween(STAGGER_MIN, STAGGER_MAX));
    } else {
      await sleep(100); // 并发已满，等待空槽
    }
  }

  // 等待所有在途登录完成
  while (done < total) await sleep(200);

  clearInterval(reporter);
}

// ============================================================
// 打印汇总
// ============================================================
function printSummary() {
  console.log('\n' + '='.repeat(55));
  console.log(`  批量登录汇总   成功: ${results.success.length}   失败: ${results.fail.length}`);
  console.log('='.repeat(55));

  console.log(`✅ 成功: ${results.success.length} 个`);
  if (results.fail.length) {
    console.log(`❌ 失败账号 (${results.fail.length}):`);
    results.fail.forEach(f => console.log(`   ${f.account}  →  ${f.reason}`));
  }
  console.log('='.repeat(55) + '\n');
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  const accounts = loadAccounts();
  console.log(`读取到 ${accounts.length} 个账号（已去掉区号 ${COUNTRY_CODE}）`);
  console.log(`配置: 爬坡 ${START_VUS}→${MAX_VUS} 并发 / ${RAMP_SECONDS}s  错峰=${STAGGER_MIN}~${STAGGER_MAX}ms  无头=${HEADLESS}  密码=${PASSWORD}\n`);

  const t0 = Date.now();
  await runRamp(accounts);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  printSummary();

  // 全部登录流程结束
  console.log('='.repeat(55));
  console.log(`✅ 所有用户登录完毕（共 ${accounts.length} 个，用时 ${elapsed}s）`);
  console.log(`   成功 ${results.success.length}  失败 ${results.fail.length}`);
  console.log('='.repeat(55) + '\n');

  if (openContexts.length === 0) {
    console.log('没有任何账号登录成功，退出。');
    process.exit(0);
  }

  console.log(`>>> ${openContexts.length} 个浏览器保持存活中。`);
  console.log('>>> 请去后台手动发送 Firebase 消息，收到的推送会实时打印在下方（按账号区分）。');
  console.log('>>> 按 Ctrl+C 结束并关闭所有浏览器。\n');

  // 保持进程存活，持续监听推送
  await new Promise(() => {});
}

// ============================================================
// 退出报表：成功收到推送 / 未收到推送 / 登录失败
// ============================================================
function printExitReport() {
  // 登录成功的账号里，区分收到推送 vs 未收到
  const gotPush    = results.success.filter(a => receivedPush.has(a));
  const noPush     = results.success.filter(a => !receivedPush.has(a));

  console.log('\n' + '='.repeat(55));
  console.log('                推送接收报表');
  console.log('='.repeat(55));
  console.log(`  登录成功:        ${results.success.length}`);
  console.log(`  ├─ 收到推送:     ${gotPush.length}`);
  console.log(`  └─ 未收到推送:   ${noPush.length}`);
  console.log(`  登录失败:        ${results.fail.length}`);
  console.log('-'.repeat(55));

  if (gotPush.length) {
    // 成功的只汇总总数，不打印明细账号
    const totalMsgs = gotPush.reduce((sum, a) => sum + receivedPush.get(a), 0);
    console.log(`✅ 成功收到推送: ${gotPush.length} 个账号，共 ${totalMsgs} 条`);
  }
  if (noPush.length) {
    console.log(`❌ 未收到推送 (${noPush.length}):`);
    noPush.forEach(a => console.log(`   ${a}`));
  }
  if (results.fail.length) {
    console.log(`❌ 登录失败 (${results.fail.length}):`);
    results.fail.forEach(f => console.log(`   ${f.account}  →  ${f.reason}`));
  }
  console.log('='.repeat(55) + '\n');
}

// 优雅退出：先出报表，再关浏览器
let exiting = false;
process.on('SIGINT', async () => {
  if (exiting) return;
  exiting = true;
  console.log('\n收到退出信号，正在生成报表并关闭所有浏览器...');
  printExitReport();
  for (const { context } of openContexts) {
    try { await context.close(); } catch (e) { /* ignore */ }
  }
  process.exit(0);
});

main().catch((err) => {
  console.error('运行失败:', err);
  process.exit(1);
});
