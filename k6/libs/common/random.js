/**
 * 随机数 / 随机字符串 公共工具（k6 脚本用，ESM）
 *
 * 统一替代各脚本里重复的 randInt / getRandomInt / getRandomAmount / randomPick 等。
 */

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

/** [min, max] 闭区间随机整数 */
export function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 从数组随机取一个；空数组/空值返回 null */
export function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

/** 从数组随机取 n 个不重复元素（不改原数组） */
export function randomPickN(arr, n) {
    const copy = (arr || []).slice();
    const result = [];
    const count = Math.min(n, copy.length); // 先定好个数，循环里 copy 会变短
    for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        result.push(copy.splice(idx, 1)[0]);
    }
    return result;
}

/** 从字符集随机拼 length 位 */
export function randomFrom(chars, length) {
    let s = '';
    for (let i = 0; i < length; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
}

/** length 位数字串；noLeadingZero=true 时首位 1-9 */
export function randomDigits(length, noLeadingZero = false) {
    let s = '';
    for (let i = 0; i < length; i++) {
        s += (i === 0 && noLeadingZero) ? String(randInt(1, 9)) : String(randInt(0, 9));
    }
    return s;
}

/** 小写字母+数字 */
export function randomString(length) {
    return randomFrom(LOWER + DIGITS, length);
}

/** 大小写字母 */
export function randomLetters(length) {
    return randomFrom(LOWER + UPPER, length);
}

export const CHARSETS = { LOWER, UPPER, DIGITS };
