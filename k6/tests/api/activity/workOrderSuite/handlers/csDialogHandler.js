/**
 * workOrderSuite/handlers/csDialogHandler.js
 * 一对一客服工单：多轮对话处理器
 *
 * 流程：
 *   1. 锁定工单
 *   2. 客服与会员交叉回复 2~4 轮（客服回1条 → 会员回1条，循环）
 *   3. 客服最终关闭工单（state:4，30% 概率带图）
 */

import { sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { signAndPost } from '../lib/submitHelper.js';
import { maybeUpload } from '../lib/upload.js';
import { lockOrder } from '../lib/pendingHelper.js';
import { buildKefuPrefix, buildLongUserId } from '../lib/userIdHelper.js';

const TAG = 'CsDialog';

// ============================================================
// 随机整数 [min, max]
// ============================================================
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// 客服提交一条回复（后台）→ /api/WorkOrder/Submit
// ============================================================
function adminReply(workOrderId, remark, adminToken, env, tag) {
    const { attachmentName, attachmentPath } = maybeUpload('admin', adminToken, env);
    const payload = {
        workOrderId,
        state: 2,  // 处理中
        remark,
    };
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }
    const res = signAndPost(payload, '/api/WorkOrder/Submit', false, adminToken, tag);
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 客服回复成功: ${remark}${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 客服回复失败: ${remark} -> ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 会员提交一条回复（前台）→ /api/WorkOrder/SubmitComment
// ============================================================
function memberReply(workOrderId, longUserId, commentContent, env, tag) {
    const { attachmentName, attachmentPath } = maybeUpload('frontend', null, env);

    // userId 为数字类型
    const payload = {
        orderId: workOrderId,
        userId: Number(longUserId),
        commentContent,
    };

    // 有图片才追加附件字段
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }

    const res = signAndPost(payload, '/api/WorkOrder/SubmitComment', true, '', tag);
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 会员回复成功: ${commentContent}${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 会员回复失败: ${commentContent} -> ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 客服关闭工单（state:4）→ /api/WorkOrder/Submit
// ============================================================
function adminCloseOrder(workOrderId, kefuPrefix, adminToken, env, tag) {
    const remark = `${kefuPrefix}:over`;
    const { attachmentName, attachmentPath } = maybeUpload('admin', adminToken, env);
    const payload = {
        workOrderId,
        state: 4,  // 关闭
        remark,
    };
    if (attachmentName) {
        payload.attachmentName = attachmentName;
        payload.attachmentPath = attachmentPath;
    }
    const res = signAndPost(payload, '/api/WorkOrder/Submit', false, adminToken, tag);
    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${tag}] ✅ 工单关闭成功${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${tag}] ❌ 工单关闭失败: ${JSON.stringify(res)}`);
    }
}

// ============================================================
// 主处理器
// ============================================================

/**
 * 一对一客服多轮对话处理器
 *
 * @param {object} order       - 工单对象（来自 GetPageListByPending）
 * @param {string} adminToken  - 管理员 token
 * @param {string} tenantId    - 租户 ID
 * @param {object} env         - 当前环境配置
 * @param {boolean} isMainAdmin - true=主账号(systemkefu), false=普通客服(kefu)
 */
export function csDialogHandler(order, adminToken, tenantId, env, isMainAdmin = true) {
    const workOrderId = order.id;
    const kefuPrefix  = buildKefuPrefix(tenantId, isMainAdmin);

    // userId 直接从工单对象取，拼接 14 位长 ID
    const shortUserId = order.userId;
    if (!shortUserId) {
        logger.error(`[${TAG}] 工单 ${workOrderId} 缺少 userId，跳过`);
        return;
    }
    const longUserId = buildLongUserId(tenantId, shortUserId);

    logger.info(`\n[${TAG}] ==== 开始处理一对一客服工单 ${workOrderId} ====`);
    logger.info(`[${TAG}] 客服前缀: ${kefuPrefix} | userId: ${shortUserId} → ${longUserId}`);

    // Step 1: 锁定工单
    if (!lockOrder(workOrderId, adminToken)) {
        logger.error(`[${TAG}] 工单锁定失败，跳过`);
        return;
    }
    sleep(0.5);

    // Step 2 & 3: 客服与会员交叉回复 2~4 轮
    // 每轮：客服回 1 条 → 会员回 1 条
    const rounds = randInt(2, 4);
    logger.info(`[${TAG}] 交叉回复轮数: ${rounds}`);

    for (let round = 1; round <= rounds; round++) {
        logger.info(`[${TAG}] --- 第 ${round}/${rounds} 轮 ---`);

        // 客服回复
        adminReply(workOrderId, `${kefuPrefix}:${round}`, adminToken, env, TAG);
        sleep(0.8 + Math.random());

        // 会员回复
        memberReply(workOrderId, longUserId, `user:${round}`, env, TAG);
        sleep(0.8 + Math.random());
    }
    sleep(0.5);

    // Step 5: 客服最终关闭工单
    adminCloseOrder(workOrderId, kefuPrefix, adminToken, env, TAG);

    logger.info(`[${TAG}] ==== 工单 ${workOrderId} 处理完毕 ====`);
    sleep(1);
}
