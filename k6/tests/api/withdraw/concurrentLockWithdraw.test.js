/**
 * 并发锁单竞争测试
 *
 * 目标：用两个不同权限的后台账号同时对同一笔提现订单发起锁单请求，
 *       验证系统的并发互斥保护是否生效（预期：只有一个成功，另一个被拒）。
 *
 * 前提：目标用户已有一笔"待审核"状态的提现订单（不负责创建订单）。
 *
 * 使用方式：
 *   k6 run \
 *     -e TENANT=3004 \
 *     -e TARGET_USER=918048050116 \
 *     -e WITHDRAW_AMOUNT=500 \
 *     k6/tests/api/withdraw/concurrentLockWithdraw.test.js
 *
 * 参数说明：
 *   TENANT          租户ID（默认 3004）
 *   TARGET_USER_ID  前台用户 userId（推荐，精确，优先级高于 TARGET_USER）
 *   TARGET_USER     前台用户手机号（次选，存在模糊匹配风险）
 *   WITHDRAW_AMOUNT 提现金额（用于精确匹配订单，默认不限制，传 0 表示不限）
 * 
 * 
# 推荐用法：直接传 userId，精确可靠
    k6 run -e TENANT=3004 -e TARGET_USER_ID=139084 concurrentLockWithdraw.test.js

# 精确匹配金额
    k6 run -e TENANT=3004 -e TARGET_USER_ID=139187 -e WITHDRAW_AMOUNT=1000 concurrentLockWithdraw.test.js

# 兼容用法：传手机号（注意后台为模糊匹配，可能查到错误的 userId）
    k6 run -e TENANT=3004 -e TARGET_USER=916154156993 concurrentLockWithdraw.test.js

 * 
 */

import { tenantAdminLogin, tenantRequest, backendLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { lockWithdrawOrder } from './backendWithdrawApi.js';
import { getUserIdByAccount } from '../user/userManagement.js';

// ============================================================
// ==================== 参数 ==================================
// ============================================================

const TENANT_ID     = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const TARGET_PHONE  = __ENV.TARGET_USER;          // 前台用户手机号
const TARGET_UID    = __ENV.TARGET_USER_ID        // 直接传 userId，优先级高于手机号查询
    ? parseInt(__ENV.TARGET_USER_ID, 10)
    : null;
const AMOUNT        = parseFloat(__ENV.WITHDRAW_AMOUNT || '0'); // 0 = 不限金额

const TAG = 'ConcurrentLock';

// ============================================================
// ==================== K6 Options ============================
// ============================================================

export const options = {
    scenarios: {
        concurrent_lock: {
            executor:    'per-vu-iterations',
            vus:         2,          // VU1 = 主账号，VU2 = 受限账号
            iterations:  1,          // 每个 VU 只锁一次
            maxDuration: '5m'
        }
    },
    thresholds: {
        http_req_duration: ['p(95)<10000']
    }
};

// ============================================================
// ==================== 工具函数 ==============================
// ============================================================

/**
 * 查询用户待审核提现订单（精简版）
 *
 * 原 getWithdrawLockPageList 在 withdrawType='' / amount=undefined 时
 * 会把这些字段序列化进 payload，后台将空字符串当过滤条件导致查不到。
 * 这里只传必要字段，避免干扰。
 *
 * @param {string} adminToken
 * @param {number} userId
 * @param {number} amount - 传 0 或不传表示不限金额
 * @returns {object|null} { orderNo, createTime }
 */
function queryPendingWithdrawOrder(adminToken, userId, amount) {
    const api = '/api/WithdrawOrder/GetWithdrawLockPageList';

    // 计算今天的开始/结束时间戳（毫秒），覆盖当天所有订单
    const now       = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const payload = {
        userId:    userId,
        startTime: todayStart.getTime(),
        endTime:   todayEnd.getTime(),
        dateType:  0,
        pageNo:    1,
        pageSize:  20,
        orderBy:   'Desc'
    };

    // 有指定金额才加上精确匹配
    if (amount && amount > 0) {
        payload.minWithdrawAmount = amount;
        payload.maxWithdrawAmount = amount;
    }

    console.log(`[${TAG}] 查询订单 payload: ${JSON.stringify(payload)}`);

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${TAG}] 查询提现订单失败: msgCode=${response ? response.msgCode : 'null'} msg=${response ? response.msg : ''}`);
        return null;
    }

    if (!response.data || !response.data.list || response.data.list.length === 0) {
        console.warn(`[${TAG}] 查询成功但列表为空，该用户暂无待审核订单`);
        return null;
    }

    const order = response.data.list[0];
    console.log(`[${TAG}] 找到订单: ${order.orderNo}，金额: ${order.withdrawAmount}，状态: ${order.withdrawState}`);
    return {
        orderNo:    order.orderNo,
        createTime: order.createTime
    };
}


/**
 * 用 LimitedPermissions 账号登录，拿到 limitedToken
 * 和主账号走同一套 /api/Login/Login 接口
 *
 * @param {string} tenantId
 * @returns {string|null} token
 */
function limitedAdminLogin(tenantId) {
    const envConfig = getEnvByTenantId(tenantId);
    // 受限账号也是后台登录，走统一 backendLogin（带 vCode，共用租户 GOOGLE_SECRET）
    const token = backendLogin(envConfig.LimitedPermissions, envConfig.LimitedPermissionsPassWord, envConfig.GOOGLE_SECRET, tenantId);
    if (token) {
        console.log(`[${TAG}] ✅ 受限账号 (${envConfig.LimitedPermissions}) 登录成功`);
    } else {
        console.error(`[${TAG}] ❌ 受限账号 (${envConfig.LimitedPermissions}) 登录失败`);
    }
    return token;
}

// ============================================================
// ==================== SETUP =================================
// ============================================================

export function setup() {
    console.log(`\n[${TAG}] ========== Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID}`);
    console.log(`[${TAG}] 匹配金额: ${AMOUNT > 0 ? AMOUNT : '不限'}`);

    // TARGET_USER_ID 优先；没有才用手机号查询
    if (!TARGET_UID && (!TARGET_PHONE || TARGET_PHONE === 'undefined')) {
        throw new Error(`[${TAG}] 必须传入 TARGET_USER_ID（userId）或 TARGET_USER（手机号）`);
    }

    // 1. 主账号登录
    console.log(`[${TAG}] [1/3] 主账号登录...`);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) {
        throw new Error(`[${TAG}] 主账号登录失败`);
    }
    console.log(`[${TAG}] ✅ 主账号登录成功`);

    // 2. 受限账号登录
    console.log(`[${TAG}] [2/3] 受限账号登录...`);
    const limitedToken = limitedAdminLogin(TENANT_ID);
    if (!limitedToken) {
        throw new Error(`[${TAG}] 受限账号登录失败`);
    }

    // 3. 确定 userId（直接传 TARGET_USER_ID 跳过手机号查询）
    let userId;
    if (TARGET_UID) {
        userId = TARGET_UID;
        console.log(`[${TAG}] [3/3] 使用直接传入的 userId: ${userId}`);
    } else {
        console.log(`[${TAG}] [3/3] 通过手机号查询 userId: ${TARGET_PHONE}`);
        userId = getUserIdByAccount(adminToken, TARGET_PHONE);
        if (!userId) {
            throw new Error(`[${TAG}] 无法根据手机号 ${TARGET_PHONE} 查到 userId，建议改用 -e TARGET_USER_ID=xxx 直接指定`);
        }
        console.log(`[${TAG}] userId: ${userId}`);
    }

    // 4. 查询待审核订单
    console.log(`[${TAG}] [4/4] 查询待审核提现订单...`);
    const orderInfo = queryPendingWithdrawOrder(adminToken, userId, AMOUNT);

    if (!orderInfo) {
        throw new Error(`[${TAG}] 未找到待审核订单，请确认 userId=${userId} 今日存在待审核的提现订单`);
    }

    console.log(`[${TAG}] ✅ 找到订单: ${orderInfo.orderNo}`);
    console.log(`[${TAG}] ========== Setup 完成 ==========\n`);

    return {
        adminToken,
        limitedToken,
        orderInfo,
        userId
    };
}

// ============================================================
// ==================== Default（2 VU 并发）===================
// ============================================================

/**
 * 每个 VU 分配一个 token，几乎同时对同一笔订单发起锁单。
 *
 * VU1（__VU === 1）：主账号   adminToken
 * VU2（__VU === 2）：受限账号 limitedToken
 *
 * k6 的 per-vu-iterations 会在 setup 完成后立刻同时启动两个 VU，
 * 这是 k6 能做到的最接近"同时"的方式，无需额外 sleep 对齐。
 */
export default function (data) {
    if (!data) {
        console.error(`[${TAG}] setup 数据为空，跳过`);
        return;
    }

    const { adminToken, limitedToken, orderInfo, userId } = data;

    // 根据 VU 编号选择 token
    const isAdminVu   = __VU === 1;
    const token       = isAdminVu ? adminToken : limitedToken;
    const accountName = isAdminVu ? 'ADMIN（主账号）' : 'LIMITED（受限账号）';

    console.log(`[${TAG}][VU${__VU}] ===== 开始锁单竞争 =====`);
    console.log(`[${TAG}][VU${__VU}] 使用账号类型: ${accountName}`);
    console.log(`[${TAG}][VU${__VU}] 目标订单: ${orderInfo.orderNo}`);

    // 直接调用锁单，不做任何 sleep，最大化并发窗口
    const lockSuccess = lockWithdrawOrder(token, userId, orderInfo);

    // ── 结果断言 ──────────────────────────────────────────────
    if (lockSuccess) {
        console.log(`[${TAG}][VU${__VU}] ✅ 锁单成功 → 账号: ${accountName}`);
    } else {
        console.log(`[${TAG}][VU${__VU}] 🔒 锁单被拒 → 账号: ${accountName}（符合预期：互斥保护生效）`);
    }

    console.log(`[${TAG}][VU${__VU}] ===== 锁单竞争结束 =====`);
}

// ============================================================
// ==================== 汇总报告 ==============================
// ============================================================

export function handleSummary(_data) {
    const lines = [
        '='.repeat(60),
        '  并发锁单竞争测试 - 结果汇总',
        '='.repeat(60),
        `  租户:       ${TENANT_ID}`,
        `  目标用户:   ${TARGET_PHONE}`,
        `  匹配金额:   ${AMOUNT > 0 ? AMOUNT : '不限'}`,
        '',
        '  预期结果：',
        '    - 两个 VU 中，有且仅有一个锁单成功',
        '    - 若两个都成功 → 系统并发互斥存在漏洞 ⚠️',
        '    - 若两个都失败 → 订单状态异常，请检查订单是否已被锁定',
        '='.repeat(60),
        '  请查阅上方 VU1 / VU2 的日志确认各自结果',
        '='.repeat(60)
    ];

    return {
        stdout: lines.join('\n') + '\n'
    };
}
