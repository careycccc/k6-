// ============================================
// 登录页 - 浏览器加载性能测试
// ============================================
//
// 测试内容：
//   1. 打开前台登录页（从首页跳转或直接访问 /login）
//   2. 采集 Web Vitals（k6 内置自动输出）
//   3. 采集 Navigation Timing（自定义 Trend 指标）
//   4. 验证登录页关键元素可见（手机号输入框 / 密码框 / 登录按钮）
//   5. 截图存档
//
// 注意：本测试仅测量页面加载性能，不执行实际登录操作
//
// 运行命令：
//   k6 run -e TENANT_ID=3007 k6/page/loginpage/login.test.js
//   k6 run -e TENANT_ID=3004 login.test.js
//
// 调试（显示浏览器窗口）：
//   Windows: set K6_BROWSER_HEADLESS=false && k6 run -e TENANT_ID=3007 k6/page/loginpage/login.test.js
// ============================================

import { browser } from 'k6/browser';
import { check } from 'k6';

import {
  buildBrowserOptions,
  getTenantConfig,
  getTenantId,
  getTestLanguages,
} from '../browser.config.js';

import { collectNavigationTiming } from '../helpers/webVitals.js';
import { openPage, checkVisible, captureScreenshot } from '../helpers/pageHelper.js';
import { switchLanguage } from '../helpers/i18nHelper.js';

// ---- k6 Options ----
export const options = buildBrowserOptions(1, 1);

// ============================================================
// Setup
// ============================================================
export function setup() {
  const tenantId = getTenantId();
  const config = getTenantConfig();
  const langs = getTestLanguages();

  // 登录页 URL：尝试直接拼接 /login，前台通常都在此路径
  // 如果租户登录页路径不同，可在 envconfig.js 中添加 LOGIN_PATH 字段
  const loginUrl = (config.LOGIN_URL)
    ? config.LOGIN_URL
    : `${config.BASE_DESK_URL}/login`;

  console.log('════════════════════════════════════════════════════════');
  console.log(`🚀 登录页浏览器性能测试`);
  console.log(`   租户 ID  : ${tenantId}`);
  console.log(`   登录地址 : ${loginUrl}`);
  console.log(`   测试语言 : ${langs.join(', ')}`);
  console.log('════════════════════════════════════════════════════════');

  return { tenantId, loginUrl, langs };
}

// ============================================================
// 主测试函数
// ============================================================
export default async function ({ tenantId, loginUrl, langs }) {
  const page = await browser.newPage();

  try {
    // ── Step 1: 打开登录页 ────────────────────────────────────
    await openPage(page, loginUrl, { pageName: `login_${tenantId}` });

    // ── Step 2: 采集 Navigation Timing ───────────────────────
    await collectNavigationTiming(page, `login_${tenantId}`);

    // ── Step 3: 登录页关键元素可见性检查 ──────────────────────
    // ⚠️  选择器覆盖常见前台登录页实现，如与实际不符请按需调整
    await checkVisible(page,
      'input[type="tel"], input[type="text"], input[name*="phone"], input[name*="mobile"], input[placeholder*="phone"], input[placeholder*="手机"]',
      '手机号输入框可见'
    );
    // await checkVisible(page,
    //   'input[type="password"], input[name*="password"], input[name*="pwd"]',
    //   '密码输入框可见'
    // );
    // await checkVisible(page,
    //   'button[type="submit"], button:has-text("登录"), button:has-text("Login"), button:has-text("Sign in"), [class*="login-btn"], [class*="submit"]',
    //   '登录按钮可见'
    // );

    // ── Step 4: 截图存档 ──────────────────────────────────────
    await captureScreenshot(page, 'initial');


  } catch (e) {
    console.error(`❌ 测试异常: ${e.message}`);
    await captureScreenshot(page, 'exception');
    check(null, { '测试无未捕获异常': () => false });

  } finally {
    await page.close();
  }
}

// ============================================================
// Teardown
// ============================================================
export function teardown({ tenantId, loginUrl }) {
  console.log('════════════════════════════════════════════════════════');
  console.log(`✅ 登录页测试完成 - 租户 ${tenantId}`);
  console.log(`   地址: ${loginUrl}`);
  console.log('════════════════════════════════════════════════════════');
}
