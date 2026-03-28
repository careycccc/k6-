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
 * 或：91 + 311 + 1234567 = 913111234567 (12位)
 * @param {string} countryCode - 国家区号，默认为 '91'
 * @returns {string} 随机手机号
 */
export function generateRandomPhone(countryCode = '91') {
    // 获取当前日期
    const now = new Date();
    const month = now.getMonth() + 1; // JavaScript 月份从 0 开始
    const day = now.getDate();

    // 格式化月和日
    let prefix;
    if (month < 10) {
        // 月1位+日2位=3位
        prefix = `${month}${day.toString().padStart(2, '0')}`;
    } else {
        // 月2位+日2位=4位
        prefix = `${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
    }

    // 根据前缀长度决定随机数位数
    let randomLength;
    if (prefix.length === 3) {
        randomLength = 7;
    } else {
        randomLength = 6;
    }

    // 生成随机数
    let randomNum = '';
    for (let i = 0; i < randomLength; i++) {
        randomNum += randInt(0, 9);
    }

    // 合并：区号 + 前缀 + 随机数
    return countryCode + prefix + randomNum;
}

/**
 * 生成随机邮箱地址
 * @returns {string} 随机邮箱
 */
export function generateRandomEmail() {
    // 生成随机用户名长度 (6-12个字符)
    const usernameLen = 6 + randInt(0, 6);
    const username = generateRandomString(usernameLen);

    // 随机选择域名
    const domain = EMAIL_DOMAINS[randInt(0, EMAIL_DOMAINS.length - 1)];

    return `${username}@${domain}`;
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
