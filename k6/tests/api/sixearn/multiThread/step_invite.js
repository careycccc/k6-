import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { getAgentHierarchyList } from '../../invite/agentApi.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../../user/userAccountApi.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

/**
 * 阶段：中途随机邀请注册新下级（转线前 / 转线后各跑一波）
 *
 * 做法：拉取团队活树 → 随机挑若干"现有成员"当上级（拿到其邀请码）→ 在其下面注册 INVITE_COUNT 个新下级。
 * 这些新下级会被后续 step3_action 的活树查询自动纳入，从而参与充值/投注/提现。
 *
 * 入参(env)：TEAM_NAME、ROOT_ID、ROOT_INVITE、INVITE_COUNT、TENANT_ID、[MAX_REG_ATTEMPTS]
 */
export const options = {
    scenarios: {
        invite_more: {
            executor: 'per-vu-iterations',
            vus: 1, // 单线程，挂靠随机成员，避免并发把限流打爆
            iterations: 1,
            maxDuration: '1h',
        },
    },
};

const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '6', 10);

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    const adminToken = AdminLogin();
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const rootId = parseInt(__ENV.ROOT_ID);
    const teamName = __ENV.TEAM_NAME || 'Team';
    console.log(`\n[Invite] 拉取 ${teamName} 活树 (ROOT_ID: ${rootId}) 以挑选上级 ...`);
    const members = getAgentHierarchyList(adminToken, rootId);
    console.log(`[Invite] ${teamName} 现有成员 ${members.length} 人`);

    return { adminToken, envConfig, members };
}

/** 解析某成员的邀请码：后台批量取账号 → 自动登录 → 前台用户信息取 inviteCode（带缓存） */
function resolveInviteCode(adminToken, userId, cache) {
    const key = String(userId);
    if (cache[key] !== undefined) return cache[key];

    let code = null;
    const accounts = batchGetUserAccounts(adminToken, [userId], 500);
    if (accounts && accounts.length > 0) {
        const token = autoLoginByAccount(accounts[0].account, adminToken);
        if (token) {
            const info = getFrontUserInfo(token);
            if (info && info.inviteCode) code = info.inviteCode;
        }
    }
    cache[key] = code; // 允许缓存 null，避免对同一坏成员反复尝试
    return code;
}

export default function (data) {
    const tenantId = __ENV.TENANT_ID || '3006';
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, data.envConfig);

    const { adminToken, envConfig, members } = data;
    const teamName = __ENV.TEAM_NAME || 'Team';
    const rootInvite = __ENV.ROOT_INVITE || '';
    const count = parseInt(__ENV.INVITE_COUNT || '3', 10);
    const adminData = { token: adminToken, envConfig };

    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
    };

    // 候选上级：优先真实下级(hierarchy>=1)，随机挂靠；解析不到邀请码时兜底挂到根
    const eligible = (members || []).filter((m) => m.hierarchy >= 1);
    const inviteCache = {};

    let created = 0, failed = 0, underRoot = 0;
    for (let i = 0; i < count; i++) {
        // 选上级邀请码
        let parentInvite = rootInvite;
        if (eligible.length > 0) {
            const m = eligible[Math.floor(Math.random() * eligible.length)];
            const code = resolveInviteCode(adminToken, m.userId, inviteCache);
            if (code) parentInvite = code;
            else underRoot++;
        } else {
            underRoot++;
        }
        if (!parentInvite) { failed++; continue; }

        // 注册新下级（限流退避重试，换号）
        let ok = false;
        for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
            const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');
            const res = phoneRegisterByInvite(phone, parentInvite, adminData, 'qwer1234', '', customUrls);
            if (res && res.data) { ok = true; break; }
            sleep(Math.min(0.8 * Math.pow(1.7, attempt - 1), 8) + Math.random() * 0.6);
        }
        if (ok) created++; else failed++;

        sleep(0.4 + Math.random() * 0.4); // 轻微节流
    }

    console.log(`[INVITE_RESULT] team=${teamName} 目标=${count} 新建=${created} 失败=${failed} 挂根兜底=${underRoot}`);
}
