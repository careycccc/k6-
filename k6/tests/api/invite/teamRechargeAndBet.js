/**
 * 团队充值和投注功能
 * 根据给定的 userId，查询所有上下级，然后批量登录、充值和投注
 */

import { sleep } from 'k6';
import { getAllRelatedUserIds, updateUserAgentRebateMode } from './agentApi.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../user/userAccountApi.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getFrontUserInfo } from '../user/userManagement.js';

/**
 * 登录用户（自动识别手机号/邮箱，调用对应登录方式）
 */
function loginUser(account, accountType, adminData) {
    console.log(`[Login] 尝试登录: ${account} (${accountType})`);
    try {
        const token = autoLoginByAccount(account, adminData.token);
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
 * 随机执行 1~3 次充值（首充 + 随机二充/三充）
 * @param {object} userInfo   - { token, userId, account }
 * @param {string} adminToken
 * @returns {{ recharged: boolean, totalAmount: number }}
 */
function processMultiRecharge(userInfo, adminToken) {
    // 随机决定充值次数：60% 概率1次，30% 概率2次，10% 概率3次
    const rand = Math.random();
    const rechargeCount = rand < 0.6 ? 1 : rand < 0.9 ? 2 : 3;

    console.log(`[Process] 本次充值次数: ${rechargeCount} 次`);

    let totalAmount = 0;
    let anySuccess = false;

    for (let i = 0; i < rechargeCount; i++) {
        if (i > 0) sleep(2); // 二充/三充前等待

        const rechargeAmount = getConfigRechargeAmount();
        const label = i === 0 ? '首充' : i === 1 ? '二充' : '三充';
        console.log(`[Process] ${label}: ${userInfo.account}, 金额: ${rechargeAmount}`);

        const rechargeResult = hybridRecharge({
            userToken: userInfo.token,
            adminToken: adminToken,
            userId: userInfo.userId,
            amount: rechargeAmount,
            frontendFirst: true,
            remark: `Team Recharge - ${label}`
        });

        if (rechargeResult.success) {
            anySuccess = true;
            totalAmount += rechargeResult.amount;
            console.log(`[Process] ✅ ${label}成功: ${userInfo.account}, 金额: ${rechargeResult.amount}, 方式: ${rechargeResult.method}`);
        } else {
            console.error(`[Process] ❌ ${label}失败: ${userInfo.account}, 原因: ${rechargeResult.message}`);
            break; // 充值失败则不继续
        }
    }

    return { recharged: anySuccess, totalAmount };
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

    const { recharged, totalAmount } = processMultiRecharge(userInfo, adminToken);

    if (recharged) {
        result.recharged = true;
        console.log(`[Process] ✅ 充值完成: ${userInfo.account}, 累计金额: ${totalAmount}`);

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
        console.error(`[Process] ❌ 充值失败: ${userInfo.account}`);
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

// ============================================================
// V2：三段式行为分层（不改动上方任何现有逻辑）
// ============================================================

/**
 * 处理单个用户 - 仅充值，不投注（支持随机多次充值）
 * @param {object} userInfo  - { token, userId, account }
 * @param {string} adminToken
 * @returns {object} { recharged: boolean, betted: false }
 */
function processUserRechargeOnly(userInfo, adminToken) {
    const { recharged } = processMultiRecharge(userInfo, adminToken);
    return { recharged, betted: false };
}

/**
 * 执行团队充值和投注 V2（三段式行为分层）
 *
 * 将团队用户按概率分为三组：
 *   - 不活跃（inactiveRate）：不充值，不投注
 *   - 半活跃（rechargeOnlyRate）：只充值，不投注
 *   - 活跃（剩余）：充值 + 投注
 *
 * @param {number} targetUserId  - 目标用户ID
 * @param {object} adminData     - 管理员数据（含 token）
 * @param {object} options       - 可选参数
 * @param {number} [options.inactiveRate=0.2]      - 不充值不投注的比例
 * @param {number} [options.rechargeOnlyRate=0.2]  - 只充值不投注的比例
 * @param {number} [options.rebateChance=0.2]      - 设置返佣几率
 * @param {number} [options.delayMs=1000]          - 查询账号间隔
 * @returns {object} 统计结果
 *
 * @example
 * // 使用默认分层（20% 不活跃 / 20% 只充值 / 60% 充值+投注）
 * runTeamRechargeAndBetV2(137529, adminData);
 *
 * // 自定义分层
 * runTeamRechargeAndBetV2(137529, adminData, { inactiveRate: 0.3, rechargeOnlyRate: 0.1 });
 */
export function runTeamRechargeAndBetV2(targetUserId, adminData, options = {}) {
    const {
        inactiveRate     = 0.2,   // 不充值不投注
        rechargeOnlyRate = 0.2,   // 只充值不投注
        rebateChance     = 0.2,
        delayMs          = 1000
    } = options;

    // 活跃比例 = 剩余
    const activeRate = Math.max(0, 1 - inactiveRate - rechargeOnlyRate);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 [V2] 开始团队充值和投注流程（三段式分层）`);
    console.log(`目标用户ID  : ${targetUserId}`);
    console.log(`不活跃比例  : ${(inactiveRate * 100).toFixed(0)}%  → 不充值，不投注`);
    console.log(`半活跃比例  : ${(rechargeOnlyRate * 100).toFixed(0)}%  → 只充值，不投注`);
    console.log(`活跃比例    : ${(activeRate * 100).toFixed(0)}%  → 充值 + 投注`);
    console.log(`${'='.repeat(60)}\n`);

    // 步骤1: 查询所有上下级
    console.log(`📋 步骤1: 查询所有上下级...`);
    const userIds = getAllRelatedUserIds(adminData.token, targetUserId);

    if (userIds.length === 0) {
        console.error(`❌ 未找到任何相关用户`);
        return { total: 0, inactive: 0, rechargeOnly: 0, active: 0, rechargeSuccess: 0, betSuccess: 0 };
    }
    console.log(`✅ 找到 ${userIds.length} 个相关用户\n`);

    // 步骤2: 按概率分组
    console.log(`📋 步骤2: 按概率分组...`);
    const groups = { inactive: [], rechargeOnly: [], active: [] };

    for (const uid of userIds) {
        const rand = Math.random();
        if (rand < inactiveRate) {
            groups.inactive.push(uid);
        } else if (rand < inactiveRate + rechargeOnlyRate) {
            groups.rechargeOnly.push(uid);
        } else {
            groups.active.push(uid);
        }
    }

    console.log(`  不活跃: ${groups.inactive.length} 人`);
    console.log(`  半活跃: ${groups.rechargeOnly.length} 人`);
    console.log(`  活跃  : ${groups.active.length} 人\n`);

    // 步骤3: 设置返佣（仅对半活跃+活跃用户）
    const eligibleForRebate = [...groups.rechargeOnly, ...groups.active];
    let rebateUpdatedCount = 0;
    console.log(`📋 步骤3: 设置返佣模式（${(rebateChance * 100).toFixed(0)}% 几率）...`);
    for (const uid of eligibleForRebate) {
        if (Math.random() < rebateChance) {
            const rebateMode  = Math.floor(Math.random() * 2) + 1;
            const rebateLevel = Math.floor(Math.random() * 6) + 1;
            const success = updateUserAgentRebateMode(adminData.token, uid, rebateMode, rebateLevel);
            if (success) rebateUpdatedCount++;
            sleep(0.5);
        }
    }
    console.log(`✅ 返佣设置完成: ${rebateUpdatedCount} 个用户\n`);

    // 步骤4: 批量查询账号（只查半活跃+活跃）
    console.log(`📋 步骤4: 批量查询用户账号...`);
    const rechargeUserIds = [...groups.rechargeOnly, ...groups.active];
    const userAccounts = batchGetUserAccounts(adminData.token, rechargeUserIds, delayMs);

    if (userAccounts.length === 0) {
        console.error(`❌ 未能获取任何用户账号`);
        return { total: userIds.length, inactive: groups.inactive.length, rechargeOnly: groups.rechargeOnly.length, active: groups.active.length, rechargeSuccess: 0, betSuccess: 0 };
    }
    console.log(`✅ 成功获取 ${userAccounts.length} 个用户账号\n`);

    // 统计
    const stats = {
        total          : userIds.length,
        inactive       : groups.inactive.length,
        rechargeOnly   : groups.rechargeOnly.length,
        active         : groups.active.length,
        rebateUpdated  : rebateUpdatedCount,
        loginSuccess   : 0,
        loginFailed    : 0,
        rechargeSuccess: 0,
        rechargeFailed : 0,
        betSuccess     : 0,
        betFailed      : 0
    };

    // 步骤5: 登录 → 按分组执行充值/投注
    console.log(`📋 步骤5: 开始登录并按分组执行...\n`);

    // 构建 userId → 分组 的快速查找表
    const rechargeOnlySet = new Set(groups.rechargeOnly.map(String));

    for (let i = 0; i < userAccounts.length; i++) {
        sleep(1);
        const userAccount = userAccounts[i];

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[${i + 1}/${userAccounts.length}] 处理用户: ${userAccount.account} (userId: ${userAccount.userId})`);

        const isRechargeOnly = rechargeOnlySet.has(String(userAccount.userId));
        console.log(`行为分组: ${isRechargeOnly ? '半活跃（只充值）' : '活跃（充值+投注）'}`);
        console.log(`${'─'.repeat(60)}`);

        const loginInfo = loginUser(userAccount.account, userAccount.accountType, adminData);
        if (!loginInfo) {
            stats.loginFailed++;
            console.error(`❌ 登录失败，跳过\n`);
            sleep(1);
            continue;
        }
        stats.loginSuccess++;
        sleep(2);

        if (isRechargeOnly) {
            // 半活跃：只充值
            const r = processUserRechargeOnly(loginInfo, adminData.token);
            if (r.recharged) stats.rechargeSuccess++;
            else stats.rechargeFailed++;
        } else {
            // 活跃：充值 + 投注（复用现有函数）
            const r = processUserRechargeAndBet(loginInfo, adminData.token);
            if (r.recharged) stats.rechargeSuccess++;
            else stats.rechargeFailed++;
            if (r.betted) stats.betSuccess++;
            else if (r.recharged) stats.betFailed++;
        }

        sleep(2);
    }

    // 打印统计
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 [V2] 团队充值和投注统计结果`);
    console.log(`${'='.repeat(60)}`);
    console.log(`总用户数    : ${stats.total}`);
    console.log(`不活跃（跳过）: ${stats.inactive} (${((stats.inactive / stats.total) * 100).toFixed(1)}%)`);
    console.log(`半活跃（只充值）: ${stats.rechargeOnly} (${((stats.rechargeOnly / stats.total) * 100).toFixed(1)}%)`);
    console.log(`活跃（充值+投注）: ${stats.active} (${((stats.active / stats.total) * 100).toFixed(1)}%)`);
    console.log(`返佣设置    : ${stats.rebateUpdated}`);
    console.log(`登录成功    : ${stats.loginSuccess} / 失败: ${stats.loginFailed}`);
    console.log(`充值成功    : ${stats.rechargeSuccess} / 失败: ${stats.rechargeFailed}`);
    console.log(`投注成功    : ${stats.betSuccess} / 失败: ${stats.betFailed}`);
    console.log(`${'='.repeat(60)}\n`);

    return stats;
}
