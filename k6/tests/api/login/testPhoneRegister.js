/**
 * 测试普通手机号注册
 * 用于验证 phoneRegister 方法是否能成功注册
 */

import { phoneRegister } from './register.test.js';
import { AdminLogin } from './adminlogin.test.js';

export function setup() {
    console.log('[Setup] 管理员登录...');
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }
    console.log('[Setup] ✅ 管理员登录成功');
    return { token: adminToken };
}

export const options = {
    scenarios: {
        phone_register_test: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m'
        },
    },
};

export default function (data) {
    console.log('\n========== 🧪 测试普通手机号注册 ==========\n');

    // 生成随机手机号
    const testPhone = '913' + String(Math.floor(Math.random() * 900000000 + 100000000));
    console.log(`测试手机号: ${testPhone}`);

    // 调用 phoneRegister（codeType=1，普通注册）
    console.log('\n--- 开始注册 ---');
    const response = phoneRegister(testPhone, data);

    if (!response) {
        console.error('❌ 注册失败：响应为空');
        throw new Error('注册失败');
    }

    // phoneRegister 现在返回 {headers, data, code, msg}
    const statusCode = response.code !== undefined ? response.code : response.msgCode;
    console.log(`\n注册响应: code=${statusCode}, msg=${response.msg}`);

    if (statusCode === 0 && response.data) {
        console.log('\n✅ 普通手机号注册成功！');
        console.log(`账号: ${testPhone}`);
        console.log(`Token: ${response.data.token ? response.data.token.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`UserId: ${response.data.userId || 'N/A'}`);
        console.log(`InviteCode: ${response.data.inviteCode || 'N/A'}`);
        console.log('\n💡 注册成功！可以在后台会员列表中查看该用户');
    } else {
        console.error('\n❌ 普通手机号注册失败！');
        console.error(`错误码: ${statusCode}`);
        console.error(`错误信息: ${response.msg}`);
        throw new Error('注册失败');
    }

    console.log('\n========== 测试结束 ==========\n');
}

export function teardown(data) {
    console.log('[Teardown] 测试完成');
}
