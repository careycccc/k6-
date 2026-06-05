/**
 * workOrderSuite/lib/userIdHelper.js
 * 用户 ID 与客服标识工具库
 *
 * - buildLongUserId()   拼接 14 位长 userId
 * - buildKefuPrefix()   生成客服 remark 前缀
 * - getKefuAccounts()   返回当前租户所有客服账号列表（便于后续多账号扩展）
 */

import { sendQueryRequest } from '../../../common/request.js';
import { logger } from '../../../../../libs/utils/logger.js';

const TAG = 'UserIdHelper';

// ============================================================
// userId 拼接
// ============================================================

/**
 * 根据租户 ID 和短 userId 拼接 14 位长 userId
 *
 * 规则：4位租户ID + 补0 + 短userId，总长 14 位
 * 例：tenantId=3004, shortId=138649 => "30040000138649"
 *     tenantId=3004, shortId=9999999 => "30040009999999" (7位userId,补0=3位)
 *
 * @param {string|number} tenantId
 * @param {string|number} shortUserId
 * @returns {string}
 */
export function buildLongUserId(tenantId, shortUserId) {
    const tenantStr = String(tenantId);
    const userStr   = String(shortUserId);
    const padLen    = 14 - tenantStr.length - userStr.length;
    const padding   = '0'.repeat(Math.max(0, padLen));
    return tenantStr + padding + userStr;
}

// ============================================================
// 客服标识
// ============================================================

/**
 * 生成客服 remark 前缀
 *
 * 主管理账号  →  systemkefu{tenantId}   (如 systemkefu3004)
 * 普通客服账号 →  kefu{tenantId}         (如 kefu3004)
 *
 * @param {string|number} tenantId
 * @param {boolean} isMainAdmin - true = 主管理账号
 * @returns {string}
 */
export function buildKefuPrefix(tenantId, isMainAdmin = true) {
    return isMainAdmin ? `systemkefu${tenantId}` : `kefu${tenantId}`;
}

// ============================================================
// 查询会员短 userId（后台接口）
// ============================================================

/**
 * 通过会员账号查询短 userId，再拼接成 14 位长 ID
 *
 * @param {string} memberAccount  - 会员账号，如 "916003199726"
 * @param {string} tenantId       - 租户 ID
 * @param {string} adminToken     - 后台 token
 * @returns {string}  成功返回 14 位长 userId，失败返回 ''
 */
export function fetchLongUserId(memberAccount, tenantId, adminToken) {
    if (!memberAccount) {
        logger.warn(`[${TAG}] 会员账号为空，无法查询 userId`);
        return '';
    }

    const res = sendQueryRequest(
        { account: memberAccount, pageNo: 1, pageSize: 20 },
        '/api/Users/GetPageList',
        TAG,
        false,  // isDesk=false 走后台
        adminToken
    );

    if (res && res.list && res.list.length > 0) {
        const shortId = res.list[0].userId;
        const longId  = buildLongUserId(tenantId, shortId);
        logger.info(`[${TAG}] ${memberAccount} → shortId=${shortId} → longId=${longId}`);
        return longId;
    }

    logger.warn(`[${TAG}] 未查到会员 ${memberAccount} 的 userId`);
    return '';
}
