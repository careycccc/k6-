/**
 * 账号生成工具
 * 用于生成随机手机号和邮箱
 */

// 常见的邮箱域名列表
const EMAIL_DOMAINS = [
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "163.com", "126.com", "qq.com", "sina.com",
    "foxmail.com", "sohu.com", "139.com", "189.com",
    "aliyun.com", "protonmail.com", "icloud.com",
    "aol.com", "zoho.com", "mail.com", "inbox.com"
];

// 模块级自增序列：为手机号/邮箱提供进程内唯一区分位。
// k6 中每个 VU 是独立 JS 运行时，本变量为每 VU 私有；配合时间戳/随机降低跨 VU 碰撞。
let _seq = 0;

/**
 * 生成随机整数
 * @param {number} min - 最小值（包含）
 * @param {number} max - 最大值（包含）
 * @returns {number} 随机整数
 */
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
function generateRandomString(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset[randInt(0, charset.length - 1)];
    }
    return result;
}

/**
 * 生成随机手机号
 * 格式：区号 + 月日 + 随机数
 * 例如：91 + 0311 + 123456 = 910311123456 (12位)
 * 或：880 + 0311 + 123456 = 8800311123456 (13位，孟加拉)
 * @param {string} countryCode - 国家区号，默认为 '91'
 * @returns {string} 随机手机号
 */
export function generateRandomPhone(countryCode = '91') {
    // 手机号总长度（含区号）：孟加拉(880) 13 位，其它 12 位
    const targetLength = countryCode === '880' ? 13 : 12;
    // 号码部分位数（不含区号），通常为 10
    const N = targetLength - countryCode.length;

    // 号码构造：epoch 秒低 4 位（时间散列，随年份单调滚动，不再像"月日"那样跨年系统性重复）
    //          + 进程内自增序列 2 位（压低同刻并发碰撞）+ 其余随机位。
    const t4 = String(Math.floor(Date.now() / 1000) % 10000).padStart(4, '0');
    const s2 = String(_seq++ % 100).padStart(2, '0');
    const randLen = Math.max(0, N - t4.length - s2.length);
    let randPart = '';
    for (let i = 0; i < randLen; i++) randPart += randInt(0, 9);

    // 拼成 N 位号码；位数兜底后再确保首位非 0（避免被判为短号/校验失败）
    let number = (t4 + s2 + randPart).slice(0, N);
    while (number.length < N) number += randInt(0, 9);
    if (number[0] === '0') number = String(randInt(1, 9)) + number.slice(1);

    // 合并：区号 + 号码
    return countryCode + number;
}

/**
 * 生成随机邮箱地址
 * @returns {string} 随机邮箱
 */
export function generateRandomEmail() {
    // 真实感随机词（6-12 字符）作为前缀主体
    const usernameLen = 6 + randInt(0, 6);
    const word = generateRandomString(usernameLen);

    // 唯一后缀：base36(毫秒时间) + base36(自增序列) + base36(随机) → 实际唯一，跨年不重复
    const uniq = Date.now().toString(36) + (_seq++).toString(36) + randInt(0, 46655).toString(36);

    // 随机选择域名
    const domain = EMAIL_DOMAINS[randInt(0, EMAIL_DOMAINS.length - 1)];

    return `${word}${uniq}@${domain}`;
}

/**
 * 批量生成随机手机号（去重）
 * @param {number} count - 生成数量
 * @param {string} countryCode - 国家区号，默认为 '91'
 * @returns {string[]} 手机号列表
 */
export function generateRandomPhones(count, countryCode = '91') {
    const phones = new Set();
    const generated = new Map(); // 用于检测重复
    let collisionCount = 0;

    while (phones.size < count) {
        const phone = generateRandomPhone(countryCode);

        // 检查重复
        if (generated.has(phone)) {
            collisionCount++;
            console.log(`[账号生成] 手机号重复检测: ${phone}`);
        } else {
            generated.set(phone, true);
            phones.add(phone);
        }
    }

    if (collisionCount > 0) {
        console.log(`[账号生成] 已生成手机号: ${count}, 重复数: ${collisionCount}`);
    }

    return Array.from(phones);
}

/**
 * 批量生成随机邮箱（去重）
 * @param {number} count - 生成数量
 * @returns {string[]} 邮箱列表
 */
export function generateRandomEmails(count) {
    const emails = new Set();
    const generated = new Map(); // 用于检测重复
    let collisionCount = 0;

    while (emails.size < count) {
        const email = generateRandomEmail();

        // 检查重复
        if (generated.has(email)) {
            collisionCount++;
            console.log(`[账号生成] 邮箱重复检测: ${email}`);
        } else {
            generated.set(email, true);
            emails.add(email);
        }
    }

    if (collisionCount > 0) {
        console.log(`[账号生成] 已生成邮箱: ${count}, 重复数: ${collisionCount}`);
    }

    return Array.from(emails);
}

/**
 * 生成随机密码
 * @param {number} length - 密码长度，默认8位
 * @returns {string} 随机密码
 */
export function generateRandomPassword(length = 8) {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const special = '@#$%';

    const allChars = lowercase + uppercase + numbers + special;

    let password = '';
    // 确保至少包含一个小写字母、大写字母、数字
    password += lowercase[randInt(0, lowercase.length - 1)];
    password += uppercase[randInt(0, uppercase.length - 1)];
    password += numbers[randInt(0, numbers.length - 1)];

    // 填充剩余长度
    for (let i = 3; i < length; i++) {
        password += allChars[randInt(0, allChars.length - 1)];
    }

    // 打乱顺序
    return password.split('').sort(() => Math.random() - 0.5).join('');
}
