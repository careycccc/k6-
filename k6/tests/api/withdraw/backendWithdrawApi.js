/**
 * 后台提现审核相关接口 - 多租户版本
 *
 * forceTenant说明(2026-11-13新增)：本文件所有接口默认forceTenant=false，保持原有
 * 行为不变(走tenantRequest的默认路由——resolveQueryRoute自动判断集团/商户，适配
 * withdraw.test.js等现有调用方的adminToken多是tenantAdminLogin(tenantId)不传
 * forceTenant拿到的集团token)。但如果调用方的adminToken是显式forceTenant=true登录
 * 拿到的"商户自己的token"(如multiChannelAudienceBuilder.js)，必须给这里的函数也
 * 传forceTenant=true，否则会复现"Account type does not match the admin site"
 * (msgCode 13208)——商户token被默认路由打到了集团域名，查询"成功"但列表恒为空，
 * 很容易误判成"没有待审核订单"而不是路由错误(2026-11-13实测踩坑)。
 */

import { tenantRequest } from '../../../libs/http/tenantRequest.js';

/**
 * 查询待审核的提现订单
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {string} withdrawType - 提现类型
 * @param {number} minAmount - 最小金额
 * @param {number} maxAmount - 最大金额
 * @param {boolean} [forceTenant=false] - 见文件头说明
 * @returns {object|null} 返回订单信息 {orderNo, createTime}
 */
export function getWithdrawLockPageList(adminToken, userId, withdrawType, minAmount, maxAmount, forceTenant = false) {
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

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

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
 * @param {boolean} [forceTenant=false]
 * @returns {boolean} 是否成功
 */
export function lockWithdrawOrder(adminToken, userId, orderInfo, forceTenant = false) {
    const api = '/api/WithdrawOrder/LockWithdrawOrder';
    const tag = 'LockWithdrawOrder';

    const payload = {
        userId: userId,
        orderNo: orderInfo.orderNo,
        createTime: orderInfo.createTime,
        remark: 'Auto lock by K6'
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

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
 * @param {boolean} [forceTenant=false]
 * @returns {number|null} 返回通道ID
 */
export function getCanWithdrawChannelByOrder(adminToken, userId, orderInfo, forceTenant = false) {
    const api = '/api/WithdrawOrder/GetCanWithdrawChannelByOrder';
    const tag = 'GetCanWithdrawChannelByOrder';

    const payload = {
        remark: 'Auto get channel by K6',
        userId: userId,
        orderNo: orderInfo.orderNo,
        createTime: orderInfo.createTime
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

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
 * @param {boolean} [forceTenant=false]
 * @returns {boolean} 是否成功
 */
export function thirdWithdraw(adminToken, userId, orderInfo, channelId, forceTenant = false) {
    const api = '/api/WithdrawOrder/ThirdWithdraw';
    const tag = 'ThirdWithdraw';

    const payload = {
        orderNo: orderInfo.orderNo,
        userId: userId,
        createTime: orderInfo.createTime,
        remark: 'Auto third withdraw by K6',
        withdrawChannelId: channelId
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

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
 * @param {boolean} [forceTenant=false]
 * @returns {boolean} 是否成功
 */
export function confirmWithdrawOrder(adminToken, userId, orderInfo, forceTenant = false) {
    const api = '/api/WithdrawOrder/ConfirmWithdrawOrder';
    const tag = 'ConfirmWithdrawOrder';

    const payload = {
        orderNo: orderInfo.orderNo,
        userId: userId,
        createTime: orderInfo.createTime,
        remark: 'Auto confirm by K6'
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 确认出款失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 确认出款成功`);
    return true;
}

/**
 * 人工确认出款（三方提现失败时的保底方案）
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {object} orderInfo - 订单信息 {orderNo, createTime}
 * @param {string} remark - 备注（可选）
 * @param {boolean} [forceTenant=false]
 * @returns {boolean} 是否成功
 */
export function artificialConfirmWithdrawOrder(adminToken, userId, orderInfo, remark = 'Auto artificial confirm by K6', forceTenant = false) {
    const api = '/api/WithdrawOrder/ArtificialConfirmWithdrawOrder';
    const tag = 'ArtificialConfirmWithdrawOrder';

    const payload = {
        orderNo:    orderInfo.orderNo,
        userId:     userId,
        createTime: orderInfo.createTime,
        remark:     remark
    };

    const response = tenantRequest(api, payload, { token: adminToken, isDesk: false, forceTenant });

    // msgCode=8("The order has been processed")是个终态信号，不是失败：出现在"三方提现
    // 响应判定为失败(ThirdWithdraw报错，比如测试环境常见的'响应转换参数错误'/'withdraw
    // error, code exception')，但订单实际已经被三方那一步处理完"的场景——三方接口执行
    // 动作本身成功了，只是响应格式/内容让调用方误判成失败，订单状态已经不是"待处理"，
    // 所以这里再去"人工确认"自然会被拒绝(订单已处理，不能再处理一次)。把这种情况当失败
    // 上报会让runBackendWithdrawApproval的调用方以为提现没出款，但实际钱已经到账了
    // (2026-11-13实测：多次复现，每次ThirdWithdraw报错后紧跟着就是msgCode=8)。
    if (response && response.msgCode === 8) {
        console.log(`[${tag}] ℹ️ 订单已处理(视为成功，三方提现那一步实际已完成出款): ${orderInfo.orderNo}`);
        return true;
    }

    if (!response || response.msgCode !== 0) {
        console.error(`[${tag}] 人工确认出款失败:`, response);
        return false;
    }

    console.log(`[${tag}] ✅ 人工确认出款成功: ${orderInfo.orderNo}`);
    return true;
}

/**
 * 完整的后台审核流程
 * 三方提现失败时自动降级到人工确认出款
 * @param {string} adminToken - 后台管理员token
 * @param {number} userId - 用户ID
 * @param {string} withdrawType - 提现类型
 * @param {number} amount - 提现金额
 * @param {boolean} [forceTenant=false] - adminToken是显式forceTenant登录拿到的"商户
 *   自己的token"时必须传true，否则按默认路由走(适配走集团token的现有调用方)，见文件头说明
 * @returns {boolean} 是否成功
 */
export function runBackendWithdrawApproval(adminToken, userId, withdrawType, amount, forceTenant = false) {
    const tag = 'BackendApproval';

    console.log(`[${tag}] ========== 开始后台审核流程 ==========`);
    console.log(`[${tag}] 用户ID: ${userId}`);
    console.log(`[${tag}] 提现类型: ${withdrawType}`);
    console.log(`[${tag}] 提现金额: ${amount}`);

    // 1. 查询订单
    console.log(`[${tag}] 步骤1: 查询待审核订单...`);
    const orderInfo = getWithdrawLockPageList(adminToken, userId, withdrawType, amount, amount, forceTenant);
    if (!orderInfo) {
        console.error(`[${tag}] ❌ 未找到待审核订单`);
        return false;
    }
    console.log(`[${tag}] ✅ 找到订单: ${orderInfo.orderNo}`);

    // 等待1秒
    sleep(1);

    // 2. 锁定订单
    console.log(`[${tag}] 步骤2: 锁定订单...`);
    if (!lockWithdrawOrder(adminToken, userId, orderInfo, forceTenant)) {
        console.error(`[${tag}] ❌ 锁定订单失败`);
        return false;
    }

    // 等待1秒
    sleep(1);

    // 3. 获取三方通道
    console.log(`[${tag}] 步骤3: 获取三方提现通道...`);
    const channelId = getCanWithdrawChannelByOrder(adminToken, userId, orderInfo, forceTenant);
    if (!channelId) {
        console.error(`[${tag}] ❌ 获取提现通道失败`);
        return false;
    }

    // 等待1秒
    sleep(1);

    // 4. 三方提现
    console.log(`[${tag}] 步骤4: 执行三方提现...`);
    if (!thirdWithdraw(adminToken, userId, orderInfo, channelId, forceTenant)) {
        console.warn(`[${tag}] ⚠️ 三方提现失败，降级到人工确认出款...`);
        sleep(1);
        if (!artificialConfirmWithdrawOrder(adminToken, userId, orderInfo, 'Auto artificial confirm by K6', forceTenant)) {
            console.error(`[${tag}] ❌ 人工确认出款也失败，审核流程终止`);
            return false;
        }
        console.log(`[${tag}] ✅ 人工确认出款成功，跳过步骤5`);
        console.log(`[${tag}] ========== 后台审核流程完成（人工兜底）==========`);
        return true;
    }

    // 等待1秒
    sleep(1);

    // 5. 确认出款
    console.log(`[${tag}] 步骤5: 确认出款...`);
    if (!confirmWithdrawOrder(adminToken, userId, orderInfo, forceTenant)) {
        console.error(`[${tag}] ❌ 确认出款失败`);
        return false;
    }

    console.log(`[${tag}] ========== 后台审核流程完成 ==========`);
    return true;
}

// 需要导入 sleep
import { sleep } from 'k6';
