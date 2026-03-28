/**
 * 提现相关接口封装 - 多租户版本
 */

import { tenantRequest, tenantQueryRequest } from '../../../libs/http/tenantRequest.js';

/**
 * 获取提现基础信息
 * @param {string} token 
 * @returns {object|null}
 */
export function getWithdrawBasicInfo(token) {
    const api = '/api/Withdraw/GetWithdrawBasicInfo';
    const tag = 'GetWithdrawBasicInfo';

    const payload = {};

    const response = tenantRequest(api, payload, { token, isDesk: true });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 获取提现基础信息失败:`, response);
        return null;
    }

    return response.data;
}

/**
 * 获取用户提现钱包
 * @param {string} token 
 * @param {string} withdrawType 
 * @returns {string|null} 返回 walletId
 */
export function getUserWithdrawWallet(token, withdrawType) {
    const api = '/api/Withdraw/GetUserWithdrawWallet';
    const tag = 'GetUserWithdrawWallet';
    const payload = {
        withdrawType: withdrawType
    };

    const response = tenantRequest(api, payload, { token, isDesk: true });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 获取用户提现钱包失败:`, response);
        return null;
    }

    // 返回 walletId（从 data 数组的第一个元素中提取）
    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0].walletId;
    }

    console.error(`[${tag}] 钱包数据为空`);
    return null;
}

/**
 * 设置提现密码
 * @param {string} token 
 * @param {string} password
 * @returns {object}
 */
export function setWithdrawPassword(token, password = '123456') {
    // 根据系统惯例，提现密码通常在 User 模块下
    const api = '/api/User/SetWithdrawPassword';
    const tag = 'SetWithdrawPassword';
    const payload = {
        withdrawPassword: password
    };

    const response = tenantRequest(api, payload, { token, isDesk: true });

    // 返回真实的响应体，用于在业务层进行判断是否成功或跳过
    return response;
}

/**
 * 提现申请
 * @param {string} token 
 * @param {number} amount 提现金额
 * @param {number|string} walletId 钱包ID
 * @param {number} withdrawCategoryId 提现通道ID
 * @param {string} withdrawType 提现通道类型
 * @param {string} withdrawPassword 提现密码
 * @returns {object|null}
 */
export function withdrawApply(token, amount, walletId, withdrawCategoryId, withdrawType, withdrawPassword = '123456') {
    const api = '/api/Withdraw/WithdrawApply';
    const tag = 'WithdrawApply';
    const payload = {
        amount: amount,
        walletId: walletId,
        withdrawCategoryId: withdrawCategoryId,
        withdrawType: withdrawType,
        withdrawPassword: withdrawPassword
    };

    console.log(`[${tag}] 提现申请参数:`, JSON.stringify(payload, null, 2));

    const response = tenantRequest(api, payload, { token, isDesk: true });

    console.log(`[${tag}] 提现申请响应:`, JSON.stringify(response, null, 2));

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 提现申请失败:`, response);
        return null;
    }

    console.log(`[${tag}] ✅ 提现申请成功`);

    // 如果没有 data 字段，返回整个响应对象（表示成功）
    return response.data || response.raw || { success: true };
}

/**
 * 获取提现历史
 * @param {string} token 
 * @param {number} startTime 
 * @param {number} endTime 
 * @param {number} pageNo
 * @param {number} pageSize
 * @returns {Array|null}
 */
export function getWithdrawHistory(token, startTime, endTime, pageNo = 1, pageSize = 20) {
    const api = '/api/Withdraw/GetWithdrawHistory';
    const tag = 'GetWithdrawHistory';
    const payload = {
        withdrawType: "",
        withdrawState: "",
        startTime: startTime,
        endTime: endTime
    };

    const response = tenantQueryRequest(api, payload, { token, isDesk: true, pageNo, pageSize });

    if (!response || !response.list) {
        console.error(`[${tag}] 获取提现历史失败`);
        return null;
    }
    return response.list;
}
