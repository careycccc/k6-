/**
 * 亏损救援金 (Rescue) 验证入口脚本
 * 
 * 使用方法：
 * k6 run -e TENANT_ID=3101 tests/api/activity/rescue/runRescueValidation.test.js
 * k6 run -e TENANT_ID=3101 -e USER_COUNT=2 runRescueValidation.test.js

 */

import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { validateRescue, getRescueActivityDetail } from './rescueValidation.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { sleep } from 'k6';

export const options = {
    scenarios: {
        rescue_validation: {
            executor: 'per-vu-iterations',
            vus: parseInt(__ENV.USER_COUNT) || 1,
            iterations: 1,
            maxDuration: '10m'
        },
    },
};

export function setup() {
    logger.info(`[RescueValidationTest] ========== Setup 开始 ==========`);

    const tenantId = __ENV.TENANT_ID || '3004';

    logger.info(`[RescueValidationTest] 目标租户: ${tenantId}`);

    const targetEnv = getEnvByTenantId(tenantId);
    if (targetEnv) {
        Object.assign(ENV_CONFIG, targetEnv);
    } else {
        logger.warn(`[RescueValidationTest] 未找到租户 ${tenantId} 的配置，使用默认配置。`);
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    // 在 setup 中先分析活动目标和条件
    logger.info(`[RescueValidationTest] 分析活动配置...`);
    const activityData = getRescueActivityDetail({ token: adminToken, envConfig: ENV_CONFIG });
    
    if (!activityData) {
        throw new Error('获取活动详情失败，请检查环境配置和活动状态');
    }

    logger.info(`[RescueValidationTest] ========== Setup 完成 ==========`);
    return { 
        token: adminToken, 
        tenantId, 
        envConfig: ENV_CONFIG,
        strategy: {
            targetIncludesZero: activityData.targetIncludesZero,
            vipArr: activityData.vipArr,
            rewardConfig: activityData.rewardConfig,
            activeActivity: activityData.activeActivity
        }
    };
}

export default function (data) {
    if (data.tenantId) {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    const vuId = __VU;
    logger.info(`[RescueValidationTest] [VU-${vuId}] 开始执行独立验证任务`);

    validateRescue(data);
}

export function teardown(data) {
    logger.info(`[RescueValidationTest] ========== 测试结束 ==========`);
}
