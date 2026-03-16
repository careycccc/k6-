/**
 * 提现流程逻辑
 */

import { sleep } from 'k6';
import { getTestSession } from '../common/session.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { 
    getWithdrawBasicInfo, 
    setWithdrawPassword, 
    getUserWithdrawWallet, 
    withdrawApply 
} from './withdrawApi.js';
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

    // 过滤可用提现金额
    let canWithDrawCaseList = filterGreaterOrEqual(balance, allWithdraw.withdrawAmountList || []);
    let todayWithdrawAmount = allWithdraw.userTodayWithdrawAmount;
    
    if (todayWithdrawAmount === -1) {
        // -1 表示没有限制，临时处理
        todayWithdrawAmount = 9999;
    }

    const maxRetries = 10;
    let retryCount = 0;
    let selectedAmountIndex = 0;
    let foundValidAmount = false;

    for (retryCount = 0; retryCount < maxRetries; retryCount++) {
        const listLen = canWithDrawCaseList.length;
        
        if (listLen === 0) {
            // 如果列表为空，说明不是商品模式，手动赋值
            canWithDrawCaseList = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
            selectedAmountIndex = getRandomInt(0, canWithDrawCaseList.length - 1);
        } else if (listLen === 1) {
            selectedAmountIndex = 0;
        } else {
            selectedAmountIndex = getRandomInt(0, listLen - 1);
        }

        const selectedAmount = canWithDrawCaseList[selectedAmountIndex];
        console.log(`[${tag}] 随机出来的提现金额: ${selectedAmount}`);

        // 随机出来的值必须小于等于今日可提现的总金额
        if (selectedAmount <= todayWithdrawAmount) {
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
    const walletInfo = getUserWithdrawWallet(token, withdrawType);
    let walletId = walletInfo ? walletInfo.walletId : null;

    if (!walletId) {
        console.warn(`[${tag}] 无法获取用户钱包信息，跳过提现`);
        // 实际上可以生成一个随机ID或mock ID，根据实际业务判断
        walletId = 0; // 假设失败为0
    }

    // 执行提现
    const applyResult = withdrawApply(token, withdrawAmount, walletId, withdrawId, withdrawType, "password123");
    
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
 * 完整提现流程主函数
 * 相当于 Golang 的 RunWithDrawCase()
 */
export function RunWithDrawCase() {
    const userName = "911537394568";
    
    console.log(`[${tag}] 开始完整提现流程，用户: ${userName}`);

    const targetUser = __ENV.TARGET_USER || userName;
    const isRegister = __ENV.IS_REGISTER === 'true';

    // 1. 获取测试会话 (自动处理获取验证码、登录/注册、获取 UserId)
    const session = getTestSession(targetUser, isRegister);
    
    if (!session) {
        console.error(`[${tag}] 会话初始化失败，提现流程终止`);
        return;
    }

    const token = session.userToken;
    const userId = session.userId;

    // k6 不支持 goroutine/channels，我们顺序或者Promise获取数据
    // 由于 sendRequest 通常是同步的HTTP请求，我们顺序执行
    
    // 2. 获取基础信息 (Golang: GetWithdrawBasicInfo)
    const allWithdrawInfoResponse = getWithdrawBasicInfo(token);
    if (!allWithdrawInfoResponse || allWithdrawInfoResponse.msgCode !== undefined) {
        // 如果返回了带有 msgCode 的对象说明请求有业务错误，例如 msgCode: 3
        console.error(`[${tag}] 获取提现基础信息失败，可能是签名或参数问题: `, JSON.stringify(allWithdrawInfoResponse));
        return;
    }
    const allWithdrawInfo = allWithdrawInfoResponse; // 此时它是真正的 data 对象

    // 4. 获取余额 (Golang: RecoverSaasBalance)
    const balanceInfo = getAccountBalance(token);
    let money = balanceInfo ? balanceInfo.balance : 0.0;

    // 5. 添加钱包后台异步执行 (Golang: RunAddWallet)
    // k6 没有真正的异步且不能阻塞主线程太久，我们可以直接调用或者不调用
    // 这里不包含后台调用API，仅作注释说明
    console.log(`[${tag}] 模拟调用添加钱包: ${userId}`);

    // 6. 设置提现密码 (Golang: SetWithdrawPasswordApi)
    // 注意：如果密码接口 404 或返回已设置，我们只作为警告不阻断提现流程
    const pwdRes = setWithdrawPassword(token);
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn(`[${tag}] 设置提现密码可能失败或接口路径不准确，但这可能是非致命的，继续尝试提现: `, JSON.stringify(pwdRes));
    } else {
        console.log(`[${tag}] 提现密码设置响应: 成功`);
    }

    // 7. 执行核心提现逻辑
    const withdrawResult = executeWithdrawCase(token, money, allWithdrawInfo);

    if (!withdrawResult) {
        console.error(`[${tag}] 提现逻辑执行未通过，流程终止`);
        return;
    }

    // 8. 下单 (Golang: RunWithdraw)
    // 在 k6 脚本里可能就是单纯打印日志
    console.log(`[${tag}] 触发下单记录: 用户=${userId}, 金额=${withdrawResult.withDrawaAmont}, 渠道=${withdrawResult.withDrawaType}`);
}

export default function () {
    RunWithDrawCase();
}
