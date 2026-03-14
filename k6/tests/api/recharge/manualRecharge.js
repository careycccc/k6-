/**
 * 人工充值模块
 * 对应 Golang 的 ArtificialRechargeFunc
 */

import { sendRequest } from '../common/request.js';

/**
 * 人工充值类型枚举
 */
export const RechargeType = {
    MANUAL: 3,  // 人工充值
};

/**
 * 人工充值接口
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {number} rechargeAmount - 充值金额
 * @param {number} amountOfCode - 打码量倍数（null表示默认，数字表示倍数）
 * @param {string} remark - 备注，默认为 'Manual recharge'
 * @returns {object|null} 充值结果
 */
export function manualRecharge(adminToken, userId, rechargeAmount, amountOfCode = 1, remark = 'Manual recharge') {
    console.log(`[ManualRecharge] 开始人工充值: userId=${userId}, amount=${rechargeAmount}, code=${amountOfCode}`);

    const api = '/api/ArtificialRechargeRecord/ArtificialRecharge';

    // 构建请求负载
    const payload = {
        artificialRechargeType: RechargeType.MANUAL,  // 人工充值类型：3
        rechargeAmount: rechargeAmount,               // 充值金额
        remark: remark,                               // 备注
        amountOfCode: amountOfCode,                   // 打码量倍数
        userId: userId                                // 用户ID
    };

    try {
        // 发送请求（isDesk=false 表示后台管理员接口）
        const response = sendRequest(payload, api, 'ManualRecharge', false, adminToken);

        // 检查响应
        if (!response) {
            console.error('[ManualRecharge] 充值失败：响应为空');
            return null;
        }

        // sendRequest 可能返回三种类型，需要处理
        let statusCode, msg, data;

        if (typeof response === 'string') {
            // 不应该返回 Token
            console.error('[ManualRecharge] 充值失败：响应格式错误（返回Token）');
            return null;
        } else if (response.msgCode !== undefined || response.code !== undefined) {
            // 完整响应对象
            statusCode = response.code !== undefined ? response.code : response.msgCode;
            msg = response.msg;
            data = response.data;
        } else {
            // 可能是 data 对象
            console.log(`[ManualRecharge] ✅ 充值成功: userId=${userId}, amount=${rechargeAmount} (返回data)`);
            return {
                success: true,
                userId: userId,
                amount: rechargeAmount,
                data: response
            };
        }

        // 检查业务状态码
        if (statusCode === 0 && msg === 'Succeed') {
            console.log(`[ManualRecharge] ✅ 充值成功: userId=${userId}, amount=${rechargeAmount}`);
            return {
                success: true,
                userId: userId,
                amount: rechargeAmount,
                data: data
            };
        } else {
            console.error(`[ManualRecharge] 充值失败: userId=${userId}, msgCode=${statusCode}, msg=${msg}`);
            return {
                success: false,
                userId: userId,
                amount: rechargeAmount,
                msgCode: statusCode,
                msg: msg
            };
        }

    } catch (error) {
        console.error(`[ManualRecharge] 充值异常: userId=${userId}, error=${error.message}`);
        return {
            success: false,
            userId: userId,
            amount: rechargeAmount,
            error: error.message
        };
    }
}

/**
 * 批量人工充值
 * @param {string} adminToken - 管理员token
 * @param {Array<{userId: number, amount: number}>} rechargeList - 充值列表
 * @param {number} amountOfCode - 打码量倍数
 * @returns {object} 批量充值结果统计
 */
export function batchManualRecharge(adminToken, rechargeList, amountOfCode = 1) {
    console.log(`[BatchRecharge] 开始批量充值: 共${rechargeList.length}个用户`);

    const results = {
        total: rechargeList.length,
        success: 0,
        failed: 0,
        details: []
    };

    for (let i = 0; i < rechargeList.length; i++) {
        const { userId, amount } = rechargeList[i];

        console.log(`[BatchRecharge] [${i + 1}/${rechargeList.length}] 充值用户: ${userId}`);

        const result = manualRecharge(adminToken, userId, amount, amountOfCode);

        if (result && result.success) {
            results.success++;
        } else {
            results.failed++;
        }

        results.details.push({
            userId: userId,
            amount: amount,
            success: result ? result.success : false,
            result: result
        });
    }

    console.log(`[BatchRecharge] 批量充值完成: 成功${results.success}, 失败${results.failed}`);

    return results;
}
