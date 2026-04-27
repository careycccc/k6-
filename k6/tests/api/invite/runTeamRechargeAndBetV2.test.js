/**
 * 团队充值和投注 V2 测试脚本（三段式行为分层）
 *
 * 将团队用户按概率分为三组：
 *   - 不活跃（INACTIVE_RATE）  ：不充值，不投注
 *   - 半活跃（RECHARGE_ONLY_RATE）：只充值，不投注
 *   - 活跃（剩余）             ：充值 + 投注
 *
 * ════════════════════════════════════════════════════════════
 * 用法
 * ════════════════════════════════════════════════════════════
 *
 *   # 默认分层（20% 不活跃 / 20% 只充值 / 60% 充值+投注）
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=137529 runTeamRechargeAndBetV2.test.js
 *
 *   # 自定义分层比例
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=137529 \
 *     -e INACTIVE_RATE=0.3 -e RECHARGE_ONLY_RATE=0.1 \
 *     runTeamRechargeAndBetV2.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 环境变量
 * ════════════════════════════════════════════════════════════
 *   TENANT_ID          租户ID                     默认: 3004
 *   TARGET_UID         目标用户ID（必填）
 *   INACTIVE_RATE      不活跃比例 0~1             默认: 0.2
 *   RECHARGE_ONLY_RATE 只充值比例 0~1             默认: 0.2
 *   REBATE_CHANCE      返佣设置几率 0~1           默认: 0.2
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { runTeamRechargeAndBetV2 } from './teamRechargeAndBet.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

export const options = {
    scenarios: {
        team_recharge_bet_v2: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2h'
        }
    }
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
            console.log(`[Setup] 切换到租户 ${tenantId}`);
        }
    }

    console.log('[Setup] 开始管理员登录...');
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');
    console.log('[Setup] ✅ 管理员登录成功\n');

    return { token: adminToken, tenantId };
}

export default function (data) {
    const targetUid = __ENV.TARGET_UID;
    if (!targetUid) {
        console.error('❌ 请通过 -e TARGET_UID=xxx 指定目标用户ID');
        return;
    }

    const inactiveRate     = parseFloat(__ENV.INACTIVE_RATE      || '0.2');
    const rechargeOnlyRate = parseFloat(__ENV.RECHARGE_ONLY_RATE || '0.2');
    const rebateChance     = parseFloat(__ENV.REBATE_CHANCE      || '0.2');

    // 校验比例之和不超过1
    if (inactiveRate + rechargeOnlyRate > 1) {
        console.error(`❌ INACTIVE_RATE(${inactiveRate}) + RECHARGE_ONLY_RATE(${rechargeOnlyRate}) 不能超过 1`);
        return;
    }

    // VU 中重新切换租户环境
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    console.log(`目标用户ID    : ${targetUid}`);
    console.log(`不活跃比例    : ${(inactiveRate * 100).toFixed(0)}%`);
    console.log(`只充值比例    : ${(rechargeOnlyRate * 100).toFixed(0)}%`);
    console.log(`充值+投注比例 : ${((1 - inactiveRate - rechargeOnlyRate) * 100).toFixed(0)}%\n`);

    runTeamRechargeAndBetV2(parseInt(targetUid), data, {
        inactiveRate,
        rechargeOnlyRate,
        rebateChance,
        delayMs: 1000
    });
}
