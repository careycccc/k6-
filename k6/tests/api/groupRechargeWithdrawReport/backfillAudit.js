/**
 * 补单执行 —— 对前一天"故意不审核"的充值订单做审核决策(多天衰减系列专用)
 *
 * 背景：accountSeed.day.js 的新增/捶老会员流程里，部分充值笔数会用
 * {audit:false} 发起但不审核(见 rechargeAssembler.js 的 pollAndAudit 注释)，
 * 让订单约5分钟后自动从Wait转Cancel。第二天运行时，这里负责把前一天这批
 * "挂起"的订单随机挑50%审核通过(变Payed)，另外50%维持Cancel不动——不调用
 * 任何"拒绝"接口，因为Cancel本身就是"未支付"终态，天然符合"不通过"语义。
 *
 * 不需要额外的"待审核队列"持久化文件：每个账号记录(ndjson里的一条)自带
 * pendingRecharges数组，记录了哪些订单是哪天发起、还没做审核决定——直接在
 * 这个数组上扫描、决策、更新decision字段，然后整条记录照常emit回Runner落盘。
 */
import { findOrderByOrderNo, auditOrderNow } from './rechargeAssembler.js';
import { resolvePendingWithdraw } from './withdrawAssembler.js';

/**
 * 从全量账号记录里，收集"targetDay那天产生、还没做过审核决定"的待补单项。
 * @param {Array<object>} allRecords - init阶段读入内存的全量账号记录(ndjson反序列化结果)
 * @param {number} targetDay - 一般传 DAY_INDEX-1(昨天)
 * @returns {Array<{record:object, pending:object}>}
 */
export function collectPendingForDay(allRecords, targetDay) {
    const out = [];
    for (const record of (allRecords || [])) {
        for (const p of (record.pendingRecharges || [])) {
            if (p.createdDay === targetDay && !p.auditDecisionMade) out.push({ record, pending: p });
        }
    }
    return out;
}

/**
 * 提现版本的collectPendingForDay(2026-10-27新增，跟充值对称)——扫描
 * record.pendingWithdraws而不是pendingRecharges，字段结构不同(没有orderNo，
 * 因为提现backfill靠userId+withdrawType+amount重新定位，不靠订单号)。
 */
export function collectPendingWithdrawsForDay(allRecords, targetDay) {
    const out = [];
    for (const record of (allRecords || [])) {
        for (const p of (record.pendingWithdraws || [])) {
            if (p.createdDay === targetDay && !p.auditDecisionMade) out.push({ record, pending: p });
        }
    }
    return out;
}

/**
 * 把候选列表随机切成"审核通过"/"维持不动"两部分(Fisher-Yates洗牌后按比例切片)。
 * @param {Array} candidates
 * @param {number} [approveRate=0.5]
 */
export function splitApproveDecision(candidates, approveRate = 0.5) {
    const arr = candidates.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const approveCount = Math.round(arr.length * approveRate);
    return { toApprove: arr.slice(0, approveCount), toLeave: arr.slice(approveCount) };
}

/**
 * 对单条待补单项做出最终处理：先重新查一次订单当前真实状态(防御性，防止
 * 已经被别的流程处理过)，是Payed就直接标记完成；approve=true则调用审核接口
 * 变Payed；approve=false则什么都不做，只标记"已决策、维持Cancel"。
 *
 * @param {string} adminToken
 * @param {object} pending - record.pendingRecharges 里的一项，会被原地修改
 * @param {{approve:boolean}} opts
 */
export function resolvePendingOrder(adminToken, pending, opts) {
    const current = findOrderByOrderNo(adminToken, pending.userId, pending.orderNo, pending.rechargeType, pending.createTime);
    if (!current) {
        pending.auditDecisionMade = true;
        pending.auditResult = 'order-not-found';
        console.error(`[BackfillAudit] 订单${pending.orderNo}查不到了，标记跳过`);
        return;
    }
    if (current.rechargeState === 'Payed') {
        pending.auditDecisionMade = true;
        pending.auditResult = 'already-payed';
        return;
    }

    if (opts.approve) {
        const ok = auditOrderNow(adminToken, current, pending.amount);
        pending.auditDecisionMade = true;
        pending.auditResult = ok ? 'approved' : 'approve-failed';
        if (ok) console.log(`[BackfillAudit] 订单${pending.orderNo}补单审核通过`);
        else console.error(`[BackfillAudit] 订单${pending.orderNo}补单审核调用失败`);
    } else {
        // 不同意的那一半：维持Cancel/Wait不动，不调用任何"拒绝"接口
        pending.auditDecisionMade = true;
        pending.auditResult = 'left-cancelled';
    }
}

/**
 * 提现版本的resolvePendingOrder(2026-10-27新增，跟充值对称)——没有
 * findOrderByOrderNo这步防御性重查：提现没有按订单号查详情的现成封装，
 * resolvePendingWithdraw内部的approveWithdrawOrder本身就是靠
 * getWithdrawLockPageList按userId+withdrawType+amount查"当前处于Wait状态"
 * 的订单，如果已经被处理过(不在Wait了)，第一步就查不到，自然返回false，
 * 不会误操作。approve=false分支同理没有"拒绝"接口，只标记决策结果。
 *
 * @param {string} adminToken
 * @param {object} pending - record.pendingWithdraws 里的一项，会被原地修改
 * @param {{approve:boolean}} opts
 */
export function resolvePendingWithdrawOrder(adminToken, pending, opts) {
    if (opts.approve) {
        const { approved } = resolvePendingWithdraw(adminToken, pending.userId, pending.withdrawType, pending.amount, true);
        pending.auditDecisionMade = true;
        pending.auditResult = approved ? 'approved' : 'approve-failed';
    } else {
        pending.auditDecisionMade = true;
        pending.auditResult = 'left-wait';
    }
}
