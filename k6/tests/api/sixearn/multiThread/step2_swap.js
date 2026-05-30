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

    console.log(`\n🔄 开始转线(Swap): ${fromTeam} -> ${toTeam}`);
    const agentList = getAgentHierarchyList(data.token, parseInt(fromRootId));
    
    if (!agentList || agentList.length === 0) {
        console.warn(`[Swap] ${fromTeam} 没有任何下级，跳过`);
        return;
    }

    const eligibleMembers = agentList.filter(member => member.hierarchy >= 1);
    if (eligibleMembers.length === 0) {
        console.warn(`[Swap] ⚠️ ${fromTeam} 只有总代，将总代自己转过去`);
        __ENV.UNBIND_UID = fromRootId.toString();
    } else {
        // 随机挑一个
        const uid = eligibleMembers[Math.floor(Math.random() * eligibleMembers.length)].userId;
        __ENV.UNBIND_UID = uid.toString();
    }
    
    __ENV.BIND_INVITE_CODE = toRootInvite;
    
    // 调用现有的 bundEarn 逻辑 (传入 { token, envConfig })
    bundEarn({ token: data.token, envConfig: data.envConfig });
    
    console.log(`✅ 转线完成: UID ${__ENV.UNBIND_UID} 已绑定至邀请码 ${toRootInvite}`);
}
