/**
 * workOrderSuite/handlers/index.js
 * Handler 路由分发器
 *
 * 用 workOrderTypeId 路由，避免依赖 workOrderTypeName 字符串的不确定性。
 *
 * - workOrderTypeId 2  → csDialogHandler（一对一客服，多轮交叉对话）
 * - 半自动类 typeId    → simpleHandler（70%通过 / 30%拒绝）
 * - 其他               → 跳过
 */

import { csDialogHandler } from './csDialogHandler.js';
import { simpleHandler } from './simpleHandler.js';
import { sendRequest } from '../../../common/request.js';
import { logger } from '../../../../../libs/utils/logger.js';

const TAG = 'HandlerRouter';

/**
 * 走多轮对话处理器的 workOrderTypeId 列表
 * queryId=2 → 一对一客服（已登陆/未登陆）
 */
const DIALOG_TYPE_IDS = [2];

/**
 * 走半自动处理器（通过/拒绝）的 workOrderTypeId 列表
 * 对应 oderyconfig.js 中各工单的 queryId
 */
const SIMPLE_TYPE_IDS = [
    7,   // 修改真实姓名半自动
    8,   // 修改登录密码半自动-已登陆 / 未登陆
    9,   // 忘记会员账号
    10,  // 会员账号解冻半自动 / 忘记登录密码
    13,  // 删除USDT半自动
    14,  // 删除银行卡半自动
    16,  // 删除电子钱包半自动
    17,  // 新增USDT半自动
    22,  // 修改提现密码半自动化
    6,   // 修改银行信息（半自动）
    3,   // 其他问题
    // 自动化工单（提交后系统自动执行，不需要后台客服处理）：
    // 11=修改IFSC、12=修改银行名称、15=删除PIX、18=删除银行卡、19=删除USDT、21=修改提现密码
];

/**
 * 根据工单 workOrderTypeId 分发到对应处理器
 *
 * @param {object}  order
 * @param {string}  adminToken           - 客服A token
 * @param {string}  tenantId
 * @param {object}  env
 * @param {boolean} isMainAdmin
 * @param {string}  [workOrderRoleToken] - 客服B token（可选）
 * @param {number}  [orderIndex]         - 工单序号（0-based），用于奇偶交替
 */
export function dispatchHandler(order, adminToken, tenantId, env, isMainAdmin = true, workOrderRoleToken = null, orderIndex = 0, workOrderRoleName = null) {
    let typeId   = order.workOrderTypeId;
    const typeName = order.workOrderTypeName || order.displayName || '';

    // GetPageListByPending 不返回 workOrderTypeId，需调详情接口补全
    if (!typeId) {
        const detail = sendRequest(
            { workOrderId: order.id },
            '/api/WorkOrder/Get',
            TAG,
            false,
            adminToken
        );
        if (detail && detail.workOrderTypeId) {
            typeId = detail.workOrderTypeId;
            logger.info(`[${TAG}] 补全 workOrderTypeId=${typeId} (${typeName})`);
        } else {
            logger.warn(`[${TAG}] ⚠️ 无法获取 workOrderTypeId，跳过工单 id=${order.id} (${typeName})`);
            return;
        }
    }

    order.workOrderTypeId = typeId;

    if (DIALOG_TYPE_IDS.includes(typeId)) {
        logger.info(`[${TAG}] 路由 → csDialogHandler (${typeName}, typeId=${typeId})`);
        csDialogHandler(order, adminToken, tenantId, env, isMainAdmin, workOrderRoleToken, workOrderRoleName);
        return;
    }

    if (SIMPLE_TYPE_IDS.includes(typeId)) {
        // 奇偶交替：偶数序号用客服B，奇数序号用客服A
        const useRoleToken = workOrderRoleToken && (orderIndex % 2 === 1);
        const activeToken  = useRoleToken ? workOrderRoleToken : adminToken;
        const activeName   = useRoleToken ? 'carey' : 'systemkefu';
        logger.info(`[${TAG}] 路由 → simpleHandler (${typeName}, typeId=${typeId}, 客服=${activeName})`);
        simpleHandler(order, activeToken, tenantId, env, isMainAdmin);
        return;
    }

    logger.info(`[${TAG}] ⏭️ 跳过: "${typeName}" (typeId=${typeId}, id=${order.id})`);
}
