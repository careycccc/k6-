/**
 * 充值循环奖励活动 —— 核心业务逻辑（纯算法 + 复用充值）
 *
 * ⚠️ 仅新增文件，不改动任何已有代码。
 *
 * 职责：
 *   1. 档位人数分配（首档 30%，其后依次衰减，凑满 100%）
 *   2. 每人目标额决策（B 方案：部分人只冲 free 区间，部分人冲 paidRechargeRequire）
 *   3. 目标额拆成 1-4 笔充值；冲 paid 者保证有一笔 ≥ require（单笔/累计两种开关模式通吃）
 *   4. 森林分层人数（参照多线程邀请森林逻辑，重写，不 import 旧脚本）
 *   5. rechargeToTarget：按拆好的每笔金额逐笔调用 hybridRecharge
 *   6. 读奖励记录表造数用：assignDailyRoles 每日分组 / buildTierSequence 明天档位 / planDailyRecharge 当日充值金额
 *      （1~3 的 buildRechargePlans 老逻辑仍供 cycleRewardByTeam.js 使用）
 */

import { sleep } from 'k6';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { randInt } from '../../../libs/common/index.js';

// 基础衰减权重（首档 30%，其后每档 -5%）。实际档数不为 5 时按前 n 个截断并归一化。
const BASE_WEIGHTS = [30, 25, 20, 15, 10, 5];
// 每档中「冲 paid」的默认比例
const DEFAULT_PAID_RATIO = 0.3;
// 单笔最小充值额（避免拆出过小金额被后台拒绝）
const MIN_PER_INSTALLMENT = 100;

// ================= 基础工具 =================


/** Fisher-Yates 洗牌（原地） */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

/** 从池中随机取一个 */
export function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ================= 档位人数分配 =================

/**
 * 计算每个档位分到的人数：首档权重最高，依次衰减，总和 = userCount。
 * 当 userCount >= 档数时，尽量保证每档至少 1 人。
 * @param {number} userCount
 * @param {number} tierCount
 * @returns {number[]} 长度 = tierCount，和 = userCount
 */
export function computeTierCounts(userCount, tierCount) {
    if (userCount <= 0 || tierCount <= 0) return [];
    const weights = [];
    for (let i = 0; i < tierCount; i++) {
        weights.push(i < BASE_WEIGHTS.length ? BASE_WEIGHTS[i] : 1);
    }
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    const counts = weights.map(w => Math.floor((w / totalWeight) * userCount));

    // 若人数够，先保证每档至少 1
    if (userCount >= tierCount) {
        for (let i = 0; i < tierCount; i++) if (counts[i] === 0) counts[i] = 1;
    }

    // 修正总数：多退少补（补给权重高的前档，减从权重低的后档）
    let diff = userCount - counts.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < tierCount && diff > 0; i++) { counts[i]++; diff--; } }
    while (diff < 0) { for (let i = tierCount - 1; i >= 0 && diff < 0; i--) { if (counts[i] > 0) { counts[i]--; diff++; } } }

    return counts;
}

// ================= 目标额 & 拆笔 =================

/**
 * 把目标额拆成 1-4 笔充值金额（整数）。
 * @param {number} target        - 目标累计额
 * @param {boolean} mustHitSingle - 是否必须有一笔 >= requireAmount（冲 paid 时）
 * @param {number} requireAmount  - 付费要求金额（mustHitSingle 时使用）
 * @returns {number[]} 每笔金额，和 >= target（冲 paid 时可能因补足 require 而略大于原 target）
 */
export function splitInstallments(target, mustHitSingle, requireAmount) {
    target = Math.round(target);

    if (mustHitSingle) {
        // 冲 paid：先放一笔 = require（保证单笔达标），再随机追加 0-2 笔小额（保证累计也达标）
        const installments = [Math.round(requireAmount)];
        const extra = randInt(0, 2);
        for (let i = 0; i < extra; i++) installments.push(randInt(MIN_PER_INSTALLMENT, 500));
        return installments;
    }

    // 只冲 free：把 target 拆成 parts 笔，每笔 >= MIN_PER_INSTALLMENT，和 = target
    const maxParts = Math.max(1, Math.min(4, Math.floor(target / MIN_PER_INSTALLMENT)));
    const parts = randInt(1, maxParts);
    if (parts <= 1) return [target];

    const arr = new Array(parts).fill(MIN_PER_INSTALLMENT);
    let remain = target - parts * MIN_PER_INSTALLMENT; // >= 0（因 maxParts 已保证）
    for (let k = 0; k < parts - 1; k++) {
        const add = randInt(0, remain);
        arr[k] += add;
        remain -= add;
    }
    arr[parts - 1] += remain;
    return arr.map(x => Math.round(x));
}

/**
 * 为一个人决策其充值计划（目标档位 + 是否冲 paid + 每笔金额）。
 * @param {object} tier  - 档位配置对象
 * @param {boolean} isPaid - 是否冲付费奖励
 * @returns {{tier:object, isPaid:boolean, target:number, installments:number[]}}
 */
export function decidePlan(tier, isPaid) {
    const min = Number(tier.minAmount);
    const max = Number(tier.maxAmount);
    const require = Number(tier.paidRechargeRequire);

    // 只产出「目标累计额」；拆成几笔由充值层决定：
    //   商品模式 → goodsRechargeService 用固定面额组合凑（宁超）
    //   经典模式 → 单笔充值
    if (isPaid) {
        return { tier, isPaid: true, target: require };                       // 冲 paid：目标=付费要求
    }
    return { tier, isPaid: false, target: randInt(Math.round(min), Math.round(max)) }; // 只 free：落区间
}

/**
 * 为 userCount 个人生成完整充值计划数组（已打乱顺序）。
 * 每档按 computeTierCounts 分人；每档内约 paidRatio 比例冲 paid，
 * 且在人数允许时保证每档「至少 1 人冲 paid、至少 1 人只 free」。
 * @param {number} userCount
 * @param {Array<object>} tiers
 * @param {object} [opts] - { paidRatio }
 * @returns {Array<{tier, isPaid, target, installments}>} 长度 = userCount
 */
export function buildRechargePlans(userCount, tiers, opts = {}) {
    const paidRatio = opts.paidRatio != null ? opts.paidRatio : DEFAULT_PAID_RATIO;
    const counts = computeTierCounts(userCount, tiers.length);
    const plans = [];

    for (let i = 0; i < tiers.length; i++) {
        const count = counts[i];
        if (count <= 0) continue;

        // 该档冲 paid 的人数：至少 1，且在 count>=2 时至少留 1 人只 free
        let paidNum = Math.round(count * paidRatio);
        if (paidNum < 1) paidNum = 1;
        if (count >= 2 && paidNum > count - 1) paidNum = count - 1;
        if (count === 1) paidNum = randInt(0, 1); // 单人档随机冲或不冲

        for (let k = 0; k < count; k++) {
            plans.push(decidePlan(tiers[i], k < paidNum));
        }
    }

    return shuffle(plans);
}

// ================= 每日人群分组 + 当日充值规划（读奖励记录表的造数逻辑） =================

/** 随机取 k 个（不改原数组） */
export function sampleK(arr, k) {
    return shuffle(arr.slice()).slice(0, Math.max(0, Math.min(k, arr.length)));
}

/**
 * 给今天有奖励资格的人分组，各比例都按「全部人数」四舍五入成人数：
 *   role      noLogin(完全不登录) / loginOnly(登录不充值) / recharge(登录且充值)
 *   claimFree 领免费：从已登录的人里抽
 *   isPayer   冲付费：从充值的人里抽
 *   claimPaid 领付费：从冲付费的人里抽（比例相对冲付费人数）
 * @param {Array<object>} members
 * @param {{noLogin:number, loginOnly:number, freeClaim:number, paid:number, paidClaim:number}} r
 * @returns {Array<object>} 新对象数组（已打乱），在原字段上追加 role/claimFree/isPayer/claimPaid
 */
export function assignDailyRoles(members, r) {
    const n = members.length;
    const noLoginN = Math.min(n, Math.round(n * r.noLogin));
    const loginOnlyN = Math.min(n - noLoginN, Math.round(n * r.loginOnly));
    const out = shuffle(members.slice()).map((m, i) => ({
        ...m,
        role: i < noLoginN ? 'noLogin' : (i < noLoginN + loginOnlyN ? 'loginOnly' : 'recharge'),
        claimFree: false, isPayer: false, claimPaid: false
    }));
    sampleK(out.filter(m => m.role !== 'noLogin'), Math.round(n * r.freeClaim)).forEach(m => { m.claimFree = true; });
    const payers = sampleK(out.filter(m => m.role === 'recharge'), Math.round(n * r.paid));
    payers.forEach(m => { m.isPayer = true; });
    sampleK(payers, Math.round(payers.length * r.paidClaim)).forEach(m => { m.claimPaid = true; });
    return out;
}

/** 按首档 30% 起衰减的权重给 count 人各分一个「明天的目标档位」（已打乱）；每人每天重新分，故每天档位不同 */
export function buildTierSequence(count, tiers) {
    const seq = [];
    computeTierCounts(count, tiers.length).forEach((c, i) => { for (let k = 0; k < c; k++) seq.push(tiers[i]); });
    return shuffle(seq);
}

/**
 * 规划某人今天这次充多少。今天的充值同时决定两件事：
 *   ① 今天的付费奖励是否满足（要求/累计或单笔 取今天奖励记录上的 paidRechargeRequire / paidUseCumulative）
 *   ② 明天落在哪个档位（今天全部成功充值之和 ∈ [minAmount, maxAmount]；超过最高档上限也按最高档给）
 * 冲付费：本次金额 ≥ 还差的付费要求；不冲付费：保证今天不满足付费。
 * 先试按权重分到的计划档位，装不下就改落离它最近、能装下的档位；都装不下就照付费逻辑充，明天无资格。
 * （最高档没有上限，所以冲付费总能落进最高档；明天无资格只剩「不冲付费且金额落不进任何档位」的情况）
 *
 * @param {object} p
 * @param {Array}  p.tiers           档位配置
 * @param {object} p.plannedTier     计划的明天档位
 * @param {object|null} p.record     今天的奖励记录（新注册的人为 null）
 * @param {boolean} p.isPayer        是否冲付费
 * @param {number} [p.existingToday] 今天已有成功充值（重复跑 / 别人充的）
 * @param {number} [p.progressToday] 今天资格生成后已有充值之和（累计模式的已有进度）
 * @param {number} [p.maxSingleToday] 今天资格生成后已有的最大单笔
 * @param {number} [p.step]          金额步长（商品面额最小步长，默认 100）
 * @returns {{amount:number, tier:object|null, note:string}}  amount=0 表示这次不充
 */
export function planDailyRecharge(p) {
    const step = p.step || MIN_PER_INSTALLMENT;
    const existing = p.existingToday || 0;
    const rec = p.record;
    const require = rec ? Number(rec.paidRechargeRequire) || 0 : 0;
    const cumulative = rec ? Number(rec.paidUseCumulative) === 1 : false;
    // 冲付费还差多少（单笔模式：已有一笔达标则不差，否则本次整笔要 ≥ require）
    const need = !rec ? 0 : (cumulative ? require - (p.progressToday || 0) : ((p.maxSingleToday || 0) >= require ? 0 : require));
    // 不冲付费最多能充多少（保证今天不满足）
    const cap = !rec ? Infinity : (cumulative ? require - (p.progressToday || 0) - 1 : require - 1);

    // 档位按金额区间比较，不能用 ===：k6 setup 传进来的对象每次取出来都是新引用
    const tierKey = t => `${Number(t.minAmount)}-${Number(t.maxAmount)}`;
    const isPlanned = t => tierKey(t) === tierKey(p.plannedTier);
    // 最高档：前一天充值超过它的上限，第二天也按最高档给 → 最高档没有上限
    const top = p.tiers.reduce((a, t) => (Number(t.minAmount) > Number(a.minAmount) ? t : a), p.tiers[0]);
    const isTop = t => tierKey(t) === tierKey(top);
    if (existing >= Number(top.minAmount) && (!rec || !p.isPayer || need <= 0)) {
        return { amount: 0, tier: top, note: '今天已有充值已达最高档（超过上限也按最高档），本次不充' };
    }

    const rangeFor = (tier) => {
        let lo = Number(tier.minAmount) - existing;
        if (rec && p.isPayer) lo = Math.max(lo, need);
        lo = Math.max(lo, step);
        // 最高档上限放开到「至少能充到 lo」，冲付费金额再大也落在最高档
        let hi = isTop(tier) ? Math.max(Number(tier.maxAmount) - existing, Math.ceil(lo / step) * step) : Number(tier.maxAmount) - existing;
        if (rec && !p.isPayer) hi = Math.min(hi, cap);
        return { lo, hi };
    };
    // 区间内随机取 step 的整数倍；取不到返回 null
    const pick = ({ lo, hi }) => {
        const a = Math.ceil(lo / step) * step;
        const b = Math.floor(hi / step) * step;
        return a <= b ? a + randInt(0, (b - a) / step) * step : null;
    };
    const tierStr = t => `[${t.minAmount}-${t.maxAmount}]`;

    const planned = pick(rangeFor(p.plannedTier));
    if (planned !== null) return { amount: planned, tier: p.plannedTier, note: '' };

    // 改落离计划档位最近、且装得下的档位（同距离随机），尽量保持档位分布
    const indexOfTier = t => p.tiers.findIndex(x => tierKey(x) === tierKey(t));
    const idx = indexOfTier(p.plannedTier);
    const dist = t => Math.abs(indexOfTier(t) - idx);
    const alt = shuffle(p.tiers.filter(t => !isPlanned(t)))
        .sort((a, b) => dist(a) - dist(b))
        .map(t => ({ t, amt: pick(rangeFor(t)) }))
        .find(x => x.amt !== null);
    if (alt) return { amount: alt.amt, tier: alt.t, note: `计划档位${tierStr(p.plannedTier)}装不下，改落最近的${tierStr(alt.t)}` };

    if (rec && p.isPayer && need <= 0) {
        return { amount: 0, tier: null, note: '今天已满足付费，且已有充值超出所有档位，本次不充' };
    }
    if (rec && p.isPayer) {
        const amt = Math.max(step, Math.ceil(need / step) * step);
        return { amount: amt, tier: null, note: `付费要求 ${require} 超出所有档位可落范围：充 ${amt} 满足付费，明天无奖励资格` };
    }
    if (rec && !p.isPayer && cap >= step) {
        const amt = Math.floor(cap / step) * step;
        return { amount: amt, tier: null, note: `不满足付费的金额落不进任何档位：充 ${amt}，明天无奖励资格` };
    }
    return { amount: 0, tier: null, note: '今天已有充值已超出所有档位，本次不充' };
}

// ================= 森林分层 =================

/**
 * 把 totalPeople 人分配到 levels 层（第 0 层最多，向下递减）。
 * 参照多线程邀请森林逻辑重写，保证每层至少 1 人（人数足够时）。
 * @param {number} totalPeople
 * @param {number} levels
 * @returns {number[]} 各层人数，和 = totalPeople
 */
export function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }

    const weights = [];
    for (let i = 0; i < levels; i++) weights.push(((levels - i) / levels) * (0.5 + Math.random()));
    weights.sort((a, b) => b - a);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));

    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

// ================= 充值执行 =================

/**
 * 把「目标累计额」交给充值层充值。调一次 hybridRecharge：
 *   - 商品模式：内部用固定面额组合凑成多笔 + 查今天订单补单
 *   - 经典模式：单笔充值
 * @param {object} p
 * @param {string} p.adminToken
 * @param {string} p.userToken
 * @param {number} p.userId
 * @param {number} p.amount   - 目标累计额
 * @param {string} [p.remark]
 * @returns {{successCount:number, totalAmount:number, totalInstallments:number}}
 */
export function rechargeToTarget(p) {
    const { adminToken, userToken, userId, amount, remark = 'CycleReward' } = p;

    const r = hybridRecharge({ userToken, adminToken, userId, amount, frontendFirst: true, remark });

    if (r && r.success) {
        return { successCount: 1, totalAmount: r.amount, totalInstallments: 1 };
    }
    console.error(`[CycleReward] 用户 ${userId} 充值失败 target=${amount}`);
    return { successCount: 0, totalAmount: 0, totalInstallments: 1 };
}
