/**
 * workOrderSuite/lib/pendingHelper.js
 * 待处理工单查询与锁定工具
 *
 * - getPendingOrders()      获取今日待处理工单（state=1）
 * - getProcessingOrders()   获取今日处理中工单（state=2）
 * - waitUntilAllClear()     轮询等待指定账号的所有工单清空（state≠1,2）
 * - lockOrder()             锁定指定工单
 * - resolveUserIds()        账号列表 → userId 映射（手机号/邮箱 → userId）
 */

import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../../../common/request.js';
import { logger } from '../../../../../libs/utils/logger.js';
import { monitoredQueryRequest, monitoredPost } from '../../../../../libs/monitor/perfIntegration.js';
import { PERF_METRICS } from '../../../../../libs/monitor/perfMetrics.js';

const TAG = 'PendingHelper';

// ============================================================
// 今日时间范围工具
// ============================================================
function todayRange() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { begin: start.getTime(), end: end.getTime() };
}

// ============================================================
// 获取待处理工单（state=1）
// ============================================================

/**
 * 获取今日待处理工单列表
 *
 * @param {string} adminToken
 * @param {number} [userId]   - 按 userId 过滤（可选）
 * @param {boolean} [forceTenant=false] - adminToken 是商户自己登录拿到的（非集团token）时传
 *   true，否则集团模式下会被自动路由去集团域名，token/域名错配报 "Account type does not
 *   match the admin site"（2026-11-07 实测踩坑，见 libs/http/groupRouting.js 顶部注释）
 * @returns {Array}
 */
export function getPendingOrders(adminToken, userId, forceTenant = false) {
    const { begin, end } = todayRange();

    const payload = {
        submissionTimeBegin: begin,
        submissionTimeEnd:   end,
        sortField:           'submissionTime',
        orderBy:             'Desc',
        pageNo:              1,
        pageSize:            500,
    };

    if (userId) payload.account = String(userId);

    const res = monitoredQueryRequest(payload, '/api/WorkOrder/GetPageListByPending', TAG, false, adminToken, {
        trendObj: PERF_METRICS.WORK_ORDER_QUERY,
        forceTenant
    });

    if (!res || !res.list) {
        logger.warn(`[${TAG}] 获取待处理工单失败或列表为空${userId ? ` (userId=${userId})` : ''}`);
        return [];
    }

    logger.info(`[${TAG}] 待处理工单: ${res.list.length} 条${userId ? ` (userId=${userId})` : ''}`);
    return res.list;
}

// ============================================================
// 获取处理中工单（state=2）
// ============================================================

/**
 * 获取今日处理中工单列表
 *
 * @param {string} adminToken
 * @param {number} [userId]   - 按 userId 过滤（可选）
 * @param {boolean} [forceTenant=false] - 同 getPendingOrders
 * @returns {Array}
 */
export function getProcessingOrders(adminToken, userId, forceTenant = false) {
    const { begin, end } = todayRange();

    const payload = {
        state:               2,
        account:             userId ? String(userId) : '',
        payName:             '',
        level:               '',
        minAmount:           '',
        maxAmount:           '',
        workOrderName:       '',
        operator:            '',
        workOrderId:         '',
        submissionTimeBegin: begin,
        submissionTimeEnd:   end,
        pageNo:              1,
        pageSize:            500,
        orderBy:             'Desc',
        sortField:           'submissionTime',
    };

    const res = monitoredQueryRequest(payload, '/api/WorkOrder/GetPageList', TAG, false, adminToken, {
        trendObj: PERF_METRICS.WORK_ORDER_QUERY,
        forceTenant
    });

    if (!res || !res.list) {
        logger.warn(`[${TAG}] 获取处理中工单失败或列表为空${userId ? ` (userId=${userId})` : ''}`);
        return [];
    }

    logger.info(`[${TAG}] 处理中工单: ${res.list.length} 条${userId ? ` (userId=${userId})` : ''}`);
    return res.list;
}

// ============================================================
// 轮询等待：指定账号所有工单清空（state=1,2 都为空）
// ============================================================

/**
 * 轮询等待指定 userId 列表的所有工单处理完毕
 *
 * @param {string}   adminToken
 * @param {number[]} userIds        - 要等待的 userId 列表
 * @param {number}   [intervalSec]  - 轮询间隔秒数（默认 10s）
 * @param {number}   [maxWaitSec]   - 最长等待秒数（默认 600s = 10min）
 * @param {boolean}  [forceTenant=false] - 同 getPendingOrders
 * @returns {boolean} 是否在超时前清空
 */
export function waitUntilAllClear(adminToken, userIds, intervalSec = 10, maxWaitSec = 600, forceTenant = false) {
    const deadline = Date.now() + maxWaitSec * 1000;
    const userIdSet = userIds.filter(Boolean);

    logger.info(`[${TAG}] 开始等待工单清空，userId 列表: [${userIdSet.join(', ')}]，最长等待 ${maxWaitSec}s`);

    while (Date.now() < deadline) {
        let totalActive = 0;

        for (const uid of userIdSet) {
            const pending    = getPendingOrders(adminToken, uid, forceTenant);
            const processing = getProcessingOrders(adminToken, uid, forceTenant);
            const active     = pending.length + processing.length;
            totalActive     += active;

            if (active > 0) {
                logger.info(`[${TAG}] userId=${uid} 仍有 ${pending.length} 待处理 + ${processing.length} 处理中`);
            }
        }

        if (totalActive === 0) {
            logger.info(`[${TAG}] ✅ 所有工单已清空，可触发下一轮`);
            return true;
        }

        logger.info(`[${TAG}] 共 ${totalActive} 个工单未完成，${intervalSec}s 后重新检查...`);
        sleep(intervalSec);
    }

    logger.warn(`[${TAG}] ⚠️ 等待超时（${maxWaitSec}s），强制进入下一轮`);
    return false;
}

// ============================================================
// 账号 → userId 解析
// ============================================================

/**
 * 将账号列表（手机号/邮箱/userId字符串）解析为 userId 数字列表
 * - 纯数字且位数 <= 10 → 直接视为 userId
 * - 否则视为手机号/邮箱 → 后台查询 userId
 * - 查不到的跳过并警告
 *
 * @param {string[]} accounts    - 账号字符串列表
 * @param {string}   adminToken
 * @returns {{ account: string, userId: number }[]}
 */
export function resolveUserIds(accounts, adminToken) {
    const result = [];

    for (const account of accounts) {
        const trimmed = account.trim();
        if (!trimmed) continue;

        // 纯数字且 <= 10 位 → 直接当 userId
        if (/^\d{1,10}$/.test(trimmed)) {
            result.push({ account: trimmed, userId: Number(trimmed) });
            continue;
        }

        // 手机号/邮箱 → 后台查询
        const res = monitoredQueryRequest(
            { account: trimmed, pageNo: 1, pageSize: 5 },
            '/api/Users/GetPageList',
            TAG,
            false,
            adminToken,
            { trendObj: PERF_METRICS.WORK_ORDER_QUERY }
        );

        if (res && res.list && res.list.length > 0) {
            const userId = res.list[0].userId;
            logger.info(`[${TAG}] 账号 ${trimmed} → userId=${userId}`);
            result.push({ account: trimmed, userId });
        } else {
            logger.warn(`[${TAG}] ⚠️ 账号 ${trimmed} 未找到对应 userId，已跳过`);
        }

        sleep(0.3);
    }

    return result;
}

// ============================================================
// 锁定工单
// ============================================================

// 锁定成功时 data 是 {lockTime}，monitoredSendRequest 只返回 data 会把 msgCode 丢掉、
// 成功也被判成失败，所以这里取完整 body
function updateLockState(workOrderId, isLockWorkOrder, adminToken, forceTenant = false) {
    const { body } = monitoredPost(
        { workOrderId, isLockWorkOrder },
        '/api/WorkOrder/UpdateWordOrderState',
        TAG,
        false,
        adminToken,
        { trendObj: PERF_METRICS.WORK_ORDER_DISPATCH, forceTenant }
    );
    return body;
}

/**
 * 锁定指定工单（防止多客服并发抢单）
 * @param {boolean} [forceTenant=false] - 同 getPendingOrders
 */
export function lockOrder(workOrderId, adminToken, forceTenant = false) {
    const res = updateLockState(workOrderId, 1, adminToken, forceTenant);

    if (res && res.msgCode === 0) {
        logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 锁定成功`);
        return true;
    }

    if (res && res.msgCode === 13) {
        logger.warn(`[${TAG}] 锁定过快，1s 后重试...`);
        sleep(1);
        const retry = updateLockState(workOrderId, 1, adminToken, forceTenant);
        if (retry && retry.msgCode === 0) {
            logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 重试锁定成功`);
            return true;
        }
    }

    logger.error(`[${TAG}] ❌ 工单 ${workOrderId} 锁定失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 解锁工单（仅对处理中 state=2 的工单有效）
// ============================================================

/**
 * 解锁指定工单
 *
 * @param {string} workOrderId
 * @param {string} adminToken
 * @param {boolean} [forceTenant=false] - 同 getPendingOrders
 * @returns {boolean}
 */
export function unlockOrder(workOrderId, adminToken, forceTenant = false) {
    const res = updateLockState(workOrderId, 0, adminToken, forceTenant);

    if (res && res.msgCode === 0) {
        logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 解锁成功`);
        return true;
    }

    if (res && res.msgCode === 13) {
        logger.warn(`[${TAG}] 解锁过快，1s 后重试...`);
        sleep(1);
        const retry = updateLockState(workOrderId, 0, adminToken, forceTenant);
        if (retry && retry.msgCode === 0) {
            logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 重试解锁成功`);
            return true;
        }
    }

    logger.error(`[${TAG}] ❌ 工单 ${workOrderId} 解锁失败: ${JSON.stringify(res)}`);
    return false;
}

// ============================================================
// 从 jsonData 提取会员账号
// ============================================================

export function extractMemberAccount(jsonData) {
    if (!jsonData) return '';
    const values = Object.values(jsonData);
    return values.length > 0 ? String(values[0]) : '';
}
