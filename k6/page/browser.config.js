// ============================================
// 浏览器测试 - 公共配置
// ============================================
//
// 运行命令示例：
//   k6 run -e TENANT_ID=3007 k6/page/indexpage/index.test.js
//   k6 run -e TENANT_ID=3001 -e LANGUAGES=hi,en k6/page/indexpage/index.test.js
//   k6 run -e TENANT_ID=3004 K6_BROWSER_HEADLESS=false k6/page/indexpage/index.test.js
//
// 调试模式（看到真实浏览器）：
//   Windows: set K6_BROWSER_HEADLESS=false && k6 run -e TENANT_ID=3007 ...
// ============================================

import { getEnvByTenantId } from '../config/envconfig.js';
import { getTenantDefaultLanguages } from '../config/tenantLanguageConfig.js';

/**
 * 获取当前租户ID
 */
export function getTenantId() {
  return __ENV.TENANT_ID || '3004';
}

/**
 * 获取当前租户配置（从 envconfig.js 的 ENV_MAP 中读取）
 */
export function getTenantConfig() {
  const tenantId = getTenantId();
  const config = getEnvByTenantId(tenantId);
  if (!config) {
    throw new Error(`[browser.config] 未找到租户 ${tenantId} 的配置，请检查 envconfig.js`);
  }
  return config;
}

/**
 * 获取本次测试使用的语言列表
 * 优先级：-e LANGUAGES=hi,en > 租户默认语言配置
 */
export function getTestLanguages() {
  const tenantId = getTenantId();
  if (__ENV.LANGUAGES && __ENV.LANGUAGES.trim()) {
    return __ENV.LANGUAGES.split(',').map(l => l.trim()).filter(Boolean);
  }
  return getTenantDefaultLanguages(tenantId);
}

/**
 * 构建 k6 browser options
 * @param {number} vus        - 并发浏览器实例数（建议 1~3，每个 VU 一个真实浏览器）
 * @param {number} iterations - 总迭代次数
 */
export function buildBrowserOptions(vus = 1, iterations = 1) {
  return {
    scenarios: {
      browser: {
        executor: 'shared-iterations',
        vus,
        iterations,
        options: {
          browser: {
            type: 'chromium',
          },
        },
      },
    },

    // ---- Web Vitals 阈值（Google 标准） ----
    thresholds: {
      // k6 内置 Web Vitals（运行 browser 测试时自动采集）
      'browser_web_vital_lcp':  ['p(75) < 2500'],  // 最大内容绘制 < 2.5s
      'browser_web_vital_fcp':  ['p(75) < 1800'],  // 首次内容绘制 < 1.8s
      'browser_web_vital_cls':  ['p(75) < 0.1'],   // 累积布局偏移 < 0.1
      'browser_web_vital_ttfb': ['p(75) < 800'],   // 首字节时间 < 800ms
      'browser_web_vital_inp':  ['p(75) < 200'],   // 交互响应 < 200ms

      // 自定义 Trend 指标阈值
      'page_load_duration':     ['p(95) < 5000'],  // 页面完整加载 < 5s
      'dom_content_loaded':     ['p(95) < 3000'],  // DOM 加载完成 < 3s

      // 业务断言通过率
      'checks':                 ['rate > 0.95'],   // 断言通过率 > 95%
    },
  };
}
