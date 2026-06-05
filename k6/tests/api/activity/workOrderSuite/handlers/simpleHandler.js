/**
 * workOrderSuite/handlers/simpleHandler.js
 * 半自动工单处理器（通过/拒绝）
 *
 * 适用工单类型：
 *   - 修改登录密码半自动-未登陆 / 已登陆
 *   - 会员账号解冻半自动
 *   - 忘记会员账号
 *   - 忘记登录密码
 *   - 修改真实姓名半自动
 *   - 删除USDT半自动 / 删除银行卡半自动 / 删除电子钱包半自动 / 新增USDT半自动
 *   - 修改提现密码半自动化
 *   （后续有新的半自动类型，在 index.js 路由里加上即可）
 *
 * 流程：
 *   1. 锁定工单
 *   2. 70% 概率通过（state:4, remark: systemkefu{tenantId}:over）
 *      30% 概率拒绝（state:3, remark: systemkefu{tenantId}:Refuse）
 */

import { sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { signAndPost } from '../lib/submitHelper.js';
import { lockOrder } from '../lib/pendingHelper.js';
import { buildKefuPrefix } from '../lib/userIdHelper.js';
import { sendRequest } from '../../../common/request.js';

const TAG = 'SimpleHandler';

/** 通过概率 70% */
const APPROVE_RATE = 0.7;

// ============================================================
// workOrderTypeId → 前置接口映射
// 在提交 Submit 之前需要额外调用的接口
// ============================================================
const PRE_SUBMIT_ACTIONS = {
    // 修改登录密码半自动：先调 UpdateLoginPassword
    8: (workOrderId, adminToken) => {
        logger.info(`[${TAG}] 调用 UpdateLoginPassword workOrderId=${workOrderId}`);
        const res = sendRequest(
            { workOrderId },
            '/api/WorkOrder/UpdateLoginPassword',
            TAG,
            false,
            adminToken
        );
        if (res && (res.code === 0 || res.msgCode === 0)) {
            logger.info(`[${TAG}] ✅ UpdateLoginPassword 成功`);
            return true;
        }
        logger.error(`[${TAG}] ❌ UpdateLoginPassword 失败: ${JSON.stringify(res)}`);
        return false;
    },
};

/**
 * 半自动工单处理器
 * 同时支持：
 *   - 待处理工单（state=1，来自 GetPageListByPending）
 *   - 处理中工单（state=2，来自 GetPageList，需先调 /api/WorkOrder/Get 拿 workOrderTypeId）
 *
 * @param {object}  order        - 工单对象
 * @param {string}  adminToken
 * @param {string}  tenantId
 * @param {object}  env
 * @param {boolean} isMainAdmin
 */
export function simpleHandler(order, adminToken, tenantId, env, isMainAdmin = true) {
    const workOrderId     = order.id;
    const typeName        = order.workOrderTypeName || '';
    const kefuPrefix      = buildKefuPrefix(tenantId, isMainAdmin);
    let   workOrderTypeId = order.workOrderTypeId;

    logger.info(`\n[${TAG}] ==== 处理半自动工单: ${typeName} (${workOrderId}) ====`);

    // 处理中工单（state=2）需要先调 /api/WorkOrder/Get 拿到完整信息
    if (order.state === 2 && !workOrderTypeId) {
        const detail = sendRequest(
            { workOrderId },
            '/api/WorkOrder/Get',
            TAG,
            false,
            adminToken
        );
        if (!detail || !detail.workOrderTypeId) {
            logger.error(`[${TAG}] 获取工单详情失败，跳过 workOrderId=${workOrderId}`);
            return;
        }
        workOrderTypeId = detail.workOrderTypeId;
        logger.info(`[${TAG}] 处理中工单详情获取成功 typeId=${workOrderTypeId}`);
        sleep(0.3);
    }

    // Step 1: 锁定工单（处理中的已被锁定，跳过）
    if (order.state !== 2) {
        if (!lockOrder(workOrderId, adminToken)) {
            logger.error(`[${TAG}] 工单锁定失败，跳过`);
            return;
        }
        sleep(0.5);
    }

    // Step 2: 执行前置接口（如有）
    const preAction = PRE_SUBMIT_ACTIONS[workOrderTypeId];
    if (preAction) {
        const preOk = preAction(workOrderId, adminToken);
        if (!preOk) {
            logger.error(`[${TAG}] 前置接口失败，跳过 workOrderId=${workOrderId}`);
            return;
        }
        sleep(0.3);
    }

    // Step 3: 70% 通过 / 30% 拒绝
    const isApprove = Math.random() < APPROVE_RATE;
    const state     = isApprove ? 4 : 3;
    const remark    = isApprove ? `${kefuPrefix}:over` : `${kefuPrefix}:Refuse`;
    const action    = isApprove ? '✅ 通过' : '❌ 拒绝';

    logger.info(`[${TAG}] 决策: ${action} (state=${state}, remark=${remark})`);

    const res = signAndPost(
        { workOrderId, state, remark },
        '/api/WorkOrder/Submit',
        false,
        adminToken,
        TAG
    );

    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${TAG}] ${action} 成功: ${workOrderId}`);
    } else {
        logger.error(`[${TAG}] ${action} 失败: ${workOrderId} → ${JSON.stringify(res)}`);
    }

    sleep(1);
}
