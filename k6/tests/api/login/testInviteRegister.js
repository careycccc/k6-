/**
 * 测试邀请注册流程
 * 验证 phoneRegisterByInvite 方法是否能成功注册
 */

import { phoneRegisterByInvite } from './register.test.js';
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
        invite_register_test: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m'
        },
    },
};

export default function (data) {
    console.log('\n========== 🧪 测试邀请注册 ==========\n');

    // 生成随机手机号
    const testPhone = '913' + String(Math.floor(Math.random() * 900000000 + 100000000));
    console.log(`测试手机号: ${testPhone}`);

    // 使用测试邀请码（需要修改为实际有效的邀请码）
    const inviteCode = 'W5LU89N';
    console.log(`邀请码: ${inviteCode}`);

    // 调用 phoneRegisterByInvite（codeType=19，邀请注册）
    console.log('\n--- 开始邀请注册 ---');
    const response = phoneRegisterByInvite(testPhone, inviteCode, data);

    if (!response) {
        console.error('❌ 邀请注册失败：响应为空');
        throw new Error('邀请注册失败');
    }

    // phoneRegisterByInvite 返回 {headers, data, code, msg}
    const statusCode = response.code !== undefined ? response.code : response.msgCode;
    console.log(`\n注册响应: code=${statusCode}, msg=${response.msg}`);

    if (statusCode === 0 && response.data) {
        console.log('\n✅ 邀请注册成功！');
        console.log(`账号: ${testPhone}`);
        console.log(`Token: ${response.data.token ? response.data.token.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`UserId: ${response.data.userId || 'N/A'}`);

        // 从 headers 中提取 Authorization token
        const authToken = response.headers ?
            (response.headers['Authorization'] || response.headers['authorization']) : null;
        console.log(`Authorization Header: ${authToken ? authToken.substring(0, 50) + '...' : 'N/A'}`);

        console.log('\n💡 注册成功！可以在后台会员列表中查看该用户');
    } else {
        console.error('\n❌ 邀请注册失败！');
        console.error(`错误码: ${statusCode}`);
        console.error(`错误信息: ${response.msg}`);
        throw new Error('邀请注册失败');
    }

    console.log('\n========== 测试结束 ==========\n');
}

export function teardown(data) {
    console.log('[Teardown] 测试完成');
}
