/**
 * 团队充值和投注测试脚本
 * 
 * 使用方法：
 * k6 run -e TENANT_ID=3004 -e TARGET_UID=137529 k6/tests/api/invite/runTeamRechargeAndBet.test.js
 * 
 * 环境变量：
 * - TENANT_ID: 租户ID（可选，默认3004）
 * - TARGET_UID: 目标用户ID（必需）
 * - RECHARGE_CHANCE: 充值几率 0-1（可选，默认0.5即50%）
 */

// # 基本使用
// k6 run -e TENANT_ID=3004 -e RECHARGE_CHANCE=0.8 -e TARGET_UID=136736 runTeamRechargeAndBet.test.js

// # 自定义充值几率（70%）
// k6 run -e TENANT_ID=3002 -e TARGET_UID=5945146 -e RECHARGE_CHANCE=0.7 k6/tests/api/invite/runTeamRechargeAndBet.test.js


import { AdminLogin } from '../login/adminlogin.test.js';
import { runTeamRechargeAndBet } from './teamRechargeAndBet.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

export function setup() {
    console.log('[Setup] 开始管理员登录...');

    const tenantId = __ENV.TENANT_ID || '3004';

    // 切换租户环境
    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
            console.log(`[Setup] 切换到租户 ${tenantId}`);
        }
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    console.log('[Setup] ✅ 管理员登录成功\n');

    return { token: adminToken, tenantId: tenantId };
}

export const options = {
    scenarios: {
        team_recharge_bet: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2h'
        },
    },
};

export default function (data) {
    const targetUid = __ENV.TARGET_UID;

    if (!targetUid) {
        console.error('❌ 请通过环境变量 TARGET_UID 指定目标用户ID');
        return;
    }

    const rechargeChance = __ENV.RECHARGE_CHANCE ? parseFloat(__ENV.RECHARGE_CHANCE) : 0.5;

    // 切换租户环境（VU中需要重新切换）
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
        }
    }

    console.log(`\n目标用户ID: ${targetUid}`);
    console.log(`充值几率: ${(rechargeChance * 100).toFixed(0)}%\n`);

    // 执行团队充值和投注
    runTeamRechargeAndBet(parseInt(targetUid), data, {
        rechargeChance: rechargeChance,
        delayMs: 1000
    });
}
