/**
 * 长时间多租户转线测试脚本（纯转线版，无充值/投注）
 *
 * 功能概述：
 *   1. 多租户支持（同租户内总代互转）
 *   2. 每个租户注册 N 个总代，每个总代可单独配置人数和层级
 *   3. 同租户内每对总代之间各转线 TRANSFERS_PER_PAIR 次
 *   4. 每次转线：随机选人 → 直接执行转线（无充值/投注行为）
 *   5. 最终报表写入 k6/reports/ 目录
 *
 * 使用方法（每个总代单独指定人数和层级）：
 *   k6 run \
 *     -e TENANT_IDS=3004,3006,3007 \
 *     -e AGENTS_PER_TENANT=3 \
 *     -e AGENT1_MEMBERS=1000 -e AGENT1_LEVELS=20 \
 *     -e AGENT2_MEMBERS=2000 -e AGENT2_LEVELS=30 \
 *     -e AGENT3_MEMBERS=3000 -e AGENT3_LEVELS=40 \
 *     -e TRANSFERS_PER_PAIR=3 \
 *     longRunMultiTenantTransferOnly.test.js
 *
 * 说明：
 *   - AGENT{N}_MEMBERS / AGENT{N}_LEVELS：第 N 个总代的人数/层级（N 从 1 开始）
 *   - 未单独配置的总代回退到 MEMBERS_PER_AGENT / LEVELS_PER_AGENT 默认值
 *   - 同一套 AGENT{N} 配置对所有租户的第 N 个总代生效
 *     （如需租户级别单独配置，可用 TENANT_{tenantId}_AGENT{N}_MEMBERS）
 *
 * 断点续跑（跳过注册，直接使用已有总代）：
 *   -e TENANT_IDS=3004 \
 *   -e ROOT_UIDS_3004=111,222,333 \
 *   longRunMultiTenantTransferOnly.test.js
 *
 * k6 run -e TENANT_IDS=3006 -e AGENTS_PER_TENANT=3 -e AGENT1_MEMBERS=10 -e AGENT1_LEVELS=2 -e AGENT2_MEMBERS=20 -e AGENT2_LEVELS=3 -e AGENT3_MEMBERS=11 -e AGENT3_LEVELS=3 -e TRANSFERS_PER_PAIR=3 longRunMultiTenantTransferOnly.test.js
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { batchGetUserAccounts, autoLoginByUserId } from '../user/userAccountApi.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';
import { sendRequest } from '../common/request.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';

// ============================================================
// ==================== 参数解析 ==============================
// ============================================================

const TENANT_IDS         = (__ENV.TENANT_IDS || '3004').split(',').map(s => s.trim()).filter(Boolean);
const AGENTS_PER_TENANT  = parseInt(__ENV.AGENTS_PER_TENANT  || '3',   10);
// 全局默认值（当某个总代没有单独配置时使用）
const MEMBERS_PER_AGENT  = parseInt(__ENV.MEMBERS_PER_AGENT  || '100', 10);
const LEVELS_PER_AGENT   = parseInt(__ENV.LEVELS_PER_AGENT   || '8',   10);
const TRANSFERS_PER_PAIR = parseInt(__ENV.TRANSFERS_PER_PAIR || '3',   10);
const REPORT_DIR         = __ENV.REPORT_DIR || 'k6/reports';

const TAG = 'LongRunTransferOnly';

/**
 * 获取第 agentIndex（1-based）个总代的成员数
 */
function getAgentMembers(agentIndex, tenantId) {
    const tenantKey = `TENANT_${tenantId}_AGENT${agentIndex}_MEMBERS`;
    const globalKey = `AGENT${agentIndex}_MEMBERS`;
    if (__ENV[tenantKey]) return parseInt(__ENV[tenantKey], 10);
    if (__ENV[globalKey]) return parseInt(__ENV[globalKey], 10);
    return MEMBERS_PER_AGENT;
}

/**
 * 获取第 agentIndex（1-based）个总代的层级数
 */
function getAgentLevels(agentIndex, tenantId) {
    const tenantKey = `TENANT_${tenantId}_AGENT${agentIndex}_LEVELS`;
    const globalKey = `AGENT${agentIndex}_LEVELS`;
    if (__ENV[tenantKey]) return parseInt(__ENV[tenantKey], 10);
    if (__ENV[globalKey]) return parseInt(__ENV[globalKey], 10);
    return LEVELS_PER_AGENT;
}

// ============================================================
// ==================== K6 配置 ===============================
// ============================================================

export const options = {
    setupTimeout: '8h',
    scenarios: {
        long_run_transfer: {
            executor:    'per-vu-iterations',
            vus:         1,
            iterations:  1,
            maxDuration: '36h'
        }
    },
    thresholds: {
        http_req_duration: ['p(95)<10000']
    }
};

// ============================================================
// ==================== 工具函数 ==============================
// ============================================================

function formatTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 按层级加权随机选择成员
 */
function selectMemberByHierarchyWeight(memberList, excludeUserId) {
    const eligible = memberList.filter(m => m.userId !== excludeUserId && m.hierarchy > 0);
    if (eligible.length === 0) return null;

    const byHier = {};
    eligible.forEach(m => {
        if (!byHier[m.hierarchy]) byHier[m.hierarchy] = [];
        byHier[m.hierarchy].push(m);
    });

    const hiers = Object.keys(byHier).map(Number).sort((a, b) => a - b);
    const totalWeight = hiers.reduce((s, h) => s + h, 0);
    let rand = Math.random() * totalWeight;
    let selectedHier = hiers[hiers.length - 1];
    for (const h of hiers) {
        rand -= h;
        if (rand <= 0) { selectedHier = h; break; }
    }

    const pool = byHier[selectedHier];
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 登录用户（自动识别手机号/邮箱）
 */
function loginByAccount(account, adminToken) {
    const adminData = { token: adminToken };
    if (account.includes('@')) return emailAutoLoginFlow(account, adminData);
    return mobileAutoLoginFlow(account, adminData);
}

/**
 * 将总人数按层级递减随机分配
 */
function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }
    const weights = [];
    for (let i = 0; i < levels; i++) {
        const base = (levels - i) / levels;
        weights.push(base * (0.5 + Math.random()));
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

// ============================================================
// ==================== 转线操作 ==============================
// ============================================================

// 解绑后等待时间（秒），默认 60 秒
const UNBIND_WAIT_SECONDS = parseInt(__ENV.UNBIND_WAIT_SECONDS || '60', 10);

/**
 * 执行解绑 + 绑定
 */
function doTransfer(adminToken, userId, targetInviteCode) {
    console.log(`[Transfer] 解绑 userId=${userId}`);
    sendRequest({ userId }, '/api/Agent/UserInviteUnBind', TAG, false, adminToken);

    console.log(`[Transfer] 解绑完成，等待 ${UNBIND_WAIT_SECONDS} 秒后再绑定（系统处理时间）...`);
    sleep(UNBIND_WAIT_SECONDS);

    console.log(`[Transfer] 绑定 userId=${userId} → inviteCode=${targetInviteCode}`);
    sendRequest({ userId, inviteCode: targetInviteCode }, '/api/Agent/UserInviteBind', TAG, false, adminToken);
    sleep(2);
}

// ============================================================
// ==================== 注册总代 ==============================
// ============================================================

function registerRootAgent(adminToken, tenantId, agentIndex) {
    const envCfg = getEnvByTenantId(tenantId);
    const countryCode = envCfg.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const adminData = { token: adminToken, envConfig: envCfg };

    console.log(`[Setup] 租户${tenantId} 总代${agentIndex} 注册手机号: ${phone}`);

    let regResult = phoneRegister(phone, adminData, 'qwer1234', '', null);

    if (!regResult || !regResult.data) {
        const inviteUrl = envCfg.INVITE_REGISTER_URL || envCfg.BASE_DESK_URL;
        const customUrls = { frontUrl: inviteUrl, adminUrl: envCfg.BASE_ADMIN_URL, registerUrl: inviteUrl };
        regResult = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', customUrls);
    }

    if (!regResult || !regResult.data) {
        throw new Error(`[Setup] 租户${tenantId} 总代${agentIndex} 注册失败`);
    }

    let token = null;
    if (regResult.headers && regResult.headers.Authorization) {
        token = regResult.headers.Authorization.replace('Bearer ', '').trim();
    } else if (regResult.data && regResult.data.token) {
        token = regResult.data.token;
    }
    if (!token) throw new Error(`[Setup] 租户${tenantId} 总代${agentIndex} 未获取到token`);

    sleep(1);
    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.inviteCode) {
        throw new Error(`[Setup] 租户${tenantId} 总代${agentIndex} 未获取到邀请码`);
    }

    console.log(`[Setup] ✅ 总代注册成功: userId=${userInfo.userId} inviteCode=${userInfo.inviteCode}`);
    return { userId: userInfo.userId, inviteCode: userInfo.inviteCode, token, phone, tenantId };
}

// ============================================================
// ==================== SETUP 阶段 ============================
// ============================================================

export function setup() {
    const startTs = Date.now();
    console.log('\n' + '='.repeat(80));
    console.log('🚀 长时间多租户转线测试（纯转线版）- Setup 开始');
    console.log(`   租户列表: ${TENANT_IDS.join(', ')}`);
    console.log(`   每租户总代数: ${AGENTS_PER_TENANT}`);
    console.log(`   默认每总代成员数: ${MEMBERS_PER_AGENT}（可被 AGENT{N}_MEMBERS 覆盖）`);
    console.log(`   默认层级数: ${LEVELS_PER_AGENT}（可被 AGENT{N}_LEVELS 覆盖）`);
    for (let i = 1; i <= AGENTS_PER_TENANT; i++) {
        const m = getAgentMembers(i, TENANT_IDS[0]);
        const l = getAgentLevels(i, TENANT_IDS[0]);
        console.log(`   总代${i}: ${m}人 / ${l}层`);
    }
    console.log(`   每对转线次数: ${TRANSFERS_PER_PAIR}`);
    console.log('='.repeat(80) + '\n');

    const tenantDataMap = {};
    const memberTokenMap = {};

    for (const tenantId of TENANT_IDS) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📋 处理租户: ${tenantId}`);
        console.log(`${'─'.repeat(60)}`);

        const envCfg = getEnvByTenantId(tenantId);
        Object.assign(ENV_CONFIG, envCfg);

        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) throw new Error(`[Setup] 租户${tenantId} 管理员登录失败`);
        console.log(`[Setup] 租户${tenantId} 管理员登录成功`);

        tenantDataMap[tenantId] = { adminToken, envCfg, agents: [] };

        const rootUidsEnvKey = `ROOT_UIDS_${tenantId}`;
        const rootUidsStr = __ENV[rootUidsEnvKey] || '';
        const existingRootUids = rootUidsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);

        let agents = [];

        if (existingRootUids.length >= AGENTS_PER_TENANT) {
            console.log(`[Setup] 租户${tenantId} 使用已有总代: ${existingRootUids.join(',')}`);
            for (const rootUid of existingRootUids.slice(0, AGENTS_PER_TENANT)) {
                const token = autoLoginByUserId(adminToken, rootUid);
                sleep(1);
                const info = token ? getFrontUserInfo(token) : null;
                agents.push({
                    userId: rootUid,
                    inviteCode: info ? (info.inviteCode || String(rootUid)) : String(rootUid),
                    token: token || '',
                    phone: '',
                    tenantId
                });
                console.log(`[Setup] 总代 ${rootUid} 邀请码: ${info ? info.inviteCode : '获取失败'}`);
            }
        } else {
            for (let i = 0; i < AGENTS_PER_TENANT; i++) {
                sleep(2);
                const agent = registerRootAgent(adminToken, tenantId, i + 1);
                agents.push(agent);
                sleep(3);
            }
        }

        for (let ai = 0; ai < agents.length; ai++) {
            const agent = agents[ai];
            const agentIndex = ai + 1;

            const membersForAgent = getAgentMembers(agentIndex, tenantId);
            const levelsForAgent  = getAgentLevels(agentIndex, tenantId);
            const distribution    = distributePeople(membersForAgent, levelsForAgent);

            console.log(`\n[Setup] 租户${tenantId} 总代${agentIndex}(${agent.userId}) 配置: ${membersForAgent}人 ${levelsForAgent}层 → ${distribution.join('->')}`);

            agent.configMembers = membersForAgent;
            agent.configLevels  = levelsForAgent;

            const existingMembers = getAgentHierarchyList(adminToken, agent.userId, {
                isAll: true, isIncludeSelfAndParent: true, pageSize: 2000
            });

            if (existingMembers && existingMembers.length > 1) {
                console.log(`[Setup] 总代${agent.userId} 已有 ${existingMembers.length} 个成员，跳过注册`);
                agent.members = existingMembers;
            } else {
                const adminData = { token: adminToken, envConfig: envCfg };
                try {
                    buildTeamSync(agent.inviteCode, distribution, adminData, tenantId);
                } catch (e) {
                    console.error(`[Setup] 总代${agent.userId} 建立团队失败: ${e.message}`);
                }
                sleep(3);

                const members = getAgentHierarchyList(adminToken, agent.userId, {
                    isAll: true, isIncludeSelfAndParent: true, pageSize: 2000
                });
                agent.members = members || [];
            }

            console.log(`[Setup] 总代${agent.userId} 成员数: ${agent.members.length}`);
        }

        tenantDataMap[tenantId].agents = agents;

        // 批量登录所有成员，缓存 token（转线时需要成员 inviteCode）
        console.log(`\n[Setup] 租户${tenantId} 开始批量登录成员...`);
        for (const agent of agents) {
            const nonRoot = (agent.members || []).filter(m => m.userId !== agent.userId);
            if (nonRoot.length === 0) continue;

            const userIds = nonRoot.map(m => m.userId);
            console.log(`[Setup] 总代${agent.userId} 批量获取 ${userIds.length} 个成员账号...`);

            const batchSize = 50;
            for (let start = 0; start < userIds.length; start += batchSize) {
                const batch = userIds.slice(start, start + batchSize);
                const accounts = batchGetUserAccounts(adminToken, batch, 500);

                for (const { userId, account } of accounts) {
                    if (memberTokenMap[userId]) continue;
                    sleep(0.5);
                    const token = loginByAccount(account, adminToken);
                    if (!token) {
                        console.warn(`[Setup] userId=${userId} 登录失败`);
                        continue;
                    }
                    sleep(0.5);
                    const frontInfo = getFrontUserInfo(token);
                    const memberInfo = nonRoot.find(m => m.userId === userId);
                    memberTokenMap[userId] = {
                        userId,
                        account,
                        token,
                        inviteCode: frontInfo ? (frontInfo.inviteCode || '') : '',
                        hierarchy: memberInfo ? memberInfo.hierarchy : 0,
                        tenantId,
                        rootUserId: agent.userId
                    };
                }
                sleep(2);
            }
        }

        console.log(`[Setup] 租户${tenantId} 成员登录完成，共 ${Object.keys(memberTokenMap).filter(uid => {
            return memberTokenMap[uid].tenantId === tenantId;
        }).length} 人`);
    }

    const setupDuration = Date.now() - startTs;
    console.log(`\n[Setup] ✅ 完成，耗时: ${formatDuration(setupDuration)}`);
    console.log(`[Setup] 总成员登录数: ${Object.keys(memberTokenMap).length}`);

    // 打印所有总代账号信息，方便断点续跑
    console.log('\n' + '='.repeat(80));
    console.log('📋 总代账号汇总（可用于断点续跑 ROOT_UIDS_<tenantId>）');
    console.log('='.repeat(80));
    for (const tenantId of TENANT_IDS) {
        const agents = tenantDataMap[tenantId] ? tenantDataMap[tenantId].agents : [];
        const uidList = agents.map(a => a.userId).join(',');
        console.log(`  租户 ${tenantId}:`);
        agents.forEach((a, i) => {
            console.log(`    总代${i + 1}: userId=${a.userId}  phone=${a.phone || '(已有)'}  inviteCode=${a.inviteCode}`);
        });
        console.log(`    → -e ROOT_UIDS_${tenantId}=${uidList}`);
    }
    console.log('='.repeat(80) + '\n');

    return {
        tenantDataMap,
        memberTokenMap,
        setupStartTs: startTs,
        testStartTs: Date.now()
    };
}
