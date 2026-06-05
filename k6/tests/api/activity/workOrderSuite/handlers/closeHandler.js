/**
 * workOrderSuite/handlers/closeHandler.js
 * 通用工单关闭处理器（非一对一客服类型）
 *
 * 流程：
 *   1. 锁定工单
 *   2. 客服回复一次并关闭（state:4，remark: systemkefu{tenantId}:over，30% 概率带图）
 *
 * 使用方式：
 *   import { closeHandler } from '../handlers/closeHandler.js';
 *   closeHandler(order, adminToken, tenantId, env);
 */

import { sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { signAndPost } from '../lib/submitHelper.js';
import { maybeUpload } from '../lib/upload.js';
import { lockOrder } from '../lib/pendingHelper.js';
import { buildKefuPrefix } from '../lib/userIdHelper.js';

const TAG = 'CloseHandler';

/**
 * 通用工单关闭处理器
 *
 * @param {object} order       - 工单对象（来自 GetPageListByPending）
 * @param {string} adminToken  - 管理员 token
 * @param {string} tenantId    - 租户 ID
 * @param {object} env         - 当前环境配置
 * @param {boolean} isMainAdmin - true=主账号(systemkefu), false=普通客服(kefu)
 */
export function closeHandler(order, adminToken, tenantId, env, isMainAdmin = true) {
    const workOrderId = order.id;
    const kefuPrefix  = buildKefuPrefix(tenantId, isMainAdmin);

    logger.info(`\n[${TAG}] ==== 关闭工单 ${workOrderId} [${order.workOrderTypeName}] ====`);

    // Step 1: 锁定工单
    if (!lockOrder(workOrderId, adminToken)) {
        logger.error(`[${TAG}] 工单锁定失败，跳过`);
        return;
    }
    sleep(0.5);

    // Step 2: 一次性回复并关闭
    const remark = `${kefuPrefix}:over`;
    const { attachmentName, attachmentPath } = maybeUpload('admin', adminToken, env);

    const payload = {
        workOrderId,
        state: 4,  // 关闭
        remark,
        attachmentName,
        attachmentPath,
    };

    const res = signAndPost(payload, '/api/WorkOrder/Submit', false, adminToken, TAG);

    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 关闭成功${attachmentName ? ' [含图]' : ''}`);
    } else {
        logger.error(`[${TAG}] ❌ 工单 ${workOrderId} 关闭失败: ${JSON.stringify(res)}`);
    }

    sleep(1);
}
