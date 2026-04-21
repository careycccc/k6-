/**
 * 充值留存分析报表脚本
 *
 * 使用方法：
 *
 *   # 当日复充（查昨天，今天执行）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=same_day rechargeRetention.test.js
 *
 *   # 次日复充（查前天+昨天，今天执行）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=next_day rechargeRetention.test.js
 *
 *   # 指定目标日期（当日复充：查指定日期；次日复充：查指定日期及其次日）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=same_day -e TARGET_DATE=2026-04-16 rechargeRetention.test.js
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=next_day -e TARGET_DATE=2026-04-14 rechargeRetention.test.js
 *
 * 参数：
 *   TENANT_ID            租户ID（必需）
 *   CHANNEL_PACKAGE_ID   渠道来源ID（必需，不传直接报错）
 *   MODE                 same_day / next_day
 *   TARGET_DATE          指定目标日期（可选，格式 YYYY-MM-DD）
 */

import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import {
    getDayRange,
    fetchAllRechargeOrders,
    analyzeSameDayRetention,
    analyzeNextDayRetention
} from './rechargeRetentionApi.js';

export const options = {
    scenarios: {
        retention_report: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        }
    }
};

// ============================================================
// 全局变量：VU 阶段写入，handleSummary 阶段读取
// （单 VU 场景下安全）
// ============================================================
let _reportData = {
    mode: '',
    tenantId: '',
    sameDayDate: '',
    sameDayTotalOrders: 0,
    sameDayResult: [],
    nextDayDate1: '',
    nextDayDate2: '',
    nextDayResult: []
};

// ============================================================
// 时区工具（内联，避免循环依赖）
// ============================================================
const TZ_MAP = {
    '91': 5.5, '880': 6, '92': 5, '52': -6, '1': -5, '86': 8
};

function getTzOffsetMs(tenantId) {
    const envConfig = getEnvByTenantId(tenantId);
    const code = (envConfig && envConfig.COUNTRY_CODE) ? envConfig.COUNTRY_CODE : '91';
    const offset = TZ_MAP[code] !== undefined ? TZ_MAP[code] : 5.5;
    return offset * 3600 * 1000;
}

/**
 * 将 "YYYY-MM-DD" 字符串解析为租户时区的自然日时间戳范围
 */
function parseDateRange(dateStr, tenantId) {
    const tzOffsetMs = getTzOffsetMs(tenantId);
    const parts = dateStr.split('-');
    const startTime = Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])) - tzOffsetMs;
    const endTime   = startTime + 86400000 - 1;
    return { startTime, endTime, dateStr };
}

/**
 * 目标日期加 N 天，返回 "YYYY-MM-DD"
 */
function addDays(dateStr, n) {
    const parts = dateStr.split('-');
    const d = new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]) + n));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ============================================================
// Setup
// ============================================================
export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    console.log(`[Setup] 租户 ${tenantId} 管理员登录...`);

    const channelPackageId = __ENV.CHANNEL_PACKAGE_ID ? parseInt(__ENV.CHANNEL_PACKAGE_ID) : null;
    if (!channelPackageId) {
        throw new Error('[Setup] ❌ 未提供渠道来源，请通过 -e CHANNEL_PACKAGE_ID=xxx 传入');
    }

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error(`[Setup] ❌ 租户 ${tenantId} 管理员登录失败`);
    }

    console.log(`[Setup] ✅ 登录成功，渠道来源: ${channelPackageId}`);
    return { adminToken, tenantId, channelPackageId };
}

// ============================================================
// 主函数
// ============================================================
export default function (data) {
    const { adminToken, tenantId, channelPackageId } = data;
    const mode       = (__ENV.MODE || 'same_day').toLowerCase();
    const targetDate = __ENV.TARGET_DATE || '';

    _reportData.mode     = mode;
    _reportData.tenantId = tenantId;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 充值留存分析  租户: ${tenantId}  模式: ${mode}`);
    console.log(`${'='.repeat(60)}\n`);

    if (mode === 'same_day') {
        // 当日复充：不传 TARGET_DATE → 查昨天；传了 → 查指定日期
        const range = targetDate
            ? parseDateRange(targetDate, tenantId)
            : getDayRange(1, tenantId);

        console.log(`[SameDay] 查询日期: ${range.dateStr}`);
        console.log(`[SameDay] 时间范围: ${new Date(range.startTime).toISOString()} ~ ${new Date(range.endTime).toISOString()}`);

        const orders = fetchAllRechargeOrders(adminToken, range.startTime, range.endTime, 'Payed', channelPackageId);
        const result = analyzeSameDayRetention(orders);

        _reportData.sameDayDate        = range.dateStr;
        _reportData.sameDayTotalOrders = orders.length;
        _reportData.sameDayResult      = result;

        console.log(`[SameDay] ✅ 当日复充用户数: ${result.length}`);

    } else if (mode === 'next_day') {
        // 次日复充：不传 TARGET_DATE → day1=前天, day2=昨天；传了 → day1=指定日期, day2=指定日期+1
        let day1Range, day2Range;
        if (targetDate) {
            day1Range = parseDateRange(targetDate, tenantId);
            day2Range = parseDateRange(addDays(targetDate, 1), tenantId);
        } else {
            day1Range = getDayRange(2, tenantId);
            day2Range = getDayRange(1, tenantId);
        }

        console.log(`[NextDay] 第一天: ${day1Range.dateStr}`);
        console.log(`[NextDay] 第二天: ${day2Range.dateStr}`);

        const day1Orders = fetchAllRechargeOrders(adminToken, day1Range.startTime, day1Range.endTime, 'Payed', channelPackageId);
        const day2Orders = fetchAllRechargeOrders(adminToken, day2Range.startTime, day2Range.endTime, 'Payed', channelPackageId);
        const result     = analyzeNextDayRetention(day1Orders, day2Orders);

        _reportData.nextDayDate1  = day1Range.dateStr;
        _reportData.nextDayDate2  = day2Range.dateStr;
        _reportData.nextDayResult = result;

        console.log(`[NextDay] ✅ 次日复充用户数: ${result.length}`);

    } else {
        console.error(`[Main] ❌ 未知 MODE: ${mode}，支持 same_day / next_day`);
    }
}

// ============================================================
// 报表输出
// ============================================================
export function handleSummary() {
    const mode = (_reportData.mode || __ENV.MODE || 'same_day').toLowerCase();

    if (mode === 'same_day') {
        return { stdout: buildSameDayReport() };
    } else if (mode === 'next_day') {
        return { stdout: buildNextDayReport() };
    }
    return { stdout: '未知模式，请指定 -e MODE=same_day 或 -e MODE=next_day\n' };
}

// ============================================================
// 报表构建
// ============================================================

function buildSameDayReport() {
    const { tenantId, sameDayDate, sameDayTotalOrders, sameDayResult: result } = _reportData;
    const COL = [12, 16, 10];

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃                    📊 当日复充分析报表                       ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 统计日期                         ┃ ${sameDayDate.padEnd(25)} ┃`,
        `┃ 当日总充值订单数                 ┃ ${String(sameDayTotalOrders).padEnd(25)} ┃`,
        `┃ 当日复充用户数（≥2次）           ┃ ${String(result.length).padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];

    if (result.length === 0) {
        lines.push('  （无当日复充用户）', '');
    } else {
        lines.push(buildRow(['userId', '充值总金额', '充值次数'], COL));
        lines.push(buildSep(COL));
        for (const r of result) {
            lines.push(buildRow([String(r.userId), r.totalAmount.toFixed(2), String(r.count)], COL));
        }
        lines.push('');
    }

    return lines.join('\n');
}

function buildNextDayReport() {
    const { tenantId, nextDayDate1, nextDayDate2, nextDayResult: result } = _reportData;
    const COL = [12, 16, 18, 18];

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃                    📊 次日复充分析报表                       ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 第一天                           ┃ ${nextDayDate1.padEnd(25)} ┃`,
        `┃ 第二天                           ┃ ${nextDayDate2.padEnd(25)} ┃`,
        `┃ 次日复充用户数                   ┃ ${String(result.length).padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];

    if (result.length === 0) {
        lines.push('  （无次日复充用户）', '');
    } else {
        lines.push(buildRow(['userId', '充值总金额', `${nextDayDate1}次数`, `${nextDayDate2}次数`], COL));
        lines.push(buildSep(COL));
        for (const r of result) {
            lines.push(buildRow([
                String(r.userId),
                r.totalAmount.toFixed(2),
                String(r.day1Count),
                String(r.day2Count)
            ], COL));
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ============================================================
// 表格工具
// ============================================================
function buildRow(cells, colWidths) {
    return '| ' + cells.map((c, i) => String(c).padEnd(colWidths[i])).join(' | ') + ' |';
}

function buildSep(colWidths) {
    return '|-' + colWidths.map(w => '-'.repeat(w)).join('-|-') + '-|';
}
