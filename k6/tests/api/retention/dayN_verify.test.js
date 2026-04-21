/**
 * 脚本③：复充率验证（纯查询，不执行充值）
 *
 * 使用方法：
 *   # 当日复充验证（昨天同一天内充值≥2次）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=1 dayN_verify.test.js
 *
 *   # 次日复充验证（前天+昨天，连续2天）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=2 dayN_verify.test.js
 *
 *   # 3日复充验证（连续3天）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=3 dayN_verify.test.js
 *
 * 参数：
 *   TENANT_ID            租户ID（必需）
 *   CHANNEL_PACKAGE_ID   渠道来源ID（必需，不传直接报错）
 *   RETENTION_DAYS       验证连续几天（默认2=次日复充）
 */

import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange, fetchAllRechargeOrders, analyzeSameDayRetention } from './rechargeRetentionApi.js';

const tenantId      = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
const retentionDays = __ENV.RETENTION_DAYS ? parseInt(__ENV.RETENTION_DAYS) : 2;
const channelPackageId = __ENV.CHANNEL_PACKAGE_ID ? parseInt(__ENV.CHANNEL_PACKAGE_ID) : null;

export const options = {
    scenarios: {
        verify: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        }
    }
};

// 报表字符串存这里，handleSummary 直接读
let _reportOutput = '';

export function setup() {
    console.log(`[Verify] ========== 复充率验证 ==========`);
    console.log(`[Verify] 租户: ${tenantId}，验证连续 ${retentionDays} 天复充`);

    if (!channelPackageId) {
        throw new Error('[Verify] ❌ 未提供渠道来源，请通过 -e CHANNEL_PACKAGE_ID=xxx 传入');
    }
    console.log(`[Verify] 渠道来源: ${channelPackageId}`);

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error(`[Verify] ❌ 租户 ${tenantId} 管理员登录失败`);

    console.log(`[Verify] ✅ 管理员登录成功`);
    return { token: adminToken };
}

export default function (data) {
    const adminToken = data.token;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 复充率验证  租户: ${tenantId}  连续天数: ${retentionDays}`);
    console.log(`${'='.repeat(60)}\n`);

    if (retentionDays === 1) {
        _reportOutput = buildSameDayReport(adminToken);
    } else {
        _reportOutput = buildMultiDayReport(adminToken);
    }

    // 直接在 default 里打印，不依赖 handleSummary 的上下文
    console.log(_reportOutput);
}

// ============================================================
// 当日复充报表
// ============================================================
function buildSameDayReport(adminToken) {
    const range = getDayRange(1, tenantId);
    console.log(`[Verify] 当日复充验证，查询日期: ${range.dateStr}`);

    const orders = fetchAllRechargeOrders(adminToken, range.startTime, range.endTime, 'Payed', channelPackageId);
    const result = analyzeSameDayRetention(orders);
    const totalUsers = new Set(orders.map(o => String(o.userId))).size;
    const retentionRate = totalUsers > 0 ? ((result.length / totalUsers) * 100).toFixed(2) : '0.00';

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃                  📊 当日复充验证报表                         ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 统计日期                         ┃ ${range.dateStr.padEnd(25)} ┃`,
        `┃ 当日充值总用户数                 ┃ ${String(totalUsers).padEnd(25)} ┃`,
        `┃ 当日复充用户数（≥2次）           ┃ ${String(result.length).padEnd(25)} ┃`,
        `┃ 当日复充率                       ┃ ${(retentionRate + '%').padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];

    if (result.length > 0) {
        lines.push('  📋 复充用户明细（按总金额降序）');
        lines.push('  ' + '─'.repeat(56));
        lines.push(`  ${'userId'.padEnd(16)} ${'充值次数'.padEnd(10)} ${'总金额'.padEnd(16)} 日期`);
        lines.push('  ' + '─'.repeat(56));
        for (const r of result) {
            lines.push(`  ${String(r.userId).padEnd(16)} ${String(r.count).padEnd(10)} ${r.totalAmount.toFixed(2).padEnd(16)} ${range.dateStr}`);
        }
        lines.push('  ' + '─'.repeat(56));
    } else {
        lines.push('  （无当日复充用户）');
    }

    lines.push('');
    return lines.join('\n');
}

// ============================================================
// 多天连续复充报表
// ============================================================
function buildMultiDayReport(adminToken) {
    const titleMap = { 2: '次日复充', 3: '3日复充', 7: '7日复充' };
    const title = titleMap[retentionDays] || `${retentionDays}日复充`;

    // 查询每天数据，从最早那天到昨天（不含今天）
    const daySets = [];
    for (let i = retentionDays; i >= 1; i--) {
        const range = getDayRange(i, tenantId);
        const orders = fetchAllRechargeOrders(adminToken, range.startTime, range.endTime, 'Payed', channelPackageId);
        const userMap = new Map();
        for (const order of orders) {
            const uid = String(order.userId);
            if (!userMap.has(uid)) userMap.set(uid, { amount: 0, count: 0 });
            const entry = userMap.get(uid);
            entry.amount += order.amount || 0;
            entry.count++;
        }
        daySets.push({ daysAgo: i, dateStr: range.dateStr, userMap, count: userMap.size });
        console.log(`[Verify] Day ${retentionDays - i + 1} (${range.dateStr}): ${userMap.size} 人充值`);
    }

    // 取交集
    let intersectionIds = new Set(daySets[0].userMap.keys());
    for (let i = 1; i < daySets.length; i++) {
        for (const uid of intersectionIds) {
            if (!daySets[i].userMap.has(uid)) intersectionIds.delete(uid);
        }
    }

    // 构建明细
    const detail = [];
    for (const uid of intersectionIds) {
        const row = { userId: uid, days: [], totalAmount: 0 };
        for (let i = 0; i < daySets.length; i++) {
            const entry = daySets[i].userMap.get(uid);
            row.days.push({ dateStr: daySets[i].dateStr, amount: entry.amount, count: entry.count });
            row.totalAmount += entry.amount;
        }
        detail.push(row);
    }
    detail.sort((a, b) => b.totalAmount - a.totalAmount);

    const baseCount     = daySets[0].count;
    const retainCount   = intersectionIds.size;
    const retentionRate = baseCount > 0 ? ((retainCount / baseCount) * 100).toFixed(2) : '0.00';

    // 汇总表
    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        `┃             📊 ${title}验证报表`.padEnd(65) + '┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 验证连续天数                     ┃ ${String(retentionDays).padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
    ];

    for (let i = 0; i < daySets.length; i++) {
        const label = `Day${i + 1} (${daySets[i].dateStr}) 充值人数`;
        lines.push(`┃ ${label.padEnd(32)} ┃ ${String(daySets[i].count).padEnd(25)} ┃`);
    }

    lines.push('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
    lines.push(`┃ 基准用户数 (Day1)                ┃ ${String(baseCount).padEnd(25)} ┃`);
    lines.push(`┃ 连续 ${retentionDays} 天都充值用户数         ┃ ${String(retainCount).padEnd(25)} ┃`);
    lines.push(`┃ ${title}率                       ┃ ${(retentionRate + '%').padEnd(25)} ┃`);
    lines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    lines.push('');

    // 明细表
    if (detail.length > 0) {
        const colW = 16;
        const dateHeaders = daySets.map((d, i) => `Day${i + 1}(${d.dateStr})`);
        const totalWidth = 16 + (colW + 1) * (dateHeaders.length + 1);

        lines.push(`  📋 ${title}用户明细（共 ${detail.length} 人，按总金额降序）`);
        lines.push('  ' + '─'.repeat(totalWidth));

        let header = `  ${'userId'.padEnd(16)}`;
        for (const dh of dateHeaders) header += ` ${dh.padEnd(colW)}`;
        header += ` ${'总金额'.padEnd(colW)}`;
        lines.push(header);
        lines.push('  ' + '─'.repeat(totalWidth));

        for (const r of detail) {
            let row = `  ${String(r.userId).padEnd(16)}`;
            for (const d of r.days) row += ` ${d.amount.toFixed(2).padEnd(colW)}`;
            row += ` ${r.totalAmount.toFixed(2).padEnd(colW)}`;
            lines.push(row);
        }
        lines.push('  ' + '─'.repeat(totalWidth));
    } else {
        lines.push(`  （无${title}用户）`);
    }

    lines.push('');
    return lines.join('\n');
}

export function handleSummary() {
    // 报表已在 default 函数里通过 console.log 输出
    // handleSummary 只输出空内容避免 k6 默认统计干扰
    return { stdout: '' };
}
