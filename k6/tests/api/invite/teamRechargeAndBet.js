/**
 * 团队充值和投注功能
 * 根据给定的 userId，查询所有上下级，然后批量登录、充值和投注
 */

import { sleep } from 'k6';
import { getAllRelatedUserIds, updateUserAgentRebateMode } from './agentApi.js';
import { batchGetUserAccounts } from '../user/userAccountApi.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getFrontUserInfo } from '../user/userManagement.js';

/**
 * 登录用户（使用验证码自动登录）
 * @param {string} account - 账号
 * @param {string} accountType - 账号类型 'phone' 或 'email'
 * @param {object} adminData - 管理员数据对象（包含 token）
 * @returns {object|null} { token, userId, account, accountType }
 */
function loginUser(account, accountType, adminData) {
    console.log(`[Login] 尝试登录: ${account} (${accountType})`);

    try {
        let token = null;

        if (accountType === 'phone') {
            // 手机号自动登录（发送验证码并登录）
            token = mobileAutoLoginFlow(account, adminData);
        } else if (accountType === 'email') {
            // 邮箱自动登录（发送验证码并登录）
            token = emailAutoLoginFlow(account, adminData);
        } else {
            console.error(`[Login] 未知账号类型: ${accountType}`);
            return null;
        }

        if (!token) {
            console.error(`[Login] 登录失败: ${account}`);
            return null;
        }

        console.log(`[Login] ✅ 登录成功: ${account}`);

        // 获取用户信息
        sleep(1);
        const userInfo = getFrontUserInfo(token);

        if (!userInfo || !userInfo.userId) {
            console.error(`[Login] 获取用户信息失败: ${account}`);
            return null;
        }

        return {
            token: token,
            userId: userInfo.userId,
            account: account,
            accountType: accountType
        };

    } catch (error) {
        console.error(`[Login] 登录异常: ${account}, 错误: ${error.message}`);
        return null;
    }
}

/**
 * 处理单个用户的充值和投注
 * @param {object} userInfo - 用户信息 { token, userId, account }
 * @param {string} adminToken - 管理员token
 * @returns {object} { recharged: boolean, betted: boolean }
 */
function processUserRechargeAndBet(userInfo, adminToken) {
    const result = { recharged: false, betted: false };

    console.log(`[Process] 开始处理用户 ${userInfo.account}...`);

    // 随机充值金额
    const rechargeAmount = getConfigRechargeAmount();
    console.log(`[Process] 开始充值: ${userInfo.account}, 金额: ${rechargeAmount}`);

    const rechargeResult = hybridRecharge({
        userToken: userInfo.token,
        adminToken: adminToken,
        userId: userInfo.userId,
        amount: rechargeAmount,
        frontendFirst: true,
        remark: 'Team Recharge'
    });

    if (rechargeResult.success) {
        result.recharged = true;
        console.log(`[Process] ✅ 充值成功: ${userInfo.account}, 金额: ${rechargeResult.amount}, 方式: ${rechargeResult.method}`);

        sleep(2);

        // 投注
        console.log(`[Process] 开始投注: ${userInfo.account}`);
        const betResult = betRun(userInfo.token, userInfo.account);

        if (betResult) {
            result.betted = true;
            console.log(`[Process] ✅ 投注成功: ${userInfo.account}`);
        } else {
            console.error(`[Process] ❌ 投注失败: ${userInfo.account}`);
        }
    } else {
        console.error(`[Process] ❌ 充值失败: ${userInfo.account}, 原因: ${rechargeResult.message}`);
    }

    return result;
}

/**
 * 执行团队充值和投注
 * @param {number} targetUserId - 目标用户ID
 * @param {object} adminData - 管理员数据对象（包含 token）
 * @param {object} options - 可选参数
 * @returns {object} 统计结果
 */
export function runTeamRechargeAndBet(targetUserId, adminData, options = {}) {
    const {
        rechargeChance = 0.5,      // 充值几率，默认50%
        rebateChance = 0.2,        // 设置返佣几率，默认20%
        delayMs = 1000             // 查询账号间隔，默认1秒
    } = options;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 开始团队充值和投注流程`);
    console.log(`目标用户ID: ${targetUserId}`);
    console.log(`充值几率: ${(rechargeChance * 100).toFixed(0)}%`);
    console.log(`返佣设置几率: ${(rebateChance * 100).toFixed(0)}%`);
    console.log(`${'='.repeat(60)}\n`);

    // 步骤1: 查询所有上下级 userId
    console.log(`\n📋 步骤1: 查询所有上下级...`);
    const userIds = getAllRelatedUserIds(adminData.token, targetUserId);

    if (userIds.length === 0) {
        console.error(`❌ 未找到任何相关用户`);
        return { total: 0, loginSuccess: 0, rechargeSuccess: 0, betSuccess: 0 };
    }

    console.log(`✅ 找到 ${userIds.length} 个相关用户\n`);

    // 步骤1.5: 根据充值几率随机筛选用户
    console.log(`\n📋 步骤1.5: 根据充值几率 ${(rechargeChance * 100).toFixed(0)}% 随机筛选用户...`);
    const selectedUserIds = userIds.filter(() => Math.random() < rechargeChance);
    const skippedCount = userIds.length - selectedUserIds.length;

    console.log(`✅ 筛选结果: ${selectedUserIds.length} 个用户将处理, ${skippedCount} 个用户已跳过\n`);

    if (selectedUserIds.length === 0) {
        console.warn(`⚠️  所有用户都被随机跳过，流程结束`);
        return {
            total: userIds.length,
            loginSuccess: 0,
            rechargeSuccess: 0,
            betSuccess: 0,
            skipped: skippedCount,
            rebateUpdated: 0
        };
    }

    // 步骤1.6: 随机为部分用户设置返佣模式
    console.log(`\n📋 步骤1.6: 根据 ${(rebateChance * 100).toFixed(0)}% 几率为用户设置返佣模式...`);
    let rebateUpdatedCount = 0;

    for (const userId of selectedUserIds) {
        const shouldSetRebate = Math.random() < rebateChance;

        if (shouldSetRebate) {
            // 随机选择返佣模式: 1=固定, 2=特殊
            const rebateMode = Math.floor(Math.random() * 2) + 1;
            // 随机选择返佣等级: 1-6
            const rebateLevel = Math.floor(Math.random() * 6) + 1;

            const success = updateUserAgentRebateMode(adminData.token, userId, rebateMode, rebateLevel);
            if (success) {
                rebateUpdatedCount++;
            }

            sleep(0.5); // 避免请求过快
        }
    }

    console.log(`✅ 返佣设置完成: ${rebateUpdatedCount} 个用户已更新返佣模式\n`);

    // 步骤2: 批量查询账号（只查询被选中的用户）
    console.log(`\n📋 步骤2: 批量查询用户账号...`);
    const userAccounts = batchGetUserAccounts(adminData.token, selectedUserIds, delayMs);

    if (userAccounts.length === 0) {
        console.error(`❌ 未能获取任何用户账号`);
        return {
            total: userIds.length,
            loginSuccess: 0,
            rechargeSuccess: 0,
            betSuccess: 0,
            skipped: skippedCount,
            rebateUpdated: rebateUpdatedCount
        };
    }

    console.log(`✅ 成功获取 ${userAccounts.length} 个用户账号\n`);

    // 统计数据
    const stats = {
        total: userIds.length,
        selected: selectedUserIds.length,
        skipped: skippedCount,
        rebateUpdated: rebateUpdatedCount,
        loginSuccess: 0,
        rechargeSuccess: 0,
        betSuccess: 0,
        loginFailed: 0,
        rechargeFailed: 0,
        betFailed: 0
    };

    // 步骤3: 登录、充值和投注
    console.log(`\n📋 步骤3: 开始登录、充值和投注流程...\n`);

    for (let i = 0; i < userAccounts.length; i++) {
        sleep(1);
        const userAccount = userAccounts[i];

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[${i + 1}/${userAccounts.length}] 处理用户: ${userAccount.account}`);
        console.log(`${'─'.repeat(60)}`);

        // 登录
        const loginInfo = loginUser(userAccount.account, userAccount.accountType, adminData);

        if (!loginInfo) {
            stats.loginFailed++;
            console.error(`❌ 登录失败，跳过该用户\n`);
            sleep(1);
            continue;
        }

        stats.loginSuccess++;
        sleep(2);

        // 充值和投注
        const processResult = processUserRechargeAndBet(loginInfo, adminData.token);

        if (processResult.recharged) {
            stats.rechargeSuccess++;
        } else {
            stats.rechargeFailed++;
        }

        if (processResult.betted) {
            stats.betSuccess++;
        } else if (processResult.recharged) {
            stats.betFailed++;
        }

        sleep(2);
    }

    // 打印统计结果
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 团队充值和投注统计结果`);
    console.log(`${'='.repeat(60)}`);
    console.log(`总用户数: ${stats.total}`);
    console.log(`随机选中: ${stats.selected} (${((stats.selected / stats.total) * 100).toFixed(1)}%)`);
    console.log(`随机跳过: ${stats.skipped} (${((stats.skipped / stats.total) * 100).toFixed(1)}%)`);
    console.log(`返佣设置: ${stats.rebateUpdated} (${stats.selected > 0 ? ((stats.rebateUpdated / stats.selected) * 100).toFixed(1) : 0}%)`);
    console.log(`登录成功: ${stats.loginSuccess} (${stats.selected > 0 ? ((stats.loginSuccess / stats.selected) * 100).toFixed(1) : 0}%)`);
    console.log(`登录失败: ${stats.loginFailed}`);
    console.log(`充值成功: ${stats.rechargeSuccess}`);
    console.log(`充值失败: ${stats.rechargeFailed}`);
    console.log(`投注成功: ${stats.betSuccess}`);
    console.log(`投注失败: ${stats.betFailed}`);
    console.log(`${'='.repeat(60)}\n`);

    return stats;
}
