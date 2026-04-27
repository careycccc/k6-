/**
 * 复充测试公共业务逻辑
 * 被 day1_seed / dayN_recharge / dayN_verify 三个脚本复用
 */

import { sleep } from 'k6';
import { fetchAllRechargeOrders, getDayRange } from './rechargeRetentionApi.js';
import { getUserAccount, detectAccountType, autoLoginByAccount } from '../user/userAccountApi.js';
import { hybridRecharge, eventBatchFrontendRechargeRequest } from '../recharge/rechargeService.js';

/**
 * 查询指定日期充值成功的 userId 列表（去重）
 * @param {string} adminToken
 * @param {string} tenantId
 * @param {number} daysAgo - 相对今天往前几天，0=今天，1=昨天，2=前天
 * @param {number} channelPackageId - 渠道来源ID（必填）
 * @returns {Array<number>} 去重后的 userId 列表
 */
export function getRechargedUserIds(adminToken, tenantId, daysAgo, channelPackageId) {
    console.log(`[RetentionService] 查询 ${daysAgo} 天前充值用户...`);

    const range = getDayRange(daysAgo, tenantId);
    console.log(`[RetentionService] 时间范围: ${range.dateStr} (${new Date(range.startTime).toISOString()} ~ ${new Date(range.endTime).toISOString()})`);

    const orders = fetchAllRechargeOrders(adminToken, range.startTime, range.endTime, 'Payed', channelPackageId);

    if (!orders || orders.length === 0) {
        console.warn(`[RetentionService] ${daysAgo} 天前无充值订单`);
        return [];
    }

    // 提取 userId 并去重
    const userIdSet = new Set();
    for (const order of orders) {
        userIdSet.add(order.userId);
    }

    const userIds = Array.from(userIdSet);
    console.log(`[RetentionService] ${daysAgo} 天前充值订单: ${orders.length} 条，去重用户: ${userIds.length} 人`);

    return userIds;
}

/**
 * 批量获取用户账号并判断类型
 * @param {string} adminToken
 * @param {Array<number>} userIds
 * @returns {Array<{userId: number, account: string, accountType: string}>}
 */
export function getUsersWithAccounts(adminToken, userIds) {
    console.log(`[RetentionService] 开始批量获取 ${userIds.length} 个用户账号...`);

    const results = [];

    for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];

        if (i > 0 && i % 10 === 0) {
            console.log(`[RetentionService] 进度: ${i}/${userIds.length}`);
        }

        const account = getUserAccount(adminToken, userId);

        if (account) {
            const accountType = detectAccountType(account);
            results.push({ userId, account, accountType });
        } else {
            console.warn(`[RetentionService] ⚠️ 用户 ${userId} 获取账号失败`);
        }

        // 每10个用户等待1秒，避免请求过快
        if ((i + 1) % 10 === 0 && i < userIds.length - 1) {
            sleep(1);
        }
    }

    console.log(`[RetentionService] 批量获取完成: 成功 ${results.length}/${userIds.length}`);

    return results;
}

/**
 * 自动登录（根据账号类型选择手机号/邮箱登录）
 * @param {string} account
 * @param {string} accountType - 'phone' 或 'email'
 * @param {object} adminData - setup 返回的数据对象
 * @returns {string|null} userToken
 */
export function autoLogin(account, accountType, adminData) {
    console.log(`[RetentionService] 自动登录: ${account} (${accountType})`);
    const token = autoLoginByAccount(account, adminData.token);
    if (token) {
        console.log(`[RetentionService] ✅ 登录成功: ${account}`);
    } else {
        console.error(`[RetentionService] ❌ 登录失败: ${account}`);
    }

    return token;
}

/**
 * 单用户复充执行
 * @param {number} userId
 * @param {string} account
 * @param {string} accountType
 * @param {string} userToken
 * @param {string} adminToken
 * @param {string} strategy - 'single' / 'double' / 'random'
 * @returns {object} { success: boolean, rechargeCount: number, totalAmount: number }
 */
export function executeUserRecharge(userId, account, accountType, userToken, adminToken, strategy = 'random') {
    console.log(`[RetentionService] 用户 ${userId} (${account}) 开始复充，策略: ${strategy}`);

    // 级联充值：90%充1次 → 50%充2次 → 20%充3次
    // strategy 参数保留用于强制指定次数
    let rechargeCount = 1;
    if (strategy === 'triple') {
        rechargeCount = 3;
    } else if (strategy === 'double') {
        rechargeCount = 2;
    } else if (strategy === 'single') {
        rechargeCount = 1;
    } else {
        // random: 级联概率
        if (Math.random() < 0.9) {
            rechargeCount = 1;
            if (Math.random() < 0.5) {
                rechargeCount = 2;
                if (Math.random() < 0.2) {
                    rechargeCount = 3;
                }
            }
        } else {
            rechargeCount = 0; // 10% 不充值
        }
    }

    if (rechargeCount === 0) {
        console.log(`[RetentionService] 用户 ${userId} 跳过充值（10%概率）`);
        return { success: false, rechargeCount: 0, totalAmount: 0 };
    }

    console.log(`[RetentionService] 充值次数: ${rechargeCount}`);

    let successCount = 0;
    let totalAmount = 0;

    for (let i = 0; i < rechargeCount; i++) {
        console.log(`[RetentionService] 第 ${i + 1}/${rechargeCount} 次充值...`);

        const amount = 2000 + Math.floor(Math.random() * 3001);

        // 50% 概率只发起充值不审核（模拟挂单场景）
        const pendingOnly = Math.random() < 0.5;

        if (pendingOnly) {
            console.log(`[RetentionService] 第 ${i + 1} 次充值：仅发起，不审核（挂单）`);
            eventBatchFrontendRechargeRequest(userToken, amount);
            // 不计入成功，模拟待审核状态
        } else {
            const result = hybridRecharge({
                userToken,
                adminToken,
                userId,
                amount,
                frontendFirst: true,
                remark: `Day N Recharge - ${i + 1}`
            });

            if (result.success) {
                successCount++;
                totalAmount += result.amount;
                console.log(`[RetentionService] ✅ 第 ${i + 1} 次充值成功，金额: ${result.amount}`);
            } else {
                console.error(`[RetentionService] ❌ 第 ${i + 1} 次充值失败`);
            }
        }

        if (i < rechargeCount - 1) {
            sleep(3);
        }
    }

    const success = successCount > 0;
    console.log(`[RetentionService] 用户 ${userId} 复充完成: ${successCount}/${rechargeCount} 次成功，总金额: ${totalAmount}`);

    return { success, rechargeCount: successCount, totalAmount };
}

/**
 * 批量复充执行
 * @param {Array<{userId, account, accountType}>} userList
 * @param {object} adminData
 * @param {object} options
 * @returns {object} 统计结果
 */
export function batchRecharge(userList, adminData, options = {}) {
    const {
        strategy = 'random',
        participationRate = 0.8,  // 参与率（80%）
        delayBetweenUsers = 3     // 用户间隔（秒）
    } = options;

    console.log(`[RetentionService] 开始批量复充，总用户数: ${userList.length}`);
    console.log(`[RetentionService] 参与率: ${participationRate * 100}%，策略: ${strategy}`);

    // 按参与率筛选用户
    const participatingUsers = userList.filter(() => Math.random() < participationRate);
    const skippedCount = userList.length - participatingUsers.length;

    console.log(`[RetentionService] 参与复充: ${participatingUsers.length} 人，跳过: ${skippedCount} 人`);

    const stats = {
        total: userList.length,
        participating: participatingUsers.length,
        skipped: skippedCount,
        loginSuccess: 0,
        loginFailed: 0,
        rechargeSuccess: 0,
        rechargeFailed: 0,
        totalAmount: 0,
        singleRechargeUsers: 0,
        doubleRechargeUsers: 0,
        tripleRechargeUsers: 0
    };

    for (let i = 0; i < participatingUsers.length; i++) {
        const user = participatingUsers[i];
        console.log(`\n[RetentionService] [${i + 1}/${participatingUsers.length}] 处理用户 ${user.userId} (${user.account})`);

        // 1. 登录
        const userToken = autoLogin(user.account, user.accountType, adminData);

        if (!userToken) {
            stats.loginFailed++;
            console.error(`[RetentionService] ❌ 用户 ${user.userId} 登录失败，跳过`);
            continue;
        }

        stats.loginSuccess++;

        // 2. 充值
        const result = executeUserRecharge(
            user.userId,
            user.account,
            user.accountType,
            userToken,
            adminData.token,
            strategy
        );

        if (result.success) {
            stats.rechargeSuccess++;
            stats.totalAmount += result.totalAmount;

            if (result.rechargeCount === 1) {
                stats.singleRechargeUsers++;
            } else if (result.rechargeCount === 2) {
                stats.doubleRechargeUsers++;
            } else if (result.rechargeCount >= 3) {
                stats.tripleRechargeUsers++;
            }
        } else {
            stats.rechargeFailed++;
        }

        // 用户间隔
        if (i < participatingUsers.length - 1) {
            sleep(delayBetweenUsers);
        }
    }

    console.log(`\n[RetentionService] 批量复充完成`);
    console.log(`[RetentionService] 登录成功: ${stats.loginSuccess}，失败: ${stats.loginFailed}`);
    console.log(`[RetentionService] 充值成功: ${stats.rechargeSuccess}，失败: ${stats.rechargeFailed}`);

    return stats;
}
