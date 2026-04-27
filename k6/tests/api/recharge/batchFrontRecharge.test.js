/**
 * 批量前台充值发起脚本 (临时验证功能)
 * 
 * 功能：
 * 1. 动态获取用户列表。
 * 2. 模拟用户前台发起充值申请。
 * 3. 提交本地通道凭证（LocalEWallet/LocalBankCard/LocalUSDT）。
 * 4. 不进行后台审核，仅发起充值成功即结束。
 * 
 * 运行方式：
 * k6 run -e TENANT_ID=3004 -e FETCH_COUNT=10 k6/tests/api/recharge/batchFrontRecharge.test.js
 * k6 run -e TENANT_ID=3004 -e FETCH_COUNT=15 batchFrontRecharge.test.js
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTestSession } from '../common/session.js';
import { batchGetUserAccounts } from '../user/userAccountApi.js';
import { sendRequest } from '../common/request.js';
import {
    getRechargeCategoryList,
    depositRecharge,
    submitCertificate,
    generateRandomAccountNo,
    generateRandomHolderName,
    generateUsdtTransactionId
} from './frontendRechargeApi.js';

// 获取环境变量
const FETCH_COUNT = __ENV.FETCH_COUNT ? parseInt(__ENV.FETCH_COUNT) : 10;
const RECHARGE_AMOUNT = __ENV.RECHARGE_AMOUNT ? parseInt(__ENV.RECHARGE_AMOUNT) : 1000;
const tenantId = __ENV.TENANT_ID || '3004';

export const options = {
    scenarios: {
        batch_front_recharge: {
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
    console.log(`\n[Setup] 开始准备批量充值用户数据 (目标数量: ${FETCH_COUNT})...`);

    // 1. 管理员登录
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败');
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

    const response = sendRequest(payload, userPageApi, 'GetUserPageList', false, adminToken);

    if (!response || !response.list) {
        throw new Error('[Setup] ❌ 获取用户列表失败');
    }

    const rawUsers = response.list;
    const userIds = rawUsers.map(u => u.userId);

    // 3. 将 userId 转换为真实账号
    const userAccounts = batchGetUserAccounts(adminToken, userIds, 300);

    return {
        accounts: userAccounts
    };
}

export default function (data) {
    const { accounts } = data;
    const index = __ITER;
    if (index >= accounts.length) return;

    const userEntry = accounts[index];
    const account = userEntry.account;

    console.log(`\n===========================================`);
    console.log(`[BatchRecharge] 正在处理 [${index + 1}/${accounts.length}]: ${account}`);
    console.log(`===========================================`);

    // 1. 登录
    const session = getTestSession(String(account), false, userEntry.accountType);
    if (!session) {
        console.error(`[BatchRecharge] ❌ 用户 ${account} 登录失败`);
        return;
    }
    const { userToken } = session;

    // 2. 获取充值通道
    const categories = getRechargeCategoryList(userToken);
    if (!categories || categories.length === 0) {
        console.error(`[BatchRecharge] ❌ 用户 ${account} 获取充值通道失败`);
        return;
    }

    // 3. 随机决定充值次数 (1-3次)
    const rechargeCount = getRandomInt(1, 3);
    console.log(`[BatchRecharge] 用户 ${account} 本次将发起 ${rechargeCount} 次充值申请`);

    for (let i = 0; i < rechargeCount; i++) {
        console.log(`\n[BatchRecharge] [${account}] --- 第 ${i + 1}/${rechargeCount} 次充值 ---`);

        // 筛选一个合适的通道 (优先 Local 通道)
        let category = categories.find(c => c.rechargeType.startsWith('Local')) || categories[0];
        const { id: categoryId, rechargeType, name } = category;

        // 发起充值请求，带重试逻辑
        let success = false;
        let retryCount = 0;
        const maxRetries = 3;
        let response = null;

        while (retryCount <= maxRetries) {
            response = depositRechargeLocal(userToken, {
                rechargeCategoryId: categoryId,
                amount: RECHARGE_AMOUNT,
                rechargeType: rechargeType
            });

            if (response && (response.code === 0 || response.msgCode === 0)) {
                console.log(`[BatchRecharge] ✅ 充值申请提交成功! 订单号: ${response.data?.orderNo}`);
                success = true;
                break;
            } else if (response && response.msgCode === 13) {
                // 错误码 13: Too frequent access
                retryCount++;
                if (retryCount <= maxRetries) {
                    console.warn(`[BatchRecharge] ⚠️ 访问太频繁 (msgCode: 13)，等待 3 秒后进行第 ${retryCount} 次重试...`);
                    sleep(3);
                } else {
                    console.error(`[BatchRecharge] ❌ 访问太频繁，已达最大重试次数`);
                }
            } else {
                console.error(`[BatchRecharge] ❌ 充值申请失败: ${response ? response.msg : '未知错误'}`);
                break;
            }
        }

        if (!success) continue;

        // 4. 如果是本地通道，需要提交凭证
        const orderNo = response.data?.orderNo;
        const orderCreateTime = response.data?.createTime;

        if (orderNo && orderCreateTime) {
            if (rechargeType === 'LocalEWallet') {
                console.log(`[BatchRecharge] 正在提交 LocalEWallet 凭证...`);
                submitCertificate(userToken, orderNo, orderCreateTime, "", 1);
            } else if (rechargeType === 'LocalBankCard') {
                console.log(`[BatchRecharge] 正在提交 LocalBankCard 凭证...`);
                let txId = '';
                for (let i = 0; i < 12; i++) txId += Math.floor(Math.random() * 10);
                submitCertificate(userToken, orderNo, orderCreateTime, txId, 1);
            } else if (rechargeType === 'LocalUSDT') {
                console.log(`[BatchRecharge] 正在提交 LocalUSDT 凭证...`);
                const txId = generateUsdtTransactionId();
                submitCertificate(userToken, orderNo, orderCreateTime, txId, 1);
            }
        }

        console.log(`[BatchRecharge] 第 ${i + 1} 次发起流程结束`);
        sleep(2);
    }

    console.log(`[BatchRecharge] 用户 ${account} 处理完毕`);
}

/**
 * 获取随机整数
 */
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 本地封装充值申请函数
 */
function depositRechargeLocal(token, payload) {
    const api = '/api/Recharge/DepositRecharge';
    // 组装逻辑与 frontendRechargeApi.js 保持一致
    const { rechargeType, ...restPayload } = payload;

    // 这里简化处理，直接调用 depositRecharge 即可，但我们需要它的原始响应
    // 之前的 depositRecharge 已经包含了大部分逻辑，我们复用它
    return depositRecharge(token, payload);
}

