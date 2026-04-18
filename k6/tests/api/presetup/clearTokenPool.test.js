/**
 * Redis Token 池清理脚本（k6 版本）
 *
 * 功能：
 *   - 清空指定租户的 token 池
 *   - 支持清空单个租户、多个租户、或全部已知租户
 *   - 清空前打印当前池大小，清空后确认
 *
 * 使用方法：
 *
 *   # 清空单个租户
 *   k6 run -e TENANT_ID=3001 clearTokenPool.test.js
 *
 *   # 清空多个租户
 *   k6 run -e TENANTS=3001,3002,3003 clearTokenPool.test.js
 *
 *   # 清空所有已知租户（3001~3007）
 *   k6 run -e TENANTS=all clearTokenPool.test.js
 *
 *   # 指定 Redis 地址
 *   k6 run -e REDIS_URL=redis://192.168.1.100:6379 -e TENANTS=all clearTokenPool.test.js
 */

import { clearPool, getPoolSize, closeRedis } from '../../../libs/redis/tokenPool.js';

// 所有已知租户列表（与 envconfig.js 保持一致）
const ALL_KNOWN_TENANTS = ['3001', '3002', '3003', '3004', '3005', '3006', '3007'];

export const options = {
    scenarios: {
        clear_token_pool: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2m'
        }
    }
};

export default async function () {
    // 解析目标租户列表
    const tenantsEnv = __ENV.TENANTS || __ENV.TENANT_ID || '';
    let tenants = [];

    if (tenantsEnv === 'all') {
        tenants = ALL_KNOWN_TENANTS;
    } else if (tenantsEnv) {
        tenants = tenantsEnv.split(',').map(t => t.trim()).filter(Boolean);
    } else {
        console.error(
            `\n${'='.repeat(60)}\n` +
            `❌ 未指定租户，请使用以下参数：\n` +
            `   -e TENANT_ID=3001          清空单个租户\n` +
            `   -e TENANTS=3001,3002,3003  清空多个租户\n` +
            `   -e TENANTS=all             清空所有租户\n` +
            `${'='.repeat(60)}\n`
        );
        return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🗑️  Redis Token 池清理`);
    console.log(`   目标租户: ${tenants.join(', ')}`);
    console.log(`${'='.repeat(60)}\n`);

    let totalCleared = 0;

    for (const tenantId of tenants) {
        // 清空前查询数量
        const before = await getPoolSize(tenantId);

        if (before === 0) {
            console.log(`[Clear] 租户 ${tenantId}: 池已为空，跳过`);
            continue;
        }

        // 执行清空
        await clearPool(tenantId);

        // 清空后确认
        const after = await getPoolSize(tenantId);

        if (after === 0) {
            console.log(`[Clear] ✅ 租户 ${tenantId}: 已清空 ${before} 个 token`);
            totalCleared += before;
        } else {
            console.error(`[Clear] ⚠️  租户 ${tenantId}: 清空后仍剩余 ${after} 个，请检查 Redis`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ 清理完成，共清空 ${totalCleared} 个 token`);
    console.log(`   下次压测前请重新运行 batchRegister.test.js 注入新 token`);
    console.log(`${'='.repeat(60)}\n`);
}

export function teardown() {
    closeRedis();
}
