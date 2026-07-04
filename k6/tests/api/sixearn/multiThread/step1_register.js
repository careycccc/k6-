import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

// Options
export const options = {
    scenarios: {
        build_forest: {
            executor: 'per-vu-iterations',
            vus: parseInt(__ENV.VUS || '10', 10),
            iterations: 1,
            maxDuration: '2h',
        },
    },
};

// Utils
function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));

    const weights = [];
    for (let i = 0; i < levels; i++) {
        weights.push(((levels - i) / levels) * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));
    
    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const teamName = __ENV.TEAM_NAME || 'TeamA';
    
    const adminToken = AdminLogin();
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminData = { token: adminToken, envConfig };
    const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');
    
    const urls = { frontUrl: envConfig.BASE_DESK_URL, adminUrl: envConfig.BASE_ADMIN_URL, registerUrl: envConfig.BASE_DESK_URL };
    
    let res = phoneRegister(phone, adminData, 'qwer1234', '', null);
    if (!res || !res.data) {
        const inviteUrls = { ...urls, frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL, registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL };
        res = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', inviteUrls);
    }
    
    const token = extractToken(res);
    sleep(1);
    const userInfo = getFrontUserInfo(token);

    const rootData = { rootId: userInfo.userId, rootInvite: userInfo.inviteCode };
    
    // 🔥 给 Node.js Orchestrator 的输出标志位
    console.log(`[ROOT_INFO]: ${JSON.stringify(rootData)}`);

    return { adminToken, envConfig, rootInviteCode: userInfo.inviteCode };
}

export default function (data) {
    const { adminToken, envConfig, rootInviteCode } = data;
    const vuId = exec.vu.idInInstance;
    const totalVUs = parseInt(__ENV.VUS || '10', 10);
    const totalTarget = parseInt(__ENV.TOTAL_USERS || '50', 10);
    const levels = parseInt(__ENV.LEVELS || '3', 10);
    
    const tenantId = __ENV.TENANT_ID || '3006';
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminData = { token: adminToken, envConfig };
    
    // 平均分片：前 (totalTarget % totalVUs) 个 VU 各多处理1人，确保总和严格等于 totalTarget
    const base = Math.floor(totalTarget / totalVUs);
    const extra = totalTarget % totalVUs;
    // vuId 从 1 开始，前 extra 个 VU 多得 1 人
    const myTotalUsers = vuId <= extra ? base + 1 : base;
    
    const levelDistribution = distributePeople(myTotalUsers, levels);
    const inviteCodesByLevel = Array.from({ length: levels }, () => []);
    
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    for (let currentLevel = 0; currentLevel < levelDistribution.length; currentLevel++) {
        const levelCount = levelDistribution[currentLevel];
        for (let i = 0; i < levelCount; i++) {
            let parentCode = currentLevel === 0 ? rootInviteCode : randomPick(inviteCodesByLevel[currentLevel - 1]);
            if (!parentCode && currentLevel > 0) parentCode = rootInviteCode; // 降级兜底

            const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');
            const res = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
            const token = extractToken(res);
            
            if (token) {
                sleep(0.5);
                const userInfo = getFrontUserInfo(token);
                if (userInfo && userInfo.inviteCode) {
                    inviteCodesByLevel[currentLevel].push(userInfo.inviteCode);
                }
            }
        }
    }
}
