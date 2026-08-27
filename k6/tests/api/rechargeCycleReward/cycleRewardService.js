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
 */

import { sleep } from 'k6';
import { hybridRecharge } from '../recharge/rechargeService.js';

// 基础衰减权重（首档 30%，其后每档 -5%）。实际档数不为 5 时按前 n 个截断并归一化。
const BASE_WEIGHTS = [30, 25, 20, 15, 10, 5];
// 每档中「冲 paid」的默认比例
const DEFAULT_PAID_RATIO = 0.3;
// 单笔最小充值额（避免拆出过小金额被后台拒绝）
const MIN_PER_INSTALLMENT = 100;

// ================= 基础工具 =================

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

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
