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
        pageSize: 20,
        dateType: 0,
        orderBy: "Desc"
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 查询订单列表失败`);
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
 * 查询三方充值订单列表 (后台)
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
        pageSize: 20,
        dateType: 1,
        orderBy: "Desc",
        minActualAmount: null,
        maxActualAmount: null
    };

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 查询三方订单列表失败`);
        return null;
    }
    
    if (response.data && response.data.list) {
        return response.data.list;
    }
    return response.list || [];
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
