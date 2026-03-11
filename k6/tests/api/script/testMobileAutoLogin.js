/**
 * 测试手机号自动登录功能
 * 1. 后台登录
 * 2. 使用已存在的手机号
 * 3. 发送自动登录验证码
 * 4. 使用验证码进行自动登录
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { mobileAutoLoginFlow, sendMobileAutoLoginVerifyCode, MobileAutoLogin } from '../login/MobileAutoLogin.test.js';

export function setup() {
    console.log('[Setup] 开始后台登录...');
    const adminToken = AdminLogin();
    if (!adminToken) {
        console.error('后台登录失败');
        throw new Error('后台登录失败');
    }

    const tokenDisplay = adminToken && typeof adminToken === 'string' && adminToken.length > 20
        ? adminToken.substring(0, 20) + '...'
        : adminToken;
    console.log('[Setup] 后台登录成功，token:', tokenDisplay);
    return { token: adminToken };
}

export const options = {
    scenarios: {
        test_mobile_auto_login: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '15s'
        },
    },
};

export default function (data) {
    console.log('\n========== 开始测试手机号自动登录功能 ==========\n');

    // 使用一个已知存在的手机号进行测试
    // 请替换为你系统中实际存在的手机号
    const existingPhoneNumber = '913006199723'; // 这是你提供的示例手机号
    console.log('[Test] 使用已存在的手机号:', existingPhoneNumber);

    // 测试完整的自动登录流程
    console.log('\n[Test] 测试完整的自动登录流程...');

    try {
        const token = mobileAutoLoginFlow(existingPhoneNumber, data);

        if (token) {
            const tokenDisplay = token && typeof token === 'string' && token.length > 20
                ? token.substring(0, 20) + '...'
                : token;
            console.log('[Test] ✅ 手机号自动登录成功，token:', tokenDisplay);
            console.log('[Test] 登录成功！现在可以使用此 token 进行投注等操作');

            // 返回 token 供后续使用
            return { success: true, token: token, phoneNumber: existingPhoneNumber };

        } else {
            console.log('[Test] ❌ 手机号自动登录失败');
            return { success: false, token: null, phoneNumber: existingPhoneNumber };
        }

    } catch (error) {
        console.error('[Test] 自动登录流程异常:', error.message);
        console.error('[Test] 错误堆栈:', error.stack);
        return { success: false, token: null, phoneNumber: existingPhoneNumber };
    }

    console.log('\n========== 手机号自动登录功能测试完成 ==========\n');
}