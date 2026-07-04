/**
 * 提现流程逻辑 - 多租户 + 多账号多线程版本
 *
 * 单账号（原有用法）:
 *   k6 run -e TENANT=3004 -e TARGET_USER=915155160460 withdraw.test.js
 *
 * 多账号多线程（每个账号独立 VU 并发执行）:
 *   k6 run -e TENANT=3004 -e TARGET_USERS=918048050116,918048050117,918048050118 withdraw.test.js
 *
 * 其他可选参数:
 *   -e IS_REGISTER=true               是否注册新账号（默认 false）
 *   -e ENABLE_BACKEND_APPROVAL=true   是否自动后台审核（默认 false）
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

// ============================================================
// ==================== 参数解析 ==============================
// ============================================================

/**
 * 解析账号列表：
 *   - TARGET_USERS=111,222,333  → 多账号多线程模式
 *   - TARGET_USER=111           → 单账号兼容模式（转为长度1的数组）
 *   - 不传                      → 单账号随机生成模式
 */
function parseTargetUsers(envConfig) {
    const countryCode = envConfig.COUNTRY_CODE || '91';

    // 优先读 TARGET_USERS（多账号）
    const multiUsers = __ENV.TARGET_USERS;
    if (multiUsers && multiUsers !== 'undefined') {
        const list = multiUsers.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length > 0) return list;
    }

    // 兼容单账号 TARGET_USER
    const singleUser = __ENV.TARGET_USER;
    if (singleUser && singleUser !== 'undefined') {
        return [singleUser];
    }

    // 未指定：生成一个随机账号
    const randomUser = countryCode + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
    return [randomUser];
}

// ============================================================
// ==================== K6 选项（动态 VU 数）==================
// ============================================================

const _tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const _envConfig = getEnvByTenantId(_tenantId);
const _userList = parseTargetUsers(_envConfig);
const _vuCount = _userList.length;

export const options = {
    scenarios: {
        withdraw_multi: {
            executor: 'per-vu-iterations',
            vus: _vuCount,   // VU 数 = 账号数，每个账号独占一个 VU
            iterations: 1,          // 每个 VU 执行一次提现
            maxDuration: '30m'
        }
    },
    thresholds: {
        http_req_duration: ['p(95)<10000']
    }
};

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

// ============================================================
// ==================== SETUP 阶段 ============================
// ============================================================

/**
 * setup 阶段：后台登录一次，把 adminToken 和账号列表传给所有 VU
 */
export function setup() {
    const tenantId = _tenantId;
    const userList = _userList;

    console.log(`[${tag}] ========== Setup 开始 ==========`);
    console.log(`[${tag}] 租户ID: ${tenantId}`);
    console.log(`[${tag}] 账号数量: ${userList.length} (VU 数: ${_vuCount})`);
    console.log(`[${tag}] 账号列表: ${userList.join(', ')}`);

    // 后台登录一次，所有 VU 复用同一个 adminToken
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        console.error(`[${tag}] ❌ 后台登录失败，Setup 终止`);
        return null;
    }
    console.log(`[${tag}] ✅ 后台登录成功`);
    console.log(`[${tag}] ========== Setup 完成 ==========`);

    return { tenantId, userList, adminToken };
}

// ============================================================
// ==================== 完整提现流程主函数 ====================
// ============================================================

/**
 * 完整提现流程主函数 - 多租户 + 多账号多线程版本
 * @param {string} targetUser  当前 VU 负责的账号手机号
 * @param {string} tenantId    租户ID
 * @param {string} adminToken  后台管理员 token（由 setup 传入）
 */
export function RunWithDrawCase(targetUser, tenantId, adminToken) {
    const envConfig = getEnvByTenantId(tenantId);
    const isRegister = __ENV.IS_REGISTER === 'true';
    const vuLabel = `VU${__VU}`;

    console.log(`[${tag}][${vuLabel}] ========== 提现流程开始 ==========`);
    console.log(`[${tag}][${vuLabel}] 租户ID: ${tenantId}`);
    console.log(`[${tag}][${vuLabel}] 账号: ${targetUser}`);
    console.log(`[${tag}][${vuLabel}] 前台地址: ${envConfig.BASE_DESK_URL}`);

    // 1. 获取测试会话 (自动处理获取验证码、登录/注册、获取 UserId)
    const session = getTestSession(targetUser, isRegister);
    if (!session) {
        console.error(`[${tag}][${vuLabel}] 会话初始化失败，提现流程终止`);
        return;
    }

    const token = session.userToken;
    const userId = session.userId;
    console.log(`[${tag}][${vuLabel}] ✅ 会话建立成功: UserId=${userId}, UserName=${session.userName}`);

    // 2. 添加所有类型的钱包
    console.log(`[${tag}][${vuLabel}] 正在为用户添加钱包...`);
    const walletsAdded = addAllWallets(adminToken, userId);
    if (!walletsAdded) {
        console.warn(`[${tag}][${vuLabel}] ⚠️ 部分钱包添加失败，但继续执行提现流程`);
    } else {
        console.log(`[${tag}][${vuLabel}] ✅ 所有钱包添加成功`);
    }

    sleep(1); // 等待钱包数据同步

    // 3. 获取提现基础信息
    console.log(`[${tag}][${vuLabel}] 正在获取提现基础信息...`);
    const allWithdrawInfo = getWithdrawBasicInfo(token);
    if (!allWithdrawInfo) {
        console.error(`[${tag}][${vuLabel}] 获取提现基础信息失败，可能是token无效或签名问题`);
        return;
    }
    console.log(`[${tag}][${vuLabel}] ✅ 提现基础信息获取成功`);

    // 4. 获取余额
    console.log(`[${tag}][${vuLabel}] 正在获取账户余额...`);
    const balanceInfo = getAccountBalance(token);
    const money = balanceInfo ? balanceInfo.balance : 0.0;
    console.log(`[${tag}][${vuLabel}] 当前余额: ${money}`);

    // 5. 设置提现密码（非致命，失败继续）
    console.log(`[${tag}][${vuLabel}] 正在设置提现密码...`);
    const pwdRes = setWithdrawPassword(token);
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn(`[${tag}][${vuLabel}] ⚠️ 设置提现密码可能失败，继续尝试提现:`, JSON.stringify(pwdRes));
    } else {
        console.log(`[${tag}][${vuLabel}] ✅ 提现密码设置成功`);
    }

    // 6. 执行核心提现逻辑
    console.log(`[${tag}][${vuLabel}] 开始执行提现逻辑...`);
    const withdrawResult = executeWithdrawCase(token, money, allWithdrawInfo);

    if (!withdrawResult) {
        console.error(`[${tag}][${vuLabel}] ❌ 提现逻辑执行未通过，流程终止`);
        return;
    }

    console.log(`[${tag}][${vuLabel}] ========== 提现申请完成 ==========`);
    console.log(`[${tag}][${vuLabel}] 用户: ${userId} (${session.userName})`);
    console.log(`[${tag}][${vuLabel}] 提现金额: ${withdrawResult.withDrawaAmont}`);
    console.log(`[${tag}][${vuLabel}] 提现渠道: ${withdrawResult.withDrawaType}`);
    console.log(`[${tag}][${vuLabel}] 租户: ${tenantId}`);

    // 7. 后台审核流程（可选）
    const enableBackendApproval = __ENV.ENABLE_BACKEND_APPROVAL === 'true';
    if (enableBackendApproval) {
        console.log(`[${tag}][${vuLabel}] ========== 开始后台审核 ==========`);
        sleep(2); // 等待订单生成

        const approvalSuccess = runBackendWithdrawApproval(
            adminToken,
            userId,
            withdrawResult.withDrawaType,
            withdrawResult.withDrawaAmont
        );

        if (approvalSuccess) {
            console.log(`[${tag}][${vuLabel}] ✅ 后台审核完成，提现已出款`);
        } else {
            console.warn(`[${tag}][${vuLabel}] ⚠️ 后台审核失败，需要手动处理`);
        }
    } else {
        console.log(`[${tag}][${vuLabel}] ℹ️ 跳过后台审核（设置 ENABLE_BACKEND_APPROVAL=true 启用）`);
    }
}

// ============================================================
// ==================== K6 Default 入口 =======================
// ============================================================

/**
 * default 函数：每个 VU 独立执行，用 __VU（1-based）索引取对应账号
 * @param {object} data  setup() 的返回值
 */
export default function (data) {
    if (!data) {
        console.error(`[${tag}] Setup 数据为空，跳过执行`);
        return;
    }

    const { tenantId, userList, adminToken } = data;

    // __VU 从 1 开始，转为 0-based 索引取对应账号
    const vuIndex = __VU - 1;
    const targetUser = userList[vuIndex % userList.length];

    RunWithDrawCase(targetUser, tenantId, adminToken);
}


// ============================================================
// ==================== 使用说明 ==============================
// ============================================================

// # 单账号（原有用法，兼容）
// k6 run -e TENANT=3004 -e TARGET_USER=918048050116 withdraw.test.js

// # 多账号多线程（每个账号独占一个 VU 并发执行）
// k6 run -e TENANT=3004 -e TARGET_USERS=916250721844,916256164851 withdraw.test.js

// # 多账号 + 自动后台审核
// k6 run -e TENANT=3004 -e TARGET_USERS=918048050116,918048050117 -e ENABLE_BACKEND_APPROVAL=true withdraw.test.js

// # 为 3003 租户执行多账号提现
// k6 run -e TENANT=3003 -e TARGET_USERS=523021199746,523021199747 k6/tests/api/withdraw/withdraw.test.js
