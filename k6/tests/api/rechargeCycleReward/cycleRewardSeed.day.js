/**
 * 充值循环奖励活动 —— 多天造数据 k6 脚本（配合 cycleRunner.js 使用）
 *
 * ⚠️ 账号落盘由 Node 包装器 cycleRunner.js 完成：
 *    - k6 沙箱无法写本地文件；本脚本把每个要落盘的账号打印成 `##ACCT##<账号>` 行（走 stderr），
 *      由 cycleRunner.js 捕获后写入 dayNN.txt。
 *    - 读取上一天账号用 k6 open()（DAY>=2，相对脚本目录）。
 *    - 造数在 default(VU) 内执行；vus:1 单 runtime，统计完整、报表在 default 末尾打印。
 *
 * 正式运行（推荐）：
 *    node cycleRunner.js --day 1 --count 35 --levels 4 --root PJM7QLN --tenant 3004
 * 第二天运行：
 *   node cycleRunner.js --day 2 --tenant 3004
 *
 * 仅调试（不会生成 txt，只打印）：
 *    k6 run -e USER_COUNT=15 -e LEVELS=2 -e ROOT_INVITE_CODE=7VA3VCN cycleRewardSeed.day.js
 *
 * 参数（-e，由 cycleRunner.js 组装）：
 *    TENANT_ID / DAY / USER_COUNT / LEVELS / ROOT_INVITE_CODE / COUNTRY_CODE / PAID_RATIO / USER_GAP
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { loginWithPassword } from '../recharge/rechargeLevel.service.js';
import { getCycleRewardConfig, getCycleRewardSettings } from './cycleRewardApi.js';
import { buildRechargePlans, distributePeople, randomPick, rechargeToTarget } from './cycleRewardService.js';

// ================= 参数（init 上下文） =================

const TENANT_ID = __ENV.TENANT_ID || '3004';
const DAY = parseInt(__ENV.DAY || '1', 10);
const USER_COUNT = parseInt(__ENV.USER_COUNT || '10', 10);
const LEVELS = parseInt(__ENV.LEVELS || '4', 10);
const ROOT_INVITE_CODE = __ENV.ROOT_INVITE_CODE || 'W5LU89N';
const PAID_RATIO = __ENV.PAID_RATIO ? parseFloat(__ENV.PAID_RATIO) : 0.3;
const USER_GAP = __ENV.USER_GAP ? parseFloat(__ENV.USER_GAP) : 2;
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);

const FOREST_RATIO = 0.8; // 森林占比
const SKIP_RATIO = 0.2;   // DAY>=2 不充值占比
const ACCT_PREFIX = '##ACCT##'; // cycleRunner.js 据此从 stderr 提取账号写入 dayNN.txt

// DAY>=2：init 阶段读取上一天账号（open 相对本脚本目录）
let PREV_ACCOUNTS = [];
if (DAY >= 2) {
    const prevFile = `./day${String(DAY - 1).padStart(2, '0')}.txt`;
    try {
        PREV_ACCOUNTS = open(prevFile).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch (e) {
        throw new Error(`[CycleReward] ❌ DAY=${DAY} 读取上一天文件 ${prevFile} 失败：${e.message}（请确认已生成且 cycleRunner 在脚本目录运行）`);
    }
}

export const options = {
    scenarios: {
        cycle_reward_seed: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '180m'
        }
    }
};

// ================= Utils =================

function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

/** 打印账号落盘标记行（cycleRunner.js 提取）；单独一行避免与其它日志混淆 */
function emitAccount(phone) {
    console.log(`${ACCT_PREFIX}${phone}`);
}

function recordTierHit(stats, plan) {
    const id = plan.tier.id;
    if (!stats.tierHit[id]) stats.tierHit[id] = { free: 0, paid: 0 };
    if (plan.isPaid) { stats.tierHit[id].paid++; stats.paidUsers++; }
    else { stats.tierHit[id].free++; stats.freeUsers++; }
}

/**
 * 注册单个用户并补齐 userId/inviteCode（带换号重试）
 * @param {string} kind - 'forest' | 'retail'
 * @returns {{phone, token, userId, inviteCode}|null}
 */
function registerWithRetry(kind, parentCode, ctx) {
    const { countryCode, adminData, customUrls } = ctx;
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
        const phone = generateRandomPhone(countryCode);
        const res = (kind === 'forest')
            ? phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls)
            : phoneRegister(phone, adminData, 'qwer1234', '');

        const token = extractToken(res);
        if (token) {
            const info = getFrontUserInfo(token);
            if (info && info.userId) {
                return { phone, token, userId: info.userId, inviteCode: info.inviteCode || '' };
            }
        }
        sleep(1 + attempt); // 退避后换号重试（缓解限流/重复）
    }
    return null;
}

// ================= 第一天：注册森林 + 散户，按档充值 =================

function runDay1(adminToken, tiers, envConfig, countryCode, stats) {
    stats.planned = USER_COUNT;
    const plans = buildRechargePlans(USER_COUNT, tiers, { paidRatio: PAID_RATIO });
    let planCursor = 0;

    const forestCount = Math.floor(USER_COUNT * FOREST_RATIO);
    const retailCount = USER_COUNT - forestCount;

    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    const ctx = { countryCode, adminData, customUrls };

    console.log(`[CycleReward][D1] 计划注册 ${USER_COUNT} 人：森林 ${forestCount} + 散户 ${retailCount}，森林层级 ${LEVELS}`);

    // ---- 森林（80%）：逐层建树，上级邀请码供下级使用 ----
    const levelCounts = distributePeople(forestCount, LEVELS);
    const codesByLevel = Array.from({ length: LEVELS }, () => []);
    console.log(`[CycleReward][D1] 森林分层: ${JSON.stringify(levelCounts)}`);

    for (let lv = 0; lv < levelCounts.length; lv++) {
        for (let i = 0; i < levelCounts[lv]; i++) {
            const parentCode = lv === 0 ? ROOT_INVITE_CODE : (randomPick(codesByLevel[lv - 1]) || ROOT_INVITE_CODE);
            const u = registerWithRetry('forest', parentCode, ctx);
            if (!u) { stats.regFail++; continue; }

            if (u.inviteCode) codesByLevel[lv].push(u.inviteCode);
            stats.regSuccess++;
            emitAccount(u.phone); // 第一天：注册成功即落盘

            const plan = plans[planCursor++];
            recordTierHit(stats, plan);
            const rr = rechargeToTarget({
                adminToken, userToken: u.token, userId: u.userId,
                amount: plan.target, remark: 'CycleD1-Forest'
            });
            if (rr.successCount > 0) { stats.rechargeUsers++; stats.totalAmount += rr.totalAmount; }
            else stats.rechargeFailUsers++;

            sleep(USER_GAP);
        }
    }

    // ---- 散户（20%）：无邀请码独立注册 ----
    for (let i = 0; i < retailCount; i++) {
        const u = registerWithRetry('retail', null, ctx);
        if (!u) { stats.regFail++; continue; }

        stats.regSuccess++;
        emitAccount(u.phone);

        const plan = plans[planCursor++];
        recordTierHit(stats, plan);
        const rr = rechargeToTarget({
            adminToken, userToken: u.token, userId: u.userId,
            amount: plan.target, remark: 'CycleD1-Retail'
        });
        if (rr.successCount > 0) { stats.rechargeUsers++; stats.totalAmount += rr.totalAmount; }
        else stats.rechargeFailUsers++;

        sleep(USER_GAP);
    }
}

// ================= 第 N 天：读上一天账号，登录后按新档位充值 =================

function runDayN(adminToken, tiers, stats) {
    // 抽 20% 不充值
    const participants = PREV_ACCOUNTS.filter(() => Math.random() >= SKIP_RATIO);
    stats.participants = participants.length;
    stats.skipped = PREV_ACCOUNTS.length - participants.length;

    console.log(`[CycleReward][D${DAY}] 上一天 ${PREV_ACCOUNTS.length} 人 → 参与 ${participants.length}，跳过 ${stats.skipped}`);

    // 每人每天档位不一致：对参与者重新分档
    const plans = buildRechargePlans(participants.length, tiers, { paidRatio: PAID_RATIO });

    for (let i = 0; i < participants.length; i++) {
        const account = participants[i];

        const token = loginWithPassword(account, 'qwer1234');
        if (!token) { stats.loginFail++; sleep(1); continue; }

        const info = getFrontUserInfo(token);
        if (!info || !info.userId) { stats.infoFail++; sleep(1); continue; }

        const plan = plans[i];
        recordTierHit(stats, plan);
        const rr = rechargeToTarget({
            adminToken, userToken: token, userId: info.userId,
            amount: plan.target, remark: `CycleD${DAY}`
        });

        if (rr.successCount > 0) {
            stats.rechargeUsers++;
            stats.totalAmount += rr.totalAmount;
            emitAccount(account); // 第2~4天：实际充值成功才落盘
        } else {
            stats.rechargeFailUsers++;
        }

        sleep(USER_GAP);
    }
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[CycleReward] ========== 充值循环奖励造数据 DAY=${DAY} 租户=${TENANT_ID} ==========`);

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[CycleReward] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[CycleReward] ✅ 管理员登录成功`);

    // 第一步：获取档位配置（失败在此抛错 → 终止程序）
    const tiers = getCycleRewardConfig({ token: adminToken });
    console.log(`[CycleReward] ✅ 获取到档位配置 ${tiers.length} 档`);

    try {
        const settings = getCycleRewardSettings({ token: adminToken });
        console.log(`[CycleReward] 活动总开关=${settings.switchOn ? '开' : '关'} | 付费采用累计=${settings.paidUseCumulative ? '是(累计)' : '否(单笔)'}`);
    } catch (e) { /* 忽略：开关查询失败不影响造数 */ }

    return { token: adminToken, tiers, envConfig };
}

export default function (data) {
    const { token: adminToken, tiers, envConfig } = data;

    // VU runtime 内也切一次环境，保证注册/充值走对租户地址
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';

    // 单 VU：造数与统计都在本 runtime 内完成，报表在末尾直接打印
    const stats = {
        planned: 0, regSuccess: 0, regFail: 0,
        rechargeUsers: 0, rechargeFailUsers: 0, totalAmount: 0, paidUsers: 0, freeUsers: 0,
        prevTotal: PREV_ACCOUNTS.length, participants: 0, skipped: 0, loginFail: 0, infoFail: 0,
        tierHit: {}
    };

    if (DAY === 1) {
        runDay1(adminToken, tiers, envConfig, countryCode, stats);
    } else {
        runDayN(adminToken, tiers, stats);
    }

    emitReportData(stats);

    // 防呆：直接 k6 run 不会落盘 txt（k6 沙箱无法写文件），提示改用 cycleRunner.js
    if (!__ENV.VIA_RUNNER) {
        console.log(`\n⚠️  你是直接用 k6 run 运行的：账号不会写入 day${String(DAY).padStart(2, '0')}.txt（k6 无法写本地文件）。`);
        console.log(`   请改用 Node 包装器：node cycleRunner.js --day ${DAY}${DAY === 1 ? ` --count ${USER_COUNT} --levels ${LEVELS} --root ${ROOT_INVITE_CODE}` : ''} --tenant ${TENANT_ID}`);
    }
}

// ================= 报表数据输出（k6 只吐 ##RPT## 标记行，由 cycleRunner.js 收集后美化打印） =================
// 原因：k6 日志格式化器会把单条 console.log 里的 \n 转义成字面 "\n" 挤成一行；
//       改由 Node 端(runner)打印，换行正常、无 k6 前缀。

function emitReportData(stats) {
    const kv = {
        day: DAY,
        tenant: TENANT_ID,
        planned: stats.planned,
        regSuccess: stats.regSuccess,
        regFail: stats.regFail,
        prevTotal: stats.prevTotal,
        participants: stats.participants,
        skipped: stats.skipped,
        loginFail: stats.loginFail,
        infoFail: stats.infoFail,
        rechargeUsers: stats.rechargeUsers,
        rechargeFailUsers: stats.rechargeFailUsers,
        paidUsers: stats.paidUsers,
        freeUsers: stats.freeUsers,
        totalAmount: stats.totalAmount.toFixed(2)
    };
    for (const k in kv) console.log(`##RPT##${k}=${kv[k]}`);
    Object.keys(stats.tierHit).sort((a, b) => Number(a) - Number(b)).forEach(id => {
        const h = stats.tierHit[id];
        console.log(`##RPT##tier_${id}=${h.free},${h.paid}`);
    });
}
