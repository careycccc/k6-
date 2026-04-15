/**
 * 充值服务 - 统一封装前台和后台充值逻辑
 * 提供混合充值策略：优先前台充值，失败则后台充值兜底
 */

import { sleep } from 'k6';
import { getRechargeCategoryList, depositRecharge, submitCertificate } from './frontendRechargeApi.js';
import { getLocalRechargeOrderPageList, manualAuditLocalRechargeOrder, getRechargeOrderPageList, manualAuditRechargeOrder } from './backendRechargeApi.js';
import { manualRecharge } from './manualRecharge.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

/**
 * 获取范围内的随机整数金额
 */
function getRandomAmount(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 从环境配置读取并获取随机充值金额
 */
export function getConfigRechargeAmount() {
    const min = ENV_CONFIG.RECHARGE_AMOUNT_MIN || 2000;
    const max = ENV_CONFIG.RECHARGE_AMOUNT_MAX || 5000;
    return getRandomAmount(min, max);
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
        // 从第二个通道开始等待 2 秒，避免短时间内多次请求触发服务端频率限制
        // (code:11 / msgCode:13 → Too frequent access)
        if (i > 0) {
            sleep(2);
        }

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

        console.log(`[FrontRecharge] ========================================`);
        console.log(`[FrontRecharge] 尝试通道 [${i + 1}/${categories.length}]`);
        console.log(`[FrontRecharge]   - 名称: ${name}`);
        console.log(`[FrontRecharge]   - 类型: ${rechargeType}`);
        console.log(`[FrontRecharge]   - 金额: ${amount}`);
        console.log(`[FrontRecharge] ========================================`);

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

        console.log(`[FrontRecharge] 充值响应详情:`);
        console.log(`[FrontRecharge]   - code: ${code}`);
        console.log(`[FrontRecharge]   - msgCode: ${msgCode}`);
        console.log(`[FrontRecharge]   - msg: ${msg}`);
        console.log(`[FrontRecharge]   - 完整响应: ${JSON.stringify(response)}`);

        // 充值成功的条件
        const isApiSuccess = (code === 0 || msg === "Sorry, The system is busy, please try again later! code: 10003");

        console.log(`[FrontRecharge]   - 是否判定为成功: ${isApiSuccess}`);

        if (isApiSuccess) {
            console.log(`[FrontRecharge] ✅ 充值受理成功! 通道: ${name}, 金额: ${amount}`);

            // 记录充值请求的时间戳作为基准
            const rechargeRequestTime = Date.now();
            console.log(`[FrontRecharge] 充值请求时间: ${new Date(rechargeRequestTime).toISOString()}`);

            // 从响应中提取订单信息
            const orderNo = response.data?.orderNo;
            const orderCreateTime = response.data?.createTime;

            console.log(`[FrontRecharge] 订单号: ${orderNo}, 订单创建时间: ${orderCreateTime}`);

            // LocalEWallet 需要先提交凭证
            if (rechargeType === 'LocalEWallet' && orderNo && orderCreateTime) {
                console.log(`[FrontRecharge] LocalEWallet 充值，先提交凭证...`);
                sleep(1); // 等待1秒确保订单已保存

                const certResult = submitCertificate(userToken, orderNo, orderCreateTime, "", 2);
                if (certResult && (certResult.code === 0 || certResult.msgCode === 0)) {
                    console.log(`[FrontRecharge] ✅ 凭证提交成功`);
                } else {
                    console.warn(`[FrontRecharge] ⚠️ 凭证提交失败: ${JSON.stringify(certResult)}`);
                    // 凭证提交失败，尝试下一个通道
                    continue;
                }
            }

            // 后台审核轮询（增加重试次数和等待时间）
            let auditSuccess = false;

            for (let retry = 0; retry < 5; retry++) {
                if (retry > 0) {
                    console.log(`[FrontRecharge] 第${retry}次重试后台审核...`);
                }

                sleep(3);

                console.log(`[FrontRecharge] DEBUG: rechargeType = "${rechargeType}", 类型: ${typeof rechargeType}`);

                if (rechargeType === 'LocalEWallet') {
                    // 查询本地订单（使用固定的时间基准）
                    const queryTime = Date.now();
                    const startTime = rechargeRequestTime - (1 * 60 * 1000);  // 充值请求前1分钟
                    const endTime = queryTime + (1 * 60 * 1000);              // 当前查询时间后1分钟

                    console.log(`[FrontRecharge] 查询订单时间范围: ${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`);

                    const orders = getLocalRechargeOrderPageList(adminToken, userId, startTime, endTime);
                    let targetOrder = null;

                    if (orders && orders.length > 0) {
                        console.log(`[FrontRecharge] 查询到 ${orders.length} 个本地订单`);

                        // 按创建时间倒序排序，优先匹配最新订单
                        orders.sort((a, b) => b.createTime - a.createTime);

                        for (let order of orders) {
                            console.log(`[FrontRecharge]   订单: ${order.orderNo}, 金额: ${order.amount}, 状态: ${order.rechargeState}, 创建时间: ${new Date(order.createTime).toISOString()}`);

                            // 匹配条件：金额相同 + 订单创建时间在充值请求前最多120秒内 + 状态为 Wait 或 PendingReview
                            // 注意：服务器生成订单的时间通常早于本地收到响应后的时间，且可能有服务器时间误差，因此要留有时间余量
                            if (order.amount === amount &&
                                order.createTime >= (rechargeRequestTime - 120000) &&
                                (order.rechargeState === 'Wait' || order.rechargeState === 'PendingReview')) {
                                targetOrder = order;
                                console.log(`[FrontRecharge] ✅ 匹配到目标订单: ${order.orderNo}`);
                                break;
                            }
                        }
                    } else {
                        console.warn(`[FrontRecharge] 第${retry + 1}次查询未找到任何本地订单`);
                    }

                    if (targetOrder) {
                        console.log(`[FrontRecharge] 匹配到本地订单 ${targetOrder.orderNo}，开始审核`);
                        const auditRes = manualAuditLocalRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            console.log(`[FrontRecharge] ✅ 本地订单审核成功`);
                            break;
                        }
                    } else {
                        console.warn(`[FrontRecharge] 第${retry + 1}次查询未匹配到本地订单，订单数: ${orders ? orders.length : 0}`);
                    }

                } else {
                    // 查询三方订单（使用固定的时间基准）
                    const orders = getRechargeOrderPageList(adminToken, userId, "ThirdRecharge");
                    let targetOrder = null;

                    if (orders && orders.length > 0) {
                        console.log(`[FrontRecharge] 查询到 ${orders.length} 个三方订单`);

                        // 按创建时间倒序排序，优先匹配最新订单
                        orders.sort((a, b) => b.createTime - a.createTime);

                        for (let order of orders) {
                            console.log(`[FrontRecharge]   订单: ${order.orderNo}, 金额: ${order.amount}, 创建时间: ${new Date(order.createTime).toISOString()}`);

                            // 匹配条件：金额相同 + 订单创建时间在充值请求前最多120秒内
                            if (order.amount === amount &&
                                order.createTime >= (rechargeRequestTime - 120000)) {
                                targetOrder = order;
                                console.log(`[FrontRecharge] ✅ 匹配到目标三方订单: ${order.orderNo}`);
                                break;
                            }
                        }
                    } else {
                        console.warn(`[FrontRecharge] 第${retry + 1}次查询未找到任何三方订单`);
                    }

                    if (targetOrder) {
                        console.log(`[FrontRecharge] 匹配到三方订单 ${targetOrder.orderNo}，开始审核`);
                        const auditRes = manualAuditRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            break;
                        }
                    } else {
                        console.warn(`[FrontRecharge] 第${retry + 1}次查询未匹配到三方订单`);
                    }
                }
            }

            if (auditSuccess) {
                console.log(`[FrontRecharge] ✅ 前台充值完整流程成功，金额: ${amount}, 通道: ${name}`);
                return { success: true, amount: amount, method: 'frontend', message: `通道: ${name}` };
            } else {
                console.warn(`[FrontRecharge] 后台审核失败（可能订单未生成或匹配失败），尝试下一个通道`);
                continue;
            }

        } else if (msgCode === 10001) {
            console.warn(`[FrontRecharge] 充值通道不存在 (msgCode: 10001)，尝试下一个`);
        } else {
            console.warn(`[FrontRecharge] 充值返回错误 (code: ${code}, msgCode: ${msgCode}, msg: ${msg})，尝试下一个`);
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
