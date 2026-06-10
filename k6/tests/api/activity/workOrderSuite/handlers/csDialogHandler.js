/**
 * workOrderSuite/handlers/csDialogHandler.js
 * 一对一客服工单：多轮对话处理器
 *
 * 流程（70% 双客服 / 30% 单客服）：
 *
 * 双客服模式（70%）：
 *   1. 客服A 锁定 → 回复 1~2 轮 → 解锁
 *   2. 会员 回复 1 条
 *   3. 客服B 锁定 → 回复 1~2 轮 → 解锁
 *   4. 会员 回复 1 条
 *   5. 随机客服 锁定 → 关闭
 *
 * 单客服模式（30%）：
 *   1. 随机选一个客服
 *   2. 锁定 → 交叉回复 2~4 轮（客服回1条→会员回1条）→ 关闭
 */

import { sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { signAndPost } from '../lib/submitHelper.js';
import { maybeUpload } from '../lib/upload.js';
import { lockOrder, unlockOrder } from '../lib/pendingHelper.js';
import { buildKefuPrefix, buildLongUserId } from '../lib/userIdHelper.js';

const TAG = 'CsDialog';

// ============================================================
// 带重试的锁定（限流时退避重试）
// ============================================================
function lockOrderWithRetry(workOrderId, token, tag, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        if (lockOrder(workOrderId, token)) return true;
        const waitSec = (i + 1) * 2; // 2s, 4s, 6s
        logger.warn(`[${tag}] 锁定失败，${waitSec}s 后重试 (${i + 1}/${maxRetries})...`);
        sleep(waitSec);
    }
    return false;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机抖动：错开多线程并发请求（1~3s）
function jitter() { sleep(1 + Math.random() * 2); }

// ============================================================
// 客服回复（后台）- 含限流重试
// ============================================================
function adminReply(workOrderId, remark, token, env, tag) {
    const { attachmentName, attachmentPath } = maybeUpload('admin', token, env);
    const payload = { workOrderId, state: 2, remark };
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }
    let res = signAndPost(payload, '/api/WorkOrder/Submit', false, token, tag);
    if (res && res.msgCode === 13) {
        logger.warn(`[${tag}] 客服回复限流，2s 后重试...`);
        sleep(2);
        res = signAndPost(payload, '/api/WorkOrder/Submit', false, token, tag);
    }
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 客服回复: ${remark}${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 客服回复失败: ${remark} → ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 会员回复（前台）- 含限流重试
// ============================================================
function memberReply(workOrderId, longUserId, content, env, tag) {
    const { attachmentName, attachmentPath } = maybeUpload('frontend', null, env);
    const payload = { orderId: workOrderId, userId: Number(longUserId), commentContent: content };
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }
    let res = signAndPost(payload, '/api/WorkOrder/SubmitComment', true, '', tag);
    if (res && res.msgCode === 13) {
        logger.warn(`[${tag}] 会员回复限流，2s 后重试...`);
        sleep(2);
        res = signAndPost(payload, '/api/WorkOrder/SubmitComment', true, '', tag);
    }
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 会员回复: ${content}${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 会员回复失败: ${content} → ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 客服关闭工单
// ============================================================
function adminCloseOrder(workOrderId, kefuPrefix, token, env, tag) {
    const remark = `${kefuPrefix}:over`;
    const { attachmentName, attachmentPath } = maybeUpload('admin', token, env);
    const payload = { workOrderId, state: 4, remark };
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }
    const res = signAndPost(payload, '/api/WorkOrder/Submit', false, token, tag);
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 工单关闭成功 (${kefuPrefix})${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 工单关闭失败 → ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 主处理器
// ============================================================

/**
 * @param {object}  order
 * @param {string}  adminToken
 * @param {string}  tenantId
 * @param {object}  env
 * @param {boolean} isMainAdmin
 * @param {string}  [workOrderRoleToken] - 客服B token
 * @param {string}  [workOrderRoleName]  - 客服B 账号名（WorkOrderRole，用于 remark 前缀）
 */
export function csDialogHandler(order, adminToken, tenantId, env, isMainAdmin = true, workOrderRoleToken = null, workOrderRoleName = null) {
    const workOrderId = order.id;

    const shortUserId = order.userId;
    if (!shortUserId) {
        logger.error(`[${TAG}] 工单 ${workOrderId} 缺少 userId，跳过`);
        return;
    }
    const longUserId = buildLongUserId(tenantId, shortUserId);

    // 客服A / 客服B 的前缀和 token
    const prefixA = buildKefuPrefix(tenantId, true);   // systemkefu3004
    const tokenA  = adminToken;

    // 如果没有第二客服 token，fallback 到客服A
    // prefixB 优先用 workOrderRoleName，没有则用 WorkOrderRole 格式兜底
    const prefixB = workOrderRoleToken
        ? (workOrderRoleName || `carey${tenantId}_001`)
        : prefixA;
    const tokenB  = workOrderRoleToken || adminToken;

    logger.info(`\n[${TAG}] ==== 开始处理一对一客服工单 ${workOrderId} ====`);
    logger.info(`[${TAG}] 客服A: ${prefixA} | 客服B: ${prefixB} | userId: ${shortUserId} → ${longUserId}`);

    // state=2 处理中工单：先解锁再重新锁定，确保当前流程持有锁
    if (order.state === 2) {
        logger.info(`[${TAG}] 工单处于处理中状态，先解锁再重新接管`);
        unlockOrder(workOrderId, tokenA);
        sleep(1);
    }

    // 30% 概率走单客服模式
    const singleMode = Math.random() < 0.3 || !workOrderRoleToken;

    if (singleMode) {
        // ---- 单客服模式 ----
        const useA   = Math.random() < 0.5;
        const token  = useA ? tokenA : tokenB;
        const prefix = useA ? prefixA : prefixB;

        logger.info(`[${TAG}] 单客服模式 → ${prefix}`);
        jitter(); // 错开并发

        if (!lockOrderWithRetry(workOrderId, token, TAG)) {
            logger.error(`[${TAG}] 锁定失败，跳过`);
            return;
        }
        sleep(2);

        const rounds = randInt(2, 4);
        for (let r = 1; r <= rounds; r++) {
            adminReply(workOrderId, `${prefix}:${r}`, token, env, TAG);
            sleep(2 + Math.random() * 2); // 2~4s
            memberReply(workOrderId, longUserId, `user:${r}`, env, TAG);
            sleep(2 + Math.random() * 2);
        }

        adminCloseOrder(workOrderId, prefix, token, env, TAG);

    } else {
        // ---- 双客服模式 ----
        logger.info(`[${TAG}] 双客服模式 → ${prefixA} + ${prefixB}`);
        jitter(); // 错开并发

        let seq = 1;

        // Step 1: 客服A 锁定 → 回复 1~2 条 → 解锁
        if (!lockOrderWithRetry(workOrderId, tokenA, TAG)) {
            logger.error(`[${TAG}] 客服A 锁定失败，降级单客服B`);
            jitter();
            if (lockOrderWithRetry(workOrderId, tokenB, TAG)) {
                adminReply(workOrderId, `${prefixB}:1`, tokenB, env, TAG);
                sleep(2);
                memberReply(workOrderId, longUserId, 'user:1', env, TAG);
                sleep(2);
                adminCloseOrder(workOrderId, prefixB, tokenB, env, TAG);
            }
            return;
        }
        sleep(2);

        const aRounds = randInt(1, 2);
        for (let r = 0; r < aRounds; r++) {
            adminReply(workOrderId, `${prefixA}:${seq}`, tokenA, env, TAG);
            seq++;
            sleep(2 + Math.random() * 2);
        }
        unlockOrder(workOrderId, tokenA);
        sleep(2);

        // Step 2: 会员回复
        memberReply(workOrderId, longUserId, `user:1`, env, TAG);
        sleep(2 + Math.random() * 2);

        // Step 3: 客服B 锁定 → 回复 1~2 条 → 解锁
        jitter();
        if (!lockOrderWithRetry(workOrderId, tokenB, TAG)) {
            logger.warn(`[${TAG}] 客服B 锁定失败，客服A 直接关闭`);
            jitter();
            if (lockOrderWithRetry(workOrderId, tokenA, TAG)) {
                adminCloseOrder(workOrderId, prefixA, tokenA, env, TAG);
            }
            return;
        }
        sleep(2);

        const bRounds = randInt(1, 2);
        for (let r = 0; r < bRounds; r++) {
            adminReply(workOrderId, `${prefixB}:${seq}`, tokenB, env, TAG);
            seq++;
            sleep(2 + Math.random() * 2);
        }
        unlockOrder(workOrderId, tokenB);
        sleep(2);

        // Step 4: 会员再回复
        memberReply(workOrderId, longUserId, `user:2`, env, TAG);
        sleep(2 + Math.random() * 2);

        // Step 5: 随机客服关闭
        const closeWithA  = Math.random() < 0.5;
        const closeToken  = closeWithA ? tokenA : tokenB;
        const closePrefix = closeWithA ? prefixA : prefixB;

        logger.info(`[${TAG}] 随机关闭客服: ${closePrefix}`);
        jitter();
        if (lockOrderWithRetry(workOrderId, closeToken, TAG)) {
            adminCloseOrder(workOrderId, closePrefix, closeToken, env, TAG);
        } else {
            const fallbackToken  = closeWithA ? tokenB : tokenA;
            const fallbackPrefix = closeWithA ? prefixB : prefixA;
            jitter();
            if (lockOrderWithRetry(workOrderId, fallbackToken, TAG)) {
                adminCloseOrder(workOrderId, fallbackPrefix, fallbackToken, env, TAG);
            } else {
                logger.error(`[${TAG}] 两个客服都无法锁定，工单 ${workOrderId} 未关闭`);
            }
        }
    }

    logger.info(`[${TAG}] ==== 工单 ${workOrderId} 处理完毕 ====`);
    sleep(2);
}
