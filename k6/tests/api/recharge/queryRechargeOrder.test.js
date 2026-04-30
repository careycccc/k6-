/**
 * 查询充值订单列表测试
 * 
 * 功能：
 * 1. 查询指定用户的充值订单列表（默认查询昨天的数据）
 * 2. 支持按支付状态、金额范围、日期范围等条件筛选
 * 
 * 运行方式：
 * k6 run -e TENANT_ID=3004 -e USER_ID=110655 k6/tests/api/recharge/queryRechargeOrder.test.js
 * k6 run -e TENANT_ID=3004 -e USER_ID=110655 -e RECHARGE_STATE=Payed queryRechargeOrder.test.js
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest } from '../common/request.js';

// 获取环境变量
const tenantId = __ENV.TENANT_ID || '3004';
const userId = __ENV.USER_ID ? parseInt(__ENV.USER_ID) : 110655;
const rechargeState = __ENV.RECHARGE_STATE || 'Payed'; // Payed, Wait, Fail, Cancel, PendingReview

export const options = {
    scenarios: {
        query_recharge_order: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m'
        }
    }
};

/**
 * 获取昨天的开始和结束时间戳（毫秒）
 * @returns {object} { startTime, endTime }
 */
function getYesterdayTimestamps() {
    const now = new Date();
    
    // 获取昨天的日期
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // 昨天的开始时间 00:00:00
    const startTime = new Date(yesterday);
    startTime.setHours(0, 0, 0, 0);
    
    // 昨天的结束时间 23:59:59
    const endTime = new Date(yesterday);
    endTime.setHours(23, 59, 59, 999);
    
    return {
        startTime: startTime.getTime(),
        endTime: endTime.getTime()
    };
}

/**
 * 查询充值订单列表
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {string} rechargeState - 充值状态
 * @param {number} startTime - 开始时间（毫秒时间戳）
 * @param {number} endTime - 结束时间（毫秒时间戳）
 * @returns {object|null} 返回订单列表响应
 */
export function getRechargeOrderPageList(
    adminToken, 
    userId, 
    rechargeState = 'Payed',
    startTime = null,
    endTime = null
) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const tag = 'GetRechargeOrderPageList';
    
    // 如果没有提供时间范围，默认查询昨天的数据
    let queryStartTime = startTime;
    let queryEndTime = endTime;
    
    if (!startTime || !endTime) {
        const timestamps = getYesterdayTimestamps();
        queryStartTime = timestamps.startTime;
        queryEndTime = timestamps.endTime;
    }
    
    const payload = {
        userId: userId,
        rechargeState: rechargeState,
        startTime: queryStartTime,
        endTime: queryEndTime,
        pageNo: 1,
        pageSize: 20,
        minActualAmount: "",
        maxActualAmount: "",
        dateType: 0,
        orderBy: "Desc"
    };

    console.log(`\n[${tag}] 查询参数:`);
    console.log(`  - 用户ID: ${userId}`);
    console.log(`  - 充值状态: ${rechargeState}`);
    console.log(`  - 开始时间: ${new Date(queryStartTime).toISOString()} (${queryStartTime})`);
    console.log(`  - 结束时间: ${new Date(queryEndTime).toISOString()} (${queryEndTime})`);
    console.log(`  - 页码: ${payload.pageNo}`);
    console.log(`  - 每页数量: ${payload.pageSize}`);

    // 使用 sendRequest 发送后台请求，isDesk = false
    const response = sendRequest(payload, api, tag, false, adminToken);
    
    if (!response) {
        console.error(`[${tag}] ❌ 查询订单列表失败: 响应为空`);
        return null;
    }
    
    // 处理响应数据
    let orderList = [];
    if (response.data && response.data.list) {
        orderList = response.data.list;
    } else if (response.list) {
        orderList = response.list;
    }
    
    console.log(`\n[${tag}] ✅ 查询成功，共找到 ${orderList.length} 条订单记录`);
    
    // 打印订单详情
    if (orderList.length > 0) {
        console.log(`\n[${tag}] 订单列表详情:`);
        orderList.forEach((order, index) => {
            console.log(`\n  订单 [${index + 1}]:`);
            console.log(`    - 订单号: ${order.orderNo || 'N/A'}`);
            console.log(`    - 充值金额: ${order.amount || 0}`);
            console.log(`    - 实际金额: ${order.actualAmount || 0}`);
            console.log(`    - 充值状态: ${order.rechargeState || 'N/A'}`);
            console.log(`    - 充值类型: ${order.rechargeType || 'N/A'}`);
            console.log(`    - 创建时间: ${order.createTime ? new Date(order.createTime).toISOString() : 'N/A'}`);
            console.log(`    - 支付时间: ${order.payTime ? new Date(order.payTime).toISOString() : 'N/A'}`);
        });
    } else {
        console.log(`\n[${tag}] ⚠️ 未找到符合条件的订单记录`);
    }
    
    return response;
}

/**
 * Setup 阶段：管理员登录
 */
export function setup() {
    console.log(`\n[Setup] 开始准备测试环境...`);
    console.log(`[Setup] 租户ID: ${tenantId}`);
    console.log(`[Setup] 用户ID: ${userId}`);
    console.log(`[Setup] 充值状态: ${rechargeState}`);

    // 管理员登录
    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败');
    }

    console.log(`[Setup] ✅ 管理员登录成功`);

    return {
        adminToken: adminToken
    };
}

export default function (data) {
    const { adminToken } = data;

    console.log(`\n===========================================`);
    console.log(`[QueryRechargeOrder] 开始查询充值订单列表`);
    console.log(`===========================================`);

    // 查询充值订单列表（默认查询昨天的数据）
    const result = getRechargeOrderPageList(
        adminToken,
        userId,
        rechargeState
    );

    if (result) {
        console.log(`\n[QueryRechargeOrder] ✅ 查询完成`);
    } else {
        console.error(`\n[QueryRechargeOrder] ❌ 查询失败`);
    }

    sleep(1);
}

export function teardown(data) {
    console.log(`\n[Teardown] 测试完成`);
}
