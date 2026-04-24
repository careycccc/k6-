/**
 * 3级代理(AgentL3) 验证入口脚本
 * 
 * 使用方法：
 * k6 run -e TENANT_ID=3004 -e TARGET_UID=136139 tests/api/agentL3/runAgentL3Validation.test.js
 
   k6 run -e TENANT_ID=3004 -e TARGET_UID=137529 runAgentL3Validation.test.js
*/

import { logger } from '../../../libs/utils/logger.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { runAgentL3Validation } from './agentL3Validation.js';

export const options = {
    scenarios: {
        agentL3_validation: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '10m'
        },
    },
};

export function setup() {
    logger.info(`[AgentL3Test] ========== Setup 开始 ==========`);

    const tenantId = __ENV.TENANT_ID || '3004';
    const targetUid = __ENV.TARGET_UID;

    if (!targetUid) {
        throw new Error('必须通过环境变量 TARGET_UID 指定总代UID，例如: -e TARGET_UID=700128');
    }

    logger.info(`[AgentL3Test] 目标租户: ${tenantId}`);

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
        } else {
            logger.warn(`[AgentL3Test] 未找到租户 ${tenantId} 的配置，使用默认配置。`);
        }
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    logger.info(`[AgentL3Test] ========== Setup 完成 ==========`);
    return { token: adminToken, tenantId, targetUid };
}

export default function (data) {
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    // 执行验证
    runAgentL3Validation(data, data.targetUid);
}

export function teardown(data) {
    logger.info(`[AgentL3Test] ========== 测试结束 ==========`);
}
