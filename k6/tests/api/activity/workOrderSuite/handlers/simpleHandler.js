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
 * 流程（2026-11-07 改）：
 *   1. 锁定工单
 *   2. 20% 概率只锁定、不做后续处理（模拟客服接单后没处理完，工单留在锁定状态）
 *   3. 其余 80%（真正处理的工单）：60% 概率通过（state:4, remark: systemkefu{tenantId}:over）
 *      40% 概率拒绝（state:3, remark: systemkefu{tenantId}:Refuse）
 */

import { sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { signAndPost } from '../lib/submitHelper.js';
import { lockOrder, unlockOrder } from '../lib/pendingHelper.js';
import { buildKefuPrefix } from '../lib/userIdHelper.js';
import { sendRequest } from '../../../common/request.js';
import { PERF_METRICS, ERROR_COUNTERS } from '../../../../../libs/monitor/perfMetrics.js';

const TAG = 'SimpleHandler';

/** 锁定后只锁不处理的概率 20%（2026-11-07 新增） */
const LOCK_ONLY_RATE = 0.2;
/** 真正处理的工单里，通过概率 60%（2026-11-07 从 70% 调整） */
const APPROVE_RATE = 0.6;

// ============================================================
// workOrderTypeId → 前置接口映射
// 在提交 Submit 之前需要额外调用的接口
// ============================================================
const PRE_SUBMIT_ACTIONS = {
    // 修改登录密码半自动：先调 UpdateLoginPassword
    8: (workOrderId, adminToken, forceTenant = false) => {
        logger.info(`[${TAG}] 调用 UpdateLoginPassword workOrderId=${workOrderId}`);
        const res = sendRequest(
            { workOrderId },
            '/api/WorkOrder/UpdateLoginPassword',
            TAG,
            false,
            adminToken,
            forceTenant
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
 * @param {boolean} [forceTenant=false] - adminToken 是商户自己登录拿到的（非集团token）时传
 *   true，否则集团模式下会被自动路由去集团域名，token/域名错配报 "Account type does not
 *   match the admin site"（2026-11-07 实测踩坑，见 libs/http/groupRouting.js 顶部注释）
 */
export function simpleHandler(order, adminToken, tenantId, env, isMainAdmin = true, forceTenant = false) {
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
            adminToken,
            forceTenant
        );
        if (!detail || !detail.workOrderTypeId) {
            logger.error(`[${TAG}] 获取工单详情失败，跳过 workOrderId=${workOrderId}`);
            return;
        }
        workOrderTypeId = detail.workOrderTypeId;
        logger.info(`[${TAG}] 处理中工单详情获取成功 typeId=${workOrderTypeId}`);
        sleep(0.3);
    }

    // Step 1: 锁定工单
    // state=2 处理中的工单需要重新锁定（先解锁再锁定，确保当前客服持有锁）
    if (order.state === 2) {
        // 先解锁（清除旧锁），再重新锁定
        unlockOrder(workOrderId, adminToken, forceTenant);
        sleep(1);
    }
    if (!lockOrder(workOrderId, adminToken, forceTenant)) {
        // 限流重试
        logger.warn(`[${TAG}] 锁定失败，2s 后重试...`);
        sleep(2);
        if (!lockOrder(workOrderId, adminToken, forceTenant)) {
            logger.error(`[${TAG}] 工单锁定失败，跳过`);
            return;
        }
    }
    sleep(1.5);

    // 20% 概率只锁定不处理：工单留在锁定状态，不解锁、不通过/拒绝
    if (Math.random() < LOCK_ONLY_RATE) {
        logger.info(`[${TAG}] 🔒 本次只锁定不处理: ${workOrderId}`);
        return;
    }

    // Step 2: 执行前置接口（如有）
    const preAction = PRE_SUBMIT_ACTIONS[workOrderTypeId];
    if (preAction) {
        const preOk = preAction(workOrderId, adminToken, forceTenant);
        if (!preOk) {
            logger.error(`[${TAG}] 前置接口失败，跳过 workOrderId=${workOrderId}`);
            return;
        }
        sleep(0.3);
    }

    // Step 3: 70% 通过 / 30% 拒绝（含限流重试）
    const isApprove = Math.random() < APPROVE_RATE;
    const state     = isApprove ? 4 : 3;
    const remark    = isApprove ? `${kefuPrefix}:over` : `${kefuPrefix}:Refuse`;
    const action    = isApprove ? '✅ 通过' : '❌ 拒绝';

    logger.info(`[${TAG}] 决策: ${action} (state=${state}, remark=${remark})`);

    const submitPayload = { workOrderId, state, remark };
    let res = signAndPost(submitPayload, '/api/WorkOrder/Submit', false, adminToken, TAG, {
        trendObj: PERF_METRICS.WORK_ORDER_APPROVE,
        errorCounter: ERROR_COUNTERS.WORK_ORDER_APPROVE_FAIL,
    }, forceTenant);

    // 限流重试：最多重试 3 次，每次等待递增
    let retries = 0;
    while (res && res.msgCode === 13 && retries < 3) {
        retries++;
        const waitSec = retries * 2; // 2s, 4s, 6s
        logger.warn(`[${TAG}] 限流 (msgCode=13)，等待 ${waitSec}s 后重试 (${retries}/3)...`);
        sleep(waitSec);
        res = signAndPost(submitPayload, '/api/WorkOrder/Submit', false, adminToken, TAG, {
            trendObj: PERF_METRICS.WORK_ORDER_APPROVE,
            errorCounter: ERROR_COUNTERS.WORK_ORDER_APPROVE_FAIL,
        }, forceTenant);
    }

    if (res && (res.code === 0 || res.msgCode === 0)) {
        logger.info(`[${TAG}] ${action} 成功: ${workOrderId}`);
    } else {
        logger.error(`[${TAG}] ${action} 失败: ${workOrderId} → ${JSON.stringify(res)}`);
    }

    sleep(2); // 工单处理间隔，避免连续请求触发限流
}
