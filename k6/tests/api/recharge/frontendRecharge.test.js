/**
 * 前台充值业务流程测试逻辑
 */

import { sleep } from 'k6';
import { getTestSession } from '../common/session.js';
import { getRechargeCategoryList, depositRecharge, submitCertificate } from './frontendRechargeApi.js';
import { getLocalRechargeOrderPageList, manualAuditLocalRechargeOrder, getRechargeOrderPageList, manualAuditRechargeOrder } from './backendRechargeApi.js';
import { manualRecharge } from './manualRecharge.js'; // 备用后台充值
import { AdminLogin } from '../login/adminlogin.test.js'; // 后台管理员登录

const tag = 'FrontendRechargeTest';

/**
 * 获取范围内的随机整数金额
 * @param {number} min 
 * @param {number} max 
 * @returns {number} 随机整数
 */
function getRandomAmount(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 执行前台充值流程
 * @param {string} userToken - 前台用户Token
 * @param {string} userName - 用户名（用于报错时回退人工充值）
 * @param {number} userId - 用户ID（同上）
 * @returns {boolean} 是否充值成功
 */
export function runFrontendRechargeFlow(session) {
    const userToken = session.userToken;
    const adminToken = session.adminToken;
    const userName = session.userName;
    const userId = session.userId;
    
    console.log(`[${tag}] 开始前台充值流程，获取充值通道列表...`);

    // 1. 获取充值列表
    const categories = getRechargeCategoryList(userToken);
    
    if (!categories || !Array.isArray(categories) || categories.length === 0) {
        console.error(`[${tag}] 充值分类列表为空或获取失败`);
        fallbackToManualRecharge(adminToken, userName, userId, 100);
        return false;
    }

    console.log(`[${tag}] 成功获取到 ${categories.length} 个充值通道。开始排序优先三方通道...`);

    // 2. 排序优先三方通道 (排除 LocalEWallet 优先)
    categories.sort((a, b) => {
        if (a.rechargeType === 'LocalEWallet' && b.rechargeType !== 'LocalEWallet') return 1;
        if (a.rechargeType !== 'LocalEWallet' && b.rechargeType === 'LocalEWallet') return -1;
        return 0; 
    });

    let isSuccess = false;

    // 3. 遍历通道并尝试充值
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const categoryId = category.id;
        const rechargeType = category.rechargeType;
        const name = category.name;
        
        const minAmt = category.minAmount || 100;
        const maxAmt = Math.min(category.maxAmount || 100000, 5000); 
        const amount = getRandomAmount(minAmt, maxAmt);

        console.log(`[${tag}] 尝试通道 [${i + 1}/${categories.length}]: ${name}(${rechargeType}), ID: ${categoryId}, 金额: ${amount}`);

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

        // 发起充值请求 (前台)，前台只发一次，不在前台做循环
        const response = depositRecharge(userToken, payload);
        if (!response) {
            console.warn(`[${tag}] 前台发起充值无响应，继续尝试下一个通道...`);
            continue;
        }

        const code = response.code;
        const msgCode = response.msgCode;
        const msg = response.msg || "";
        
        console.log(`[${tag}] 响应 => code: ${code}, msgCode: ${msgCode}, msg: "${msg}"`);

        // 充值成功的条件有两个：
        // 1. code === 0
        // 2. msg === "Sorry, The system is busy, please try again later! code: 10003"
        const isApiSuccess = (code === 0 || msg === "Sorry, The system is busy, please try again later! code: 10003");

        if (isApiSuccess) {
            console.log(`[${tag}] ✅ 充值受理成功! 通道: ${name}(${rechargeType}), 金额: ${amount}`);
            
            // 开始对后台审核逻辑做轮询
            let auditSuccess = false;

            for (let retry = 0; retry < 2; retry++) {
                if (retry > 0) {
                    console.log(`[${tag}] 第${retry}次未能在后台匹配到订单，等待后发起重试...`);
                }
                
                // 等待一会儿以确保订单写入数据库
                sleep(2);

                if (rechargeType === 'LocalEWallet') {
                    // 查询本地订单
                    const now = Date.now();
                    const startTime = now - (60 * 60 * 1000); // 过去1小时
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
                        console.log(`[${tag}] ✅ 后台匹配到本地充值订单 ${targetOrder.orderNo}，准备人工审核`);
                        const auditRes = manualAuditLocalRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            submitCertificate(userToken, targetOrder.orderNo, targetOrder.createTime);
                            break;
                        } else {
                            console.warn(`[${tag}] ⚠️ 后台人工审核接口失败`);
                        }
                    } else {
                        console.warn(`[${tag}] ⚠️ 后台订单列表中未匹配到金额为 ${amount} 且状态为 Wait 的订单`);
                    }

                } else {
                    // 查询三方订单
                    const orders = getRechargeOrderPageList(adminToken, userId, "ThirdRecharge");
                    let targetOrder = null;
                    
                    if (orders && orders.length > 0) {
                        for (let order of orders) {
                            // 金额匹配即可
                            if (order.amount === amount) { 
                                targetOrder = order;
                                break;
                            }
                        }
                    }
                    
                    if (targetOrder) {
                        console.log(`[${tag}] ✅ 后台匹配到三方订单 ${targetOrder.orderNo}，准备人工审核`);
                        const auditRes = manualAuditRechargeOrder(adminToken, targetOrder.orderNo, userId, targetOrder.createTime, amount);
                        if (auditRes) {
                            auditSuccess = true;
                            break;
                        } else {
                            console.warn(`[${tag}] ⚠️ 后台人工审核三方接口失败`);
                        }
                    } else {
                        console.warn(`[${tag}] ⚠️ 后台订单列表中未匹配到金额为 ${amount} 的三方订单`);
                    }
                }
            } // end of backend retry

            if (auditSuccess) {
                isSuccess = true;
                break; // 如果这整个通道成功审核，跳出所有通道的遍历
            } else {
                console.error(`[${tag}] ❌ 后台查找订单并审核经过重试仍然失败，跳过该账号/通道`);
                continue; // 失败则继续下一个通道
            }

        } else if (msgCode === 10001) {
            console.warn(`[${tag}] 充值通道不存在 (msgCode: 10001)，继续尝试下一个...`);
        } else {
            console.warn(`[${tag}] 充值返回其他错误，继续尝试下一个...`);
        }
    }

    // 6. 如果所有通道都失败，触发备用机制
    if (!isSuccess) {
        console.error(`[${tag}] ❌ 所有前台充值通道尝试完毕，均未能成功充值审核。开始回退到后台人工充值...`);
        fallbackToManualRecharge(adminToken, userName, userId, 500); 
    }

    return isSuccess;
}

/**
 * 备用充值：后台人工充值
 * @param {string} adminToken 
 * @param {string} userName 
 * @param {number} userId 
 * @param {number} amount 
 */
function fallbackToManualRecharge(adminToken, userName, userId, amount) {
    if (!userId || !adminToken) {
        console.error(`[${tag}-Fallback] 无法回退人工充值：未提供 userId 或 adminToken`);
        return;
    }

    console.log(`[${tag}-Fallback] 开始给用户 ${userId} (${userName}) 人工充值 ${amount}...`);
    const result = manualRecharge(adminToken, userId, amount, 1, 'Auto Fallback Recharge');

    if (result && result.success) {
        console.log(`[${tag}-Fallback] ✅ 兜底成功: 人工充值 ${amount} 完毕`);
    } else {
        console.error(`[${tag}-Fallback] ❌ 兜底失败: 人工充值出错`);
    }
}

export default function () {
    // 可以从环境变量动态获取参数
    const userName = __ENV.TARGET_USER || "kg1m4n4dg@yahoo.com";
    const isRegister = __ENV.IS_REGISTER === 'true';

    console.log(`\n=================== 前台充值测试开始 ===================`);

    // 1. 获取测试会话
    const session = getTestSession(userName, isRegister);

    if (!session) {
        console.error(`会话初始化失败，终止充值测试`);
        return;
    }

    // 2. 运行充值流程，直接传入整个 session
    runFrontendRechargeFlow(session);

    console.log(`=================== 前台充值测试结束 ===================\n`);
}