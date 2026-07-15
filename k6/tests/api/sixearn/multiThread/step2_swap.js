import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getAgentHierarchyList } from '../../invite/agentApi.js';
import { bundEarn } from '../bundearn.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

export const options = {
    scenarios: {
        swap_members: {
            executor: 'per-vu-iterations',
            vus: 1, // 必须单线程
            iterations: 1,
            maxDuration: '10m',
        },
    },
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const adminToken = AdminLogin();
    const envConfig = getEnvByTenantId(tenantId);
    return { token: adminToken, envConfig };
}

export default function (data) {
    const tenantId = __ENV.TENANT_ID || '3006';
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, data.envConfig);

    const fromRootId = __ENV.FROM_ROOT_ID;
    const toRootInvite = __ENV.TO_ROOT_INVITE;
    const fromTeam = __ENV.FROM_TEAM;
    const toTeam = __ENV.TO_TEAM;

    // 每次转线随机搬 [SWAP_MIN, SWAP_MAX] 人（默认 1~3），更贴近真实
    const swapMin = Math.max(1, parseInt(__ENV.SWAP_MIN || '1', 10));
    const swapMax = Math.max(swapMin, parseInt(__ENV.SWAP_MAX || '3', 10));

    console.log(`\n🔄 开始转线(Swap): ${fromTeam} -> ${toTeam}`);
    const agentList = getAgentHierarchyList(data.token, parseInt(fromRootId));

    if (!agentList || agentList.length === 0) {
        console.warn(`[Swap] ${fromTeam} 没有任何下级，跳过`);
        return;
    }

    const eligibleMembers = agentList.filter(member => member.hierarchy >= 1);

    // 本次目标人数：随机 [swapMin, swapMax]
    let want = swapMin + Math.floor(Math.random() * (swapMax - swapMin + 1));

    let targets = [];
    if (eligibleMembers.length === 0) {
        console.warn(`[Swap] ⚠️ ${fromTeam} 只有总代，将总代自己转过去`);
        targets = [parseInt(fromRootId)];
    } else {
        // 洗牌后挑不重复的 want 个（不超过可用人数）
        const pool = eligibleMembers.map(m => m.userId);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        want = Math.min(want, pool.length);
        targets = pool.slice(0, want);
    }

    console.log(`[Swap] ${fromTeam} → ${toTeam} 本次计划转 ${targets.length} 人: ${targets.join(', ')}`);

    __ENV.BIND_INVITE_CODE = toRootInvite;

    // 逐个转线：bundEarn 每次只搬 1 个账号（读 __ENV.UNBIND_UID），内部已有解绑/绑定等待。
    let done = 0;
    for (const uid of targets) {
        __ENV.UNBIND_UID = uid.toString();
        bundEarn({ token: data.token, envConfig: data.envConfig });
        done++;
        console.log(`✅ [${done}/${targets.length}] UID ${uid} 已绑定至邀请码 ${toRootInvite}`);
        // 每人之间再留一点缓冲，避免连续转线过快
        if (done < targets.length) sleep(1 + Math.random());
    }

    console.log(`✅ 转线完成: ${fromTeam} → ${toTeam} 共 ${done} 人`);
}
