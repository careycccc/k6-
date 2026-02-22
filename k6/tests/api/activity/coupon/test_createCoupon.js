/**
 * 优惠券创建功能测试脚本
 * 
 * 使用方法：
 * k6 run k6/tests/api/activity/coupon/test_createCoupon.js
 * 
 * 或者带环境变量：
 * k6 run -e TOKEN=your-token-here k6/tests/api/activity/coupon/test_createCoupon.js
 */

import { createCoupon, createCouponTag, couponIds } from './createCoupon.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        checks: ['rate>0.9']
    }
};

export function setup() {
    // 从环境变量获取 token，或使用默认值
    const token = __ENV.TOKEN || 'your-default-token-here';

    console.log('='.repeat(60));
    console.log('优惠券创建功能测试');
    console.log('='.repeat(60));
    console.log(`Token: ${token.substring(0, 20)}...`);
    console.log('='.repeat(60));

    return { token };
}

export default function (data) {
    console.log('\n开始测试优惠券创建功能...\n');

    // 调用创建函数
    const result = createCoupon(data);

    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('测试结果');
    console.log('='.repeat(60));
    console.log(`成功状态: ${result.success}`);
    console.log(`标签: ${result.tag}`);
    console.log(`消息: ${result.message}`);

    if (result.couponIds && result.couponIds.length > 0) {
        console.log(`创建的优惠券数量: ${result.couponIds.length}`);
        console.log(`优惠券IDs: ${JSON.stringify(result.couponIds)}`);
    }

    console.log('='.repeat(60));

    // 验证结果
    if (result.success) {
        console.log('✅ 测试通过：优惠券创建成功');
    } else {
        console.log('⚠️  测试结果：优惠券创建被跳过或失败');
        console.log(`   原因: ${result.message}`);
    }

    console.log('='.repeat(60) + '\n');

    return result;
}

export function teardown(data) {
    console.log('\n测试完成！');
    console.log(`最终收集的优惠券ID数量: ${couponIds.length}`);
    if (couponIds.length > 0) {
        console.log(`优惠券IDs: ${JSON.stringify(couponIds)}`);
    }
}
