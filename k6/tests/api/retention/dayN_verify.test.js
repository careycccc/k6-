/**
 * 脚本③：复充率验证（纯查询，不执行充值）
 * 验证连续 N 天都有充值的用户数量及复充率
 *
 * 使用方法：
 *   # 次日复充验证（昨天+今天，连续2天）
 *   k6 run -e TENANT_ID=3004 -e RETENTION_DAYS=2 dayN_verify.test.js
 *
 *   # 3日复充验证（前天+昨天+今天，连续3天）
 *   k6 run -e TENANT_ID=3004 -e RETENTION_DAYS=3 dayN_verify.test.js
 *
 *   # 7日复充验证（连续7天）
 *   k6 run -e TENANT_ID=3004 -e RETENTION_DAYS=7 dayN_verify.test.js
 *
 * 参数：
 *   TENANT_ID        租户ID（必需）
 *   RETENTION_DAYS   验证连续几天（默认2=次日复充）
 *
 * 验证逻辑：
 *   今天往前推 RETENTION_DAYS 天，每天都必须有充值记录才算复充
 *   复充率 = |Day1 ∩ Day2 ∩ ... ∩ DayN| / |Day1|
 */

import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange } from './rechargeRetentionApi.js';
import { getRechargedUserIds } from './retentionService.js';

const tenantId      = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
const retentionDays = __ENV.RETENTION_DAYS ? parseInt(__ENV.RETENTION_DAYS) : 2;

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

// 全局结果（handleSummary 读取）
let _result = null;

export function setup() {
    console.log(`[Verify] ========== 复充率验证 ==========`);
    console.log(`[Verify] 租户: ${tenantId}，验证连续 ${retentionDays} 天复充`);

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

    // 查询每一天的充值用户集合
    // 验证的是已完成的历史数据，不包含今天
    // RETENTION_DAYS=2: 查 daysAgo=2(前天) 和 daysAgo=1(昨天)
    // RETENTION_DAYS=3: 查 daysAgo=3, 2, 1
    // 规律：从 retentionDays 往下到 1，不包含 0（今天）
    const daySets = [];

    for (let i = retentionDays; i >= 1; i--) {
        const range = getDayRange(i, tenantId);
        const userIds = getRechargedUserIds(adminToken, tenantId, i);
        const userSet = new Set(userIds.map(id => String(id)));

        daySets.push({
            daysAgo: i,
            dateStr: range.dateStr,
            userSet,
            count: userSet.size
        });

        console.log(`[Verify] Day ${retentionDays - i + 1} (${range.dateStr}): ${userSet.size} 人充值`);
    }

    // 取交集：所有天都充值的用户
    // daySets[0] 是最早那天（基准），daySets[last] 是今天
    let intersection = new Set(daySets[0].userSet);

    for (let i = 1; i < daySets.length; i++) {
        const nextSet = daySets[i].userSet;
        for (const uid of intersection) {
            if (!nextSet.has(uid)) {
                intersection.delete(uid);
            }
        }
    }

    const baseCount    = daySets[0].count;
    const retainCount  = intersection.size;
    const retentionRate = baseCount > 0
        ? ((retainCount / baseCount) * 100).toFixed(2)
        : '0.00';

    console.log(`\n[Verify] 基准用户数 (Day1): ${baseCount}`);
    console.log(`[Verify] 连续 ${retentionDays} 天复充用户数: ${retainCount}`);
    console.log(`[Verify] 复充率: ${retentionRate}%`);

    _result = {
        tenantId,
        retentionDays,
        daySets,
        baseCount,
        retainCount,
        retentionRate
    };
}

export function handleSummary() {
    if (!_result) {
        return { stdout: '\n[Verify] 无验证数据\n' };
    }

    const { daySets, baseCount, retainCount, retentionRate } = _result;

    // 标题根据天数动态生成
    const titleMap = { 2: '次日复充', 3: '3日复充', 7: '7日复充' };
    const title = titleMap[retentionDays] || `${retentionDays}日复充`;

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        `┃                📊 ${title}验证报表`.padEnd(65) + '┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 验证连续天数                     ┃ ${String(retentionDays).padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
    ];

    // 每天的充值人数
    for (let i = 0; i < daySets.length; i++) {
        const day = daySets[i];
        const label = `Day${i + 1} (${day.dateStr}) 充值人数`;
        lines.push(`┃ ${label.padEnd(32)} ┃ ${String(day.count).padEnd(25)} ┃`);
    }

    lines.push('┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫');
    lines.push(`┃ 基准用户数 (Day1)                ┃ ${String(baseCount).padEnd(25)} ┃`);
    lines.push(`┃ 连续 ${retentionDays} 天都充值用户数         ┃ ${String(retainCount).padEnd(25)} ┃`);
    lines.push(`┃ ${title}率                       ┃ ${(retentionRate + '%').padEnd(25)} ┃`);
    lines.push('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    lines.push('');

    return { stdout: lines.join('\n') };
}
