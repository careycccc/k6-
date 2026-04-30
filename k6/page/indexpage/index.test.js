// ============================================
// 前台首页 - 浏览器性能测试
// ============================================
//
// 测试内容：
//   1. 打开前台首页，等待网络空闲
//   2. 采集 Web Vitals（k6 内置自动输出）
//   3. 采集 Navigation Timing（自定义 Trend 指标）
//   4. 验证关键元素可见性（导航栏 / Banner / 主内容区）
//   5. 截图存档（初始状态）
//   6. 依次切换租户配置的每种语言，截图对比
//
// 运行命令：
//   k6 run -e TENANT_ID=3007 k6/page/indexpage/index.test.js
//   k6 run -e TENANT_ID=3001 -e LANGUAGES=hi k6/page/indexpage/index.test.js
//
// 调试（显示浏览器窗口）：
//   Windows: set K6_BROWSER_HEADLESS=false && k6 run -e TENANT_ID=3007 k6/page/indexpage/index.test.js
// ============================================

import { browser }  from 'k6/browser';
import { check }    from 'k6';

import {
  buildBrowserOptions,
  getTenantConfig,
  getTenantId,
  getTestLanguages,
} from '../browser.config.js';

import { collectNavigationTiming } from '../helpers/webVitals.js';
import { openPage, checkVisible, captureScreenshot } from '../helpers/pageHelper.js';
import { switchLanguage } from '../helpers/i18nHelper.js';

// ---- k6 Options（浏览器场景 + Web Vitals 阈值）----
// vus=1, iterations=1 → 单次完整测试；压测时可调高 vus
export const options = buildBrowserOptions(1, 1);

// ============================================================
// Setup：打印测试信息，传递配置给 default()
// ============================================================
export function setup() {
  const tenantId = getTenantId();
  const config   = getTenantConfig();
  const langs    = getTestLanguages();

  console.log('════════════════════════════════════════════════════════');
  console.log(`🚀 首页浏览器性能测试`);
  console.log(`   租户 ID  : ${tenantId}`);
  console.log(`   前台地址 : ${config.BASE_DESK_URL}`);
  console.log(`   测试语言 : ${langs.join(', ')}`);
  console.log('════════════════════════════════════════════════════════');

  return {
    tenantId,
    baseUrl: config.BASE_DESK_URL,
    langs,
  };
}

// ============================================================
// 主测试函数
// ============================================================
export default async function ({ tenantId, baseUrl, langs }) {
  const page = await browser.newPage();

  try {
    // ── Step 1: 打开首页 ──────────────────────────────────────
    await openPage(page, baseUrl, { pageName: `index_${tenantId}` });

    // ── Step 2: 采集 Navigation Timing ───────────────────────
    await collectNavigationTiming(page, `index_${tenantId}`);

    // ── Step 3: 关键元素可见性检查 ────────────────────────────
    // ⚠️  选择器覆盖常见前台实现，如与实际不符请按需调整
    await checkVisible(page,
      'header, nav, [class*="header"], [class*="navbar"], [class*="Header"]',
      '导航栏可见'
    );
    await checkVisible(page,
      '[class*="banner"], [class*="Banner"], [class*="swiper"], [class*="carousel"], [class*="hero"]',
      'Banner/轮播图可见'
    );
    await checkVisible(page,
      '[class*="game"], [class*="Game"], [class*="lobby"], [class*="Lobby"], main, [role="main"]',
      '游戏大厅/主内容区可见'
    );

    // ── Step 4: 截图存档（初始状态）──────────────────────────
    await captureScreenshot(page, 'initial');

    // ── Step 5: 多语言切换测试 ────────────────────────────────
    // 依次切换租户配置的每种语言，验证语言按钮可点击
    if (langs && langs.length > 0) {
      console.log(`\n--- 开始多语言切换测试（共 ${langs.length} 种语言）---`);

      for (const lang of langs) {
        const switched = await switchLanguage(page, lang);

        check(null, {
          [`语言切换成功: ${lang}`]: () => switched,
        });

        if (switched) {
          await captureScreenshot(page, `lang_${lang}`);
          console.log(`  ✅ 语言 [${lang}] 切换验证完成`);
        }
      }
    }

  } catch (e) {
    console.error(`❌ 测试异常: ${e.message}`);
    await captureScreenshot(page, 'exception');
    // 记录为断言失败（影响 checks 指标）
    check(null, { '测试无未捕获异常': () => false });

  } finally {
    await page.close();
  }
}

// ============================================================
// Teardown：汇总输出
// ============================================================
export function teardown({ tenantId, baseUrl, langs }) {
  console.log('════════════════════════════════════════════════════════');
  console.log(`✅ 首页测试完成 - 租户 ${tenantId}`);
  console.log(`   地址    : ${baseUrl}`);
  console.log(`   语言    : ${langs.join(', ')}`);
  console.log('════════════════════════════════════════════════════════');
}
