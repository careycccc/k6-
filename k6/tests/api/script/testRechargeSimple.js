/**
 * 简化的充值功能测试
 * 使用已有的固定邮箱账号进行测试
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { getRechargeCategoryList } from '../recharge/recharge.test.js';
import { sendRequest } from '../common/request.js';

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
        test_recharge: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '10s'
        },
    },
};

// 简单的前台登录函数
function frontendLogin(email, password = 'qwer1234') {
    const api = '/api/Home/Login';
    const payload = {
        userName: email,
        password: password,
        loginType: 'Email'
    };

    console.log('[Login] 尝试登录:', email);
    const response = sendRequest(payload, api, 'FrontendLogin', true, '');
    return response;
}

export default function (data) {
    console.log('\n========== 开始测试充值功能 ==========\n');

    // 使用一个已知存在的邮箱账号进行测试
    const testEmail = 'fr5qkp3w@foxmail.com';

    console.log('[Test] 尝试登录已有账号:', testEmail);
    const loginResult = frontendLogin(testEmail);

    console.log('[Test] 登录响应类型:', typeof loginResult);
    console.log('[Test] 登录响应:', JSON.stringify(loginResult));

    // 处理不同的返回格式
    let userToken = null;
    if (typeof loginResult === 'string') {
        userToken = loginResult;
    } else if (loginResult && loginResult.token) {
        userToken = loginResult.token;
    } else if (loginResult && loginResult.data && loginResult.data.token) {
        userToken = loginResult.data.token;
    }

    if (!userToken) {
        console.error('[Test] 登录失败，无法继续测试');
        return;
    }

    const tokenDisplay = userToken && typeof userToken === 'string' && userToken.length > 20
        ? userToken.substring(0, 20) + '...'
        : userToken;
    console.log('[Test] 登录成功，获得前台 token:', tokenDisplay);

    // 查询充值分类列表
    console.log('\n[Test] 开始查询充值分类列表...');

    try {
        const categories = getRechargeCategoryList(userToken);

        console.log('[Test] 充值分类查询结果类型:', typeof categories);
        console.log('[Test] 充值分类查询结果:', categories ? JSON.stringify(categories) : 'null');

        if (categories && Array.isArray(categories) && categories.length > 0) {
            console.log('[Test] ✅ 充值分类列表查询成功');
            console.log('[Test] 充值分类总数:', categories.length);

            // 显示前3个分类
            console.log('\n[Test] 前3个充值分类:');
            categories.slice(0, 3).forEach((cat, index) => {
                if (cat && typeof cat === 'object') {
                    console.log(`  ${index + 1}. ID: ${cat.id}, 类型: ${cat.rechargeType}, 金额范围: ${cat.minAmount}-${cat.maxAmount}`);
                } else {
                    console.log(`  ${index + 1}. 无效的分类数据:`, JSON.stringify(cat));
                }
            });
        } else {
            console.log('[Test] ❌ 充值分类列表查询失败或返回空列表');
            console.log('[Test] categories 值:', categories);
            console.log('[Test] categories 是否为数组:', Array.isArray(categories));
        }
    } catch (error) {
        console.error('[Test] 充值分类查询异常:', error.message);
        console.error('[Test] 错误堆栈:', error.stack);
    }

    console.log('\n========== 充值功能测试完成 ==========\n');
}