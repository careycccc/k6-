// ============================================
// Web Vitals & 自定义性能指标采集器
// ============================================
//
// k6 内置指标（运行 browser 测试时自动输出，无需写代码）：
//   browser_web_vital_lcp   - 最大内容绘制
//   browser_web_vital_fcp   - 首次内容绘制
//   browser_web_vital_cls   - 累积布局偏移
//   browser_web_vital_ttfb  - 首字节时间
//   browser_web_vital_inp   - 交互到下一次绘制
//   browser_web_vital_fid   - 首次输入延迟
//
// 本文件额外提供：
//   page_load_duration      - 页面完整加载耗时（Navigation Timing）
//   dom_content_loaded      - DOM 加载完成耗时
//   js_console_error_count  - 页面 JS 控制台错误数
// ============================================

import { Trend, Counter } from 'k6/metrics';

// ---- 自定义指标定义（模块级，整个测试生命周期复用） ----
export const pageLoadDuration    = new Trend('page_load_duration',   true); // ms，越小越好
export const domContentLoaded    = new Trend('dom_content_loaded',   true); // ms
export const navigationFirstByte = new Trend('navigation_first_byte', true); // ms
export const jsConsoleErrorCount = new Counter('js_console_error_count');    // 累计错误数

/**
 * 注册页面 Console 错误监听
 * 在 page.goto() 之前调用，捕获页面生命周期内所有 JS 错误
 *
 * @param {Page}   page     - k6 browser Page 对象
 * @param {string} pageName - 页面标识（用于日志）
 */
export function watchConsoleErrors(page, pageName) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      jsConsoleErrorCount.add(1);
      console.warn(`🔴 [${pageName}] Console Error: ${msg.text()}`);
    }
  });
}

/**
 * 采集 Navigation Timing 指标并记录到自定义 Trend
 * 需在 page.goto() 完成（页面加载结束）后调用
 *
 * @param {Page}   page     - k6 browser Page 对象
 * @param {string} pageName - 页面标识（用于日志）
 * @returns {object|null}   timing 原始数据
 */
export async function collectNavigationTiming(page, pageName) {
  try {
    const timing = await page.evaluate(() => {
      const entries = performance.getEntriesByType('navigation');
      if (!entries || entries.length === 0) return null;
      const n = entries[0];
      return {
        ttfb:           Math.round(n.responseStart - n.requestStart),
        domInteractive: Math.round(n.domInteractive - n.startTime),
        domComplete:    Math.round(n.domComplete    - n.startTime),
        loadComplete:   Math.round(n.loadEventEnd   - n.startTime),
      };
    });

    if (timing) {
      pageLoadDuration.add(timing.loadComplete);
      domContentLoaded.add(timing.domComplete);
      navigationFirstByte.add(timing.ttfb);

      console.log(`📊 [${pageName}] Navigation Timing:`);
      console.log(`   TTFB:             ${timing.ttfb}ms`);
      console.log(`   DOM Interactive:  ${timing.domInteractive}ms`);
      console.log(`   DOM Complete:     ${timing.domComplete}ms`);
      console.log(`   Load Complete:    ${timing.loadComplete}ms`);
    }

    return timing;
  } catch (e) {
    console.warn(`[webVitals] Navigation Timing 采集失败: ${e.message}`);
    return null;
  }
}
