/**
 * 时区 / 日期 / 时间戳 公共工具（k6 脚本用，ESM）
 *
 * 时区按租户 COUNTRY_CODE 推算（未知区号默认印度 UTC+5:30），与后台报表一致。
 * 所有 *Ts 均为毫秒 UTC 时间戳；「本地」指租户时区。
 */

import { getEnvByTenantId } from '../../config/envconfig.js';

const DAY_MS = 86400000;

/** 区号 → UTC 偏移小时 */
export const COUNTRY_CODE_TZ_OFFSET = {
    '91':  5.5,   // 印度 IST UTC+5:30
    '880': 6,     // 孟加拉 BST UTC+6
    '92':  5,     // 巴基斯坦 PKT UTC+5
    '52':  -6,    // 墨西哥 CST UTC-6
    '1':   -5,    // 美国东部 EST UTC-5
    '86':  8,     // 中国 CST UTC+8
};

/** 租户时区偏移（小时），如 5.5 */
export function getTzOffset(tenantId) {
    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = (envConfig && envConfig.COUNTRY_CODE) ? envConfig.COUNTRY_CODE : '91';
    const offset = COUNTRY_CODE_TZ_OFFSET[countryCode];
    if (offset === undefined) {
        console.warn(`[TZ] 未知区号 ${countryCode}，使用默认印度时区 UTC+5:30`);
        return 5.5;
    }
    return offset;
}

/** 租户时区偏移（毫秒） */
export function getTzOffsetMs(tenantId) {
    return getTzOffset(tenantId) * 3600 * 1000;
}

const pad2 = n => String(n).padStart(2, '0');

/**
 * 指定自然日（相对今天往前 daysAgo 天）的本地起止时间戳
 * @returns {{ startTime:number, endTime:number, dateStr:string }}  endTime = 当天最后一毫秒
 */
export function getDayRange(daysAgo, tenantId) {
    const tzOffsetMs = getTzOffsetMs(tenantId);
    const nowLocal = new Date(Date.now() + tzOffsetMs);
    const targetLocalMidnight = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() - daysAgo, 0, 0, 0, 0);
    const startTime = targetLocalMidnight - tzOffsetMs;
    const endTime = startTime + DAY_MS - 1;
    const d = new Date(targetLocalMidnight);
    const dateStr = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    return { startTime, endTime, dateStr };
}

/** 'YYYY-MM-DD' 在偏移 offsetMs 下的 00:00:00 时间戳（offsetMs=0 即 UTC） */
export function dateStartTs(dateStr, offsetMs) {
    return new Date(dateStr + 'T00:00:00Z').getTime() - (offsetMs || 0);
}

/** 'YYYY-MM-DD' 在偏移 offsetMs 下的 23:59:59.999 时间戳 */
export function dateEndTs(dateStr, offsetMs) {
    return dateStartTs(dateStr, offsetMs) + DAY_MS - 1;
}

/**
 * 时间戳 → 'YYYY-MM-DD HH:mm:ss'（按偏移 offsetMs 显示）
 * 空值返回 '-'
 */
export function formatTs(ms, offsetMs) {
    if (!ms) return '-';
    const d = new Date(Number(ms) + (offsetMs || 0));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** 北京时间偏移（毫秒），部分报表/复现轨迹按北京时间显示 */
export const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
