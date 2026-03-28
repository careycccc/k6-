/**
 * 每日签到验证测试
 */

import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { validateDailySignIn } from './signinValidation.js';

const TAG = 'SignInValidationTest';

/**
 * K6 配置选项
 */
export const options = {
    scenarios: {
        daily_signin_validation: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        },
    },
};

/**
 * K6 setup 函数
 */
export function setup() {
    logger.info(`[${TAG}] ========== Setup 开始 ==========`);

    const tenantId = __ENV.TENANT_ID || '3004';
    logger.info(`[${TAG}] 目标租户: ${tenantId}`);

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
        } else {
            logger.warn(`[${TAG}] 未找到租户 ${tenantId} 的配置，使用默认配置。`);
        }
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    logger.info(`[${TAG}] ========== Setup 完成 ==========`);
    return { token: adminToken, tenantId };
}

/**
 * K6 测试入口函数
 */
export default function (data) {
    // VU中重新应用环境配置
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    logger.info(`[${TAG}] ==============================`);
    logger.info(`[${TAG}] 启动每日签到自动化验证`);
    logger.info(`[${TAG}] 租户: ${data.tenantId}`);
    logger.info(`[${TAG}] ==============================`);

    // 读取环境变量配置
    let mode = __ENV.MODE || 'random'; // 'random' 或 'specified'
    const userCount = parseInt(__ENV.USER_COUNT || '3', 10); // 随机用户数量
    const manualReceiveRate = parseFloat(__ENV.MANUAL_RECEIVE_RATE || '0.8'); // 手动领取比例

    // 指定账号模式的账号列表（从环境变量读取）
    let accounts = [];
    if (mode === 'specified' && __ENV.ACCOUNTS) {
        try {
            // 格式: 13800138000,test@example.com
            // 系统会自动识别账号类型并使用验证码登录
            const accountsStr = __ENV.ACCOUNTS;
            accounts = accountsStr.split(',').map(acc => {
                const account = acc.trim();

                // 自动识别账号类型：包含@符号的是邮箱，否则是手机号
                const accountType = account.includes('@') ? 'email' : 'phone';

                logger.info(`[${TAG}] 解析账号: ${account} (类型: ${accountType})`);

                return {
                    accountType: accountType,
                    account: account
                };
            });
        } catch (error) {
            logger.error(`[${TAG}] 解析账号列表失败: ${error.message}`);
            logger.info(`[${TAG}] 使用随机模式`);
            mode = 'random';
        }
    }

    logger.info(`[${TAG}] 验证模式: ${mode}`);
    if (mode === 'random') {
        logger.info(`[${TAG}] 随机用户数量: ${userCount}`);
    } else {
        logger.info(`[${TAG}] 指定账号数量: ${accounts.length}`);
    }
    logger.info(`[${TAG}] 手动领取比例: ${(manualReceiveRate * 100).toFixed(0)}%`);

    // 执行验证
    const result = validateDailySignIn({
        adminToken: data.token,
        mode: mode,
        userCount: userCount,
        accounts: accounts,
        manualReceiveRate: manualReceiveRate
    });

    if (result.success) {
        logger.info(`[${TAG}] ✅ 验证完成`);
    } else {
        logger.error(`[${TAG}] ❌ 验证失败: ${result.message}`);
    }
}

/**
 * K6 teardown 函数
 */
export function teardown(data) {
    logger.info(`[${TAG}] ========== 测试结束 ==========`);
}
