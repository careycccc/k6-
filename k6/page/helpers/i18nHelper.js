// ============================================
// 多语言辅助工具
// ============================================
//
// 策略：
//   1. 点击页面上的语言切换按钮（打开语言面板）
//   2. 根据租户配置的语言代码，在面板中找到对应选项并点击
//
// 语言按钮识别优先级：
//   1. [data-lang="hi"] 属性匹配
//   2. 语言代码大写文字匹配（EN / HI / ZH）
//   3. 语言原文名称匹配（English / हिंदी / 中文）
//
// 如果页面语言按钮结构与默认选择器不符，
// 请在调用时传入 { toggleSelector, optionSelector } 覆盖
// ============================================

import { safeClick } from './pageHelper.js';

/**
 * 语言代码 → 页面可能显示的文字列表（按匹配优先级排列）
 */
export const LANG_LABELS = {
  zh: ['ZH', '中文', '简体中文', 'Chinese', 'zh'],
  en: ['EN', 'English', 'en'],
  hi: ['HI', 'हिंदी', 'Hindi', 'hi'],
  ur: ['UR', 'اردو', 'Urdu', 'ur'],
  bn: ['BN', 'বাংলা', 'Bengali', 'bn'],
  pt: ['PT', 'Português', 'Portuguese', 'pt'],
  es: ['ES', 'Español', 'Spanish', 'es'],
  vi: ['VI', 'Tiếng Việt', 'Vietnamese', 'vi'],
  ms: ['MS', 'Melayu', 'Malay', 'ms'],
};

/**
 * 尝试打开页面上的语言切换面板
 * 会依次尝试多种常见选择器，找到可见的即点击
 *
 * @param {Page}   page
 * @param {string} [customSelector] - 可选：传入已知的精确选择器
 * @returns {boolean} 是否成功打开面板
 */
export async function openLanguagePanel(page, customSelector = null) {
  const candidates = customSelector
    ? [customSelector]
    : [
        // 常见语言切换按钮选择器（覆盖大多数前台实现）
        '[class*="lang-switch"]',
        '[class*="language-switch"]',
        '[class*="langSwitch"]',
        '[class*="languageSwitch"]',
        '[class*="lang-btn"]',
        '[class*="i18n"]',
        '[data-testid*="lang"]',
        'button[class*="lang"]',
        '.lang-toggle',
        '.language-toggle',
      ];

  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        await el.click();
        console.log(`  🌍 语言面板已打开 (${sel})`);
        // 等待面板动画展开
        await page.waitForTimeout(600);
        return true;
      }
    } catch (_) {
      // 继续尝试下一个
    }
  }

  console.warn('  ⚠️  未找到语言切换按钮，语言切换测试跳过');
  return false;
}

/**
 * 在已展开的语言面板中点击指定语言选项
 *
 * @param {Page}   page
 * @param {string} langCode - 语言代码，如 'hi' / 'en' / 'zh'
 * @returns {boolean} 是否点击成功
 */
export async function selectLanguageOption(page, langCode) {
  const labels = LANG_LABELS[langCode];
  if (!labels) {
    console.warn(`  ⚠️  未知语言代码: ${langCode}，跳过`);
    return false;
  }

  // 1. 优先通过 data-lang 属性匹配
  try {
    const byAttr = page.locator(`[data-lang="${langCode}"]`).first();
    if (await byAttr.isVisible()) {
      await byAttr.click();
      console.log(`  ✅ 语言选中 [data-lang=${langCode}]`);
      return true;
    }
  } catch (_) {}

  // 2. 按 label 文字逐一尝试
  for (const label of labels) {
    try {
      // 尝试多种容器元素
      const sel = [
        `button:has-text("${label}")`,
        `li:has-text("${label}")`,
        `div:has-text("${label}")`,
        `span:has-text("${label}")`,
        `a:has-text("${label}")`,
      ].join(', ');

      const el = page.locator(sel).first();
      if (await el.isVisible()) {
        await el.click();
        console.log(`  ✅ 语言选中 "${label}" (${langCode})`);
        return true;
      }
    } catch (_) {}
  }

  console.warn(`  ⚠️  未找到语言选项: ${langCode} (尝试标签: ${labels.join(', ')})`);
  return false;
}

/**
 * 完整切换语言流程：打开面板 → 选择语言
 *
 * @param {Page}   page
 * @param {string} langCode        - 目标语言代码
 * @param {string} [toggleSelector] - 可选：语言按钮的精确选择器
 * @returns {boolean}
 */
export async function switchLanguage(page, langCode, toggleSelector = null) {
  console.log(`\n  🔄 切换语言 → ${langCode}`);
  const opened = await openLanguagePanel(page, toggleSelector);
  if (!opened) return false;

  const selected = await selectLanguageOption(page, langCode);
  if (selected) {
    // 等待语言切换动画/重新渲染
    await page.waitForTimeout(800);
  }
  return selected;
}
