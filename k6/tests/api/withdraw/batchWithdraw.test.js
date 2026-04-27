/**
 * 批量提现测试脚本 (动态获取用户版本)
 * 
 * 提现规则：
 * - 提现1次几率100%
 * - 提现2次50%的概率
 * - 提现3次33%的概率
 * 
 * 运行方式：
 * k6 run -e TENANT_ID=3004 -e FETCH_COUNT=10 k6/tests/api/withdraw/batchWithdraw.test.js
 * 
 * k6 run -e TENANT_ID=3004 -e FETCH_COUNT=15 batchWithdraw.test.js
 * 
 * 参数说明：
 * FETCH_COUNT: 获取的用户数量，默认10
 */

import { sleep } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../user/userAccountApi.js';
import { backendRecharge } from '../recharge/rechargeService.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { addAllWallets } from './addWalletApi.js';
import { sendRequest } from '../common/request.js';
import {
    getWithdrawBasicInfo,
    setWithdrawPassword,
    getUserWithdrawWallet,
    withdrawApply
} from './withdrawApi.js';

// 获取环境变量
const FETCH_COUNT = __ENV.FETCH_COUNT ? parseInt(__ENV.FETCH_COUNT) : 10;
const tenantId = __ENV.TENANT_ID || '3004';

export const options = {
    scenarios: {
        batch_withdraw: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: FETCH_COUNT,
            maxDuration: '1h'
        }
    }
};

/**
 * Setup 阶段：获取用户列表并转换账号
 */
export function setup() {
    console.log(`\n[Setup] 开始准备批量提现用户数据 (目标数量: ${FETCH_COUNT})...`);

    // 1. 管理员登录
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败，无法继续');
    }

    // 2. 获取用户列表
    const userPageApi = '/api/Users/GetPageList';
    const payload = {
        userType: 0,
        state: 1,
        pageNo: 1,
        pageSize: FETCH_COUNT,
        orderBy: 'Desc'
    };

    console.log(`[Setup] 正在请求用户列表: ${userPageApi}`);
    const response = sendRequest(payload, userPageApi, 'GetUserPageList', false, adminToken);

    if (!response || !response.list) {
        console.error(`[Setup] 获取列表失败，响应内容:`, JSON.stringify(response));
        throw new Error('[Setup] ❌ 获取用户列表失败');
    }

    const rawUsers = response.list;
    const userIds = rawUsers.map(u => u.userId);
    console.log(`[Setup] 成功获取 ${userIds.length} 个用户 ID`);

    // 3. 将 userId 转换为真实账号
    const userAccounts = batchGetUserAccounts(adminToken, userIds, 500);

    if (userAccounts.length === 0) {
        throw new Error('[Setup] ❌ 无法转换任何用户的真实账号');
    }

    console.log(`[Setup] ✅ 准备就绪，共 ${userAccounts.length} 个账号进入测试流程`);

    return {
        accounts: userAccounts,
        adminToken: adminToken
    };
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default function (data) {
    const { accounts, adminToken } = data;

    const index = __ITER;
    if (index >= accounts.length) {
        console.warn(`[Iteration ${index}] 超出账号列表范围，跳过`);
        return;
    }

    const userEntry = accounts[index];
    const account = userEntry.account;
    const userId = userEntry.userId;

    console.log(`\n===========================================`);
    console.log(`[BatchWithdraw] 正在处理 [${index + 1}/${accounts.length}]: ${account} (ID: ${userId})`);
    console.log(`===========================================`);

    // 1. 登录会话获取 userToken（自动识别手机号/邮箱，调用对应登录方式）
    console.log(`[BatchWithdraw] 正在执行验证码登录流程: ${account}...`);
    const userToken = autoLoginByAccount(String(account), adminToken);

    if (!userToken) {
        console.error(`[BatchWithdraw] ❌ 用户 ${account} 验证码登录失败`);
        return;
    }

    console.log(`[BatchWithdraw] ✅ 登录成功，Token 已获取`);

    // 2. 保证提现金额充足
    const rechargeAmount = getRandomInt(2000, 5000);
    console.log(`[BatchWithdraw] 正在为用户充值，金额: ${rechargeAmount}...`);
    const rechargeRes = backendRecharge(adminToken, userId, rechargeAmount, 'Batch Withdraw Recharge');
    if (!rechargeRes || !rechargeRes.success) {
        console.error(`[BatchWithdraw] ❌ 用户 ${account} 充值失败`);
        return;
    }
    console.log(`[BatchWithdraw] ✅ 用户 ${account} 充值成功: ${rechargeAmount}`);
    sleep(1);

    // 3. 绑卡
    console.log(`[BatchWithdraw] 正在尝试绑定钱包 (Admin 操作)...`);
    addAllWallets(adminToken, userId);
    sleep(1);

    // 4. 设置/重置提现密码
    console.log(`[BatchWithdraw] 正在设置提现密码...`);
    setWithdrawPassword(userToken, '123456');
    sleep(1);

    // 5. 根据概率计算提现次数
    let withdrawCount = 1;
    const rand = Math.random();
    if (rand <= 0.33) {
        withdrawCount = 3;
    } else if (rand <= 0.50) {
        withdrawCount = 2;
    }

    console.log(`[BatchWithdraw] 用户 ${account} 命中提现概率分配，本次将进行 ${withdrawCount} 次提现`);

    // 6. 循环执行提现
    for (let i = 0; i < withdrawCount; i++) {
        console.log(`\n[BatchWithdraw] [${account}] --- 第 ${i + 1}/${withdrawCount} 次提现 ---`);

        const balanceInfo = getAccountBalance(userToken);
        if (!balanceInfo || balanceInfo.balance <= 0) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 余额不足或查询失败`);
            break;
        }

        const currentBalance = balanceInfo.balance;
        const withdrawInfo = getWithdrawBasicInfo(userToken);
        if (!withdrawInfo || !withdrawInfo.withdrawCategoryList || withdrawInfo.withdrawCategoryList.length === 0) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 获取提现通道失败`);
            break;
        }

        let category = withdrawInfo.withdrawCategoryList[0];
        for (let c of withdrawInfo.withdrawCategoryList) {
            if (c.withdrawType !== "UPI") {
                category = c;
                break;
            }
        }

        const walletId = getUserWithdrawWallet(userToken, category.withdrawType);
        if (!walletId) {
            console.error(`[BatchWithdraw] ❌ 用户 ${account} 未找到通道 ${category.withdrawType} 的钱包`);
            break;
        }

        let amount = getRandomInt(100, 500);
        if (amount > currentBalance) {
            amount = Math.floor(currentBalance);
        }

        if (amount < 10) {
            console.warn(`[BatchWithdraw] 用户 ${account} 余额太少 (${currentBalance})，无法满足最小提现需求`);
            break;
        }

        // 发起提现申请，带重试逻辑
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount <= maxRetries) {
            const response = withdrawApplyLocal(userToken, amount, walletId, category.id, category.withdrawType, '123456');

            if (response && response.msgCode === 0) {
                console.log(`[BatchWithdraw] ✅ 用户 ${account} 第 ${i + 1} 次提现申请成功: ${amount}`);
                break;
            } else if (response && response.msgCode === 13) {
                retryCount++;
                if (retryCount <= maxRetries) {
                    console.warn(`[BatchWithdraw] ⚠️ 访问太频繁 (msgCode: 13)，等待 3 秒后进行第 ${retryCount} 次重试...`);
                    sleep(3);
                } else {
                    console.error(`[BatchWithdraw] ❌ 访问太频繁，已达最大重试次数`);
                }
            } else {
                console.error(`[BatchWithdraw] ❌ 用户 ${account} 第 ${i + 1} 次提现申请失败: ${response ? response.msg : '未知错误'}`);
                break;
            }
        }

        sleep(2);
    }

    console.log(`[BatchWithdraw] 用户 ${account} 处理完毕`);
}

/**
 * 本地封装提现申请函数
 */
function withdrawApplyLocal(token, amount, walletId, withdrawCategoryId, withdrawType, withdrawPassword = '123456') {
    const api = '/api/Withdraw/WithdrawApply';
    const payload = {
        amount: amount,
        walletId: walletId,
        withdrawCategoryId: withdrawCategoryId,
        withdrawType: withdrawType,
        withdrawPassword: withdrawPassword
    };

    return tenantRequest(api, payload, { token, isDesk: true });
}
