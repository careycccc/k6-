/**
 * diag-firebase.js  —  单账号诊断：搞清楚 EngageLab/Firebase 为什么 init failed
 *
 * 运行: node k6/playwrith/diag-firebase.js
 *
 * 会做两件事：
 *   A. 应用候选修复（去掉自动化指纹），看 EngageLab 是否还报 init failed
 *   B. 打印浏览器环境：webdriver / 通知权限 / SW 支持 / SW 注册情况 / 全部 console
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL  = 'https://arplatsaassit4.club';
const ACCOUNT   = process.env.ACC || '6277373340';
const PASSWORD  = 'qwer1234';

(async () => {
  const userDataDir = path.join(__dirname, '.browser_profiles', `diag_${ACCOUNT}`);
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    permissions: ['notifications'],
    serviceWorkers: 'allow',
    // ↓↓↓ 候选修复：去掉自动化指纹
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',   // 让 navigator.webdriver=false
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  // 进一步抹掉 webdriver 痕迹
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  // 打印全部 console，重点标记 engagelab/firebase/init
  page.on('console', (msg) => {
    const t = msg.text();
    if (/engagelab|firebase|fcm|messaging|init|sw|token|push|通知|推送|消息/i.test(t)) {
      console.log(`  [console.${msg.type()}] ${t.slice(0, 300)}`);
    }
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message.slice(0, 300)}`));

  console.log(`\n=== 登录 ${ACCOUNT} ===`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="form-input-userName"]', { timeout: 15000 });
  await page.fill('[data-testid="form-input-userName"]', ACCOUNT);
  await page.fill('[data-testid="form-input-password"]', PASSWORD);
  await page.click('[data-testid="login-submit-btn"]');

  try {
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 20000 });
    console.log('  登录成功，已跳转:', page.url());
  } catch {
    console.log('  ❌ 登录未跳转');
  }

  // 等 SDK 初始化 + SW 注册
  console.log('\n=== 等待 15s 让 SDK 初始化 / SW 注册 ===');
  await page.waitForTimeout(15000);

  // 环境探测
  const env = await page.evaluate(async () => {
    let regs = [];
    try {
      const r = await navigator.serviceWorker.getRegistrations();
      regs = r.map(x => ({ scope: x.scope, active: !!x.active, scriptURL: x.active && x.active.scriptURL }));
    } catch (e) { regs = ['err:' + e.message]; }
    let sub = null;
    try {
      const r = await navigator.serviceWorker.ready;
      const s = await r.pushManager.getSubscription();
      sub = s ? s.endpoint : null;
    } catch (e) { sub = 'err:' + e.message; }
    return {
      webdriver: navigator.webdriver,
      notificationPermission: (typeof Notification !== 'undefined') ? Notification.permission : 'no-Notification',
      hasServiceWorker: 'serviceWorker' in navigator,
      hasPushManager: 'PushManager' in window,
      isSecureContext: window.isSecureContext,
      registrations: regs,
      pushSubscription: sub,
    };
  });

  console.log('\n=== 浏览器环境探测 ===');
  console.log(JSON.stringify(env, null, 2));

  console.log('\n=== 保持 30s 观察（如有推送日志会显示），然后关闭 ===');
  await page.waitForTimeout(30000);
  await context.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
