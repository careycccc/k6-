/**
 * 商品模式充值服务
 *
 * 背景：部分环境前台已从「经典模式」(/api/Recharge/DepositRecharge) 切到「商品模式」
 *       (/api/Recharge/GoodsDepositRecharge)，经典发起会报 code:11 / msgCode:10049
 *       "Unsupport recharge mode"。商品模式只能充 goodsList 里的固定金额。
 *
 * 本模块负责商品模式的完整充值编排（对经典逻辑零侵入，由 rechargeService 在检测到 10049 时调用）：
 *   1. 拉取商品盘面 goodsList（固定金额 + 支持的充值方式）
 *   2. 用固定面额「组合凑」出调用方要的目标金额（无上限、宁超）
 *   3. 每笔选一个充值方式发起（过滤 arupi / ARPay；某商品无可用方式则该笔走后台兜底）
 *   4. 发起后不看返回（测试环境发起结果无意义），按 userId 查「今天」的三方+本地订单
 *   5. 对未到账订单逐笔补单（actualAmount=订单amount，不筛 Cancel/PendingReview 状态）
 *   6. 只要有订单已到账或补单成功 ≥1 笔，即判该用户充值成功；否则整体走后台兜底
 */

import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';
import { goodsDepositRecharge } from './frontendRechargeApi.js';
import {
    getRechargeOrderPageListFull,
    getLocalRechargeOrderPageList,
    manualAuditRechargeOrder,
    manualAuditLocalRechargeOrder
} from './backendRechargeApi.js';

// 需要跳过的充值方式（不管经典/商品模式都不使用）
const SKIP_RECHARGE_TYPES = ['ArUpi', 'ARPay'];

// ================= 工具 =================

/** 拉取商品盘面（含 goodsList）；内联实现，避免跨大模块的循环依赖 */
function getRechargeBasicInfo(userToken) {
    const resp = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', 'GetRechargeBasicInfo', true, userToken);
    if (!resp) return null;
    return resp.goodsList !== undefined ? resp : (resp.data || null);
}

/** 今天 0 点 ~ 23:59:59.999 的毫秒时间戳 */
function todayRange() {
    const now = new Date();
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { startTime: s.getTime(), endTime: e.getTime() };
}

/** 从各种返回形态里取订单 list */
function extractList(resp) {
    if (!resp) return [];
    if (resp.data && Array.isArray(resp.data.list)) return resp.data.list;
    if (Array.isArray(resp.list)) return resp.list;
    return [];
}

/** goodsList 里去重的可用面额（升序） */
function uniqueAmounts(goodsList) {
    const set = new Set();
    goodsList.forEach(g => {
        const a = Number(g.rechargeAmount);
        if (a > 0) set.add(a);
    });
    return Array.from(set).sort((a, b) => a - b);
}

/**
 * 用固定面额「组合凑」目标金额：贪心取 ≤ 剩余的最大面额；
 * 当剩余不足最小面额时补一个最小面额（宁超勿欠），无上限。
 * @returns {number[]} 面额序列（和 ≈ target，可能略超）
 */
export function composeAmounts(target, amountSet) {
    const desc = [...amountSet].sort((a, b) => b - a);
    const minAmt = amountSet.length ? Math.min(...amountSet) : 0;
    const result = [];
    if (!minAmt || target <= 0) return result;

    let remain = Math.round(target);
    let guard = 0;
    while (remain > 0 && guard++ < 200) {
        const pick = desc.find(a => a <= remain);
        if (pick == null) {
            // 剩余比最小面额还小 → 补一个最小面额（宁超），结束
            result.push(minAmt);
            break;
        }
        result.push(pick);
        remain -= pick;
        if (remain > 0 && remain < minAmt) {
            result.push(minAmt); // 尾差不足一档，补最小面额收尾
            break;
        }
    }
    return result;
}

/** 取某商品过滤 arupi/ARPay 后的第一个充值方式；无可用返回 null */
function pickCategory(goods) {
    const cats = (goods.supportCategories || []).filter(c => !SKIP_RECHARGE_TYPES.includes(c.rechargeType));
    return cats.length ? cats[0] : null;
}

// ================= 订单查询 + 补单 =================

/**
 * 查该用户今天的三方 + 本地订单，对未到账订单逐笔补单。
 * 已到账(Payed)视为已成功、补单成功也计入。
 * @returns {{count:number, amount:number}} 成功(到账或补单成功)的订单数与金额合计
 */
export function auditTodayOrders(adminToken, userId) {
    const tag = 'GoodsAudit';
    const { startTime, endTime } = todayRange();
    let count = 0;
    let amount = 0;

    // ---- 三方订单 ----
    const thirdResp = getRechargeOrderPageListFull(adminToken, { userId, startTime, endTime, pageSize: 100, dateType: 0 });
    const thirdList = extractList(thirdResp);
    console.log(`[${tag}] 今日三方订单 ${thirdList.length} 笔`);
    for (const o of thirdList) {
        if (o.rechargeState === 'Payed') { count++; amount += Number(o.amount) || 0; continue; }
        const ok = manualAuditRechargeOrder(adminToken, o.orderNo, userId, o.createTime, o.amount);
        if (ok) { count++; amount += Number(o.amount) || 0; }
        sleep(0.5);
    }

    // ---- 本地订单 ----
    const localList = getLocalRechargeOrderPageList(adminToken, userId, startTime, endTime) || [];
    console.log(`[${tag}] 今日本地订单 ${localList.length} 笔`);
    for (const o of localList) {
        if (o.rechargeState === 'Payed') { count++; amount += Number(o.amount) || 0; continue; }
        const ok = manualAuditLocalRechargeOrder(adminToken, o.orderNo, userId, o.createTime, o.amount);
        if (ok) { count++; amount += Number(o.amount) || 0; }
        sleep(0.5);
    }

    return { count, amount };
}

// ================= 商品模式充值主流程 =================

/**
 * 商品模式前台充值：组合凑目标额 → 逐笔发起 → 查今天订单补单 → 判定成功。
 * @param {string}   userToken
 * @param {string}   adminToken
 * @param {number}   userId
 * @param {number}   targetAmount
 * @param {Function} backendRechargeFn - 后台兜底函数(adminToken,userId,amount,remark)=>{success,amount,...}
 *                                       由 rechargeService 注入，避免循环依赖
 * @param {object}   [options] - { gapSec }
 * @returns {{success:boolean, amount:number, method:string, message:string}}
 */
export function goodsFrontendRecharge(userToken, adminToken, userId, targetAmount, backendRechargeFn, options = {}) {
    const tag = 'GoodsRecharge';
    const gapSec = options.gapSec != null ? options.gapSec : 1.5;

    // 1. 盘面
    const basic = getRechargeBasicInfo(userToken);
    const goodsList = basic && Array.isArray(basic.goodsList) ? basic.goodsList : [];
    if (!goodsList.length) {
        console.warn(`[${tag}] 无商品盘面，改走后台兜底 ${targetAmount}`);
        return backendRechargeFn(adminToken, userId, targetAmount, 'GoodsFallback-NoGoods');
    }

    // 2. 组合凑
    const amountSet = uniqueAmounts(goodsList);
    const amounts = composeAmounts(targetAmount, amountSet);
    console.log(`[${tag}] userId=${userId} 目标 ${targetAmount} → 组合 ${JSON.stringify(amounts)}（面额集 ${JSON.stringify(amountSet)}）`);

    if (!amounts.length) {
        console.warn(`[${tag}] 无法组合出金额，改走后台兜底 ${targetAmount}`);
        return backendRechargeFn(adminToken, userId, targetAmount, 'GoodsFallback-NoCompose');
    }

    // 3. 逐笔发起（某商品无可用充值方式 → 该笔走后台）
    for (const amt of amounts) {
        const goods = goodsList.find(g => Number(g.rechargeAmount) === amt);
        if (!goods) {
            backendRechargeFn(adminToken, userId, amt, 'GoodsFallback-NoGoodsId');
            sleep(gapSec);
            continue;
        }
        const cat = pickCategory(goods);
        if (!cat) {
            console.log(`[${tag}] 商品 ${amt} 无可用充值方式(仅 arupi/ARPay)，该笔走后台`);
            backendRechargeFn(adminToken, userId, amt, 'GoodsFallback-NoCategory');
            sleep(gapSec);
            continue;
        }
        goodsDepositRecharge(userToken, goods.id, cat.id);
        console.log(`[${tag}] 发起商品充值 amt=${amt} goodsId=${goods.id} catId=${cat.id}(${cat.rechargeType})`);
        sleep(gapSec);
    }

    // 4. 查今天订单 + 补单
    sleep(2);
    const audited = auditTodayOrders(adminToken, userId);

    if (audited.count > 0) {
        console.log(`[${tag}] ✅ userId=${userId} 商品充值成功：到账/补单 ${audited.count} 笔，合计 ${audited.amount}`);
        return { success: true, amount: audited.amount, method: 'goods', message: `到账/补单 ${audited.count} 笔` };
    }

    // 5. 一笔都没成 → 后台兜底
    console.warn(`[${tag}] userId=${userId} 无可补订单，改走后台兜底 ${targetAmount}`);
    return backendRechargeFn(adminToken, userId, targetAmount, 'GoodsFallback-NoOrder');
}
