/**
 * 提现流程逻辑 - 多租户版本
 */

import { sleep } from 'k6';
import { getTestSession } from '../common/session.js';
import { getAccountBalance } from '../balance/balance.test.js';
import {
    getWithdrawBasicInfo,
    setWithdrawPassword,
    getUserWithdrawWallet,
    withdrawApply
} from './withdrawApi.js';
import { runBackendWithdrawApproval } from './backendWithdrawApi.js';
import { addAllWallets } from './addWalletApi.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const tag = 'WithdrawTest';

/**
 * 过滤大于或等于阈值的数组
 * @param {number} threshold 阈值 (如余额)
 * @param {Array<number>} numbers 数组
 * @returns {Array<number>}
 */
function filterGreaterOrEqual(threshold, numbers) {
    if (!numbers || !Array.isArray(numbers)) return [];

    const result = [];
    for (const num of numbers) {
        if (num <= threshold) {
            result.push(num);
        }
    }
    return result;
}

/**
 * 执行提现逻辑
 * @param {string} token (Golang 的 context.Context)
 * @param {number} balance 用户余额
 * @param {object} allWithdraw 提现基础信息
 * @returns {object|null} { withDrawaAmont, withDrawaType } 或 null 表示失败
 */
export function executeWithdrawCase(token, balance, allWithdraw) {
    console.log(`[${tag}] 开始提现逻辑判断, 当前余额: ${balance}`);

    // 判断用户是否有钱
    if (balance <= 0.0) {
        console.warn(`[${tag}] 提现获取用户金额小于等于0`);
        return null;
    }

    console.log(`[${tag}] 用户今日提现次数: ${allWithdraw.userTodayWithdrawCount}`);
    console.log(`[${tag}] 用户剩余打码量: ${allWithdraw.amountCoding}`);

    // 判断每日提现次数，打码量是否满足
    if (allWithdraw.userTodayWithdrawCount === 0 || allWithdraw.amountCoding !== 0) {
        console.warn(`[${tag}] 用户的提现次数等于0, 或者 用户的打码量不等于0`);
        return null;
    }

    // 过滤可用提现金额（必须小于等于用户余额）
    let canWithDrawCaseList = filterGreaterOrEqual(balance, allWithdraw.withdrawAmountList || []);
    let todayWithdrawAmount = allWithdraw.userTodayWithdrawAmount;

    if (todayWithdrawAmount === -1) {
        // -1 表示没有限制，临时处理
        todayWithdrawAmount = 9999;
    }

    // 确保今日可提现金额不超过用户余额
    todayWithdrawAmount = Math.min(todayWithdrawAmount, balance);

    console.log(`[${tag}] 今日可提现金额上限: ${todayWithdrawAmount}`);
    console.log(`[${tag}] 可选提现金额列表: ${JSON.stringify(canWithDrawCaseList)}`);

    const maxRetries = 10;
    let retryCount = 0;
    let selectedAmountIndex = 0;
    let foundValidAmount = false;

    for (retryCount = 0; retryCount < maxRetries; retryCount++) {
        const listLen = canWithDrawCaseList.length;

        if (listLen === 0) {
            // 如果列表为空，说明不是商品模式，手动赋值
            // 生成不超过余额的金额列表
            const maxAmount = Math.floor(balance);
            canWithDrawCaseList = [];
            for (let i = 100; i <= 1000; i += 100) {
                if (i <= maxAmount) {
                    canWithDrawCaseList.push(i);
                }
            }
            // 如果余额太少，至少添加一个可提现金额
            if (canWithDrawCaseList.length === 0 && maxAmount >= 10) {
                canWithDrawCaseList.push(Math.floor(maxAmount / 10) * 10); // 取整到10的倍数
            }
            console.log(`[${tag}] 根据余额生成提现金额列表: ${JSON.stringify(canWithDrawCaseList)}`);

            if (canWithDrawCaseList.length === 0) {
                console.warn(`[${tag}] 余额不足，无法生成提现金额`);
                return null;
            }

            selectedAmountIndex = getRandomInt(0, canWithDrawCaseList.length - 1);
        } else if (listLen === 1) {
            selectedAmountIndex = 0;
        } else {
            selectedAmountIndex = getRandomInt(0, listLen - 1);
        }

        const selectedAmount = canWithDrawCaseList[selectedAmountIndex];
        console.log(`[${tag}] 随机出来的提现金额: ${selectedAmount}`);

        // 随机出来的值必须小于等于今日可提现的总金额，且不超过余额
        if (selectedAmount <= todayWithdrawAmount && selectedAmount <= balance) {
            foundValidAmount = true;
            break; // 找到合适的金额，退出循环
        }
    }

    if (!foundValidAmount || retryCount >= maxRetries) {
        console.warn(`[${tag}] 达到最大重试次数，无法找到合适的提现金额`);
        return null;
    }

    const withdrawAmount = canWithDrawCaseList[selectedAmountIndex];

    // 随机提现大类
    const withdrawCategoryList = allWithdraw.withdrawCategoryList || [];
    const categoryLen = withdrawCategoryList.length;

    if (categoryLen === 0) {
        console.warn(`[${tag}] 提现通道列表为空`);
        return null;
    }

    let foundValidCategory = false;
    let selectedCategoryIndex = 0;

    for (retryCount = 0; retryCount < maxRetries; retryCount++) {
        if (categoryLen === 1) {
            selectedCategoryIndex = 0;
        } else {
            selectedCategoryIndex = getRandomInt(0, categoryLen - 1);
        }

        // 排除 UPI 通道
        if (withdrawCategoryList[selectedCategoryIndex].withdrawType !== "UPI") {
            foundValidCategory = true;
            break; // 找到合适的通道，退出循环
        }
    }

    if (!foundValidCategory || retryCount >= maxRetries) {
        console.warn(`[${tag}] 达到最大重试次数，无法找到合适的提现通道 (非 UPI)`);
        return null;
    }

    const category = withdrawCategoryList[selectedCategoryIndex];
    const withdrawType = category.withdrawType;
    const withdrawId = category.id;

    console.log(`[${tag}] 选定提现通道: ${withdrawType}, ID: ${withdrawId}`);

    // 获取钱包 ID
    const walletId = getUserWithdrawWallet(token, withdrawType);

    if (!walletId) {
        console.warn(`[${tag}] 无法获取用户钱包信息，跳过提现`);
        return null;
    }

    console.log(`[${tag}] 获取到钱包ID: ${walletId}`);

    // 执行提现
    const applyResult = withdrawApply(token, withdrawAmount, walletId, withdrawId, withdrawType, "123456");

    if (!applyResult) {
        console.error(`[${tag}] 提现申请失败`);
        return null;
    }

    console.log(`[${tag}] ✅ 提现申请成功: 金额=${withdrawAmount}, 通道=${withdrawType}`);

    return {
        withDrawaAmont: withdrawAmount,
        withDrawaType: withdrawType
    };
}

/**
 * 完整提现流程主函数 - 多租户版本
 */
export function RunWithDrawCase() {
    // 从环境变量获取租户ID和账号信息
    const tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    console.log(`[${tag}] ========== 提现流程开始 ==========`);
    console.log(`[${tag}] 租户ID: ${tenantId}`);
    console.log(`[${tag}] 区号: ${countryCode}`);
    console.log(`[${tag}] 前台地址: ${envConfig.BASE_DESK_URL}`);
    console.log(`[${tag}] 语言: ${envConfig.LANGUAGE}`);

    // 生成或使用指定的账号
    let targetUser = __ENV.TARGET_USER;
    if (!targetUser || targetUser === "undefined") {
        // 根据租户配置生成正确区号的手机号
        targetUser = countryCode + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
        console.log(`[${tag}] 未提供账号，生成随机账号: ${targetUser}`);
    } else {
        console.log(`[${tag}] 使用指定账号: ${targetUser}`);
    }

    const isRegister = __ENV.IS_REGISTER === 'true';

    // 1. 获取测试会话 (自动处理获取验证码、登录/注册、获取 UserId)
    const session = getTestSession(targetUser, isRegister);

    if (!session) {
        console.error(`[${tag}] 会话初始化失败，提现流程终止`);
        return;
    }

    const token = session.userToken;
    const userId = session.userId;

    console.log(`[${tag}] ✅ 会话建立成功: UserId=${userId}, UserName=${session.userName}`);

    // 2. 后台登录获取管理员token
    console.log(`[${tag}] 正在进行后台登录...`);
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        console.error(`[${tag}] 后台登录失败，无法添加钱包`);
        return;
    }
    console.log(`[${tag}] ✅ 后台登录成功`);

    // 3. 添加所有类型的钱包
    console.log(`[${tag}] 正在为用户添加钱包...`);
    const walletsAdded = addAllWallets(adminToken, userId);
    if (!walletsAdded) {
        console.warn(`[${tag}] ⚠️ 部分钱包添加失败，但继续执行提现流程`);
    } else {
        console.log(`[${tag}] ✅ 所有钱包添加成功`);
    }

    sleep(1); // 等待钱包数据同步

    // 4. 获取提现基础信息
    console.log(`[${tag}] 正在获取提现基础信息...`);
    const allWithdrawInfo = getWithdrawBasicInfo(token);
    if (!allWithdrawInfo) {
        console.error(`[${tag}] 获取提现基础信息失败，可能是token无效或签名问题`);
        return;
    }
    console.log(`[${tag}] ✅ 提现基础信息获取成功`);

    // 5. 获取余额
    console.log(`[${tag}] 正在获取账户余额...`);
    const balanceInfo = getAccountBalance(token);
    let money = balanceInfo ? balanceInfo.balance : 0.0;
    console.log(`[${tag}] 当前余额: ${money}`);

    // 6. 设置提现密码
    // 注意：如果密码接口 404 或返回已设置，我们只作为警告不阻断提现流程
    console.log(`[${tag}] 正在设置提现密码...`);
    const pwdRes = setWithdrawPassword(token);
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn(`[${tag}] 设置提现密码可能失败或接口路径不准确，但这可能是非致命的，继续尝试提现: `, JSON.stringify(pwdRes));
    } else {
        console.log(`[${tag}] ✅ 提现密码设置成功`);
    }

    // 7. 执行核心提现逻辑
    console.log(`[${tag}] 开始执行提现逻辑...`);
    const withdrawResult = executeWithdrawCase(token, money, allWithdrawInfo);

    if (!withdrawResult) {
        console.error(`[${tag}] ❌ 提现逻辑执行未通过，流程终止`);
        return;
    }

    console.log(`[${tag}] ========== 提现申请完成 ==========`);
    console.log(`[${tag}] 用户: ${userId} (${session.userName})`);
    console.log(`[${tag}] 提现金额: ${withdrawResult.withDrawaAmont}`);
    console.log(`[${tag}] 提现渠道: ${withdrawResult.withDrawaType}`);
    console.log(`[${tag}] 租户: ${tenantId}`);

    // 8. 后台审核流程（可选，根据环境变量决定是否执行）
    const enableBackendApproval = __ENV.ENABLE_BACKEND_APPROVAL === 'true';
    if (enableBackendApproval) {
        console.log(`[${tag}] ========== 开始后台审核 ==========`);
        sleep(2); // 等待订单生成

        const approvalSuccess = runBackendWithdrawApproval(
            adminToken,
            userId,
            withdrawResult.withDrawaType,
            withdrawResult.withDrawaAmont
        );

        if (approvalSuccess) {
            console.log(`[${tag}] ✅ 后台审核完成，提现已出款`);
        } else {
            console.warn(`[${tag}] ⚠️ 后台审核失败，需要手动处理`);
        }
    } else {
        console.log(`[${tag}] ℹ️ 跳过后台审核（设置 ENABLE_BACKEND_APPROVAL=true 启用）`);
    }
}

export default function () {
    RunWithDrawCase();
}



// # 为 3003 租户（52区号）执行提现测试
// k6 run -e TENANT=3003 k6/tests/api/withdraw/withdraw.test.js

// # 为 3002 租户使用指定账号
// k6 run -e TENANT=3003 -e TARGET_USER=523021199746 k6/tests/api/withdraw/withdraw.test.js
// k6 run -e TENANT=3004 -e TARGET_USER=913258544276 withdraw.test.js

// # 使用便捷脚本
// ./k6/tests/api/withdraw/run-withdraw-by-tenant.sh 3003
