/**
 * 完整的登录和投注测试流程
 * 1. 后台登录
 * 2. 手机号自动登录
 * 3. 使用登录 token 进行投注
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { betRun } from '../runbet/betRun.js';

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
        login_and_bet: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '20s'
        },
    },
};

export default function (data) {
    console.log('\n========== 开始完整的登录和投注测试 ==========\n');

    // 使用已存在的手机号进行登录
    const existingPhoneNumber = '913006199723'; // 使用刚才测试成功的手机号
    console.log('[Test] 使用已存在的手机号:', existingPhoneNumber);

    // 步骤1：手机号自动登录
    console.log('\n[Test] 步骤1：手机号自动登录...');

    let userToken = null;
    try {
        userToken = mobileAutoLoginFlow(existingPhoneNumber, data);

        if (userToken) {
            const tokenDisplay = userToken && typeof userToken === 'string' && userToken.length > 20
                ? userToken.substring(0, 20) + '...'
                : userToken;
            console.log('[Test] ✅ 手机号自动登录成功，token:', tokenDisplay);
        } else {
            console.log('[Test] ❌ 手机号自动登录失败，无法继续投注');
            return;
        }

    } catch (error) {
        console.error('[Test] 自动登录流程异常:', error.message);
        return;
    }

    // 步骤2：使用登录 token 进行投注
    console.log('\n[Test] 步骤2：使用登录 token 进行投注...');

    try {
        const betSuccess = betRun(userToken, existingPhoneNumber);

        if (betSuccess) {
            console.log('[Test] ✅ 投注成功！完整流程测试通过');
        } else {
            console.log('[Test] ❌ 投注失败（可能是余额不足或其他业务原因）');
        }

    } catch (error) {
        console.error('[Test] 投注流程异常:', error.message);
        console.error('[Test] 错误堆栈:', error.stack);
    }

    console.log('\n========== 完整的登录和投注测试完成 ==========\n');
}