/**
 * 后台充值订单相关接口封装
 */

import { sendRequest, sendQueryRequest } from '../common/request.js';
import { getTimeRandom } from '../../utils/utils.js';

/**
 * 查询本地充值订单列表 (后台)
 * @param {string} adminToken 
 * @param {number} userId 
 * @param {number} startTime 
 * @param {number} endTime 
 * @returns {Array|null} 返回订单列表数组，如果失败或为空则返回null或空数组
 */
export function getLocalRechargeOrderPageList(adminToken, userId, startTime, endTime) {
    const api = '/api/RechargeOrder/GetLocalRechargeOrderPageList';
    const tag = 'GetLocalRechargeOrderList';
    
    const payload = {
        userId: userId,
        startTime: startTime,
        endTime: endTime,
        pageNo: 1,
        pageSize: 500,
        dateType: 0,
        orderBy: "Desc"
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    // testCommonRequest 成功时会直接返回 parsedBody.data，此时没有 msgCode
    if (!response) {
        console.error(`[${tag}] 查询订单列表失败, 响应内容: ${JSON.stringify(response)}`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];
}

/**
 * 人工审核本地充值订单 (后台)
 * @param {string} adminToken 
 * @param {string} orderNo 
 * @param {number} userId 
 * @param {number} createTime 
 * @param {number} actualAmount 等于第一步的 amount
 * @param {string} remark 
 * @returns {boolean} 是否审核成功
 */
export function manualAuditLocalRechargeOrder(adminToken, orderNo, userId, createTime, actualAmount, remark = "auto-audit") {
    const api = '/api/RechargeOrder/ManualAuditLocalRechargeOrder';
    const tag = 'ManualAuditLocalRecharge';
    
    const payload = {
        orderNo: orderNo,
        userId: userId,
        createTime: createTime,
        actualAmount: actualAmount,
        remark: remark
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    // 如果没有返回或者包含业务错误
    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 审核订单失败: ${response ? response.msg : '无响应'}`);
        return false;
    }
    
    console.log(`[${tag}] ✅ 订单 ${orderNo} 审核成功!`);
    return true;
}

/**
 * 查询三方充值订单列表 (后台) - 简化版本
 * @param {string} adminToken 
 * @param {number} userId 
 * @param {string} rechargeChannelType 
 * @returns {Array|null} 返回订单列表数组
 */
export function getRechargeOrderPageList(adminToken, userId, rechargeChannelType = 'ThirdRecharge') {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const tag = 'GetRechargeOrderList';
    
    const payload = {
        userId: userId,
        rechargeChannelType: rechargeChannelType,
        pageNo: 1,
        pageSize: 500,
        dateType: 1,
        orderBy: "Desc",
        minActualAmount: null,
        maxActualAmount: null
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    // testCommonRequest 成功时会直接返回 parsedBody.data，此时没有 msgCode
    if (!response) {
        console.error(`[${tag}] 查询三方订单列表失败, 响应内容: ${JSON.stringify(response)}`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];
}

/**
 * 查询充值订单列表 (后台) - 完整版本
 * 支持按状态、时间范围、金额范围等条件查询
 * @param {string} adminToken - 管理员token
 * @param {object} options - 查询参数
 * @param {number} options.userId - 用户ID（必需）
 * @param {string} options.rechargeState - 充值状态（可选）: Payed, Wait, Fail, Cancel, PendingReview
 * @param {number} options.startTime - 开始时间（毫秒时间戳，可选）
 * @param {number} options.endTime - 结束时间（毫秒时间戳，可选）
 * @param {number} options.pageNo - 页码（默认1）
 * @param {number} options.pageSize - 每页数量（默认20）
 * @param {string} options.minActualAmount - 最小金额（可选）
 * @param {string} options.maxActualAmount - 最大金额（可选）
 * @param {number} options.dateType - 日期类型（默认0）
 * @param {string} options.orderBy - 排序方式（默认Desc）
 * @returns {object|null} 返回完整响应对象，包含订单列表和分页信息
 */
export function getRechargeOrderPageListFull(adminToken, options) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const tag = 'GetRechargeOrderPageList';
    
    const {
        userId,
        rechargeState = '',
        startTime = null,
        endTime = null,
        pageNo = 1,
        pageSize = 20,
        minActualAmount = '',
        maxActualAmount = '',
        dateType = 0,
        orderBy = 'Desc'
    } = options;

    if (!userId) {
        console.error(`[${tag}] userId 参数必需`);
        return null;
    }

    const payload = {
        userId: userId,
        rechargeState: rechargeState,
        pageNo: pageNo,
        pageSize: pageSize,
        minActualAmount: minActualAmount,
        maxActualAmount: maxActualAmount,
        dateType: dateType,
        orderBy: orderBy
    };

    // 如果提供了时间范围，添加到 payload
    if (startTime !== null) {
        payload.startTime = startTime;
    }
    if (endTime !== null) {
        payload.endTime = endTime;
    }

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    if (!response) {
        console.error(`[${tag}] 查询订单列表失败, 响应内容: ${JSON.stringify(response)}`);
        return null;
    }
    
    return response;
}

/**
 * 人工审核三方充值订单 (后台)
 * @param {string} adminToken 
 * @param {string} orderNo 
 * @param {number} userId 
 * @param {number} createTime 
 * @param {number} actualAmount 
 * @param {string} remark 
 * @returns {boolean} 是否审核成功
 */
export function manualAuditRechargeOrder(adminToken, orderNo, userId, createTime, actualAmount, remark = "auto-audit") {
    const api = '/api/RechargeOrder/ManualAuditRechargeOrder';
    const tag = 'ManualAuditRecharge';
    
    const payload = {
        orderNo: orderNo,
        userId: userId,
        createTime: createTime,
        actualAmount: actualAmount,
        remark: remark
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    // 如果没有返回或者包含业务错误
    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 审核三方订单失败: ${response ? response.msg : '无响应'}`);
        return false;
    }
    
    console.log(`[${tag}] ✅ 三方订单 ${orderNo} 审核成功!`);
    return true;
}
