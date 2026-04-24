/**
 * Redis Token 池清除脚本
 *
 * 用法：
 *   # 清除指定租户
 *   k6 run -e TENANT_ID=3004 clear.tokenPool.js
 *
 *   # 清除多个租户（逗号分隔）
 *   k6 run -e TENANT_ID=3004,3001,3006 clear.tokenPool.js
 *
 *   # 清除所有租户（不传 TENANT_ID）
 *   k6 run clear.tokenPool.js
 */

import { clearPool, getPoolSize, checkRedisConnection } from '../../libs/redis/tokenPool.js';

export const options = {
    scenarios: {
        clear_pool: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
        }
    }
};

export default async function () {
    const input = __ENV.TENANT_ID || '';

    // 解析租户列表（支持逗号分隔多个）
    const tenantIds = input
        ? input.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    // 检查 Redis 连接
    await checkRedisConnection('clear');

    if (tenantIds.length === 0) {
        console.warn('[Clear] ⚠️ 未指定 TENANT_ID，请通过 -e TENANT_ID=3004 指定要清除的租户');
        console.warn('[Clear] 若要清除所有，请使用 redis-cli: KEYS "token_pool:*" 查看后手动 DEL');
        return;
    }

    console.log(`\n[Clear] 开始清除 ${tenantIds.length} 个租户的 token 池...\n`);

    for (const tenantId of tenantIds) {
        const before = await getPoolSize(tenantId);
        if (before === 0) {
            console.log(`[Clear] 租户 ${tenantId} → 池已为空，跳过`);
            continue;
        }
        await clearPool(tenantId);
        console.log(`[Clear] ✅ 租户 ${tenantId} → 已清除 ${before} 个 token`);
    }

    console.log('\n[Clear] 🎉 清除完成');
}
