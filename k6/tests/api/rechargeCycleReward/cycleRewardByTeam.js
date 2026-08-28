/**
 * 充值循环奖励 —— 团队模式（给一个总代 UID，对其整个团队按循环方案充值）
 *
 * ⚠️ 全新脚本，不改动 cycleRewardSeed.day.js / 老的多天 txt 方案，两者独立并存。
 *
 * 与多天 txt 方案的区别：成员来源不是 txt，而是「给 ROOT_UID → 递归查其全部下级」：
 *   1. 递归 /api/AgentL3/GetPageListInvitedList 拿 ROOT_UID 下所有层级的成员 userId
 *   2. 每个 userId → /api/Users/GetUserAccount 拿账号
 *   3. 账号 + 密码登录（loginWithPassword，默认 qwer1234）
 *   4. 按循环方案充值：buildRechargePlans 分档(30/25/20/15/10 + 30% 冲 paid) + rechargeToTarget
 *      （商品模式下由充值层用固定面额组合凑；经典模式单笔）
 *
 * 成员来自后台查询、不需跨天 txt 桥接 → 直接 k6 run 即可，无需 Node 包装器。
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e ROOT_UID=165175 cycleRewardByTeam.js
 *
 * 参数（-e）：
 *   TENANT_ID   租户ID（默认 3004）
 *   ROOT_UID    总代/上级 UID（必需）——对其全部下级充值
 *   MAX_DEPTH   递归层级上限，0=不限（默认 0）
 *   SKIP_RATIO  随机跳过不充值的比例（默认 0=全部都充）
 *   PAID_RATIO  每档冲 paid 比例（默认 0.3）
 *   PASSWORD    成员登录密码（默认 qwer1234）
 *   USER_GAP    用户间隔秒，缓解限流（默认 2）
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendQueryRequest } from '../common/request.js';
import { getUserAccount } from '../user/userAccountApi.js';
import { loginWithPassword } from '../recharge/rechargeLevel.service.js';
import { getCycleRewardConfig, getCycleRewardSettings } from './cycleRewardApi.js';
import { buildRechargePlans, rechargeToTarget } from './cycleRewardService.js';

const TAG = 'CycleTeam';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const ROOT_UID = __ENV.ROOT_UID;
const MAX_DEPTH = parseInt(__ENV.MAX_DEPTH || '0', 10);      // 0=不限层级
const SKIP_RATIO = __ENV.SKIP_RATIO ? parseFloat(__ENV.SKIP_RATIO) : 0; // 默认全部都充
const PAID_RATIO = __ENV.PAID_RATIO ? parseFloat(__ENV.PAID_RATIO) : 0.3;
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
const USER_GAP = __ENV.USER_GAP ? parseFloat(__ENV.USER_GAP) : 2;

export const options = {
    scenarios: {
        cycle_reward_team: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '180m'
        }
    }
};

// ================= 团队递归查询（重写，不动 agentL3） =================

/** 拉取某 agentId 的直推下级列表（自动翻页） */
function getDirectInvitees(adminToken, agentId) {
    const api = '/api/AgentL3/GetPageListInvitedList';
    let all = [];
    let pageNo = 1;
    while (true) {
        const payload = { agentId, pageNo, pageSize: 500, orderBy: 'Desc' };
        let res = sendQueryRequest(payload, api, TAG, false, adminToken);
        if (typeof res !== 'object') {
            try { res = JSON.parse(res); } catch (e) { break; }
        }
        const list = (res && res.list) ? res.list : [];
        all = all.concat(list);
        const totalPage = (res && res.totalPage) ? res.totalPage : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return all;
}

/** 逐层(BFS)递归拿 rootId 下所有下级 userId；maxDepth<=0 表示不限层级 */
function getAllDescendantIds(adminToken, rootId, maxDepth) {
    const result = [];
    const seen = new Set([Number(rootId)]);
    let frontier = [Number(rootId)];
    let depth = 0;

    while (frontier.length && (maxDepth <= 0 || depth < maxDepth)) {
        const next = [];
        for (const uid of frontier) {
            const kids = getDirectInvitees(adminToken, uid);
            for (const k of kids) {
                const kid = Number(k.userId);
                if (!seen.has(kid)) {
                    seen.add(kid);
                    result.push(kid);
                    next.push(kid);
                }
            }
            sleep(0.2);
        }
        frontier = next;
        depth++;
    }
    return result;
}

// ================= Utils =================

function recordTierHit(stats, plan) {
    const id = plan.tier.id;
    if (!stats.tierHit[id]) stats.tierHit[id] = { free: 0, paid: 0 };
    if (plan.isPaid) { stats.tierHit[id].paid++; stats.paidUsers++; }
    else { stats.tierHit[id].free++; stats.freeUsers++; }
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[${TAG}] ========== 团队循环充值 ROOT_UID=${ROOT_UID} 租户=${TENANT_ID} ==========`);

    if (!ROOT_UID) {
        throw new Error(`[${TAG}] ❌ 必须提供 -e ROOT_UID=<总代UID>`);
    }

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    // 档位配置（失败抛错终止）
    const tiers = getCycleRewardConfig({ token: adminToken });
    console.log(`[${TAG}] ✅ 获取到档位配置 ${tiers.length} 档`);

    try {
        const settings = getCycleRewardSettings({ token: adminToken });
        console.log(`[${TAG}] 活动总开关=${settings.switchOn ? '开' : '关'} | 付费采用累计=${settings.paidUseCumulative ? '是(累计)' : '否(单笔)'}`);
    } catch (e) { /* 忽略 */ }

    return { token: adminToken, tiers, envConfig };
}

export default function (data) {
    const { token: adminToken, tiers, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const stats = {
        teamTotal: 0, accountFail: 0, participants: 0, skipped: 0, loginFail: 0,
        rechargeUsers: 0, rechargeFailUsers: 0, paidUsers: 0, freeUsers: 0, totalAmount: 0, tierHit: {}
    };

    // 1. 递归查团队全部下级
    console.log(`[${TAG}] 递归查询 ROOT_UID=${ROOT_UID} 的下级成员（层级上限 ${MAX_DEPTH <= 0 ? '不限' : MAX_DEPTH}）...`);
    const memberIds = getAllDescendantIds(adminToken, ROOT_UID, MAX_DEPTH);
    stats.teamTotal = memberIds.length;
    console.log(`[${TAG}] ✅ 团队下级成员共 ${memberIds.length} 人`);

    if (memberIds.length === 0) {
        console.warn(`[${TAG}] ⚠️ 未查询到任何下级成员，结束`);
        printReport(stats);
        return;
    }

    // 2. userId → 账号
    const members = [];
    for (const uid of memberIds) {
        const account = getUserAccount(adminToken, uid);
        if (account) members.push({ userId: uid, account: account });
        else { stats.accountFail++; console.warn(`[${TAG}] userId=${uid} 取账号失败`); }
        sleep(0.2);
    }

    // 3. 可选随机跳过
    const participants = SKIP_RATIO > 0 ? members.filter(() => Math.random() >= SKIP_RATIO) : members;
    stats.participants = participants.length;
    stats.skipped = members.length - participants.length;
    console.log(`[${TAG}] 有账号 ${members.length} 人，参与充值 ${participants.length}，跳过 ${stats.skipped}`);

    // 4. 分档 + 逐个登录充值
    const plans = buildRechargePlans(participants.length, tiers, { paidRatio: PAID_RATIO });

    for (let i = 0; i < participants.length; i++) {
        const m = participants[i];
        const token = loginWithPassword(m.account, PASSWORD);
        if (!token) { stats.loginFail++; sleep(1); continue; }

        const plan = plans[i];
        recordTierHit(stats, plan);
        const rr = rechargeToTarget({
            adminToken, userToken: token, userId: m.userId,
            amount: plan.target, remark: 'CycleTeam'
        });
        if (rr.successCount > 0) { stats.rechargeUsers++; stats.totalAmount += rr.totalAmount; }
        else stats.rechargeFailUsers++;

        sleep(USER_GAP);
    }

    printReport(stats);
}

// ================= 报表（逐行 console.log，避免 k6 把 \n 转义挤成一行） =================

function printReport(stats) {
    const dline = '═'.repeat(54);
    const sline = '─'.repeat(54);
    console.log('');
    console.log(dline);
    console.log(`  📊 团队循环充值报表   ROOT_UID=${ROOT_UID}   租户=${TENANT_ID}`);
    console.log(dline);
    console.log(`  团队下级成员   : ${stats.teamTotal}   取账号失败: ${stats.accountFail}`);
    console.log(`  参与充值       : ${stats.participants}   跳过: ${stats.skipped}`);
    console.log(sline);
    console.log(`  充值成功人数   : ${stats.rechargeUsers}   充值失败: ${stats.rechargeFailUsers}   登录失败: ${stats.loginFail}`);
    console.log(`  其中冲 paid    : ${stats.paidUsers}   只冲 free: ${stats.freeUsers}`);
    console.log(`  总充值金额     : ${stats.totalAmount.toFixed(2)}`);
    console.log(sline);
    console.log('  各档位命中 (free / paid):');
    Object.keys(stats.tierHit).sort((a, b) => Number(a) - Number(b)).forEach(id => {
        const h = stats.tierHit[id];
        console.log(`    档位 id=${id} : free=${h.free}  paid=${h.paid}`);
    });
    console.log(dline);
    console.log('');
}
