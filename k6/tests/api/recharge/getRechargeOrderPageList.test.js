/**
 * GetRechargeOrderPageList 接口测试
 * 
 * 功能：
 * 查询指定用户的充值订单列表，默认查询昨天的数据
 * 
 * 运行方式：
 * k6 run -e TENANT_ID=3004 k6/tests/api/recharge/getRechargeOrderPageList.test.js
 * k6 run -e TENANT_ID=3004 -e USER_ID=110655 getRechargeOrderPageList.test.js
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getRechargeOrderPageListFull } from './backendRechargeApi.js';

// 获取环境变量
const tenantId = __ENV.TENANT_ID || '3004';
const userId = __ENV.USER_ID ? parseInt(__ENV.USER_ID) : 110655;

export const options = {
    scenarios: {
        get_recharge_order_page_list: {
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
 * Setup 阶段：管理员登录
 */
export function setup() {
    console.log(`\n[Setup] 开始准备测试环境...`);
    console.log(`[Setup] 租户ID: ${tenantId}`);
    console.log(`[Setup] 用户ID: ${userId}`);

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
    console.log(`[GetRechargeOrderPageList] 开始查询充值订单`);
    console.log(`===========================================`);

    // 获取昨天的时间范围
    const { startTime, endTime } = getYesterdayTimestamps();

    console.log(`\n[GetRechargeOrderPageList] 查询参数:`);
    console.log(`  - 用户ID: ${userId}`);
    console.log(`  - 充值状态: Payed`);
    console.log(`  - 开始时间: ${new Date(startTime).toISOString()} (${startTime})`);
    console.log(`  - 结束时间: ${new Date(endTime).toISOString()} (${endTime})`);

    // 调用查询接口
    const result = getRechargeOrderPageListFull(adminToken, {
        userId: userId,
        rechargeState: 'Payed',
        startTime: startTime,
        endTime: endTime,
        pageNo: 1,
        pageSize: 20,
        minActualAmount: '',
        maxActualAmount: '',
        dateType: 0,
        orderBy: 'Desc'
    });

    if (result) {
        // 处理响应数据
        let orderList = [];
        if (result.data && result.data.list) {
            orderList = result.data.list;
        } else if (result.list) {
            orderList = result.list;
        }

        console.log(`\n[GetRechargeOrderPageList] ✅ 查询成功，共找到 ${orderList.length} 条订单记录`);

        // 打印订单详情
        if (orderList.length > 0) {
            console.log(`\n[GetRechargeOrderPageList] 订单列表详情:`);
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
            console.log(`\n[GetRechargeOrderPageList] ⚠️ 未找到符合条件的订单记录`);
        }
    } else {
        console.error(`\n[GetRechargeOrderPageList] ❌ 查询失败`);
    }

    sleep(1);
}

export function teardown(data) {
    console.log(`\n[Teardown] 测试完成`);
}
