/**
 * 批量注册前置脚本 - k6 入口
 *
 * 使用方法：
 *
 *   场景A：普通注册100个（租户不需要邀请码）
 *     k6 run -e TENANT_ID=3001 -e COUNT=100 batchRegister.test.js
 *
 *   场景A：带邀请码注册（第一次报"邀请码不能为空"后使用）
 *     k6 run -e TENANT_ID=3001 -e COUNT=100 -e INVITE_CODE=L746TDN batchRegister.test.js
 *
 *   场景B：多层级邀请注册，100人，5层
 *     k6 run -e TENANT_ID=3001 -e COUNT=100 -e INVITE_CODE=L746TDN -e LEVELS=5 batchRegister.test.js
 *
 *   指定 Redis 地址（默认 localhost:6379）：
 *     k6 run -e REDIS_URL=redis://192.168.1.100:6379 -e TENANT_ID=3001 -e COUNT=100 batchRegister.test.js
 */

import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { batchRegisterScenarioA, batchRegisterScenarioB } from './batchRegister.js';
import { getPoolSize, closeRedis } from '../../../libs/redis/tokenPool.js';

export const options = {
    scenarios: {
        batch_register: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120m'  // 注册大量账号可能耗时较长
        }
    }
};

// ============================================================
// Setup：管理员登录
// ============================================================
export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    const envConfig = getEnvByTenantId(tenantId);

    console.log(`[Setup] 租户: ${tenantId}`);
    console.log(`[Setup] 后台地址: ${envConfig.BASE_ADMIN_URL}`);

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error(`[Setup] ❌ 管理员登录失败，租户: ${tenantId}`);
    }

    console.log(`[Setup] ✅ 管理员登录成功`);

    return {
        token: adminToken,
        envConfig: envConfig,
        tenantId: tenantId
    };
}

// ============================================================
// 主函数
// ============================================================
export default async function (data) {
    const tenantId   = __ENV.TENANT_ID   || '3004';
    const count      = parseInt(__ENV.COUNT       || '100', 10);
    const inviteCode = __ENV.INVITE_CODE  || '';
    const levels     = parseInt(__ENV.LEVELS      || '0', 10);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 批量注册前置脚本`);
    console.log(`   租户ID   : ${tenantId}`);
    console.log(`   目标数量 : ${count}`);
    console.log(`   邀请码   : ${inviteCode || '(无)'}`);
    console.log(`   层级     : ${levels > 0 ? levels : '(场景A，不分层)'}`);
    console.log(`${'='.repeat(60)}\n`);

    const adminData = {
        token: data.token,
        envConfig: data.envConfig
    };

    let added = 0;

    if (levels > 0 && inviteCode) {
        // 场景B：多层级邀请注册
        added = await batchRegisterScenarioB(adminData, count, inviteCode, levels, tenantId);
    } else {
        // 场景A：普通注册 / 带邀请码注册
        added = await batchRegisterScenarioA(adminData, count, inviteCode, tenantId);
    }

    // 最终汇报
    const total = await getPoolSize(tenantId);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ 注册完成`);
    console.log(`   本次新增 : ${added} 个 token`);
    console.log(`   池内总量 : ${total} 个 token`);
    console.log(`   Redis Key: token_pool:${tenantId}`);
    console.log(`${'='.repeat(60)}\n`);
}

// ============================================================
// Teardown：关闭 Redis 连接
// ============================================================
export function teardown() {
    closeRedis();
    console.log('[Teardown] Redis 连接已关闭');
}
