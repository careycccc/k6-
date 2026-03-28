/**
 * 批量充值投注提现测试
 * 
 * 功能：随机生成多个账号，进行充值、投注和提现操作
 * 
 * 流程：
 * 1. 批量注册账号（手机号或邮箱）
 * 2. 批量充值（混合策略：前台优先，后台兜底）
 * 3. 批量投注（完成打码量）
 * 4. 添加提现钱包
 * 5. 批量提现
 * 6. 后台审核提现（可选）
 * 
 * 环境变量：
 * - TENANT_ID: 租户ID（必需）
 * - LANGUAGE: 语言（默认en）
 * - ACCOUNT_COUNT: 账号数量（默认10）
 * - MIN_RECHARGE: 最小充值金额（默认1000）
 * - MAX_RECHARGE: 最大充值金额（默认5000）
 * - BET_ROUNDS: 投注轮数（默认5）
 * - WITHDRAW_RATIO: 提现比例 0-1（默认0.8，即充值金额的80%）
 * - ENABLE_BACKEND_APPROVAL: 是否启用后台审核（默认false）
 * - CONCURRENT_SIZE: 并发处理数量（默认5）
 */

import { sleep } from 'k6';
import { phoneRegister, emailRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { generateRandomPhone, generateRandomEmail } from '../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import { getWithdrawBasicInfo, setWithdrawPassword, getUserWithdrawWallet, withdrawApply } from '../withdraw/withdrawApi.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { runBackendWithdrawApproval } from '../withdraw/backendWithdrawApi.js';
import { betRun } from '../runbet/betRun.js';

const tag = 'BatchRechargeWithdrawWithBet';

/**
 * 获取环境变量配置
 */
function getConfig() {
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const language = __ENV.LANGUAGE || 'en';
    const accountCount = parseInt(__ENV.ACCOUNT_COUNT) || 10;
    const minRecharge = parseInt(__ENV.MIN_RECHARGE) || 1000;
    const maxRecharge = parseInt(__ENV.MAX_RECHARGE) || 5000;
    const betRounds = parseInt(__ENV.BET_ROUNDS) || 5;
    const withdrawRatio = parseFloat(__ENV.WITHDRAW_RATIO) || 0.8;
    const enableBackendApproval = __ENV.ENABLE_BACKEND_APPROVAL === 'true';
    const concurrentSize = parseInt(__ENV.CONCURRENT_SIZE) || 5;

    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    return {
        tenantId,
        language,
        accountCount,
        minRecharge,
        maxRecharge,
        betRounds,
        withdrawRatio,
        enableBackendApproval,
        concurrentSize,
        countryCode,
        envConfig
    };
}

/**
 * 获取随机充值金额
 */
function getRandomRechargeAmount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 注册单个账号（手机号优先，失败则邮箱）
 */
function registerAccount(data, config, index, total) {
    const { countryCode } = config;

    console.log(`\n[${tag}] [${index}/${total}] 开始注册账号...`);

    // 1. 尝试手机号注册
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] [${index}/${total}] 尝试手机号注册: ${phone}`);

    let registerResult = phoneRegister(phone, data);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] [${index}/${total}] ✅ 手机号注册成功: ${phone}`);
        return {
            success: true,
            account: phone,
            type: 'phone',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    // 2. 手机号失败，尝试邮箱注册
    console.log(`[${tag}] [${index}/${total}] 手机号注册失败，尝试邮箱注册...`);
    const email = generateRandomEmail();
    console.log(`[${tag}] [${index}/${total}] 尝试邮箱注册: ${email}`);

    registerResult = emailRegister(email, data);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] [${index}/${total}] ✅ 邮箱注册成功: ${email}`);
        return {
            success: true,
            account: email,
            type: 'email',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    console.error(`[${tag}] [${index}/${total}] ❌ 账号注册失败`);
    return { success: false };
}

/**
 * 批量注册账号
 */
function batchRegisterAccounts(data, config) {
    console.log(`\n[${tag}] ========== 批量注册账号 ==========`);
    console.log(`[${tag}] 目标数量: ${config.accountCount}`);

    const accounts = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < config.accountCount; i++) {
        const result = registerAccount(data, config, i + 1, config.accountCount);

        if (result.success) {
            // 获取用户信息
            const userInfo = getFrontUserInfo(result.token);
            if (userInfo && userInfo.userId) {
                accounts.push({
                    account: result.account,
                    type: result.type,
                    token: result.token,
                    userId: userInfo.userId
                });
                successCount++;
                console.log(`[${tag}] [${i + 1}/${config.accountCount}] ✅ 账号创建成功: ${result.account}, userId: ${userInfo.userId}`);
            } else {
                failedCount++;
                console.error(`[${tag}] [${i + 1}/${config.accountCount}] ❌ 获取用户信息失败`);
            }
        } else {
            failedCount++;
        }

        // 避免请求过快
        if (i < config.accountCount - 1) {
            sleep(0.5);
        }
    }

    console.log(`\n[${tag}] 注册完成: 成功=${successCount}, 失败=${failedCount}`);
    return accounts;
}

/**
 * 批量充值
 */
function batchRechargeAccounts(accounts, adminToken, config) {
    console.log(`\n[${tag}] ========== 批量充值 ==========`);
    console.log(`[${tag}] 账号数量: ${accounts.length}`);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const rechargeAmount = getRandomRechargeAmount(config.minRecharge, config.maxRecharge);

        console.log(`\n[${tag}] [${i + 1}/${accounts.length}] 充值: ${account.account}, 金额: ${rechargeAmount}`);

        const rechargeResult = hybridRecharge({
            userToken: account.token,
            adminToken: adminToken,
            userId: account.userId,
            amount: rechargeAmount,
            frontendFirst: true,
            remark: `BatchRecharge-${i + 1}`
        });

        if (rechargeResult.success) {
            account.rechargeAmount = rechargeAmount;
            account.rechargeMethod = rechargeResult.method;
            successCount++;
            console.log(`[${tag}] [${i + 1}/${accounts.length}] ✅ 充值成功: ${rechargeAmount}, 方式: ${rechargeResult.method}`);
        } else {
            account.rechargeAmount = 0;
            account.rechargeFailed = true;
            failedCount++;
            console.error(`[${tag}] [${i + 1}/${accounts.length}] ❌ 充值失败`);
        }

        // 批次间等待
        if (i < accounts.length - 1) {
            sleep(1);
        }
    }

    console.log(`\n[${tag}] 充值完成: 成功=${successCount}, 失败=${failedCount}`);
    return { success: successCount, failed: failedCount };
}

/**
 * 批量投注
 */
function batchBetAccounts(accounts, config) {
    console.log(`\n[${tag}] ========== 批量投注 ==========`);

    // 只处理充值成功的账号
    const validAccounts = accounts.filter(a => !a.rechargeFailed);
    console.log(`[${tag}] 可投注账号数量: ${validAccounts.length}/${accounts.length}`);
    console.log(`[${tag}] 每个账号投注轮数: ${config.betRounds}`);

    let totalBetCount = 0;
    let successBetCount = 0;
    let failedBetCount = 0;

    for (let i = 0; i < validAccounts.length; i++) {
        const account = validAccounts[i];
        console.log(`\n[${tag}] [${i + 1}/${validAccounts.length}] 开始投注: ${account.account}`);

        let accountBetSuccess = 0;
        let accountBetFailed = 0;

        for (let round = 1; round <= config.betRounds; round++) {
            console.log(`[${tag}] [${i + 1}/${validAccounts.length}] 第 ${round}/${config.betRounds} 轮投注...`);

            const betResult = betRun(account.token, account.account);

            if (betResult) {
                accountBetSuccess++;
                successBetCount++;
                console.log(`[${tag}] [${i + 1}/${validAccounts.length}] ✅ 第 ${round} 轮投注成功`);
            } else {
                accountBetFailed++;
                failedBetCount++;
                console.error(`[${tag}] [${i + 1}/${validAccounts.length}] ❌ 第 ${round} 轮投注失败`);
            }

            totalBetCount++;

            // 投注间隔
            if (round < config.betRounds) {
                sleep(2);
            }
        }

        account.betSuccess = accountBetSuccess;
        account.betFailed = accountBetFailed;
        account.betTotal = config.betRounds;

        console.log(`[${tag}] [${i + 1}/${validAccounts.length}] 投注完成: 成功=${accountBetSuccess}, 失败=${accountBetFailed}`);

        // 账号间等待
        if (i < validAccounts.length - 1) {
            sleep(1);
        }
    }

    console.log(`\n[${tag}] 投注完成: 总投注=${totalBetCount}, 成功=${successBetCount}, 失败=${failedBetCount}`);
    return { total: totalBetCount, success: successBetCount, failed: failedBetCount };
}

/**
 * 单个账号提现流程
 */
function withdrawSingleAccount(account, adminToken, config, index, total) {
    console.log(`\n[${tag}] [${index}/${total}] 开始提现: ${account.account}`);

    // 跳过充值失败的账号
    if (account.rechargeFailed) {
        console.warn(`[${tag}] [${index}/${total}] 跳过（充值失败）`);
        return { success: false, reason: 'recharge_failed' };
    }

    // 1. 获取余额
    console.log(`[${tag}] [${index}/${total}] 步骤1: 获取余额...`);
    const balanceInfo = getAccountBalance(account.token);
    if (!balanceInfo) {
        console.error(`[${tag}] [${index}/${total}] ❌ 获取余额失败`);
        return { success: false, reason: 'get_balance_failed' };
    }

    if (balanceInfo.balance <= 0) {
        console.warn(`[${tag}] [${index}/${total}] ⚠️ 余额不足: ${balanceInfo.balance}`);
        return { success: false, reason: 'insufficient_balance', balance: balanceInfo.balance };
    }

    const balance = balanceInfo.balance;
    console.log(`[${tag}] [${index}/${total}] ✅ 当前余额: ${balance}`);

    // 2. 添加钱包
    console.log(`[${tag}] [${index}/${total}] 步骤2: 添加提现钱包...`);
    const walletsAdded = addAllWallets(adminToken, account.userId);
    if (!walletsAdded) {
        console.warn(`[${tag}] [${index}/${total}] ⚠️ 钱包添加失败，继续尝试提现`);
    } else {
        console.log(`[${tag}] [${index}/${total}] ✅ 钱包添加成功`);
    }

    sleep(1);

    // 3. 设置提现密码
    console.log(`[${tag}] [${index}/${total}] 步骤3: 设置提现密码...`);
    const pwdResult = setWithdrawPassword(account.token, "123456");
    if (!pwdResult || (pwdResult.msgCode !== 0 && pwdResult.msgCode !== undefined)) {
        console.warn(`[${tag}] [${index}/${total}] ⚠️ 设置提现密码可能失败，但继续尝试: ${JSON.stringify(pwdResult)}`);
    } else {
        console.log(`[${tag}] [${index}/${total}] ✅ 提现密码设置成功`);
    }

    // 4. 获取提现基础信息
    console.log(`[${tag}] [${index}/${total}] 步骤4: 获取提现基础信息...`);
    const withdrawInfo = getWithdrawBasicInfo(account.token);
    if (!withdrawInfo) {
        console.error(`[${tag}] [${index}/${total}] ❌ 获取提现信息失败`);
        return { success: false, reason: 'get_info_failed' };
    }
    console.log(`[${tag}] [${index}/${total}] ✅ 提现信息获取成功`);

    // 4. 检查提现条件
    console.log(`[${tag}] [${index}/${total}] 步骤4: 检查提现条件...`);
    console.log(`[${tag}] [${index}/${total}]   - 今日提现次数: ${withdrawInfo.userTodayWithdrawCount}`);
    console.log(`[${tag}] [${index}/${total}]   - 剩余打码量: ${withdrawInfo.amountCoding}`);
    console.log(`[${tag}] [${index}/${total}]   - 提现通道数: ${withdrawInfo.withdrawCategoryList?.length || 0}`);

    if (withdrawInfo.userTodayWithdrawCount === 0) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 今日提现次数为0，跳过`);
        return { success: false, reason: 'no_withdraw_count' };
    }

    if (withdrawInfo.amountCoding !== 0) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 打码量未完成: ${withdrawInfo.amountCoding}，跳过`);
        return { success: false, reason: 'coding_not_complete', codingAmount: withdrawInfo.amountCoding };
    }

    console.log(`[${tag}] [${index}/${total}] ✅ 提现条件检查通过`);


    // 5. 计算提现金额（充值金额的指定比例）
    console.log(`[${tag}] [${index}/${total}] 步骤5: 计算提现金额...`);
    const withdrawAmount = Math.floor(account.rechargeAmount * config.withdrawRatio);
    console.log(`[${tag}] [${index}/${total}]   - 充值金额: ${account.rechargeAmount}`);
    console.log(`[${tag}] [${index}/${total}]   - 提现比例: ${config.withdrawRatio * 100}%`);
    console.log(`[${tag}] [${index}/${total}]   - 计划提现: ${withdrawAmount}`);
    console.log(`[${tag}] [${index}/${total}]   - 当前余额: ${balance}`);

    if (withdrawAmount > balance) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 提现金额 ${withdrawAmount} 超过余额 ${balance}`);
        return { success: false, reason: 'amount_exceeds_balance', withdrawAmount, balance };
    }

    if (withdrawAmount <= 0) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 提现金额无效: ${withdrawAmount}`);
        return { success: false, reason: 'invalid_amount', withdrawAmount };
    }

    console.log(`[${tag}] [${index}/${total}] ✅ 提现金额有效`);

    // 7. 选择提现通道
    console.log(`[${tag}] [${index}/${total}] 步骤7: 选择提现通道...`);
    const withdrawCategoryList = withdrawInfo.withdrawCategoryList || [];
    console.log(`[${tag}] [${index}/${total}]   - 可用通道数: ${withdrawCategoryList.length}`);

    if (withdrawCategoryList.length === 0) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 提现通道列表为空`);
        return { success: false, reason: 'no_withdraw_channel' };
    }

    // 打印所有通道
    withdrawCategoryList.forEach((cat, idx) => {
        console.log(`[${tag}] [${index}/${total}]   ${idx + 1}. ${cat.withdrawType} (ID: ${cat.id})`);
    });

    // 排除 UPI 通道，随机选择一个
    const validCategories = withdrawCategoryList.filter(c => c.withdrawType !== 'UPI');
    console.log(`[${tag}] [${index}/${total}]   - 排除UPI后: ${validCategories.length} 个通道`);

    if (validCategories.length === 0) {
        console.warn(`[${tag}] [${index}/${total}] ❌ 没有可用的提现通道（排除UPI后）`);
        return { success: false, reason: 'no_valid_channel' };
    }

    const randomIndex = Math.floor(Math.random() * validCategories.length);
    const selectedCategory = validCategories[randomIndex];
    const withdrawType = selectedCategory.withdrawType;
    const withdrawId = selectedCategory.id;

    console.log(`[${tag}] [${index}/${total}] ✅ 选择提现通道: ${withdrawType} (ID: ${withdrawId})`);

    // 8. 获取钱包ID
    console.log(`[${tag}] [${index}/${total}] 步骤8: 获取钱包ID...`);
    const walletId = getUserWithdrawWallet(account.token, withdrawType);
    if (!walletId) {
        console.error(`[${tag}] [${index}/${total}] ❌ 获取钱包ID失败，通道: ${withdrawType}`);
        return { success: false, reason: 'no_wallet', withdrawType };
    }
    console.log(`[${tag}] [${index}/${total}] ✅ 钱包ID: ${walletId}`);

    // 9. 提交提现申请
    console.log(`[${tag}] [${index}/${total}] 步骤9: 提交提现申请...`);
    console.log(`[${tag}] [${index}/${total}]   - 金额: ${withdrawAmount}`);
    console.log(`[${tag}] [${index}/${total}]   - 钱包ID: ${walletId}`);
    console.log(`[${tag}] [${index}/${total}]   - 通道ID: ${withdrawId}`);
    console.log(`[${tag}] [${index}/${total}]   - 通道类型: ${withdrawType}`);

    const applyResult = withdrawApply(account.token, withdrawAmount, walletId, withdrawId, withdrawType, "123456");
    if (!applyResult) {
        console.error(`[${tag}] [${index}/${total}] ❌ 提现申请失败`);
        return { success: false, reason: 'apply_failed', amount: withdrawAmount, withdrawType };
    }

    console.log(`[${tag}] [${index}/${total}] ✅ 提现申请成功: ${withdrawAmount}, 通道: ${withdrawType}`);

    // 10. 后台审核（如果启用）
    if (config.enableBackendApproval) {
        console.log(`[${tag}] [${index}/${total}] 等待2秒后进行后台审核...`);
        sleep(2);

        const approvalSuccess = runBackendWithdrawApproval(
            adminToken,
            account.userId,
            withdrawType,
            withdrawAmount
        );

        if (approvalSuccess) {
            console.log(`[${tag}] [${index}/${total}] ✅ 后台审核通过，提现已出款`);
            return {
                success: true,
                amount: withdrawAmount,
                type: withdrawType,
                approved: true
            };
        } else {
            console.warn(`[${tag}] [${index}/${total}] ⚠️ 后台审核失败`);
            return {
                success: true,
                amount: withdrawAmount,
                type: withdrawType,
                approved: false
            };
        }
    }

    return {
        success: true,
        amount: withdrawAmount,
        type: withdrawType,
        approved: false
    };
}

/**
 * 批量提现
 */
function batchWithdrawAccounts(accounts, adminToken, config) {
    console.log(`\n[${tag}] ========== 批量提现 ==========`);

    // 只处理充值成功的账号
    const validAccounts = accounts.filter(a => !a.rechargeFailed);
    console.log(`[${tag}] 可提现账号数量: ${validAccounts.length}/${accounts.length}`);

    let successCount = 0;
    let failedCount = 0;
    let approvedCount = 0;

    for (let i = 0; i < validAccounts.length; i++) {
        const account = validAccounts[i];
        const result = withdrawSingleAccount(account, adminToken, config, i + 1, validAccounts.length);

        if (result.success) {
            account.withdrawAmount = result.amount;
            account.withdrawType = result.type;
            account.withdrawApproved = result.approved;
            successCount++;

            if (result.approved) {
                approvedCount++;
            }
        } else {
            account.withdrawFailed = true;
            account.withdrawFailReason = result.reason;
            account.codingAmount = result.codingAmount;
            failedCount++;
        }

        // 批次间等待
        if (i < validAccounts.length - 1) {
            sleep(1);
        }
    }

    console.log(`\n[${tag}] 提现完成: 成功=${successCount}, 失败=${failedCount}, 已审核=${approvedCount}`);
    return { success: successCount, failed: failedCount, approved: approvedCount };
}

/**
 * 打印结果表格
 */
function printResultTable(accounts, config) {
    console.log(`\n[${tag}] ========== 批量充值投注提现结果 ==========`);
    console.log(`[${tag}] `);
    console.log(`[${tag}] ┌────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────────┐`);
    console.log(`[${tag}] │ 账号                   │ 充值金额 │ 充值方式 │ 投注成功 │ 提现金额 │ 提现状态     │`);
    console.log(`[${tag}] ├────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────────┤`);

    accounts.forEach((account) => {
        const acc = (account.account || 'N/A').padEnd(22, ' ');
        const rechargeAmt = (account.rechargeAmount || 0).toString().padEnd(8, ' ');
        const rechargeMethod = (account.rechargeMethod || 'N/A').padEnd(8, ' ');
        const betSuccess = `${account.betSuccess || 0}/${account.betTotal || 0}`.padEnd(8, ' ');
        const withdrawAmt = (account.withdrawAmount || 0).toString().padEnd(8, ' ');

        let withdrawStatus;
        if (account.rechargeFailed) {
            withdrawStatus = '充值失败'.padEnd(12, ' ');
        } else if (account.withdrawFailed) {
            // 根据失败原因显示不同状态
            const reason = account.withdrawFailReason || 'unknown';
            if (reason === 'coding_not_complete') {
                withdrawStatus = `打码未完成`.padEnd(12, ' ');
            } else if (reason === 'no_withdraw_count') {
                withdrawStatus = `次数为0`.padEnd(12, ' ');
            } else if (reason === 'insufficient_balance') {
                withdrawStatus = `余额不足`.padEnd(12, ' ');
            } else if (reason === 'no_wallet') {
                withdrawStatus = `无钱包`.padEnd(12, ' ');
            } else if (reason === 'no_withdraw_channel') {
                withdrawStatus = `无通道`.padEnd(12, ' ');
            } else if (reason === 'apply_failed') {
                withdrawStatus = `申请失败`.padEnd(12, ' ');
            } else {
                withdrawStatus = `❌ ${reason}`.substring(0, 12).padEnd(12, ' ');
            }
        } else if (account.withdrawAmount) {
            if (config.enableBackendApproval) {
                withdrawStatus = account.withdrawApproved ? '✅ 已出款'.padEnd(12, ' ') : '⏳ 待审核'.padEnd(12, ' ');
            } else {
                withdrawStatus = '✅ 已申请'.padEnd(12, ' ');
            }
        } else {
            withdrawStatus = '未提现'.padEnd(12, ' ');
        }

        console.log(`[${tag}] │ ${acc} │ ${rechargeAmt} │ ${rechargeMethod} │ ${betSuccess} │ ${withdrawAmt} │ ${withdrawStatus} │`);
    });

    console.log(`[${tag}] └────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────────┘`);
}

/**
 * 打印统计信息
 */
function printStatistics(accounts, rechargeStats, betStats, withdrawStats, config) {
    console.log(`\n[${tag}] ========== 统计信息 ==========`);

    // 账号统计
    console.log(`[${tag}] 账号: 总数=${config.accountCount}, 成功=${accounts.length}, 失败=${config.accountCount - accounts.length}`);

    // 充值统计
    const totalRechargeAmount = accounts.reduce((sum, a) => sum + (a.rechargeAmount || 0), 0);
    console.log(`[${tag}] 充值: 成功=${rechargeStats.success}, 失败=${rechargeStats.failed}, 总金额=${totalRechargeAmount}`);

    // 投注统计
    console.log(`[${tag}] 投注: 总投注=${betStats.total}, 成功=${betStats.success}, 失败=${betStats.failed}`);

    // 提现统计
    const totalWithdrawAmount = accounts.reduce((sum, a) => sum + (a.withdrawAmount || 0), 0);
    console.log(`[${tag}] 提现: 成功=${withdrawStats.success}, 失败=${withdrawStats.failed}, 总金额=${totalWithdrawAmount}`);

    // 提现失败原因统计
    if (withdrawStats.failed > 0) {
        console.log(`[${tag}] `);
        console.log(`[${tag}] 提现失败原因分析:`);
        const failReasons = {};
        accounts.forEach(a => {
            if (a.withdrawFailed && a.withdrawFailReason) {
                const reason = a.withdrawFailReason;
                failReasons[reason] = (failReasons[reason] || 0) + 1;
            }
        });

        const reasonNames = {
            'coding_not_complete': '打码量未完成',
            'no_withdraw_count': '提现次数为0',
            'insufficient_balance': '余额不足',
            'get_balance_failed': '获取余额失败',
            'get_info_failed': '获取提现信息失败',
            'no_wallet': '无钱包',
            'no_withdraw_channel': '无提现通道',
            'no_valid_channel': '无有效通道',
            'amount_exceeds_balance': '金额超过余额',
            'invalid_amount': '金额无效',
            'apply_failed': '申请失败'
        };

        for (const [reason, count] of Object.entries(failReasons)) {
            const reasonName = reasonNames[reason] || reason;
            console.log(`[${tag}]   - ${reasonName}: ${count}次`);
        }
    }

    if (config.enableBackendApproval) {
        console.log(`[${tag}] 审核: 已出款=${withdrawStats.approved}, 待审核=${withdrawStats.success - withdrawStats.approved}`);
    }

    // 成功率
    const rechargeSuccessRate = accounts.length > 0 ? (rechargeStats.success / accounts.length * 100).toFixed(2) : 0;
    const betSuccessRate = betStats.total > 0 ? (betStats.success / betStats.total * 100).toFixed(2) : 0;
    const withdrawSuccessRate = rechargeStats.success > 0 ? (withdrawStats.success / rechargeStats.success * 100).toFixed(2) : 0;

    console.log(`[${tag}] `);
    console.log(`[${tag}] 充值成功率: ${rechargeSuccessRate}%`);
    console.log(`[${tag}] 投注成功率: ${betSuccessRate}%`);
    console.log(`[${tag}] 提现成功率: ${withdrawSuccessRate}%`);
}

/**
 * Setup函数 - 初始化环境
 */
export function setup() {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 批量充值投注提现测试 - 初始化`);
    console.log(`${'='.repeat(100)}\n`);

    const config = getConfig();

    console.log(`[${tag}] 配置信息:`);
    console.log(`  - 租户ID: ${config.tenantId}`);
    console.log(`  - 语言: ${config.language}`);
    console.log(`  - 账号数量: ${config.accountCount}`);
    console.log(`  - 充值金额范围: ${config.minRecharge}-${config.maxRecharge}`);
    console.log(`  - 投注轮数: ${config.betRounds}`);
    console.log(`  - 提现比例: ${config.withdrawRatio * 100}%`);
    console.log(`  - 后台审核: ${config.enableBackendApproval ? '启用' : '禁用'}`);
    console.log(`  - 并发数: ${config.concurrentSize}`);
    console.log(`  - 区号: ${config.countryCode}`);

    // 更新全局 ENV_CONFIG
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, config.envConfig);
        console.log(`[${tag}] ✅ 已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
    }

    // 后台管理员登录
    console.log(`\n[${tag}] 后台管理员登录...`);
    const adminToken = tenantAdminLogin(config.tenantId);
    if (!adminToken) {
        throw new Error('后台管理员登录失败');
    }
    console.log(`[${tag}] ✅ 后台管理员登录成功`);

    return {
        token: adminToken,
        envConfig: config.envConfig,
        config: config
    };
}

/**
 * 主测试函数
 */
export default function (data) {
    const config = data.config;

    // VU中重新应用环境配置
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, data.envConfig);
        console.log(`[${tag}] ✅ VU中已更新 ENV_CONFIG`);
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 开始批量充值投注提现测试`);
    console.log(`${'='.repeat(100)}\n`);

    // 1. 批量注册账号
    const accounts = batchRegisterAccounts(data, config);

    if (accounts.length === 0) {
        console.error(`[${tag}] ❌ 没有成功注册的账号，测试终止`);
        return;
    }

    // 2. 批量充值
    const rechargeStats = batchRechargeAccounts(accounts, data.token, config);

    // 3. 批量投注
    const betStats = batchBetAccounts(accounts, config);

    // 4. 批量提现
    const withdrawStats = batchWithdrawAccounts(accounts, data.token, config);

    // 5. 打印结果
    printResultTable(accounts, config);
    printStatistics(accounts, rechargeStats, betStats, withdrawStats, config);

    console.log(`\n[${tag}] ========== 测试完成 ==========`);
}
