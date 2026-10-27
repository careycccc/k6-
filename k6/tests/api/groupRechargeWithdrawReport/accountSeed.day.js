/**
 * 集团充提报表核对 —— 造数 k6 脚本
 *
 * ⚠️ 单进程只处理一个商户(env TENANT_ID)：项目请求层主力链路(sendRequest→
 * httpClient→getApiUrl→resolveTenant())在不传参时只认进程级别的
 * __ENV.TENANT_ID，不是按VU区分的，所以"多商户并行"必须是多个独立k6进程
 * (Runner并行spawn)，不能在一个进程里开多个VU各自指定不同商户。
 *
 * 本文件支持两种模式，用 __ENV.DAY_INDEX 是否存在区分，互不影响：
 *
 * 【模式A：单批次造数】(DAY_INDEX不传，配合 accountSeedRunner.js)
 *   原有逻辑，完全不变：注册ACCOUNT_COUNT个账号，每个充值1笔+投注1-2笔+
 *   提现2-3笔。USDT账号(30%概率)按商户真实支持性分别降级，不会因为商户
 *   不支持USDT而让账号报废(见 ensureUsdtSupport 注释)。
 *
 * 【模式B：多天衰减系列】(DAY_INDEX存在，配合 dailyRunner.js，2026-10-26新增)
 *   目的：单批次造数只能验证报表"当天数据对不对"，验证不了报表核心的
 *   "按成功时间统计(非发起时间)"和"按天去重、多天累加"这两个口径——这些
 *   只有构造跨天的订单才能测出来。真实连续跑TOTAL_DAYS天，当天3个scenario
 *   并发跑(不是顺序跑，参照 inviteWheelRetention.day.js 已验证过的多scenario
 *   并发范式)：
 *     - backfill_audit：对前一天"故意不审核"的充值订单，随机50%审核通过，
 *       另外50%维持Cancel不动(第1天没有昨天的订单，不会启用这个scenario)
 *     - new_accounts：新注册NEW_COUNT个账号，每个充值3-5笔(其中2-3笔故意
 *       不立即审核，留给明天补单，但保证至少1笔立即审核通过——否则账号
 *       0可用余额，投注/提现全部失败，这是已验证过的硬约束)+投注+提现
 *     - fish_old_accounts：从商户会员列表里随机捶FISH_TARGET个老会员
 *       (/api/Users/GetPageList)，标准密码登录失败就后台重置密码
 *       (/api/Users/UpdatePassword，不需要原密码)，走和新账号一样的流程
 *
 *   "故意不审核"的技术原理(2026-10-26实测确认，不是假设)：充值订单发起后
 *   约5-6分钟会自动从Wait转Cancel(仍算未支付)，但Cancel状态依然可以在
 *   第二天被manualAuditXXX补单变成Payed，且订单的createTime保持不变、
 *   rechargeSuccessTime精确反映补单发生的那一刻——这正是构造"创建时间和
 *   成功时间跨天"样本的机制。
 *
 * 运行：
 *   模式A: node accountSeedRunner.js
 *   模式B: node dailyRunner.js
 *
 * 参数（-e，由对应的 runner 组装）：
 *   TENANT_ID(必传) / ACCOUNT_COUNT(模式A，不传则15-25随机)
 *   DAY_INDEX / NEW_COUNT / FISH_TARGET(模式B) / VIA_RUNNER
 */

/* global open */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { phoneRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getWithdrawBasicInfo } from '../withdraw/withdrawApi.js';
import { assembleUsdtRecharge, assembleFiatRechargeNoUsdt, detectUsdtRechargeSupport } from './rechargeAssembler.js';
import { betFixed } from './betAssembler.js';
import { prepareWithdraw, doWithdrawMultiple, detectUsdtWithdrawSupport } from './withdrawAssembler.js';
import { fishOldMembers, loginOrResetFished } from './oldMemberFisher.js';
import { collectPendingForDay, collectPendingWithdrawsForDay, splitApproveDecision, resolvePendingOrder, resolvePendingWithdrawOrder } from './backfillAudit.js';
import {
    USDT_ACCOUNT_RATE, BET_COUNT_MIN, BET_COUNT_MAX, BET_AMOUNT_MIN, BET_AMOUNT_MAX,
    WITHDRAW_COUNT_MIN, WITHDRAW_COUNT_MAX, USDT_RECHARGE_AMOUNT_MIN, USDT_RECHARGE_AMOUNT_MAX,
    USDT_WITHDRAW_AMOUNT, FIAT_WITHDRAW_AMOUNT, ACCOUNT_COUNT_MIN, ACCOUNT_COUNT_MAX, randInt,
    RECHARGE_COUNT_MIN, RECHARGE_COUNT_MAX, RECHARGE_PENDING_MIN, RECHARGE_PENDING_MAX, BACKFILL_APPROVE_RATE,
    WITHDRAW_PENDING_COUNT
} from './seedConfig.js';

const TENANT_ID = __ENV.TENANT_ID;
if (!TENANT_ID) throw new Error('[AccountSeed] 必须传 TENANT_ID');

// 模式B参数
const DAY_INDEX = __ENV.DAY_INDEX ? parseInt(__ENV.DAY_INDEX, 10) : null;
const NEW_COUNT = __ENV.NEW_COUNT ? parseInt(__ENV.NEW_COUNT, 10) : 0;
const FISH_TARGET = __ENV.FISH_TARGET ? parseInt(__ENV.FISH_TARGET, 10) : 0;

// 模式A参数
const ACCOUNT_COUNT = __ENV.ACCOUNT_COUNT ? parseInt(__ENV.ACCOUNT_COUNT, 10) : randInt(ACCOUNT_COUNT_MIN, ACCOUNT_COUNT_MAX);

// init阶段(模块顶层)读累计状态表——只有模式B需要：①fishOldMembers的排除集合
// ②backfill_audit扫描前一天的pendingRecharges。照抄inviteWheelRetention.day.js
// 的open()+try/catch兜底模式，文件不存在(第1天)视为空历史，不报错。
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';
let ALL_RECORDS = [];
if (DAY_INDEX) {
    try {
        ALL_RECORDS = open(STATE_FILE).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(line => JSON.parse(line));
    } catch (e) {
        console.warn(`[AccountSeed] 状态文件${STATE_FILE}不存在或读取失败，视为第1天(无历史记录): ${e.message}`);
    }
}
const KNOWN_ACCOUNTS = new Set(ALL_RECORDS.map(r => r.account));

export const options = DAY_INDEX ? {
    scenarios: {
        ...(DAY_INDEX > 1 ? {
            backfill_audit: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'runBackfillAudit', maxDuration: '30m' }
        } : {}),
        new_accounts: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'runNewAccounts', maxDuration: '180m' },
        ...(FISH_TARGET > 0 ? {
            fish_old_accounts: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'runFishOldAccounts', maxDuration: '180m' }
        } : {})
    }
} : {
    scenarios: { s: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '120m' } }
};

function emitAcct(record) {
    console.log(`##ACCT##${JSON.stringify(record)}`);
}

/** 非USDT账号的法币提现类型：排除UPI(已知业务不支持这个类型提现)，取第一个可用 */
function pickFiatWithdrawType(withdrawCategoryList) {
    const found = (withdrawCategoryList || []).find(c => c.withdrawType !== 'UPI' && c.withdrawType !== 'USDT');
    return found ? found.withdrawType : 'BankCard';
}

/**
 * 本商户USDT支持性缓存——充值/提现独立判断，不能假设一致(2026-10-26用户
 * 指出：有些商户可能只支持充值USDT，有些可能只支持提现USDT)。本进程只服务
 * 一个商户(TENANT_ID固定)，用第一个账号的token探测一次即可，后续账号直接
 * 读缓存，不用每个账号都重新查两个接口。
 */
let usdtSupportCache = null;
function ensureUsdtSupport(userToken) {
    if (usdtSupportCache) return usdtSupportCache;
    const recharge = detectUsdtRechargeSupport(userToken);
    const withdraw = detectUsdtWithdrawSupport(userToken);
    usdtSupportCache = { recharge, withdraw };
    console.log(`[AccountSeed] 商户${TENANT_ID} USDT支持性探测: 充值=${recharge} 提现=${withdraw}`);
    return usdtSupportCache;
}

/** 只负责注册，返回 {phone, userToken, userId} 或 null(注册/查用户信息失败) */
function createNewAccount(countryCode) {
    const phone = generateRandomPhone(countryCode);
    const reg = phoneRegister(phone, {});
    if (!reg || !reg.data || !reg.data.token) {
        console.error(`[AccountSeed] ❌ 注册失败: ${phone}`);
        return null;
    }
    const userToken = reg.data.token;
    const info = getFrontUserInfo(userToken);
    const userId = info && info.userId;
    if (!userId) {
        console.error(`[AccountSeed] ❌ 注册成功但拿不到userId: ${phone}`);
        return null;
    }
    return { phone, userToken, userId };
}

/**
 * 充值rechargeCount笔 + 投注 + 提现，新账号/捶到的老会员公用这条流程。
 *
 * 充值笔数拆成"立即审核"(immediateCount)+"故意延迟留给明天补单"(pendingCount，
 * 实际生效数不超过rechargeCount-1)两段，先做完全部"立即审核"的再做"延迟"的——
 * 这样哪怕"立即审核"那几笔里有1笔失败(网络/限流)，只要不是全部失败，账号
 * 依然有可用余额，不会因为"唯一一笔不延迟的charge刚好失败"就导致账号报废。
 *
 * @param {string} adminToken
 * @param {string} userToken
 * @param {number} userId
 * @param {string} phone
 * @param {{rechargeCount?:number, pendingCount?:number, createdDay?:number|null, role?:'new'|'fished', fishedInfo?:object|null}} opts
 * @returns {object} 完整的账号记录(已经emit过)
 */
function operateAccount(adminToken, userToken, userId, phone, opts) {
    const { rechargeCount = 1, pendingCount = 0, createdDay = null, role = 'new', fishedInfo = null } = opts;

    const support = ensureUsdtSupport(userToken);
    const canUsdtAny = support.recharge || support.withdraw;
    const isUsdt = canUsdtAny && Math.random() < USDT_ACCOUNT_RATE;
    const useUsdtRecharge = isUsdt && support.recharge;
    const useUsdtWithdraw = isUsdt && support.withdraw;
    console.log(`[AccountSeed] ✅ ${role === 'fished' ? '捶取老会员' : '新账号'} ${phone} userId=${userId} isUsdt=${isUsdt}(充值用USDT=${useUsdtRecharge} 提现用USDT=${useUsdtWithdraw})`);

    const record = {
        account: phone, password: 'qwer1234', userId, tenantId: TENANT_ID, isUsdt,
        role, createdDay,
        ...(fishedInfo ? { fishedInfo } : {}),
        rechargeDone: false, rechargeOrderNo: null, rechargeRealType: null,
        rechargeAttempts: [], pendingRecharges: [],
        betCount: 0, withdrawAttempts: 0, withdrawSuccessCount: 0, withdrawRealType: null, withdrawStopReason: null,
        withdrawHistory: [], pendingWithdraws: [],
        createdAt: new Date().toISOString()
    };

    const actualPending = Math.min(pendingCount, Math.max(0, rechargeCount - 1));
    const immediateCount = rechargeCount - actualPending;

    function doOneRecharge(audit) {
        const targetAmount = useUsdtRecharge ? randInt(USDT_RECHARGE_AMOUNT_MIN, USDT_RECHARGE_AMOUNT_MAX) : ENV_CONFIG.RECHARGE_AMOUNT_MIN || 2000;
        const result = useUsdtRecharge
            ? assembleUsdtRecharge(userToken, adminToken, userId, targetAmount, { audit })
            : assembleFiatRechargeNoUsdt(userToken, adminToken, userId, targetAmount, { audit });
        if (!result.success) {
            console.warn(`[AccountSeed] ⚠️ ${phone} 充值失败: ${result.reason}`);
            return false;
        }
        const attempt = { orderNo: result.orderNo, rechargeType: result.rechargeType, amount: result.amount, createTime: result.createTime, audited: !result.pending, createdDay };
        record.rechargeAttempts.push(attempt);
        if (result.pending) {
            record.pendingRecharges.push({ ...attempt, userId, auditDecisionMade: false, auditResult: null, resolvedDay: null });
            console.log(`[AccountSeed] 📌 ${phone} 充值已发起(故意不审核，留给明天补单): ${JSON.stringify(result)}`);
        } else {
            console.log(`[AccountSeed] ✅ ${phone} 充值成功: ${JSON.stringify(result)}`);
            if (!record.rechargeDone) {
                record.rechargeDone = true;
                record.rechargeOrderNo = result.orderNo;
                record.rechargeRealType = result.rechargeType;
            }
        }
        return !result.pending; // 只有真正审核通过(Payed)才算贡献了可用余额
    }

    let anyPayed = false;
    for (let i = 0; i < immediateCount; i++) {
        if (i > 0) sleep(1);
        if (doOneRecharge(true)) anyPayed = true;
    }
    if (!anyPayed) {
        console.error(`[AccountSeed] ❌ ${phone} 立即审核的${immediateCount}笔充值全部失败，没法投注/提现`);
        emitAcct(record);
        return record;
    }
    for (let i = 0; i < actualPending; i++) {
        sleep(1);
        doOneRecharge(false);
    }

    sleep(2);

    // 投注(不能省，避免"无充值连续提款"风控)
    const betCount = randInt(BET_COUNT_MIN, BET_COUNT_MAX);
    for (let i = 0; i < betCount; i++) {
        const unit = 10;
        const multiple = Math.round(randInt(BET_AMOUNT_MIN, BET_AMOUNT_MAX) / unit);
        const betResult = betFixed(userToken, unit, multiple, phone);
        if (betResult) record.betCount++;
        sleep(1);
    }

    sleep(2);

    // 提现：同理，只有该商户真的支持USDT提现才走USDT，否则降级为法币
    prepareWithdraw(adminToken, userId, userToken);
    const withdrawCount = randInt(WITHDRAW_COUNT_MIN, WITHDRAW_COUNT_MAX);
    let forceType = 'USDT';
    if (!useUsdtWithdraw) {
        const basicInfo = getWithdrawBasicInfo(userToken);
        forceType = pickFiatWithdrawType(basicInfo && basicInfo.withdrawCategoryList);
    }
    const withdrawAmount = useUsdtWithdraw ? USDT_WITHDRAW_AMOUNT : FIAT_WITHDRAW_AMOUNT;
    // 模式A(单批次，createdDay为null)不构造跨天，强制不留pending——跟充值
    // 侧 seedOneAccount 传 pendingCount:0 的保守做法保持一致，模式A流程
    // 完全不受这次改动影响。
    const withdrawPendingCount = createdDay != null ? WITHDRAW_PENDING_COUNT : 0;
    const { attempts, stopReason } = doWithdrawMultiple(adminToken, userId, userToken, withdrawCount, withdrawAmount, forceType, withdrawPendingCount);
    record.withdrawAttempts = attempts.length;
    record.withdrawSuccessCount = attempts.filter(a => a.withdrew).length;
    record.withdrawRealType = forceType;
    record.withdrawStopReason = stopReason;
    record.withdrawHistory.push({ day: createdDay, attempts: attempts.length, successCount: record.withdrawSuccessCount, withdrawRealType: forceType, stopReason });
    for (const a of attempts) {
        if (a.pending) {
            record.pendingWithdraws.push({ userId, withdrawType: forceType, amount: withdrawAmount, createdDay, auditDecisionMade: false, auditResult: null, resolvedDay: null });
        }
    }
    console.log(`[AccountSeed] 提现结果 ${phone}: 尝试${attempts.length}笔 成功${record.withdrawSuccessCount}笔 待补单${attempts.filter(a => a.pending).length}笔 类型=${forceType} 停止原因=${stopReason || '无(正常跑完)'}`);

    emitAcct(record);
    return record;
}

// ========================= 模式A：单批次造数(原有逻辑，不变) =========================

function seedOneAccount(adminToken, countryCode) {
    const created = createNewAccount(countryCode);
    if (!created) return null;
    return operateAccount(adminToken, created.userToken, created.userId, created.phone, { rechargeCount: 1, pendingCount: 0, createdDay: null, role: 'new' });
}

// ========================= 模式B：多天衰减系列 =========================

/** Scenario: 新注册NEW_COUNT个账号 */
export function runNewAccounts(data) {
    const { adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    console.log(`[AccountSeed] [新增] 第${DAY_INDEX}天，目标新增${NEW_COUNT}个账号`);
    for (let i = 0; i < NEW_COUNT; i++) {
        console.log(`[AccountSeed] [新增] ===== 第${i + 1}/${NEW_COUNT}个 =====`);
        const created = createNewAccount(countryCode);
        if (!created) continue;
        const rechargeCount = randInt(RECHARGE_COUNT_MIN, RECHARGE_COUNT_MAX);
        const pendingCount = randInt(RECHARGE_PENDING_MIN, RECHARGE_PENDING_MAX);
        operateAccount(adminToken, created.userToken, created.userId, created.phone, { rechargeCount, pendingCount, createdDay: DAY_INDEX, role: 'new' });
        sleep(1);
    }
    console.log(`[AccountSeed] [新增] 第${DAY_INDEX}天新增完成`);
}

/** Scenario: 从会员列表捶FISH_TARGET个老会员 */
export function runFishOldAccounts(data) {
    const { adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    if (FISH_TARGET <= 0) { console.log('[AccountSeed] [捶老会员] 目标为0，跳过'); return; }

    const fished = fishOldMembers(adminToken, KNOWN_ACCOUNTS, FISH_TARGET);
    console.log(`[AccountSeed] [捶老会员] 第${DAY_INDEX}天，目标${FISH_TARGET}个，实际捶到${fished.length}个`);
    for (const m of fished) {
        const { token, passwordWasReset } = loginOrResetFished(adminToken, m.account, m.userId);
        if (!token) { console.error(`[AccountSeed] [捶老会员] ${m.account}登录失败，跳过`); continue; }
        const rechargeCount = randInt(RECHARGE_COUNT_MIN, RECHARGE_COUNT_MAX);
        const pendingCount = randInt(RECHARGE_PENDING_MIN, RECHARGE_PENDING_MAX);
        operateAccount(adminToken, token, m.userId, m.account, {
            rechargeCount, pendingCount, createdDay: DAY_INDEX, role: 'fished',
            fishedInfo: { fishedOnDay: DAY_INDEX, passwordWasReset }
        });
        sleep(1);
    }
    console.log(`[AccountSeed] [捶老会员] 第${DAY_INDEX}天完成`);
}

/** Scenario: 补前一天的待审核充值+提现订单，随机50%通过(DAY_INDEX===1时不会启用这个scenario) */
export function runBackfillAudit(data) {
    const { adminToken } = data;
    const targetDay = DAY_INDEX - 1;

    const candidates = collectPendingForDay(ALL_RECORDS, targetDay);
    const { toApprove, toLeave } = splitApproveDecision(candidates, BACKFILL_APPROVE_RATE);
    console.log(`[AccountSeed] [补单-充值] 第${targetDay}天的待审核订单共${candidates.length}笔，本次审核通过${toApprove.length}笔，维持不动${toLeave.length}笔`);
    for (const { record, pending } of toApprove) {
        resolvePendingOrder(adminToken, pending, { approve: true });
        pending.resolvedDay = DAY_INDEX;
        emitAcct(record);
        sleep(1);
    }
    for (const { record, pending } of toLeave) {
        resolvePendingOrder(adminToken, pending, { approve: false });
        emitAcct(record);
    }

    // 提现版本(2026-10-27新增，跟充值对称)：没有"维持不动"对应的终态变化，
    // 只是标记决策结果，见 resolvePendingWithdrawOrder 注释。
    const withdrawCandidates = collectPendingWithdrawsForDay(ALL_RECORDS, targetDay);
    const { toApprove: wToApprove, toLeave: wToLeave } = splitApproveDecision(withdrawCandidates, BACKFILL_APPROVE_RATE);
    console.log(`[AccountSeed] [补单-提现] 第${targetDay}天的待审核提现共${withdrawCandidates.length}笔，本次审核通过${wToApprove.length}笔，维持不动${wToLeave.length}笔`);
    for (const { record, pending } of wToApprove) {
        resolvePendingWithdrawOrder(adminToken, pending, { approve: true });
        pending.resolvedDay = DAY_INDEX;
        emitAcct(record);
        sleep(1);
    }
    for (const { record, pending } of wToLeave) {
        resolvePendingWithdrawOrder(adminToken, pending, { approve: false });
        emitAcct(record);
    }

    console.log(`[AccountSeed] [补单] 第${DAY_INDEX}天补单完成`);
}

// ========================= setup / 默认导出 =========================

export function setup() {
    const modeDesc = DAY_INDEX ? `多天系列第${DAY_INDEX}天(新增${NEW_COUNT}+捶老会员${FISH_TARGET})` : `单批次账号数=${ACCOUNT_COUNT}`;
    console.log(`[AccountSeed] ========== 集团充提报表造数 租户=${TENANT_ID} ${modeDesc} ==========`);
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[AccountSeed] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log('[AccountSeed] ✅ 管理员登录成功');

    if (!__ENV.VIA_RUNNER) {
        console.warn(`[AccountSeed] ⚠️ 直接 k6 run 不会写状态文件(沙箱限制)，请用 node accountSeedRunner.js 或 node dailyRunner.js`);
    }

    return { adminToken, envConfig, countryCode: envConfig.COUNTRY_CODE || '91' };
}

export default function (data) {
    if (DAY_INDEX) return; // 模式B走scenario各自的exec，不会触发这里；留着只是防御性保护
    const { adminToken, envConfig, countryCode } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    let usdtCount = 0;
    for (let i = 0; i < ACCOUNT_COUNT; i++) {
        console.log(`[AccountSeed] ===== 第${i + 1}/${ACCOUNT_COUNT}个账号 =====`);
        const record = seedOneAccount(adminToken, countryCode);
        if (record && record.isUsdt) usdtCount++;
        sleep(1);
    }
    console.log(`[AccountSeed] ========== 租户${TENANT_ID}造数完成，共${ACCOUNT_COUNT}个账号，其中USDT账号${usdtCount}个 ==========`);
}
