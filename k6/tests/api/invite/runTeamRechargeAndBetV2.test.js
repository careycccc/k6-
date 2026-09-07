/**
 * 团队充值和投注 V2 测试脚本（三段式行为分层 + 多线程支持）
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
 *   # 默认分层，多线程模式（根据层级自动计算线程数）
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=138413 runTeamRechargeAndBetV2.test.js
 *
 *   # 自定义线程数
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=138413 -e VUS=4 runTeamRechargeAndBetV2.test.js
 *
 *   # 自定义分层比例
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=138413 -e INACTIVE_RATE=0 -e RECHARGE_ONLY_RATE=0 runTeamRechargeAndBetV2.test.js
 *
 *   # 自定义提现几率
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=163353 -e WITHDRAW_CHANCE=0.9 runTeamRechargeAndBetV2.test.js
 *
 *   # 提现 + 后台审核出款（默认不审核）,WITHDRAW_AUDIT=true后台要审核
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=164320 -e WITHDRAW_CHANCE=0.9 -e WITHDRAW_AUDIT=true runTeamRechargeAndBetV2.test.js
 *
 *   # 只针对于L3团队的方式进行整个团队的充值投注
 *   k6 run -e TENANT_ID=3004 -e TARGET_UID=164597 -e IS_L3=true -e VUS=3 runTeamRechargeAndBetV2.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 环境变量
 * ════════════════════════════════════════════════════════════
 *   TENANT_ID          租户ID                     默认: 3004
 *   TARGET_UID         目标用户ID（必填）
 *   VUS                启动的线程(VU)数量         默认: 层级数 (最高20)
 *   INACTIVE_RATE      不活跃比例 0~1             默认: 0.2
 *   RECHARGE_ONLY_RATE 只充值比例 0~1             默认: 0.2
 *   REBATE_CHANCE      返佣设置几率 0~1           默认: 0.2
 *   WITHDRAW_CHANCE    提现几率 0~1               默认: 0
 *   WITHDRAW_AUDIT     提现后是否后台审核出款      默认: false（不审核）
 *   IS_L3              是否为L3代理(true/false)   默认: false
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { runTeamRechargeAndBetV2 } from './teamRechargeAndBet.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import exec from 'k6/execution';
import { getAgentHierarchyList, getL3AgentInvitedList } from './agentApi.js';

// 获取手动指定的VUs
const manualVus = __ENV.VUS ? parseInt(__ENV.VUS, 10) : 0;

export const options = {
    scenarios: {
        team_recharge_bet_v2: {
            executor: 'per-vu-iterations',
            // 如果未指定，预先分配一个较大的默认值，执行时再动态裁剪超出层级的部分
            vus: manualVus > 0 ? manualVus : 20,
            iterations: 1,
            maxDuration: '2h'
        }
    }
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    const targetUid = __ENV.TARGET_UID;

    if (!targetUid) {
        console.error('❌ 请通过 -e TARGET_UID=xxx 指定目标用户ID');
        return { error: 'Missing TARGET_UID' };
    }

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

    // 提前在 setup 阶段查询所有用户层级，以实现智能多线程切分
    const isL3 = (__ENV.IS_L3 || '').toLowerCase() === 'true';
    let allUsers = [];

    console.log(`[Setup] 正在计算代理的层级结构...`);
    if (isL3) {
        allUsers = getL3AgentInvitedList(adminToken, parseInt(targetUid));
    } else {
        allUsers = getAgentHierarchyList(adminToken, parseInt(targetUid));
    }

    let levels = 1;
    let prefetchedUserIds = [];

    if (allUsers && allUsers.length > 0) {
        prefetchedUserIds = allUsers.map(u => u.userId).filter(id => id);

        // 尝试从返回结果中计算实际层级跨度
        if (allUsers[0].hierarchy !== undefined) {
            const hierarchies = allUsers.map(u => u.hierarchy).filter(h => h !== null && h !== undefined);
            if (hierarchies.length > 0) {
                const minH = Math.min(...hierarchies);
                const maxH = Math.max(...hierarchies);
                levels = maxH - minH + 1;
            }
        } else {
            // 没有层级字段时粗略估算或默认为4
            levels = Math.max(1, Math.floor(Math.log10(allUsers.length + 1)));
            if (levels === 1 && allUsers.length > 1) levels = 4;
        }
    }

    // 动态决定实际激活的 VU 数量
    const activeVus = manualVus > 0 ? manualVus : Math.min(levels, 20);

    console.log(`[Setup] 发现 ${prefetchedUserIds.length} 个相关用户, 跨越 ${levels} 个层级.`);
    console.log(`[Setup] 将激活 ${activeVus} 个 VU (线程) 并行处理批任务.\n`);

    return { token: adminToken, tenantId, activeVus, prefetchedUserIds };
}

export default function (data) {
    if (!data || data.error) return;

    const { activeVus, prefetchedUserIds } = data;
    const vuId = exec.vu.idInInstance;

    // 动态裁剪：超出我们需要激活的VU数量时，该VU直接空转退出
    if (vuId > activeVus) {
        return;
    }

    const targetUid = __ENV.TARGET_UID;
    const inactiveRate = parseFloat(__ENV.INACTIVE_RATE || '0.2');
    const rechargeOnlyRate = parseFloat(__ENV.RECHARGE_ONLY_RATE || '0.2');
    const rebateChance = parseFloat(__ENV.REBATE_CHANCE || '0.2');
    const withdrawChance = parseFloat(__ENV.WITHDRAW_CHANCE || '0');
    const withdrawAudit = (__ENV.WITHDRAW_AUDIT || '').toLowerCase() === 'true';
    const isL3 = (__ENV.IS_L3 || '').toLowerCase() === 'true';

    // 校验比例之和不超过1
    if (inactiveRate + rechargeOnlyRate > 1) {
        if (vuId === 1) console.error(`❌ INACTIVE_RATE(${inactiveRate}) + RECHARGE_ONLY_RATE(${rechargeOnlyRate}) 不能超过 1`);
        return;
    }

    // VU 中重新切换租户环境
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    if (vuId === 1) {
        console.log(`目标用户ID    : ${targetUid}`);
        console.log(`启动线程数    : ${activeVus}`);
        console.log(`不活跃比例    : ${(inactiveRate * 100).toFixed(0)}%`);
        console.log(`只充值比例    : ${(rechargeOnlyRate * 100).toFixed(0)}%`);
        console.log(`充值+投注比例 : ${((1 - inactiveRate - rechargeOnlyRate) * 100).toFixed(0)}%\n`);
        console.log(`提现触发几率  : ${(withdrawChance * 100).toFixed(0)}%`);
        console.log(`后台审核出款  : ${withdrawAudit ? '开启' : '关闭'}\n`);
    }

    runTeamRechargeAndBetV2(parseInt(targetUid), data, {
        inactiveRate,
        rechargeOnlyRate,
        rebateChance,
        withdrawChance,
        withdrawAudit,
        delayMs: 1000,
        isL3,
        vuId: vuId,
        vuCount: activeVus,
        prefetchedUserIds: prefetchedUserIds
    });
}
