/**
 * 测试账号余额查询功能
 * 1. 后台登录
 * 2. 手机号自动登录
 * 3. 查询账号余额
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { getAccountBalance, checkSufficientBalance, getFormattedBalance } from '../balance/balance.test.js';

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
        test_balance: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '15s'
        },
    },
};

export default function (data) {
    console.log('\n========== 开始测试账号余额查询功能 ==========\n');

    // 使用已存在的手机号进行登录
    const existingPhoneNumber = '913006199723';
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
            console.log('[Test] ❌ 手机号自动登录失败，无法继续测试');
            return;
        }

    } catch (error) {
        console.error('[Test] 自动登录流程异常:', error.message);
        return;
    }

    // 步骤2：查询账号余额
    console.log('\n[Test] 步骤2：查询账号余额...');

    try {
        // 基础余额查询
        const balanceInfo = getAccountBalance(userToken);

        if (balanceInfo) {
            console.log('[Test] ✅ 余额查询成功');
            console.log('[Test] 余额:', balanceInfo.balance);
            console.log('[Test] 货币:', balanceInfo.currency);
            console.log('[Test] 租户ID:', balanceInfo.tenantId);
            console.log('[Test] 用户ID:', balanceInfo.userId);

            // 格式化显示余额
            const formattedBalance = getFormattedBalance(userToken);
            console.log('[Test] 格式化余额信息:', formattedBalance);

            // 测试余额检查功能
            console.log('\n[Test] 步骤3：测试余额检查功能...');

            const testAmounts = [10, 50, 100, 1000];
            testAmounts.forEach(amount => {
                const hasEnough = checkSufficientBalance(userToken, amount);
                console.log(`[Test] 检查是否有 ${amount} 余额: ${hasEnough ? '✅ 足够' : '❌ 不足'}`);
            });

        } else {
            console.log('[Test] ❌ 余额查询失败');
        }

    } catch (error) {
        console.error('[Test] 余额查询异常:', error.message);
        console.error('[Test] 错误堆栈:', error.stack);
    }

    console.log('\n========== 账号余额查询功能测试完成 ==========\n');
}