/**
 * 长时间多租户转线测试脚本
 *
 * 功能概述：
 *   1. 多租户支持（同租户内总代互转）
 *   2. 每个租户注册 N 个总代，每个总代可单独配置人数和层级
 *   3. 同租户内每对总代之间各转线 TRANSFERS_PER_PAIR 次
 *   4. 每次转线：随机选人 → 随机生成行为计划（转线前后充值/投注/提现完全随机）
 *   5. 转线完成后对所有剩余成员跑 V2 三段式分层
 *   6. 最终报表写入 k6/reports/ 目录
 *
 * 使用方法（每个总代单独指定人数和层级）：
 *   k6 run \
 *     -e TENANT_IDS=3004,3006,3007 \
 *     -e AGENTS_PER_TENANT=3 \
 *     -e AGENT1_MEMBERS=1000 -e AGENT1_LEVELS=20 \
 *     -e AGENT2_MEMBERS=2000 -e AGENT2_LEVELS=30 \
 *     -e AGENT3_MEMBERS=3000 -e AGENT3_LEVELS=40 \
 *     -e TRANSFERS_PER_PAIR=3 \
 *     -e INACTIVE_RATE=0.2 \
 *     -e RECHARGE_ONLY_RATE=0.2 \
 *     -e ENABLE_WITHDRAW=true \
 *     -e ENABLE_BACKEND_APPROVAL=false \
 *     longRunMultiTenantTransfer.test.js
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
 *   longRunMultiTenantTransfer.test.js
 * 
 * k6 run -e TENANT_IDS=3006 -e AGENTS_PER_TENANT=3 -e AGENT1_MEMBERS=10 -e AGENT1_LEVELS=2 -e AGENT2_MEMBERS=20 -e AGENT2_LEVELS=3 -e AGENT3_MEMBERS=11 -e AGENT3_LEVELS=3 -e TRANSFERS_PER_PAIR=3 longRunMultiTenantTransfer.test.js
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { batchGetUserAccounts, autoLoginByUserId } from '../user/userAccountApi.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { sendRequest } from '../common/request.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { runMultiLevelInvite } from '../invite/inviteService.js';

// ============================================================
// ==================== 参数解析 ==============================
// ============================================================

const TENANT_IDS          = (__ENV.TENANT_IDS || '3004').split(',').map(s => s.trim()).filter(Boolean);
const AGENTS_PER_TENANT   = parseInt(__ENV.AGENTS_PER_TENANT   || '3',   10);
// 全局默认值（当某个总代没有单独配置时使用）
const MEMBERS_PER_AGENT   = parseInt(__ENV.MEMBERS_PER_AGENT   || '100', 10);
const LEVELS_PER_AGENT    = parseInt(__ENV.LEVELS_PER_AGENT    || '8',   10);
const TRANSFERS_PER_PAIR  = parseInt(__ENV.TRANSFERS_PER_PAIR  || '3',   10);
const INACTIVE_RATE       = parseFloat(__ENV.INACTIVE_RATE       || '0.2');
const RECHARGE_ONLY_RATE  = parseFloat(__ENV.RECHARGE_ONLY_RATE  || '0.2');
const MAX_RECHARGE_BEFORE = parseInt(__ENV.MAX_RECHARGE_BEFORE || '3', 10);
const MAX_RECHARGE_AFTER  = parseInt(__ENV.MAX_RECHARGE_AFTER  || '3', 10);
const MAX_BET_BEFORE      = parseInt(__ENV.MAX_BET_BEFORE      || '3', 10);
const MAX_BET_AFTER       = parseInt(__ENV.MAX_BET_AFTER       || '3', 10);
const REPORT_DIR          = __ENV.REPORT_DIR || 'k6/reports';

const TAG = 'LongRunTransfer';

/**
 * 获取第 agentIndex（1-based）个总代的成员数
 * 优先读 TENANT_{tenantId}_AGENT{N}_MEMBERS，其次 AGENT{N}_MEMBERS，最后全局默认
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
 * 优先读 TENANT_{tenantId}_AGENT{N}_LEVELS，其次 AGENT{N}_LEVELS，最后全局默认
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
    setupTimeout: '36h',
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
// ==================== 全局报表数据 ==========================
// ============================================================

// 报表记录（在 handleSummary 中使用）
// 由于 k6 的 setup/default/handleSummary 之间只能通过 return 传递数据，
// 我们把报表数据挂在 globalThis 上，handleSummary 通过读取文件获取
// 实际上 k6 不支持全局写文件，所以我们在 default 函数末尾构建报表字符串
// 并通过 handleSummary 的 data 参数中的 metrics 附带信息输出

// ============================================================
// ==================== 工具函数 ==============================
// ============================================================

/**
 * 格式化时间戳为可读字符串
 */
function formatTime(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 格式化毫秒为 Xh Xm Xs
 */
function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

/**
 * 随机整数 [min, max]
 */
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 按层级加权随机选择成员
 * 深层级成员被选中概率更高（更真实）
 * @param {Array} memberList - 成员列表（含 hierarchy 字段）
 * @param {number} excludeUserId - 排除的 userId（总代自身）
 * @returns {object|null}
 */
function selectMemberByHierarchyWeight(memberList, excludeUserId) {
    const eligible = memberList.filter(m => m.userId !== excludeUserId && m.hierarchy > 0);
    if (eligible.length === 0) return null;

    // 按层级分组
    const byHier = {};
    eligible.forEach(m => {
        if (!byHier[m.hierarchy]) byHier[m.hierarchy] = [];
        byHier[m.hierarchy].push(m);
    });

    const hiers = Object.keys(byHier).map(Number).sort((a, b) => a - b);

    // 层级越深权重越高（深层级 = 更多人，更真实）
    // 权重 = 层级号（层级1权重1，层级2权重2，...）
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
// ==================== 充值/投注/提现 原子操作 ================
// ============================================================

/**
 * 执行单次充值
 * @returns {{ success: boolean, amount: number }}
 */
function doSingleRecharge(userToken, userId, adminToken) {
    const amount = getConfigRechargeAmount();
    const r = hybridRecharge({ userToken, adminToken, userId, amount, frontendFirst: true });
    return { success: r.success, amount: r.success ? r.amount : 0 };
}

/**
 * 执行 N 次充值
 * @returns {{ totalAmt: number, times: number }}
 */
function doRechargeN(userToken, userId, adminToken, n) {
    let totalAmt = 0, times = 0;
    for (let i = 0; i < n; i++) {
        if (i > 0) sleep(2);
        const r = doSingleRecharge(userToken, userId, adminToken);
        if (r.success) { totalAmt += r.amount; times++; } else break;
    }
    return { totalAmt, times };
}

/**
 * 执行单次投注
 * @returns {{ success: boolean, amount: number }}
 */
function doSingleBet(userToken, account) {
    const r = betRun(userToken, account);
    if (r && r.amount) return { success: true, amount: r.amount };
    if (r === true) return { success: true, amount: 0 };
    return { success: false, amount: 0 };
}

/**
 * 执行 N 次投注
 * @returns {{ totalAmt: number, times: number }}
 */
function doBetN(userToken, account, n) {
    let totalAmt = 0, times = 0;
    for (let i = 0; i < n; i++) {
        if (i > 0) sleep(3);
        const r = doSingleBet(userToken, account);
        if (r.success) { totalAmt += r.amount; times++; }
    }
    return { totalAmt, times };
}

/**
 * 计算可提现金额
 */
function calcWithdrawAmount(balance) {
    if (balance <= 300)   return 0;
    if (balance <= 1000)  return Math.floor(balance * 0.3);
    if (balance <= 10000) return Math.floor(balance * 0.1);
    return Math.floor(200 + Math.random() * 4800);
}

/**
 * 执行单次提现
 * @returns {{ success: boolean, amount: number }}
 */
function doSingleWithdraw(userToken, userId, adminToken) {
    if (!ENABLE_WITHDRAW) return { success: false, amount: 0 };
    const balInfo = getAccountBalance(userToken);
    if (!balInfo) return { success: false, amount: 0 };
    const amt = calcWithdrawAmount(balInfo.balance || 0);
    if (amt <= 0) return { success: false, amount: 0 };

    addAllWallets(adminToken, userId);
    sleep(1);
    setWithdrawPassword(userToken, '123456');
    sleep(1);

    const wInfo = getWithdrawBasicInfo(userToken);
    if (!wInfo) return { success: false, amount: 0 };
    if (wInfo.amountCoding !== 0) {
        console.warn(`[Withdraw] userId=${userId} 流水未完成，跳过提现`);
        return { success: false, amount: 0 };
    }

    const cats = (wInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (cats.length === 0) return { success: false, amount: 0 };

    const cat = cats[Math.floor(Math.random() * cats.length)];
    const walletId = getUserWithdrawWallet(userToken, cat.withdrawType);
    if (!walletId) return { success: false, amount: 0 };

    const ok = withdrawApply(userToken, amt, walletId, cat.id, cat.withdrawType, '123456');
    if (!ok) return { success: false, amount: 0 };

    if (ENABLE_BACKEND_APPROVAL) {
        sleep(2);
        runBackendWithdrawApproval(adminToken, userId, cat.withdrawType, amt);
    }
    return { success: true, amount: amt };
}

/**
 * 执行 N 次提现
 * @returns {{ totalAmt: number, times: number }}
 */
function doWithdrawN(userToken, userId, adminToken, n) {
    let totalAmt = 0, times = 0;
    for (let i = 0; i < n; i++) {
        if (i > 0) sleep(3);
        const r = doSingleWithdraw(userToken, userId, adminToken);
        if (r.success) { totalAmt += r.amount; times++; } else break;
    }
    return { totalAmt, times };
}

// ============================================================
// ==================== 转线操作 ==============================
// ============================================================

// 解绑后等待时间（秒），默认 60 秒（1分钟）
// 可通过 -e UNBIND_WAIT_SECONDS=60 覆盖
const UNBIND_WAIT_SECONDS = parseInt(__ENV.UNBIND_WAIT_SECONDS || '60', 10);

/**
 * 执行解绑 + 绑定
 * 解绑后等待 UNBIND_WAIT_SECONDS 秒再绑定，确保系统完成解绑处理
 * @param {string} adminToken
 * @param {number} userId - 被转线的成员
 * @param {string} targetInviteCode - 目标上级的邀请码
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

/**
 * 注册一个总代并返回其信息
 */
function registerRootAgent(adminToken, tenantId, agentIndex) {
    const envCfg = getEnvByTenantId(tenantId);
    const countryCode = envCfg.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const adminData = { token: adminToken, envConfig: envCfg };

    console.log(`[Setup] 租户${tenantId} 总代${agentIndex} 注册手机号: ${phone}`);

    // 策略1：普通注册
    let regResult = phoneRegister(phone, adminData, 'qwer1234', '', null);

    // 策略2：邀请注册域名降级
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
    console.log('🚀 长时间多租户转线测试 - Setup 开始');
    console.log(`   租户列表: ${TENANT_IDS.join(', ')}`);
    console.log(`   每租户总代数: ${AGENTS_PER_TENANT}`);
    console.log(`   默认每总代成员数: ${MEMBERS_PER_AGENT}（可被 AGENT{N}_MEMBERS 覆盖）`);
    console.log(`   默认层级数: ${LEVELS_PER_AGENT}（可被 AGENT{N}_LEVELS 覆盖）`);
    // 打印每个总代的实际配置
    for (let i = 1; i <= AGENTS_PER_TENANT; i++) {
        const m = getAgentMembers(i, TENANT_IDS[0]);
        const l = getAgentLevels(i, TENANT_IDS[0]);
        console.log(`   总代${i}: ${m}人 / ${l}层`);
    }
    console.log(`   每对转线次数: ${TRANSFERS_PER_PAIR}`);
    console.log('='.repeat(80) + '\n');

    // tenantDataMap: tenantId → { adminToken, envCfg, agents: [...] }
    // agents[i]: { userId, inviteCode, token, phone, tenantId, members: [...] }
    // memberTokenMap: userId → { userId, account, token, inviteCode, hierarchy, tenantId, rootUserId }
    const tenantDataMap = {};
    const memberTokenMap = {}; // 全局成员 token 缓存

    for (const tenantId of TENANT_IDS) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📋 处理租户: ${tenantId}`);
        console.log(`${'─'.repeat(60)}`);

        const envCfg = getEnvByTenantId(tenantId);
        Object.assign(ENV_CONFIG, envCfg);

        // 登录管理员
        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) throw new Error(`[Setup] 租户${tenantId} 管理员登录失败`);
        console.log(`[Setup] 租户${tenantId} 管理员登录成功`);

        tenantDataMap[tenantId] = { adminToken, envCfg, agents: [] };

        // 检查是否有断点续跑的 ROOT_UIDS
        const rootUidsEnvKey = `ROOT_UIDS_${tenantId}`;
        const rootUidsStr = __ENV[rootUidsEnvKey] || '';
        const existingRootUids = rootUidsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);

        let agents = [];

        if (existingRootUids.length >= AGENTS_PER_TENANT) {
            // 断点续跑：直接使用已有总代
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
            // 注册新总代
            for (let i = 0; i < AGENTS_PER_TENANT; i++) {
                sleep(2);
                const agent = registerRootAgent(adminToken, tenantId, i + 1);
                agents.push(agent);
                sleep(3);
            }
        }

        // 为每个总代建立多级团队
        // 注意：每个总代单独读取自己的人数和层级配置
        for (let ai = 0; ai < agents.length; ai++) {
            const agent = agents[ai];
            const agentIndex = ai + 1; // 1-based

            // 读取该总代的人数和层级（支持单独配置）
            const membersForAgent = getAgentMembers(agentIndex, tenantId);
            const levelsForAgent  = getAgentLevels(agentIndex, tenantId);
            const distribution    = distributePeople(membersForAgent, levelsForAgent);

            console.log(`\n[Setup] 租户${tenantId} 总代${agentIndex}(${agent.userId}) 配置: ${membersForAgent}人 ${levelsForAgent}层 → ${distribution.join('->')}`);

            // 将配置保存到 agent 对象，供报表使用
            agent.configMembers = membersForAgent;
            agent.configLevels  = levelsForAgent;

            // 检查是否已有成员（断点续跑时跳过注册）
            const existingMembers = getAgentHierarchyList(adminToken, agent.userId, {
                isAll: true, isIncludeSelfAndParent: true, pageSize: 2000
            });

            if (existingMembers && existingMembers.length > 1) {
                console.log(`[Setup] 总代${agent.userId} 已有 ${existingMembers.length} 个成员，跳过注册`);
                agent.members = existingMembers;
            } else {
                // 注册多级团队
                const adminData = { token: adminToken, envConfig: envCfg };
                try {
                    // runMultiLevelInvite 是 async，k6 不支持 await，使用同步版本
                    // 这里直接调用 bindOneLevel 逻辑的同步封装
                    buildTeamSync(agent.inviteCode, distribution, adminData, tenantId);
                } catch (e) {
                    console.error(`[Setup] 总代${agent.userId} 建立团队失败: ${e.message}`);
                }
                sleep(3);

                // 重新获取成员列表
                const members = getAgentHierarchyList(adminToken, agent.userId, {
                    isAll: true, isIncludeSelfAndParent: true, pageSize: 2000
                });
                agent.members = members || [];
            }

            console.log(`[Setup] 总代${agent.userId} 成员数: ${agent.members.length}`);
        }

        tenantDataMap[tenantId].agents = agents;

        // 批量登录所有成员，缓存 token
        console.log(`\n[Setup] 租户${tenantId} 开始批量登录成员...`);
        for (const agent of agents) {
            const nonRoot = (agent.members || []).filter(m => m.userId !== agent.userId);
            if (nonRoot.length === 0) continue;

            const userIds = nonRoot.map(m => m.userId);
            console.log(`[Setup] 总代${agent.userId} 批量获取 ${userIds.length} 个成员账号...`);

            // 分批处理，每批 50 个，避免超时
            const batchSize = 50;
            for (let start = 0; start < userIds.length; start += batchSize) {
                const batch = userIds.slice(start, start + batchSize);
                const accounts = batchGetUserAccounts(adminToken, batch, 500);

                for (const { userId, account } of accounts) {
                    if (memberTokenMap[userId]) continue; // 已登录
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

/**
 * 同步建立多级团队（调用 inviteService 的 bindOneLevel）
 * 由于 k6 不支持 async/await 在 setup 中，我们直接调用底层注册逻辑
 */
function buildTeamSync(rootInviteCode, distribution, adminData, tenantId) {
    const envCfg = getEnvByTenantId(tenantId);
    const countryCode = envCfg.COUNTRY_CODE || '91';
    const inviteRegisterUrl = envCfg.INVITE_REGISTER_URL || envCfg.BASE_DESK_URL;
    const customUrls = {
        frontUrl: inviteRegisterUrl,
        adminUrl: envCfg.BASE_ADMIN_URL,
        registerUrl: inviteRegisterUrl
    };

    let currentParentCodes = [rootInviteCode];

    for (let level = 0; level < distribution.length; level++) {
        const count = distribution[level];
        if (count <= 0) continue;

        console.log(`[BuildTeam] 层级${level+1}: 注册 ${count} 人，父级 ${currentParentCodes.length} 个`);
        const newCodes = [];

        for (let i = 0; i < count; i++) {
            sleep(1);
            const phone = generateRandomPhone(countryCode);
            const parentCode = currentParentCodes[Math.floor(Math.random() * currentParentCodes.length)];

            let regResult = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
            if (!regResult || !regResult.data) {
                console.warn(`[BuildTeam] 注册失败: ${phone}，跳过`);
                continue;
            }

            let token = null;
            if (regResult.headers && regResult.headers.Authorization) {
                token = regResult.headers.Authorization.replace('Bearer ', '').trim();
            } else if (regResult.data && regResult.data.token) {
                token = regResult.data.token;
            }
            if (!token) continue;

            sleep(1);
            const info = getFrontUserInfo(token);
            if (info && info.inviteCode) {
                newCodes.push(info.inviteCode);
            }
        }

        if (newCodes.length > 0) {
            currentParentCodes = newCodes;
        }
        sleep(2);
    }
}


// ============================================================
// ==================== 核心：单次转线任务执行 =================
// ============================================================

/**
 * 生成单次转线的完整行为计划（一次性随机决定）
 * @returns {object} plan
 */
function generateTransferPlan() {
    // 转线前行为
    const rechargeBeforeTotal = randInt(0, MAX_RECHARGE_BEFORE);
    // 如果有充值，随机在第几次充值后转线（1 ~ rechargeBeforeTotal）
    const transferAfterRecharge = rechargeBeforeTotal > 0 ? randInt(1, rechargeBeforeTotal) : 0;
    const betBeforeTotal   = randInt(0, MAX_BET_BEFORE);
    const withdrawBeforeTotal = ENABLE_WITHDRAW ? randInt(0, MAX_WITHDRAW_BEFORE) : 0;

    // 转线后行为
    const rechargeAfterTotal  = randInt(0, MAX_RECHARGE_AFTER);
    const betAfterTotal       = randInt(0, MAX_BET_AFTER);
    const withdrawAfterTotal  = ENABLE_WITHDRAW ? randInt(0, MAX_WITHDRAW_AFTER) : 0;

    return {
        rechargeBeforeTotal,
        transferAfterRecharge, // 充值第几次后转线（0=转线前不充值）
        betBeforeTotal,
        withdrawBeforeTotal,
        rechargeAfterTotal,
        betAfterTotal,
        withdrawAfterTotal
    };
}

/**
 * 执行单次转线任务
 * @param {object} params
 * @param {string} params.adminToken
 * @param {object} params.fromMemberInfo  - { userId, account, token, hierarchy, inviteCode }
 * @param {string} params.targetInviteCode - 转入目标的邀请码
 * @param {number} params.fromRootUserId
 * @param {number} params.toRootUserId
 * @param {string} params.tenantId
 * @param {number} params.taskIndex
 * @param {number} params.totalTasks
 * @returns {object} 转线记录
 */
function executeTransferTask(params) {
    const {
        adminToken, fromMemberInfo, targetInviteCode,
        fromRootUserId, toRootUserId, tenantId,
        taskIndex, totalTasks
    } = params;

    const { userId, account, token: userToken, hierarchy } = fromMemberInfo;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`[${taskIndex}/${totalTasks}] 转线任务 | 租户${tenantId} | 总代${fromRootUserId}→${toRootUserId}`);
    console.log(`  被转成员: userId=${userId} 层级=L${hierarchy} account=${account}`);
    console.log(`  目标邀请码: ${targetInviteCode}`);
    console.log(`${'─'.repeat(70)}`);

    if (!userToken) {
        console.warn(`[Transfer] userId=${userId} 无 token，跳过`);
        return null;
    }

    // 生成行为计划
    const plan = generateTransferPlan();
    console.log(`[Transfer] 行为计划:`);
    console.log(`  转线前: 充值${plan.rechargeBeforeTotal}次(第${plan.transferAfterRecharge}次后转线) 投注${plan.betBeforeTotal}次 提现${plan.withdrawBeforeTotal}次`);
    console.log(`  转线后: 充值${plan.rechargeAfterTotal}次 投注${plan.betAfterTotal}次 提现${plan.withdrawAfterTotal}次`);

    const rec = {
        tenantId,
        fromRootUserId,
        toRootUserId,
        userId,
        account,
        hierarchy,
        targetInviteCode,
        plan,
        // 实际执行结果
        rechargeBeforeAmt: 0, rechargeBeforeTimes: 0,
        betBeforeAmt: 0,      betBeforeTimes: 0,
        withdrawBeforeAmt: 0, withdrawBeforeTimes: 0,
        rechargeAfterAmt: 0,  rechargeAfterTimes: 0,
        betAfterAmt: 0,       betAfterTimes: 0,
        withdrawAfterAmt: 0,  withdrawAfterTimes: 0,
        transferSuccess: false,
        timestamp: Date.now()
    };

    // ── 转线前：充值（部分） ──
    if (plan.rechargeBeforeTotal > 0 && plan.transferAfterRecharge > 0) {
        console.log(`[Transfer] 转线前充值 ${plan.transferAfterRecharge} 次...`);
        const r = doRechargeN(userToken, userId, adminToken, plan.transferAfterRecharge);
        rec.rechargeBeforeAmt   += r.totalAmt;
        rec.rechargeBeforeTimes += r.times;
        sleep(1);
    }

    // ── 转线前：投注（仅在转线前有充值成功时才执行）──
    if (plan.betBeforeTotal > 0 && rec.rechargeBeforeAmt > 0) {
        console.log(`[Transfer] 转线前投注 ${plan.betBeforeTotal} 次（充值成功 ${rec.rechargeBeforeAmt.toFixed(2)}）...`);
        const b = doBetN(userToken, account, plan.betBeforeTotal);
        rec.betBeforeAmt   += b.totalAmt;
        rec.betBeforeTimes += b.times;
        sleep(1);
    } else if (plan.betBeforeTotal > 0) {
        console.log(`[Transfer] 转线前投注跳过（转线前无充值成功）`);
    }

    // ── 转线前：提现（仅在转线前有投注成功时才执行）──
    if (plan.withdrawBeforeTotal > 0 && rec.betBeforeAmt > 0) {
        console.log(`[Transfer] 转线前提现 ${plan.withdrawBeforeTotal} 次...`);
        const w = doWithdrawN(userToken, userId, adminToken, plan.withdrawBeforeTotal);
        rec.withdrawBeforeAmt   += w.totalAmt;
        rec.withdrawBeforeTimes += w.times;
        sleep(1);
    } else if (plan.withdrawBeforeTotal > 0) {
        console.log(`[Transfer] 转线前提现跳过（转线前无投注成功）`);
    }

    // ── 执行转线 ──
    console.log(`[Transfer] 执行转线...`);
    doTransfer(adminToken, userId, targetInviteCode);
    rec.transferSuccess = true;
    console.log(`[Transfer] ✅ 转线完成`);

    // ── 转线前充值剩余部分（补充） ──
    const remainRecharge = plan.rechargeBeforeTotal - plan.transferAfterRecharge;
    if (remainRecharge > 0) {
        console.log(`[Transfer] 补充转线前剩余充值 ${remainRecharge} 次...`);
        const r = doRechargeN(userToken, userId, adminToken, remainRecharge);
        rec.rechargeBeforeAmt   += r.totalAmt;
        rec.rechargeBeforeTimes += r.times;
        sleep(1);
    }

    // ── 转线后：充值 ──
    if (plan.rechargeAfterTotal > 0) {
        console.log(`[Transfer] 转线后充值 ${plan.rechargeAfterTotal} 次...`);
        const r = doRechargeN(userToken, userId, adminToken, plan.rechargeAfterTotal);
        rec.rechargeAfterAmt   += r.totalAmt;
        rec.rechargeAfterTimes += r.times;
        sleep(1);
    }

    // ── 转线后：投注（仅在转线后有充值成功时才执行）──
    if (plan.betAfterTotal > 0 && rec.rechargeAfterAmt > 0) {
        console.log(`[Transfer] 转线后投注 ${plan.betAfterTotal} 次（充值成功 ${rec.rechargeAfterAmt.toFixed(2)}）...`);
        const b = doBetN(userToken, account, plan.betAfterTotal);
        rec.betAfterAmt   += b.totalAmt;
        rec.betAfterTimes += b.times;
        sleep(1);
    } else if (plan.betAfterTotal > 0) {
        console.log(`[Transfer] 转线后投注跳过（转线后无充值成功）`);
    }

    // ── 转线后：提现（仅在转线后有投注成功时才执行）──
    if (plan.withdrawAfterTotal > 0 && rec.betAfterAmt > 0) {
        console.log(`[Transfer] 转线后提现 ${plan.withdrawAfterTotal} 次...`);
        const w = doWithdrawN(userToken, userId, adminToken, plan.withdrawAfterTotal);
        rec.withdrawAfterAmt   += w.totalAmt;
        rec.withdrawAfterTimes += w.times;
    } else if (plan.withdrawAfterTotal > 0) {
        console.log(`[Transfer] 转线后提现跳过（转线后无投注成功）`);
    }

    console.log(`[Transfer] ✅ 任务完成 | 充值前${rec.rechargeBeforeTimes}次/${rec.rechargeBeforeAmt.toFixed(2)} 后${rec.rechargeAfterTimes}次/${rec.rechargeAfterAmt.toFixed(2)}`);
    return rec;
}

// ============================================================
// ==================== V2 剩余成员处理 =======================
// ============================================================

/**
 * 对单个成员执行 V2 三段式分层行为
 * @param {object} memberInfo - { userId, account, token }
 * @param {string} adminToken
 * @param {string} group - 'inactive' | 'rechargeOnly' | 'active'
 * @returns {object} v2 记录
 */
function executeV2Member(memberInfo, adminToken, group) {
    const { userId, account, token: userToken } = memberInfo;
    const rec = {
        userId, account, group,
        rechargeAmt: 0, rechargeTimes: 0,
        betAmt: 0,      betTimes: 0,
        withdrawAmt: 0, withdrawTimes: 0
    };

    if (group === 'inactive') {
        console.log(`[V2] userId=${userId} 不活跃，跳过`);
        return rec;
    }

    if (!userToken) {
        console.warn(`[V2] userId=${userId} 无 token，跳过`);
        return rec;
    }

    // 充值（半活跃和活跃都充值）
    const rechargeCount = randInt(1, 3);
    const r = doRechargeN(userToken, userId, adminToken, rechargeCount);
    rec.rechargeAmt   = r.totalAmt;
    rec.rechargeTimes = r.times;

    if (group === 'rechargeOnly') {
        console.log(`[V2] userId=${userId} 半活跃，充值${rec.rechargeTimes}次/${rec.rechargeAmt.toFixed(2)}`);
        return rec;
    }

    // 活跃：充值 + 投注 + 随机提现
    if (r.times > 0) {
        sleep(2);
        const betCount = randInt(1, 3);
        const b = doBetN(userToken, account, betCount);
        rec.betAmt   = b.totalAmt;
        rec.betTimes = b.times;

        // 随机提现（50% 概率）
        if (ENABLE_WITHDRAW && Math.random() < 0.5) {
            sleep(2);
            const w = doWithdrawN(userToken, userId, adminToken, 1);
            rec.withdrawAmt   = w.totalAmt;
            rec.withdrawTimes = w.times;
        }
    }

    console.log(`[V2] userId=${userId} 活跃，充值${rec.rechargeTimes}次 投注${rec.betTimes}次 提现${rec.withdrawTimes}次`);
    return rec;
}

/**
 * 对所有剩余成员（未被转线）执行 V2 三段式分层
 * @param {object} memberTokenMap
 * @param {Set} transferredUserIds - 已被转线的 userId 集合
 * @param {object} tenantDataMap
 * @returns {Array} v2Records
 */
function runV2ForRemainingMembers(memberTokenMap, transferredUserIds, tenantDataMap) {
    console.log('\n' + '='.repeat(70));
    console.log('🎲 V2 三段式分层 - 处理所有剩余成员');
    console.log(`   不活跃: ${(INACTIVE_RATE * 100).toFixed(0)}%  半活跃: ${(RECHARGE_ONLY_RATE * 100).toFixed(0)}%  活跃: ${((1 - INACTIVE_RATE - RECHARGE_ONLY_RATE) * 100).toFixed(0)}%`);
    console.log('='.repeat(70) + '\n');

    const v2Records = [];
    const allMemberIds = Object.keys(memberTokenMap).map(Number);
    const remainingIds = allMemberIds.filter(uid => !transferredUserIds.has(uid));

    console.log(`[V2] 总成员: ${allMemberIds.length}  已转线: ${transferredUserIds.size}  剩余: ${remainingIds.length}`);

    let inactiveCount = 0, rechargeOnlyCount = 0, activeCount = 0;

    for (let i = 0; i < remainingIds.length; i++) {
        const uid = remainingIds[i];
        const memberInfo = memberTokenMap[uid];
        if (!memberInfo) continue;

        // 获取该成员所属租户的 adminToken
        const tenantData = tenantDataMap[memberInfo.tenantId];
        if (!tenantData) continue;
        const adminToken = tenantData.adminToken;

        // 随机分组
        const rand = Math.random();
        let group;
        if (rand < INACTIVE_RATE) {
            group = 'inactive'; inactiveCount++;
        } else if (rand < INACTIVE_RATE + RECHARGE_ONLY_RATE) {
            group = 'rechargeOnly'; rechargeOnlyCount++;
        } else {
            group = 'active'; activeCount++;
        }

        console.log(`[V2] [${i+1}/${remainingIds.length}] userId=${uid} 分组=${group}`);

        // 切换租户环境
        Object.assign(ENV_CONFIG, tenantData.envCfg);

        const rec = executeV2Member(memberInfo, adminToken, group);
        rec.tenantId    = memberInfo.tenantId;
        rec.rootUserId  = memberInfo.rootUserId;
        v2Records.push(rec);

        sleep(1);
    }

    console.log(`\n[V2] 完成 | 不活跃: ${inactiveCount}  半活跃: ${rechargeOnlyCount}  活跃: ${activeCount}`);
    return v2Records;
}


// ============================================================
// ==================== 主测试函数 ============================
// ============================================================

export default function (data) {
    const { tenantDataMap, memberTokenMap, testStartTs } = data;

    console.log('\n' + '='.repeat(80));
    console.log('🚀 长时间多租户转线测试 - 主流程开始');
    console.log(`   开始时间: ${formatTime(testStartTs)}`);
    console.log('='.repeat(80) + '\n');

    const transferRecords = [];       // 所有转线记录
    const transferredUserIds = new Set(); // 被转线过的 userId（可重复）

    // ── 阶段2：生成并执行转线计划 ──
    console.log('\n' + '═'.repeat(70));
    console.log('📋 阶段2: 生成转线计划');
    console.log('═'.repeat(70));

    // 生成转线计划：同租户内每对总代之间各转 TRANSFERS_PER_PAIR 次
    const transferPlan = []; // { tenantId, fromAgentIdx, toAgentIdx, round }

    for (const tenantId of TENANT_IDS) {
        const tenantData = tenantDataMap[tenantId];
        if (!tenantData) continue;
        const agents = tenantData.agents;
        const N = agents.length;

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                if (i === j) continue;
                for (let round = 1; round <= TRANSFERS_PER_PAIR; round++) {
                    transferPlan.push({ tenantId, fromAgentIdx: i, toAgentIdx: j, round });
                }
            }
        }
    }

    console.log(`[Plan] 总转线任务数: ${transferPlan.length}`);
    transferPlan.forEach((p, idx) => {
        const td = tenantDataMap[p.tenantId];
        const from = td.agents[p.fromAgentIdx];
        const to   = td.agents[p.toAgentIdx];
        console.log(`  ${idx+1}. 租户${p.tenantId} 总代${from.userId}→${to.userId} 第${p.round}次`);
    });

    // ── 执行转线任务 ──
    console.log('\n' + '═'.repeat(70));
    console.log('🔄 阶段2: 执行转线任务');
    console.log('═'.repeat(70));

    for (let taskIdx = 0; taskIdx < transferPlan.length; taskIdx++) {
        const plan = transferPlan[taskIdx];
        const tenantData = tenantDataMap[plan.tenantId];
        if (!tenantData) continue;

        const adminToken = tenantData.adminToken;
        const fromAgent  = tenantData.agents[plan.fromAgentIdx];
        const toAgent    = tenantData.agents[plan.toAgentIdx];

        // 切换租户环境
        Object.assign(ENV_CONFIG, tenantData.envCfg);

        // 从转出方团队中随机选人（按层级加权）
        // 注意：同一人可以被多次选中
        const fromMembers = getAgentHierarchyList(adminToken, fromAgent.userId, {
            isAll: true, isIncludeSelfAndParent: false, pageSize: 2000
        });

        if (!fromMembers || fromMembers.length === 0) {
            console.warn(`[Main] 总代${fromAgent.userId} 无成员，跳过`);
            continue;
        }

        const fromMember = selectMemberByHierarchyWeight(fromMembers, fromAgent.userId);
        if (!fromMember) {
            console.warn(`[Main] 总代${fromAgent.userId} 无可用成员，跳过`);
            continue;
        }

        // 从转入方团队中随机选目标上级（包含总代自身，层级0也可以）
        const toMembers = getAgentHierarchyList(adminToken, toAgent.userId, {
            isAll: true, isIncludeSelfAndParent: true, pageSize: 2000
        });

        let targetInviteCode = toAgent.inviteCode; // 默认挂在总代下
        if (toMembers && toMembers.length > 0) {
            // 随机选一个层级（含层级0）
            const byHier = {};
            toMembers.forEach(m => {
                if (!byHier[m.hierarchy]) byHier[m.hierarchy] = [];
                byHier[m.hierarchy].push(m);
            });
            const hiers = Object.keys(byHier).map(Number);
            const randHier = hiers[Math.floor(Math.random() * hiers.length)];
            const pool = byHier[randHier];
            const targetMember = pool[Math.floor(Math.random() * pool.length)];

            // 获取目标成员的邀请码
            const targetMemberInfo = memberTokenMap[targetMember.userId];
            if (targetMemberInfo && targetMemberInfo.inviteCode) {
                targetInviteCode = targetMemberInfo.inviteCode;
            } else if (targetMember.userId === toAgent.userId) {
                targetInviteCode = toAgent.inviteCode;
            }
            console.log(`[Main] 转入目标: userId=${targetMember.userId} 层级=L${targetMember.hierarchy} inviteCode=${targetInviteCode}`);
        }

        // 获取被转线成员的 token 信息
        let fromMemberInfo = memberTokenMap[fromMember.userId];
        if (!fromMemberInfo) {
            // 尝试临时登录
            console.warn(`[Main] userId=${fromMember.userId} 无缓存token，尝试临时登录`);
            const accounts = batchGetUserAccounts(adminToken, [fromMember.userId], 500);
            if (accounts.length > 0) {
                const { account } = accounts[0];
                const token = loginByAccount(account, adminToken);
                if (token) {
                    sleep(0.5);
                    const frontInfo = getFrontUserInfo(token);
                    fromMemberInfo = {
                        userId: fromMember.userId,
                        account,
                        token,
                        inviteCode: frontInfo ? (frontInfo.inviteCode || '') : '',
                        hierarchy: fromMember.hierarchy,
                        tenantId: plan.tenantId,
                        rootUserId: fromAgent.userId
                    };
                    memberTokenMap[fromMember.userId] = fromMemberInfo;
                }
            }
        }

        if (!fromMemberInfo || !fromMemberInfo.token) {
            console.warn(`[Main] userId=${fromMember.userId} 无法获取token，跳过`);
            continue;
        }

        // 执行转线任务
        const rec = executeTransferTask({
            adminToken,
            fromMemberInfo: { ...fromMemberInfo, hierarchy: fromMember.hierarchy },
            targetInviteCode,
            fromRootUserId: fromAgent.userId,
            toRootUserId:   toAgent.userId,
            tenantId:       plan.tenantId,
            taskIndex:      taskIdx + 1,
            totalTasks:     transferPlan.length
        });

        if (rec) {
            transferRecords.push(rec);
            transferredUserIds.add(fromMember.userId);
        }

        sleep(randInt(3, 8)); // 转线间随机间隔
    }

    console.log(`\n[Main] ✅ 转线阶段完成，共执行 ${transferRecords.length} 次转线`);

    // ── 阶段3：V2 剩余成员处理 ──
    const v2Records = runV2ForRemainingMembers(memberTokenMap, transferredUserIds, tenantDataMap);

    // ── 阶段4：构建报表数据 ──
    const testEndTs = Date.now();
    const reportData = {
        testStartTs,
        testEndTs,
        tenantIds: TENANT_IDS,
        transferRecords,
        v2Records,
        config: {
            AGENTS_PER_TENANT, MEMBERS_PER_AGENT, LEVELS_PER_AGENT,
            TRANSFERS_PER_PAIR, INACTIVE_RATE, RECHARGE_ONLY_RATE,
            ENABLE_WITHDRAW, MAX_RECHARGE_BEFORE, MAX_RECHARGE_AFTER,
            MAX_BET_BEFORE, MAX_BET_AFTER, MAX_WITHDRAW_BEFORE, MAX_WITHDRAW_AFTER,
            // 每个总代的实际配置（从第一个租户读取，各租户相同编号总代配置相同）
            agentConfigs: Array.from({ length: AGENTS_PER_TENANT }, (_, i) => ({
                index: i + 1,
                members: getAgentMembers(i + 1, TENANT_IDS[0]),
                levels:  getAgentLevels(i + 1, TENANT_IDS[0])
            }))
        }
    };

    // 打印控制台汇总
    printConsoleSummary(reportData);

    // 将报表数据序列化，供 handleSummary 使用
    // k6 不支持在 default 中直接写文件，通过 __ENV 传递序列化数据
    // 实际上 k6 的 handleSummary 可以访问 data 参数，但无法访问 default 的局部变量
    // 解决方案：将报表写入 k6 metrics 的 custom summary，或直接在 handleSummary 中重建
    // 这里我们把报表数据存到全局变量（k6 单 VU 模式下可行）
    globalThis.__reportData = reportData;

    console.log('\n[Main] ✅ 主流程完成');
}


// ============================================================
// ==================== 报表生成 ==============================
// ============================================================

/**
 * 打印控制台汇总
 */
function printConsoleSummary(reportData) {
    const { testStartTs, testEndTs, transferRecords, v2Records } = reportData;
    const duration = testEndTs - testStartTs;

    // 转线汇总
    const tBefore = transferRecords.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeBeforeAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeBeforeTimes,
        bet: s.bet + r.betBeforeAmt,
        betTimes: s.betTimes + r.betBeforeTimes,
        withdraw: s.withdraw + r.withdrawBeforeAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawBeforeTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    const tAfter = transferRecords.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeAfterAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeAfterTimes,
        bet: s.bet + r.betAfterAmt,
        betTimes: s.betTimes + r.betAfterTimes,
        withdraw: s.withdraw + r.withdrawAfterAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawAfterTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    // V2 汇总
    const v2Sum = v2Records.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeTimes,
        bet: s.bet + r.betAmt,
        betTimes: s.betTimes + r.betTimes,
        withdraw: s.withdraw + r.withdrawAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    console.log('\n' + '='.repeat(80));
    console.log('📊 测试完成汇总');
    console.log('='.repeat(80));
    console.log(`  开始时间: ${formatTime(testStartTs)}`);
    console.log(`  结束时间: ${formatTime(testEndTs)}`);
    console.log(`  总耗时:   ${formatDuration(duration)}`);
    console.log(`  租户:     ${reportData.tenantIds.join(', ')}`);
    console.log('');
    console.log(`  【转线阶段】共 ${transferRecords.length} 次转线`);
    console.log(`    转线前 - 充值: ${tBefore.rechargeTimes}次 / ${tBefore.recharge.toFixed(2)}`);
    console.log(`    转线前 - 投注: ${tBefore.betTimes}次 / ${tBefore.bet.toFixed(2)}`);
    console.log(`    转线前 - 提现: ${tBefore.withdrawTimes}次 / ${tBefore.withdraw.toFixed(2)}`);
    console.log(`    转线后 - 充值: ${tAfter.rechargeTimes}次 / ${tAfter.recharge.toFixed(2)}`);
    console.log(`    转线后 - 投注: ${tAfter.betTimes}次 / ${tAfter.bet.toFixed(2)}`);
    console.log(`    转线后 - 提现: ${tAfter.withdrawTimes}次 / ${tAfter.withdraw.toFixed(2)}`);
    console.log('');
    console.log(`  【V2阶段】共 ${v2Records.length} 个成员`);
    const v2Inactive     = v2Records.filter(r => r.group === 'inactive').length;
    const v2RechargeOnly = v2Records.filter(r => r.group === 'rechargeOnly').length;
    const v2Active       = v2Records.filter(r => r.group === 'active').length;
    console.log(`    不活跃: ${v2Inactive}  半活跃: ${v2RechargeOnly}  活跃: ${v2Active}`);
    console.log(`    充值: ${v2Sum.rechargeTimes}次 / ${v2Sum.recharge.toFixed(2)}`);
    console.log(`    投注: ${v2Sum.betTimes}次 / ${v2Sum.bet.toFixed(2)}`);
    console.log(`    提现: ${v2Sum.withdrawTimes}次 / ${v2Sum.withdraw.toFixed(2)}`);
    console.log('='.repeat(80) + '\n');
}

/**
 * 构建 TXT 报表内容
 */
function buildTxtReport(reportData) {
    const { testStartTs, testEndTs, tenantIds, transferRecords, v2Records, config } = reportData;
    const duration = testEndTs - testStartTs;
    const lines = [];

    const sep80 = '='.repeat(80);
    const sep60 = '-'.repeat(60);

    lines.push(sep80);
    lines.push('  长时间多租户转线测试报表');
    lines.push(`  租户: ${tenantIds.join(', ')}`);
    lines.push(`  执行开始: ${formatTime(testStartTs)}`);
    lines.push(`  执行结束: ${formatTime(testEndTs)}`);
    lines.push(`  总耗时:   ${formatDuration(duration)}`);
    lines.push(sep80);
    lines.push('');

    // 配置参数
    lines.push('【测试配置】');
    lines.push(`  每租户总代数: ${config.AGENTS_PER_TENANT}`);
    lines.push(`  默认每总代成员数: ${config.MEMBERS_PER_AGENT}  默认层级数: ${config.LEVELS_PER_AGENT}`);
    // 输出每个总代的实际配置
    if (config.agentConfigs && config.agentConfigs.length > 0) {
        config.agentConfigs.forEach((ac, idx) => {
            lines.push(`  总代${idx+1}: ${ac.members}人 / ${ac.levels}层`);
        });
    }
    lines.push(`  每对转线次数: ${config.TRANSFERS_PER_PAIR}`);
    lines.push(`  转线前最大充值: ${config.MAX_RECHARGE_BEFORE}次  投注: ${config.MAX_BET_BEFORE}次  提现: ${config.MAX_WITHDRAW_BEFORE}次`);
    lines.push(`  转线后最大充值: ${config.MAX_RECHARGE_AFTER}次  投注: ${config.MAX_BET_AFTER}次  提现: ${config.MAX_WITHDRAW_AFTER}次`);
    lines.push(`  V2不活跃: ${(config.INACTIVE_RATE*100).toFixed(0)}%  只充值: ${(config.RECHARGE_ONLY_RATE*100).toFixed(0)}%  活跃: ${((1-config.INACTIVE_RATE-config.RECHARGE_ONLY_RATE)*100).toFixed(0)}%`);
    lines.push(`  提现功能: ${config.ENABLE_WITHDRAW ? '开启' : '关闭'}`);
    lines.push('');

    // 全局汇总
    const tBefore = transferRecords.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeBeforeAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeBeforeTimes,
        bet: s.bet + r.betBeforeAmt,
        betTimes: s.betTimes + r.betBeforeTimes,
        withdraw: s.withdraw + r.withdrawBeforeAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawBeforeTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    const tAfter = transferRecords.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeAfterAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeAfterTimes,
        bet: s.bet + r.betAfterAmt,
        betTimes: s.betTimes + r.betAfterTimes,
        withdraw: s.withdraw + r.withdrawAfterAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawAfterTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    const v2Sum = v2Records.reduce((s, r) => ({
        recharge: s.recharge + r.rechargeAmt,
        rechargeTimes: s.rechargeTimes + r.rechargeTimes,
        bet: s.bet + r.betAmt,
        betTimes: s.betTimes + r.betTimes,
        withdraw: s.withdraw + r.withdrawAmt,
        withdrawTimes: s.withdrawTimes + r.withdrawTimes
    }), { recharge: 0, rechargeTimes: 0, bet: 0, betTimes: 0, withdraw: 0, withdrawTimes: 0 });

    lines.push('【全局汇总】');
    lines.push(`  总转线次数: ${transferRecords.length}`);
    lines.push(`  转线前 - 充值: ${tBefore.rechargeTimes}次 / ${tBefore.recharge.toFixed(2)}  投注: ${tBefore.betTimes}次 / ${tBefore.bet.toFixed(2)}  提现: ${tBefore.withdrawTimes}次 / ${tBefore.withdraw.toFixed(2)}`);
    lines.push(`  转线后 - 充值: ${tAfter.rechargeTimes}次 / ${tAfter.recharge.toFixed(2)}  投注: ${tAfter.betTimes}次 / ${tAfter.bet.toFixed(2)}  提现: ${tAfter.withdrawTimes}次 / ${tAfter.withdraw.toFixed(2)}`);
    lines.push('');
    const v2Inactive     = v2Records.filter(r => r.group === 'inactive').length;
    const v2RechargeOnly = v2Records.filter(r => r.group === 'rechargeOnly').length;
    const v2Active       = v2Records.filter(r => r.group === 'active').length;
    lines.push(`  V2剩余成员: ${v2Records.length}（不活跃${v2Inactive} / 半活跃${v2RechargeOnly} / 活跃${v2Active}）`);
    lines.push(`  V2 - 充值: ${v2Sum.rechargeTimes}次 / ${v2Sum.recharge.toFixed(2)}  投注: ${v2Sum.betTimes}次 / ${v2Sum.bet.toFixed(2)}  提现: ${v2Sum.withdrawTimes}次 / ${v2Sum.withdraw.toFixed(2)}`);
    lines.push('');

    // 转线明细
    lines.push('【转线明细】');
    lines.push(sep80);

    // 表头
    const hdr = [
        '#'.padEnd(4),
        '租户'.padEnd(6),
        '转出总代'.padEnd(12),
        '转入总代'.padEnd(12),
        'userId'.padEnd(12),
        '层级'.padEnd(6),
        '目标邀请码'.padEnd(12),
        '转线前充值'.padEnd(12),
        '转线前投注'.padEnd(12),
        '转线前提现'.padEnd(12),
        '转线后充值'.padEnd(12),
        '转线后投注'.padEnd(12),
        '转线后提现'.padEnd(12),
        '状态'
    ].join(' | ');
    lines.push(hdr);
    lines.push(sep80);

    transferRecords.forEach((r, idx) => {
        const row = [
            String(idx + 1).padEnd(4),
            String(r.tenantId).padEnd(6),
            String(r.fromRootUserId).padEnd(12),
            String(r.toRootUserId).padEnd(12),
            String(r.userId).padEnd(12),
            `L${r.hierarchy}`.padEnd(6),
            String(r.targetInviteCode).padEnd(12),
            `${r.rechargeBeforeTimes}次/${r.rechargeBeforeAmt.toFixed(0)}`.padEnd(12),
            `${r.betBeforeTimes}次/${r.betBeforeAmt.toFixed(0)}`.padEnd(12),
            `${r.withdrawBeforeTimes}次/${r.withdrawBeforeAmt.toFixed(0)}`.padEnd(12),
            `${r.rechargeAfterTimes}次/${r.rechargeAfterAmt.toFixed(0)}`.padEnd(12),
            `${r.betAfterTimes}次/${r.betAfterAmt.toFixed(0)}`.padEnd(12),
            `${r.withdrawAfterTimes}次/${r.withdrawAfterAmt.toFixed(0)}`.padEnd(12),
            r.transferSuccess ? '✅成功' : '❌失败'
        ].join(' | ');
        lines.push(row);

        // 行为计划备注
        const plan = r.plan;
        lines.push(`     计划: 转线前[充${plan.rechargeBeforeTotal}次(第${plan.transferAfterRecharge}次后转) 投${plan.betBeforeTotal}次 提${plan.withdrawBeforeTotal}次] 转线后[充${plan.rechargeAfterTotal}次 投${plan.betAfterTotal}次 提${plan.withdrawAfterTotal}次]`);
    });

    lines.push(sep80);
    lines.push('');

    // V2 明细
    lines.push('【V2 剩余成员明细】');
    lines.push(sep60);
    const v2Hdr = [
        'userId'.padEnd(12),
        '租户'.padEnd(6),
        '总代'.padEnd(12),
        '分组'.padEnd(12),
        '充值次数'.padEnd(8),
        '充值金额'.padEnd(12),
        '投注次数'.padEnd(8),
        '投注金额'.padEnd(12),
        '提现次数'.padEnd(8),
        '提现金额'.padEnd(12)
    ].join(' | ');
    lines.push(v2Hdr);
    lines.push(sep60);

    v2Records.forEach(r => {
        if (r.group === 'inactive') return; // 不活跃不输出明细
        const row = [
            String(r.userId).padEnd(12),
            String(r.tenantId).padEnd(6),
            String(r.rootUserId).padEnd(12),
            r.group === 'rechargeOnly' ? '半活跃'.padEnd(12) : '活跃'.padEnd(12),
            String(r.rechargeTimes).padEnd(8),
            r.rechargeAmt.toFixed(2).padEnd(12),
            String(r.betTimes).padEnd(8),
            r.betAmt.toFixed(2).padEnd(12),
            String(r.withdrawTimes).padEnd(8),
            r.withdrawAmt.toFixed(2).padEnd(12)
        ].join(' | ');
        lines.push(row);
    });

    lines.push(sep60);
    lines.push('');
    lines.push(sep80);
    lines.push('  报表生成完毕');
    lines.push(sep80);

    return lines.join('\n');
}

// ============================================================
// ==================== handleSummary =========================
// ============================================================

export function handleSummary(data) {
    // 从全局变量获取报表数据
    const reportData = globalThis.__reportData;

    if (!reportData) {
        console.warn('[Summary] 无报表数据，跳过文件写入');
        return {};
    }

    // 生成文件名（含时间戳）
    const now = new Date(reportData.testEndTs || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const tenantStr = (reportData.tenantIds || ['unknown']).join('-');
    const fileName = `${REPORT_DIR}/longrun_transfer_${tenantStr}_${ts}.txt`;

    const txtContent = buildTxtReport(reportData);

    console.log(`\n[Summary] 报表写入: ${fileName}`);

    return {
        [fileName]: txtContent,
        stdout: '\n' + txtContent.split('\n').slice(0, 30).join('\n') + '\n...(完整报表已写入文件)\n'
    };
}
