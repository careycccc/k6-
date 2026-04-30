// ============================================
// 页面操作工具库
// ============================================
// 封装常用浏览器操作：导航、元素断言、截图
// 所有方法均带超时保护和错误日志，不会因单个操作失败中断整个测试
// ============================================

import { check } from 'k6';
import { watchConsoleErrors } from './webVitals.js';

/**
 * 打开页面（goto + 等待网络空闲 + console 错误监听）
 *
 * @param {Page}   page
 * @param {string} url
 * @param {object} opts
 * @param {string}  opts.pageName - 日志标识
 * @param {number}  opts.timeout  - 超时毫秒（默认 30000）
 */
export async function openPage(page, url, opts = {}) {
  const { pageName = url, timeout = 30000 } = opts;

  // 先注册 console 错误监听（必须在 goto 之前）
  watchConsoleErrors(page, pageName);

  console.log(`🌐 [${pageName}] 打开页面: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    console.log(`✅ [${pageName}] 页面加载完成`);
  } catch (e) {
    console.error(`❌ [${pageName}] 页面加载失败: ${e.message}`);
    await captureScreenshot(page, `load_error`);
    throw e;
  }
}

/**
 * 检查元素是否可见，结果记录到 k6 checks（影响 checks 指标和 thresholds）
 *
 * @param {Page}   page
 * @param {string} selector  - CSS 选择器
 * @param {string} checkName - check 标签（显示在报告中）
 * @returns {boolean}
 */
export async function checkVisible(page, selector, checkName) {
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 8000 });
    const visible = await locator.isVisible();
    check(null, { [checkName]: () => visible });
    if (visible) {
      console.log(`  ✔ ${checkName}`);
    } else {
      console.warn(`  ✘ ${checkName} [${selector}]`);
    }
    return visible;
  } catch (e) {
    check(null, { [checkName]: () => false });
    console.warn(`  ✘ ${checkName} [${selector}]: ${e.message}`);
    return false;
  }
}

/**
 * 安全点击（等待可见 → 点击，失败不抛错）
 *
 * @param {Page}   page
 * @param {string} selector
 * @param {string} label    - 日志标识
 * @returns {boolean} 是否点击成功
 */
export async function safeClick(page, selector, label) {
  try {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 8000 });
    await locator.click();
    console.log(`  👆 点击: ${label}`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️  点击失败: ${label} [${selector}] - ${e.message}`);
    return false;
  }
}

/**
 * 截图存档
 * 文件名格式：screenshots/t{tenantId}_{label}_{timestamp}.png
 *
 * @param {Page}   page
 * @param {string} label - 截图标识
 */
export async function captureScreenshot(page, label) {
  const tenantId = (typeof __ENV !== 'undefined' && __ENV.TENANT_ID) || 'unknown';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `screenshots/t${tenantId}_${label}_${ts}.png`;
  try {
    await page.screenshot({ path, fullPage: false });
    console.log(`  📸 截图: ${path}`);
  } catch (e) {
    console.warn(`  截图失败: ${e.message}`);
  }
}
