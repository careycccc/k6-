/**
 * 充值服务 - 统一封装前台和后台充值逻辑
 * 提供混合充值策略：优先前台充值，失败则后台充值兜底
 */

import { sleep } from 'k6';
import { getRechargeCategoryList, depositRecharge, submitCertificate } from './frontendRechargeApi.js';
import { getLocalRechargeOrderPageList, manualAuditLocalRechargeOrder, getRechargeOrderPageList, manualAuditRechargeOrder } from './backendRechargeApi.js';
import { manualRecharge } from './manualRecharge.js';

/**
 * 获取范围内的随机整数金额
 */
function getRandomAmount(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 前台充值流程
 * @param {string} userToken - 用户token
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {number} targetAmount - 目标充值金额
 * @returns {object} { success: boolean, amount: number, method: string, message: string }
 */
export function frontendRecharge(userToken, adminToken, userId, targetAmount) {
    console.log(`[FrontRecharge] 开始前台充值流程，用户ID: ${userId}, 目标金额: ${targetAmount}`);

    // 1. 获取充值通道列表
    const categories = getRechargeCategoryList(userToken);

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
        console.warn(`[FrontRecharge] 充值分类列表为空或获取失败`);
        return { success: false, amount: 0, method: 'frontend', message: '获取充值通道失败' };
    }

    console.log(`[FrontRecharge] 获取到 ${categories.length} 个充值通道`);

    // 2. 排序优先三方通道 (排除 LocalEWallet 优先)
    categories.sort((a, b) => {
        if (a.rechargeType === 'LocalEWallet' && b.rechargeType !== 'LocalEWallet') return 1;
        if (a.rechargeType !== 'LocalEWallet' && b.rechargeType === 'LocalEWallet') return -1;
        return 0;
    });

    // 3. 遍历通道并尝试充值
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const categoryId = category.id;
        const rechargeType = category.rechargeType;
        const name = category.name;

        let minAmt = category.minAmount || 100;
        let maxAmt = category.maxAmount || 100000;

        // 调整金额范围
        if (rechargeType !== 'LocalEWallet') {
            minAmt = Math.max(minAmt, 1000);
        }
        maxAmt = Math.max(minAmt, Math.min(maxAmt, targetAmount));

        // 使用目标金额或在范围内随机
        const amount = Math.min(targetAmount, maxAmt);

        console.log(`[FrontRecharge] 尝试通道 [${i + 1}/${categories.length}]: ${name}(${rechargeType}), 金额: ${amount}`);

        const payload = {
            rechargeCategoryId: categoryId,
            amount: amount,
        };

        if (rechargeType === 'LocalEWallet') {
            payload.customerInfo = {
                accountNo: "467687777878978",
                holderName: "tester"
            };
        }

        // 发起充值请求
        const response = depositRecharge(userToken, payload);
        if (!response) {
            console.warn(`[FrontRecharge] 充值请求无响应，尝试下一个通道`);
            continue;
        }

        const code = response.code;
        const msgCode = response.msgCode;
        const msg = response.msg || "";

        console.log(`[FrontRecharge] 响应 => code: ${code}, msgCode: ${msgCode}`);

        // 充值成功的条件
        const isApiSuccess = (code === 0 || msg === "Sorry, The system is busy, please try again later! code: 10003");

        if (isApiSuccess) {
            console.log(`[FrontRecharge] ✅ 充值受理成功! 通道: ${name}, 金额: ${amount}`);

            // 后台审核轮询
            let auditSuccess = false;

            for (let retry = 0; retry < 2; retry++) {
                if (retry > 0) {
                    console.log(`[FrontRecharge] 第${retry}次重试后台审核...`);
                }

                sleep(2);

                if (rechargeType === 'LocalEWallet') {
                    // 查询本地订单
                    const now = Date.now();
                    const startTime = now - (60 * 60 * 1000);
                    const endTime = now + (60 * 60 * 1000);

                    const orders = getLocalRechargeOrderPageList(adminToken, userId, startTime, endTime);
                    let targetOrder = null;

                    if (orders && orders.length > 0) {
                        for (let order of orders) {
                            if (order.amount === amount && order.rechargeState === 'Wait') {
                                targetOrder = order;
                                break;
                            }
                        }
                    }

                    if (targetOrder) {
                        console.log(`[FrontRecharge] 匹配到本地订单 ${targetOrder.orderNo}，开始审核`);
                        const auditRes = manualAuditLocalRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            // 提交凭证，支持重试（第一次失败后会使用12位随机数字作为 transactionId）
                            const certResult = submitCertificate(userToken, targetOrder.orderNo, targetOrder.createTime, "", 2);
                            if (certResult && (certResult.code === 0 || certResult.msgCode === 0)) {
                                console.log(`[FrontRecharge] ✅ 提交凭证成功`);
                            } else {
                                console.warn(`[FrontRecharge] ⚠️ 提交凭证失败，但审核已完成`);
                            }
                            break;
                        }
                    }

                } else {
                    // 查询三方订单
                    const orders = getRechargeOrderPageList(adminToken, userId, "ThirdRecharge");
                    let targetOrder = null;

                    if (orders && orders.length > 0) {
                        for (let order of orders) {
                            if (order.amount === amount) {
                                targetOrder = order;
                                break;
                            }
                        }
                    }

                    if (targetOrder) {
                        console.log(`[FrontRecharge] 匹配到三方订单 ${targetOrder.orderNo}，开始审核`);
                        const auditRes = manualAuditRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            break;
                        }
                    }
                }
            }

            if (auditSuccess) {
                console.log(`[FrontRecharge] ✅ 前台充值完整流程成功，金额: ${amount}`);
                return { success: true, amount: amount, method: 'frontend', message: `通道: ${name}` };
            } else {
                console.warn(`[FrontRecharge] 后台审核失败，尝试下一个通道`);
                continue;
            }

        } else if (msgCode === 10001) {
            console.warn(`[FrontRecharge] 充值通道不存在，尝试下一个`);
        } else {
            console.warn(`[FrontRecharge] 充值返回错误，尝试下一个`);
        }
    }

    console.warn(`[FrontRecharge] 所有前台充值通道均失败`);
    return { success: false, amount: 0, method: 'frontend', message: '所有通道均失败' };
}

/**
 * 后台充值流程（兜底方案）
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {number} amount - 充值金额
 * @param {string} remark - 备注
 * @returns {object} { success: boolean, amount: number, method: string, message: string }
 */
export function backendRecharge(adminToken, userId, amount, remark = 'Auto Backend Recharge') {
    console.log(`[BackendRecharge] 开始后台充值，用户ID: ${userId}, 金额: ${amount}`);

    const result = manualRecharge(adminToken, userId, amount, 1, remark);

    if (result && result.success) {
        console.log(`[BackendRecharge] ✅ 后台充值成功，金额: ${amount}`);
        return { success: true, amount: amount, method: 'backend', message: '后台人工充值' };
    } else {
        console.error(`[BackendRecharge] ❌ 后台充值失败`);
        return { success: false, amount: 0, method: 'backend', message: '后台充值失败' };
    }
}

/**
 * 混合充值策略：优先前台充值，失败则后台充值兜底
 * @param {object} options - 充值参数
 * @param {string} options.userToken - 用户token（前台充值需要）
 * @param {string} options.adminToken - 管理员token（必需）
 * @param {number} options.userId - 用户ID（必需）
 * @param {number} options.amount - 充值金额（必需）
 * @param {boolean} options.frontendFirst - 是否优先前台充值，默认true
 * @param {string} options.remark - 后台充值备注
 * @returns {object} { success: boolean, amount: number, method: string, message: string }
 */
export function hybridRecharge(options) {
    const {
        userToken,
        adminToken,
        userId,
        amount,
        frontendFirst = true,
        remark = 'Hybrid Recharge'
    } = options;

    if (!adminToken || !userId || !amount) {
        console.error(`[HybridRecharge] 缺少必需参数: adminToken, userId, amount`);
        return { success: false, amount: 0, method: 'none', message: '参数不完整' };
    }

    console.log(`[HybridRecharge] 开始混合充值策略，用户ID: ${userId}, 金额: ${amount}`);

    // 策略1: 优先前台充值（如果有userToken且frontendFirst为true）
    if (frontendFirst && userToken) {
        console.log(`[HybridRecharge] 尝试前台充值...`);
        const frontResult = frontendRecharge(userToken, adminToken, userId, amount);

        if (frontResult.success) {
            console.log(`[HybridRecharge] ✅ 前台充值成功`);
            return frontResult;
        }

        console.log(`[HybridRecharge] 前台充值失败，切换到后台充值兜底...`);
    }

    // 策略2: 后台充值兜底
    console.log(`[HybridRecharge] 使用后台充值...`);
    const backResult = backendRecharge(adminToken, userId, amount, remark);

    if (backResult.success) {
        console.log(`[HybridRecharge] ✅ 后台充值成功`);
        return backResult;
    }

    console.error(`[HybridRecharge] ❌ 所有充值方式均失败`);
    return { success: false, amount: 0, method: 'all_failed', message: '前后台充值均失败' };
}

/**
 * 批量充值（支持多个用户）
 * @param {Array} users - 用户列表 [{ userToken, userId, amount }, ...]
 * @param {string} adminToken - 管理员token
 * @param {object} options - 充值选项
 * @returns {object} { total: number, success: number, failed: number, results: Array }
 */
export function batchRecharge(users, adminToken, options = {}) {
    const { frontendFirst = true, remark = 'Batch Recharge' } = options;

    console.log(`[BatchRecharge] 开始批量充值，用户数: ${users.length}`);

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`\n[BatchRecharge] [${i + 1}/${users.length}] 处理用户ID: ${user.userId}`);

        const result = hybridRecharge({
            userToken: user.userToken,
            adminToken: adminToken,
            userId: user.userId,
            amount: user.amount,
            frontendFirst: frontendFirst,
            remark: remark
        });

        results.push({
            userId: user.userId,
            ...result
        });

        if (result.success) {
            successCount++;
        } else {
            failedCount++;
        }

        sleep(1);
    }

    console.log(`\n[BatchRecharge] 批量充值完成: 总数=${users.length}, 成功=${successCount}, 失败=${failedCount}`);

    return {
        total: users.length,
        success: successCount,
        failed: failedCount,
        results: results
    };
}
