/**
 * 提现相关接口封装
 */

import { sendRequest, sendQueryRequest } from '../common/request.js';
import { getTimeRandom } from '../../utils/utils.js';

/**
 * 获取提现基础信息
 * @param {string} token 
 * @returns {object|null}
 */
export function getWithdrawBasicInfo(token) {
    const api = '/api/Withdraw/GetWithdrawBasicInfo';
    const tag = 'GetWithdrawBasicInfo';

    // 改用 sendRequest，避免 sendQueryRequest 附加的 pageNo, pageSize 导致签名错误
    const payload = {};

    const response = sendRequest(payload, api, tag, true, token);

    if (!response) {
        console.error(`[${tag}] 获取提现基础信息失败: 响应为空`);
        return null;
    }

    return response;
}

/**
 * 获取用户提现钱包
 * @param {string} token 
 * @param {string} withdrawType 
 * @returns {object|null} 返回钱包信息，包含 walletId
 */
export function getUserWithdrawWallet(token, withdrawType) {
    const api = '/api/Withdraw/GetUserWithdrawWallet';
    const tag = 'GetUserWithdrawWallet';
    const payload = {
        withdrawType: withdrawType
    };

    const response = sendQueryRequest(payload, api, tag, true, token);

    if (!response) {
        console.error(`[${tag}] 获取用户提现钱包失败: 响应为空`);
        return null;
    }

    return response;
}

/**
 * 设置提现密码
 * @param {string} token 
 * @param {string} password
 * @returns {boolean}
 */
export function setWithdrawPassword(token, password = '123456') {
    // 根据系统惯例，提现密码通常在 User 模块下
    const api = '/api/User/SetWithdrawPassword';
    const tag = 'SetWithdrawPassword';
    const payload = {
        withdrawPassword: password
    };

    const response = sendRequest(payload, api, tag, true, token);

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
export function withdrawApply(token, amount, walletId, withdrawCategoryId, withdrawType, withdrawPassword = 'password123') {
    const api = '/api/Withdraw/WithdrawApply';
    const tag = 'WithdrawApply';
    const payload = {
        amount: amount,
        walletId: walletId,
        withdrawCategoryId: withdrawCategoryId,
        withdrawType: withdrawType,
        withdrawPassword: withdrawPassword
    };

    const response = sendRequest(payload, api, tag, true, token);

    if (!response) {
        console.error(`[${tag}] 提现申请失败`);
        return null;
    }
    return response;
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
        endTime: endTime,
        pageNo: pageNo,
        pageSize: pageSize
    };

    const response = sendQueryRequest(payload, api, tag, true, token);

    if (!response || !response.list) {
        console.error(`[${tag}] 获取提现历史失败`);
        return null;
    }
    return response.list;
}
