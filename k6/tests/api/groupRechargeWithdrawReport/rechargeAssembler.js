/**
 * 充值组装器 —— 支持精确控制"是否走USDT渠道"的充值封装
 *
 * 背景：项目现成的 hybridRecharge/frontendRecharge(recharge/rechargeService.js)
 * 不支持强制指定渠道类型，而且遍历到 LocalUSDT 分支时会把金额强制覆盖成
 * 随机50-300，完全无视调用方指定的目标金额——不能直接拿来给"USDT账号"或
 * "非USDT账号"用，否则 30%/70% 的比例会被静默破坏。
 *
 * 这里照抄 frontendRecharge 内部已验证过能跑通的两条路径(经典直充的
 * LocalUSDT/LocalEWallet/LocalBankCard/三方通道分支、goodsFrontendRecharge
 * 的商品模式分支)，只是把"自动遍历、金额不可控"换成"调用方传 typeFilter
 * 精确筛选候选分类、金额自己定"。商品模式下不做 composeAmounts 那套"凑单
 * 到精确总额"，直接选一个"面额接近目标值 + 支持目标渠道类型"的单一商品
 * 充值——金额精度让位给"渠道类型精确可控"这个更重要的目标，这次造数任务
 * 不要求充值金额严丝合缝，只要求账号的 USDT/非USDT 身份不被污染。
 */

import { sleep } from 'k6';
import {
    getRechargeCategoryList, depositRecharge, submitCertificate,
    generateRandomAccountNo, generateRandomHolderName, generateUsdtTransactionId,
    goodsDepositRecharge
} from '../recharge/frontendRechargeApi.js';
import {
    getLocalRechargeOrderPageList, manualAuditLocalRechargeOrder,
    getRechargeOrderPageList, manualAuditRechargeOrder
} from '../recharge/backendRechargeApi.js';
import { getRechargeBasicInfo } from '../recharge/rechargeLevel.service.js';

const SKIP_RECHARGE_TYPES = ['ArUpi', 'ARPay']; // 和 goodsRechargeService.js 保持一致，这两类商品/经典模式都不可用

// "本地充值"类型清单，查订单/审核都要走Local专用接口(GetLocalRechargeOrderPageList
// /ManualAuditLocalRechargeOrder)，走错("三方")接口会查不到订单、永远审核
// (业务上叫"上分")不了。2026-10-26用户实测抓包指出：LocalBankQR漏在这个清单
// 外——之前这3处判断各自内联重复写了一遍，漏了一个类型就3处全错，这次改成
// 单一清单+共享函数，以后再发现新Local类型只需要改这一处。
const LOCAL_RECHARGE_TYPES = ['LocalUSDT', 'LocalEWallet', 'LocalBankCard', 'LocalBankQR'];
function isLocalRechargeType(rechargeType) {
    return LOCAL_RECHARGE_TYPES.includes(rechargeType);
}

// 跨多账号复用："一旦在本进程里确认过是商品模式商户，后续账号不用再浪费一轮
// 经典直充去试错"——照抄 rechargeService.js 的 useGoodsMode 同款优化思路。
let goodsModeConfirmed = false;

/** 经典直充一笔，走完整的凭证提交+后台审核流程(照抄 frontendRecharge 对应分支) */
function rechargeClassicOnce(userToken, adminToken, userId, category, amount, opts) {
    const rechargeType = category.rechargeType;
    const payload = { rechargeCategoryId: category.id, amount, rechargeType };

    if (rechargeType === 'LocalEWallet') {
        payload.customerInfo = { accountNo: '467687777878978', holderName: 'tester' };
    } else if (rechargeType === 'LocalBankCard') {
        payload.customerInfo = { accountNo: generateRandomAccountNo(), holderName: generateRandomHolderName() };
    }

    // msgCode=13(频率限制)/41(系统繁忙)都是临时性、建议重试的错误，退避重试
    // 同一个候选，不要立即放弃换下一个——2026-10-26在3006商户实测到过：经典模式
    // 候选本来就少(很多商户只有1-2个)，遇到临时性错误就放弃，很容易把仅有的
    // 候选全部"用临时错误耗尽"，兜底转商品模式时若该商户恰好没有商品盘面
    // (goodsList为空)，账号就彻底充值失败——和 rechargeGoodsOnce 对msgCode=13
    // 的处理是同一类问题，这里补上经典模式这条路径的重试。
    let response = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        response = depositRecharge(userToken, payload);
        if (!response || (response.msgCode !== 13 && response.msgCode !== 41)) break;
        const waitSec = attempt * 3;
        console.warn(`[RechargeAssembler] ${rechargeType}充值msgCode=${response.msgCode}(临时性错误)，${waitSec}s后重试(${attempt}/3)`);
        sleep(waitSec);
    }
    if (!response) return { success: false, reason: '充值请求无响应' };
    if (response.msgCode === 10049) return { success: false, reason: 'GOODS_MODE', msgCode: 10049 };

    const isApiSuccess = (response.code === 0 || response.msg === 'Sorry, The system is busy, please try again later! code: 10003');
    if (!isApiSuccess) return { success: false, reason: `code=${response.code} msgCode=${response.msgCode} msg=${response.msg}` };

    const rechargeRequestTime = Date.now();
    const orderNo = response.data && response.data.orderNo;
    const orderCreateTime = response.data && response.data.createTime;
    if (!orderNo || !orderCreateTime) return { success: false, reason: '响应缺少orderNo/createTime' };

    if (rechargeType === 'LocalUSDT') {
        sleep(1);
        const cert = submitCertificate(userToken, orderNo, orderCreateTime, generateUsdtTransactionId(), 1);
        if (!cert || (cert.code !== 0 && cert.msgCode !== 0)) return { success: false, reason: 'USDT凭证提交失败' };
    } else if (rechargeType === 'LocalEWallet') {
        sleep(1);
        const cert = submitCertificate(userToken, orderNo, orderCreateTime, '', 2);
        if (!cert || (cert.code !== 0 && cert.msgCode !== 0)) return { success: false, reason: 'EWallet凭证提交失败' };
    } else if (rechargeType === 'LocalBankCard' || rechargeType === 'LocalBankQR') {
        // LocalBankQR 没有被任何现成代码(包括rechargeService.js的frontendRecharge)
        // 处理过，2026-10-26从用户抓包的真实订单customerInfoDto.transactionId格式
        // (纯数字/数字字母混合)判断和LocalBankCard一样，复用同款凭证提交方式——
        // 这是防御性兜底，还没有实测验证经典模式真的会选中这个类型。
        sleep(1);
        let txId = '';
        for (let i = 0; i < 12; i++) txId += Math.floor(Math.random() * 10);
        const cert = submitCertificate(userToken, orderNo, orderCreateTime, txId, 1);
        if (!cert || (cert.code !== 0 && cert.msgCode !== 0)) return { success: false, reason: `${rechargeType}凭证提交失败` };
    }

    return pollAndAudit(adminToken, userId, rechargeType, amount, rechargeRequestTime, orderNo, opts);
}

/**
 * 轮询查订单+后台审核，Local三类(含USDT)走本地订单接口，其余走三方订单接口。
 *
 * @param {{audit?:boolean}} [opts] - audit默认true(原有行为：找到订单就审核通过)。
 *   传 audit:false 时，只要查到订单(不管Wait/PendingReview什么中间状态)就立刻
 *   返回 {success:true, pending:true, ...}，不调用审核接口、不等待状态变化——
 *   这是"多天衰减系列"故意构造"创建时间和成功时间跨天"订单的核心机制：订单发起后
 *   约5分钟会自动从Wait转Cancel(仍算未支付)，但Cancel状态依然可以在第二天被
 *   manualAuditXXX补单变成Payed(2026-10-26实测确认，见seedConfig.js多天衰减系列注释)。
 */
function pollAndAudit(adminToken, userId, rechargeType, amount, rechargeRequestTime, expectOrderNo, opts) {
    const audit = !opts || opts.audit !== false;
    const isLocal = isLocalRechargeType(rechargeType);
    for (let retry = 0; retry < 5; retry++) {
        if (retry > 0) console.log(`[RechargeAssembler] 第${retry}次重试后台审核...`);
        sleep(3);
        const orders = isLocal
            ? (getLocalRechargeOrderPageList(adminToken, userId, rechargeRequestTime - 60000, Date.now() + 60000) || [])
            : (getRechargeOrderPageList(adminToken, userId, 'ThirdRecharge') || []);
        orders.sort((a, b) => b.createTime - a.createTime);
        const target = orders.find(o => (expectOrderNo ? o.orderNo === expectOrderNo : o.amount === amount) && o.createTime >= (rechargeRequestTime - 120000));
        if (target) {
            if (target.rechargeState === 'Payed') return { success: true, orderNo: target.orderNo, rechargeType, amount, createTime: target.createTime };
            if (!audit) {
                console.log(`[RechargeAssembler] 订单${target.orderNo}已发起(状态=${target.rechargeState})，故意不审核，留给明天补单`);
                return { success: true, pending: true, orderNo: target.orderNo, rechargeType, amount, createTime: target.createTime };
            }
            const ok = isLocal
                ? manualAuditLocalRechargeOrder(adminToken, target.orderNo, userId, target.createTime, amount)
                : manualAuditRechargeOrder(adminToken, target.orderNo, userId, target.createTime, amount);
            if (ok) return { success: true, orderNo: target.orderNo, rechargeType, amount, createTime: target.createTime };
        }
    }
    return { success: false, reason: '后台审核失败或订单未匹配到' };
}

/** 商品模式：选一个"面额接近目标值 + 支持目标渠道类型"的商品直接充值 */
function rechargeGoodsOnce(userToken, adminToken, userId, targetAmount, typeFilter, opts) {
    const basic = getRechargeBasicInfo(userToken);
    const goodsList = basic && Array.isArray(basic.goodsList) ? basic.goodsList : [];
    if (!goodsList.length) return { success: false, reason: '无商品盘面' };

    const sorted = [...goodsList].sort((a, b) => Math.abs(a.rechargeAmount - targetAmount) - Math.abs(b.rechargeAmount - targetAmount));

    for (const goods of sorted) {
        const cats = (goods.supportCategories || []).filter(c => !SKIP_RECHARGE_TYPES.includes(c.rechargeType) && typeFilter(c.rechargeType));
        if (!cats.length) continue;
        const cat = cats[0];
        const amount = Number(goods.rechargeAmount);

        // msgCode=13(频率限制)要退避重试同一个商品，不能立刻换下一个——
        // 2026-10-26实测发现：同一账号连续对多个商品发起同一渠道(比如USDT)
        // 的充值请求，几乎必然触发后端频率限制；如果遇到13就立刻换下一个
        // 商品(没有任何sleep)，会连续撞限、把候选商品全部"用频率限制的
        // 方式"耗尽，导致USDT充值几乎必然失败——这是在加上"检查发起请求
        // 返回值"这个优化之后才暴露的副作用(之前没检查返回值时，代码会
        // 无意中进入5次x3秒的轮询，顺便起到了冷却效果)。
        let depositResp = null;
        let rechargeRequestTime = Date.now();
        for (let attempt = 1; attempt <= 3; attempt++) {
            rechargeRequestTime = Date.now();
            depositResp = goodsDepositRecharge(userToken, goods.id, cat.id);
            if (!depositResp || depositResp.msgCode !== 13) break;
            const waitSec = attempt * 3;
            console.warn(`[RechargeAssembler] 商品${amount}(${cat.rechargeType})msgCode=13频率限制，${waitSec}s后重试(${attempt}/3)`);
            sleep(waitSec);
        }
        if (!depositResp || (depositResp.code !== 0 && depositResp.msgCode !== 0)) {
            console.warn(`[RechargeAssembler] 商品${amount}(${cat.rechargeType})发起请求本身就失败: ${JSON.stringify(depositResp)}，换下一个商品(不浪费时间轮询)`);
            continue;
        }
        console.log(`[RechargeAssembler] 商品充值 amt=${amount} goodsId=${goods.id} catId=${cat.id}(${cat.rechargeType})`);

        const result = pollAndAudit(adminToken, userId, cat.rechargeType, amount, rechargeRequestTime, null, opts);
        if (result.success) return result;
        console.warn(`[RechargeAssembler] 商品${amount}(${cat.rechargeType})审核未完成: ${result.reason}，换下一个商品`);
    }
    return { success: false, reason: '所有候选商品均未能完成审核' };
}

/**
 * @param {string} userToken
 * @param {string} adminToken
 * @param {number} userId
 * @param {number} targetAmount
 * @param {(rechargeType: string) => boolean} typeFilter - true=接受这个分类
 * @param {{audit?:boolean}} [opts] - 透传给 pollAndAudit，见其注释
 * @returns {{success:boolean, pending?:boolean, orderNo?:string, rechargeType?:string, amount?:number, createTime?:number, reason?:string}}
 */
function rechargeWithTypeFilter(userToken, adminToken, userId, targetAmount, typeFilter, opts) {
    if (goodsModeConfirmed) {
        return rechargeGoodsOnce(userToken, adminToken, userId, targetAmount, typeFilter, opts);
    }

    const categories = getRechargeCategoryList(userToken);
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
        return { success: false, reason: '充值分类列表为空' };
    }
    const candidates = categories.filter(c => !SKIP_RECHARGE_TYPES.includes(c.rechargeType) && typeFilter(c.rechargeType));
    if (!candidates.length) {
        return { success: false, reason: '按类型过滤后没有候选分类(该商户可能不支持这个渠道类型)' };
    }
    candidates.sort((a, b) => {
        if (a.rechargeType === 'LocalEWallet' && b.rechargeType !== 'LocalEWallet') return 1;
        if (a.rechargeType !== 'LocalEWallet' && b.rechargeType === 'LocalEWallet') return -1;
        return 0;
    });

    for (let i = 0; i < candidates.length; i++) {
        if (i > 0) sleep(2);
        const category = candidates[i];
        const minAmt = category.minAmount || 100;
        const maxAmt = category.maxAmount || 100000;
        const amount = Math.max(minAmt, Math.min(targetAmount, maxAmt));

        const result = rechargeClassicOnce(userToken, adminToken, userId, category, amount, opts);
        if (result.success) return result;
        if (result.reason === 'GOODS_MODE') {
            goodsModeConfirmed = true;
            console.warn('[RechargeAssembler] 检测到商品模式(msgCode 10049)，本进程后续账号直接走商品模式');
            return rechargeGoodsOnce(userToken, adminToken, userId, targetAmount, typeFilter, opts);
        }
        console.warn(`[RechargeAssembler] 候选${category.name}(${category.rechargeType})失败: ${result.reason}，换下一个`);
    }

    // 兜底：经典模式全部候选都失败了，不代表商户真的充不进去钱——可能是
    // rechargeClassicOnce 没处理好这个渠道类型(比如裸BankCard/EWallet不带
    // Local前缀，缺customerInfo直接被后端拒绝，2026-10-26在3003/3007商户上
    // 实测到过)，也可能是经典分类列表本身就是摆设、真实只走商品模式但没有
    // 报10049这种能被已有降级逻辑识别的信号。商品模式走的是另一个API
    // (goodsDepositRecharge)，不依赖customerInfo，试一次成本很低，万一能跑
    // 通就不用白白浪费这个账号。
    console.warn('[RechargeAssembler] 经典模式所有候选均失败，兜底尝试商品模式...');
    const goodsResult = rechargeGoodsOnce(userToken, adminToken, userId, targetAmount, typeFilter, opts);
    if (goodsResult.success) {
        goodsModeConfirmed = true;
        console.warn('[RechargeAssembler] 商品模式兜底成功，本进程后续账号直接走商品模式');
    }
    return goodsResult;
}

/**
 * 强制走USDT充值，自己控制金额(不像 hybridRecharge 那样被内部覆盖成50-300随机)
 * @param {{audit?:boolean}} [opts] - 传 {audit:false} 故意不审核，留给明天补单(多天衰减系列用)
 */
export function assembleUsdtRecharge(userToken, adminToken, userId, targetAmount, opts) {
    return rechargeWithTypeFilter(userToken, adminToken, userId, targetAmount, t => t === 'LocalUSDT' || t === 'USDT', opts);
}

/**
 * 强制不走USDT充值(排除LocalUSDT/USDT)，供"非USDT账号"使用，避免被意外污染破坏30/70比例
 * @param {{audit?:boolean}} [opts] - 传 {audit:false} 故意不审核，留给明天补单(多天衰减系列用)
 */
export function assembleFiatRechargeNoUsdt(userToken, adminToken, userId, targetAmount, opts) {
    return rechargeWithTypeFilter(userToken, adminToken, userId, targetAmount, t => t !== 'LocalUSDT' && t !== 'USDT', opts);
}

function hasUsdtType(categories) {
    return (categories || []).some(c => c.rechargeType === 'USDT' || c.rechargeType === 'LocalUSDT');
}

/**
 * 探测该商户是否支持USDT充值。2026-10-26 用户指出不是所有商户都支持USDT，
 * 之前"30%账号随机isUsdt=true"没检查过商户支持性——如果商户不支持，
 * assembleUsdtRecharge 内部按类型过滤出的候选列表会是空的，直接充值失败，
 * 这个账号后续投注/提现全部做不了，白白浪费一个账号额度。
 *
 * 经典模式和商品模式各查一路、取OR，不能只信一路：商品模式下USDT支持性是
 * 按"商品"(金额档位)各自配置supportCategories的，不是商户级别统一开关
 * (实测同一商户有的档位支持USDT有的不支持)，必须遍历全部商品、任一档位
 * 支持就算支持；而 getRechargeCategoryList 在商品模式商户身上也会返回一份
 * "看起来正常"的分类列表(真正发起充值才会报10049)，不能单靠它一家判断
 * "当前到底是哪种模式"，所以两路都查，不互相替代。
 */
export function detectUsdtRechargeSupport(userToken) {
    const categories = getRechargeCategoryList(userToken);
    const classicList = Array.isArray(categories) ? categories : [];
    if (hasUsdtType(classicList)) return true;

    const basic = getRechargeBasicInfo(userToken);
    const goodsList = (basic && Array.isArray(basic.goodsList)) ? basic.goodsList : [];
    return goodsList.some(g => hasUsdtType(g.supportCategories));
}

/**
 * 按订单号精确查找订单当前状态——供 backfillAudit.js 补单用。用宽时间窗
 * (订单提示创建时间前后各1小时)查列表、再按orderNo精确筛选，不依赖任何
 * 查询接口对"时间范围"的真实过滤语义(反正订单号是精确的，时间窗只是为了
 * 不把分页范围撑爆，宽一点没有坏处)。
 * @param {string} adminToken
 * @param {number} userId
 * @param {string} orderNo
 * @param {string} rechargeType - 用来判断走Local订单接口还是三方订单接口
 * @param {number} [hintCreateTime] - 订单创建时间的提示值(来自之前记录)，用于收窄Local查询窗口
 * @returns {object|null} 订单对象，查不到返回null
 */
export function findOrderByOrderNo(adminToken, userId, orderNo, rechargeType, hintCreateTime) {
    const isLocal = isLocalRechargeType(rechargeType);
    const base = hintCreateTime || Date.now();
    const orders = isLocal
        ? (getLocalRechargeOrderPageList(adminToken, userId, base - 3600000, Date.now() + 3600000) || [])
        : (getRechargeOrderPageList(adminToken, userId, 'ThirdRecharge') || []);
    return orders.find(o => o.orderNo === orderNo) || null;
}

/**
 * 对给定订单对象调用对应的后台审核接口，让它从Wait/Cancel变成Payed——
 * 补单的核心动作。按 order.rechargeType 选Local还是三方审核接口，和
 * pollAndAudit 内部的选择逻辑保持一致。
 * @param {string} adminToken
 * @param {object} order - findOrderByOrderNo 返回的订单对象
 * @param {number} amount - 审核时要传的金额，一般用 order.amount
 * @returns {boolean} 审核是否成功
 */
export function auditOrderNow(adminToken, order, amount) {
    const isLocal = isLocalRechargeType(order.rechargeType);
    return isLocal
        ? manualAuditLocalRechargeOrder(adminToken, order.orderNo, order.userId, order.createTime, amount)
        : manualAuditRechargeOrder(adminToken, order.orderNo, order.userId, order.createTime, amount);
}
