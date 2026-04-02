
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { createSystemActive } from '../activity/systemActive/createSystemActive.js';
import { createOrdersystem } from '../activity/orderSystem/createOrdersystem.js';
import { createSignin } from '../activity/signin/createSignin.js';
import { createTagfunc as createTagfuncfunc } from '../activity/tag/createTag.js';

import { logger } from '../../../libs/utils/logger.js';
import { sleep } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

// ==================== setup：全局登录一次 ====================
export function setup() {
    try {
        // 获取目标租户ID（从环境变量读取，优先使用 TENANT，其次 TENANT_ID，默认3003）
        const tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3006';
        logger.info(`[Setup] 目标租户: ${tenantId}`);

        // 如果是非默认租户，需要切换到该租户的环境配置
        if (tenantId !== String(ENV_CONFIG.TENANTID)) {
            logger.info(`[Setup] 切换到租户 ${tenantId} 的环境配置`);
            const targetEnv = getEnvByTenantId(tenantId);

            if (targetEnv) {
                logger.info(`[Setup]   前台域名: ${targetEnv.BASE_DESK_URL}`);
                logger.info(`[Setup]   后台域名: ${targetEnv.BASE_ADMIN_URL}`);
                logger.info(`[Setup]   管理员账号: ${targetEnv.ADMIN_USERNAME}`);

                // 更新 ENV_CONFIG（这会影响 AdminLogin 使用的账号和后台URL）
                Object.assign(ENV_CONFIG, targetEnv);
            }
        }

        const token = AdminLogin();
        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }

        logger.info('[Setup] ✅ 管理员登录成功');
        return { token, tenantId };
    } catch (error) {
        logger.error('AdminLogin 发生异常:', error.message);
        throw new Error(`登录失败: ${error.message}`);
    }
}

// ==================== scenarios 定义 ====================
export const options = {
    scenarios: {
        // 单一场景：按顺序执行所有活动
        sequentialExecution: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120s'
        }
    },
};

// ==================== 必须的 default（按顺序执行所有活动） ====================
export default function (data) {
    const tenantId = data.tenantId;

    // ✅ 重要：在 VU 中重新切换环境配置
    // K6 的 VU 会重新加载模块，ENV_CONFIG 会恢复为默认值
    if (tenantId !== String(ENV_CONFIG.TENANTID)) {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
            logger.info(`[VU] 重新切换到租户 ${tenantId} 的环境配置`);
            logger.info(`[VU]   前台域名: ${ENV_CONFIG.BASE_DESK_URL}`);
            logger.info(`[VU]   后台域名: ${ENV_CONFIG.BASE_ADMIN_URL}`);
        }
    }

    logger.info(`[VU] 开始为租户 ${tenantId} 按顺序执行活动创建`);

    // 步骤1：创建锦标赛任务
    logger.info('========== 步骤1：创建锦标赛任务 ==========');
    const dailyTasksResult = createSystemActive(data);
    if (!dailyTasksResult || !dailyTasksResult.success) {
        logger.error(`锦标赛任务创建失败: ${dailyTasksResult?.message || '未知错误'}`);
    } else {
        logger.info('✅ 锦标赛任务创建成功');
    }
    sleep(2);

    // 步骤2：创建订单系统活动（可选）
    // logger.info('========== 步骤2：创建订单系统活动 ==========');
    // const orderSystemResult = createOrdersystem(data);
    // if (!orderSystemResult || !orderSystemResult.success) {
    //     logger.error(`订单系统活动创建失败: ${orderSystemResult?.message || '未知错误'}`);
    // } else {
    //     logger.info('✅ 订单系统活动创建成功');
    // }
    // sleep(2);

    // 步骤3：创建签到活动（可选）
    // logger.info('========== 步骤3：创建签到活动 ==========');
    // const signinResult = createSignin(data);
    // if (!signinResult || !signinResult.success) {
    //     logger.error(`签到活动创建失败: ${signinResult?.message || '未知错误'}`);
    // } else {
    //     logger.info('✅ 签到活动创建成功');
    // }

    logger.info(`[VU] 租户 ${tenantId} 所有活动创建完成`);
}
