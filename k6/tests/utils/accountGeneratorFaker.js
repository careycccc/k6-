/**
 * accountGeneratorFaker.js — k6 专用「真实感」账号生成器（基于 grafana/xk6-faker）
 *
 * ⚠️ 仅能在用 `xk6 build --with github.com/grafana/xk6-faker` 编译出来的 k6 二进制中运行；
 *    普通 k6 / Node 会因找不到 `k6/x/faker` 模块而在加载期报错（这是刻意的失败信号——提醒先 build）。
 *
 * 接口与 ./accountGenerator.js 完全同名，调用点只需改 import 路径、无需改调用代码：
 *   - generateRandomEmail / generateRandomEmails ：faker 生成真实感前缀 + 唯一后缀（跨年不重复）
 *   - generateRandomPhone / generateRandomPhones ：手机号必须纯数字定长过后端校验，faker 不适用，
 *                                                  直接复用 accountGenerator.js 的纯 JS 唯一版
 *   - generateRandomPassword                      ：复用纯 JS 版
 */

import faker from 'k6/x/faker';
import {
    generateRandomPhone,
    generateRandomPhones,
    generateRandomPassword,
} from './accountGenerator.js';

// 手机号 / 密码：直接透传纯 JS 版（已保证唯一、格式合规）
export { generateRandomPhone, generateRandomPhones, generateRandomPassword };

// 邮箱域名（真实感常见域名）
const EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'icloud.com', 'protonmail.com', 'aol.com', 'mail.com',
];

// 模块级自增序列：每 VU 私有，为邮箱提供进程内唯一区分位
let _seq = 0;

/**
 * 从 faker 取一个「真实感」用户名前缀；对不同 faker 版本/API 做防御式兜底，
 * 即便方法名有出入或 faker 缺失也不会脆断。
 * @returns {string}
 */
function realisticPrefix() {
    try {
        if (faker && faker.internet && typeof faker.internet.username === 'function') {
            return faker.internet.username();
        }
        if (faker && faker.person && typeof faker.person.firstName === 'function') {
            return faker.person.firstName();
        }
    } catch (e) { /* 忽略，走下方兜底 */ }
    // 兜底：随机字母串
    const cs = 'abcdefghijklmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < 8; i++) s += cs[Math.floor(Math.random() * cs.length)];
    return s;
}

/**
 * 生成真实感且唯一的邮箱
 * @returns {string}
 */
export function generateRandomEmail() {
    const prefix = String(realisticPrefix()).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user';
    // 唯一后缀：base36(毫秒时间) + base36(自增序列) + base36(随机) → 实际唯一，跨年不重复
    const uniq = Date.now().toString(36) + (_seq++).toString(36) + Math.floor(Math.random() * 46656).toString(36);
    const domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
    return `${prefix}${uniq}@${domain}`;
}

/**
 * 批量生成唯一邮箱
 * @param {number} count - 生成数量
 * @returns {string[]}
 */
export function generateRandomEmails(count) {
    const set = new Set();
    while (set.size < count) set.add(generateRandomEmail());
    return Array.from(set);
}
