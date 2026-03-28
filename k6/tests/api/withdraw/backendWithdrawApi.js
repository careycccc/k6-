/**
 * 后台提现审核相关接口 - 多租户版本
 */

import { tenantRequest } from '../../../libs/http/tenantRequest.js';

/**
 * 查询待审核的提现订单
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {string} withdrawType - 提现类型
 * @param {number} minAmount - 最小金额
 * @param {number} maxAmount - 最大金额
 * @returns {object|null} 返回订单信息 {orderNo, createTime}
 */
export function getWithdrawLockPageList(adminToken, userId, withdrawType, minAmount, maxAmount) {
    const api = '/api/WithdrawOrder/GetWithdrawLockPageList';
    const tag = 'GetWithdrawLockPageList';

    const payload = {
        userId: userId,
        withdrawType: withdrawType,
        minWithdrawAmount: minAmount,
        maxWithdrawAmount: maxAmount,
        dateType: 0,
        pageNo: 1,
        pageSize: 20,
        orderBy: 'Desc'
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 查询提现订单失败:`, response);
        return null;
    }

    // 检查是否有订单
    if (!response.data || !response.data.list || response.data.list.length === 0) {
        console.warn(`[${tag}] 没有找到待审核的提现订单`);
        return null;
    }

    // 返回第一个订单的信息
    const order = response.data.list[0];
    return {
        orderNo: order.orderNo,
        createTime: order.createTime
    };
}

/**
 * 锁定提现订单
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {object} orderInfo - 订单信息 {orderNo, createTime}
 * @returns {boolean} 是否成功
 */
export function lockWithdrawOrder(adminToken, userId, orderInfo) {
    const api = '/api/WithdrawOrder/LockWithdrawOrder';
    const tag = 'LockWithdrawOrder';

    const payload = {
        userId: userId,
        orderNo: orderInfo.orderNo,
        createTime: orderInfo.createTime,
        remark: 'Auto lock by K6'
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 锁定订单失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 订单锁定成功: ${orderInfo.orderNo}`);
    return true;
}

/**
 * 获取可用的三方提现通道
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {object} orderInfo - 订单信息 {orderNo, createTime}
 * @returns {number|null} 返回通道ID
 */
export function getCanWithdrawChannelByOrder(adminToken, userId, orderInfo) {
    const api = '/api/WithdrawOrder/GetCanWithdrawChannelByOrder';
    const tag = 'GetCanWithdrawChannelByOrder';

    const payload = {
        remark: 'Auto get channel by K6',
        userId: userId,
        orderNo: orderInfo.orderNo,
        createTime: orderInfo.createTime
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 获取提现通道失败:`, response);
        return null;
    }

    // 检查是否有可用通道
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
        console.error(`[${tag}] 没有可用的提现通道`);
        return null;
    }

    const channelId = response.data[0].channelId;
    console.log(`[${tag}] 获取到提现通道ID: ${channelId}`);
    return channelId;
}

/**
 * 选择三方通道提现
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {object} orderInfo - 订单信息 {orderNo, createTime}
 * @param {number} channelId - 通道ID
 * @returns {boolean} 是否成功
 */
export function thirdWithdraw(adminToken, userId, orderInfo, channelId) {
    const api = '/api/WithdrawOrder/ThirdWithdraw';
    const tag = 'ThirdWithdraw';

    const payload = {
        orderNo: orderInfo.orderNo,
        userId: userId,
        createTime: orderInfo.createTime,
        remark: 'Auto third withdraw by K6',
        withdrawChannelId: channelId
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 三方提现失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 三方提现成功`);
    return true;
}

/**
 * 确认出款
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {object} orderInfo - 订单信息 {orderNo, createTime}
 * @returns {boolean} 是否成功
 */
export function confirmWithdrawOrder(adminToken, userId, orderInfo) {
    const api = '/api/WithdrawOrder/ConfirmWithdrawOrder';
    const tag = 'ConfirmWithdrawOrder';

    const payload = {
        orderNo: orderInfo.orderNo,
        userId: userId,
        createTime: orderInfo.createTime,
        remark: 'Auto confirm by K6'
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 确认出款失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 确认出款成功`);
    return true;
}

/**
 * 完整的后台审核流程
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {string} withdrawType - 提现类型
 * @param {number} amount - 提现金额
 * @returns {boolean} 是否成功
 */
export function runBackendWithdrawApproval(adminToken, userId, withdrawType, amount) {
    const tag = 'BackendApproval';

    console.log(`[${tag}] ========== 开始后台审核流程 ==========`);
    console.log(`[${tag}] 用户ID: ${userId}`);
    console.log(`[${tag}] 提现类型: ${withdrawType}`);
    console.log(`[${tag}] 提现金额: ${amount}`);

    // 1. 查询订单
    console.log(`[${tag}] 步骤1: 查询待审核订单...`);
    const orderInfo = getWithdrawLockPageList(adminToken, userId, withdrawType, amount, amount);
    if (!orderInfo) {
        console.error(`[${tag}] ❌ 未找到待审核订单`);
        return false;
    }
    console.log(`[${tag}] ✅ 找到订单: ${orderInfo.orderNo}`);

    // 等待1秒
    sleep(1);

    // 2. 锁定订单
    console.log(`[${tag}] 步骤2: 锁定订单...`);
    if (!lockWithdrawOrder(adminToken, userId, orderInfo)) {
        console.error(`[${tag}] ❌ 锁定订单失败`);
        return false;
    }

    // 等待1秒
    sleep(1);

    // 3. 获取三方通道
    console.log(`[${tag}] 步骤3: 获取三方提现通道...`);
    const channelId = getCanWithdrawChannelByOrder(adminToken, userId, orderInfo);
    if (!channelId) {
        console.error(`[${tag}] ❌ 获取提现通道失败`);
        return false;
    }

    // 等待1秒
    sleep(1);

    // 4. 三方提现
    console.log(`[${tag}] 步骤4: 执行三方提现...`);
    if (!thirdWithdraw(adminToken, userId, orderInfo, channelId)) {
        console.error(`[${tag}] ❌ 三方提现失败`);
        return false;
    }

    // 等待1秒
    sleep(1);

    // 5. 确认出款
    console.log(`[${tag}] 步骤5: 确认出款...`);
    if (!confirmWithdrawOrder(adminToken, userId, orderInfo)) {
        console.error(`[${tag}] ❌ 确认出款失败`);
        return false;
    }

    console.log(`[${tag}] ========== 后台审核流程完成 ==========`);
    return true;
}

// 需要导入 sleep
import { sleep } from 'k6';
