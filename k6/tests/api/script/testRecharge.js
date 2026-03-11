/**
 * 测试充值功能
 * 1. 后台登录
 * 2. 注册新用户
 * 3. 查询充值分类列表
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { emailRegister } from '../login/register.test.js';
import { generateRandomEmail } from '../../utils/accountGenerator.js';
import { getRechargeCategoryList, getRechargeCategoryByType, getRandomRechargeCategory } from '../recharge/recharge.test.js';

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

export default function (data) {
    console.log('\n========== 开始测试充值功能 ==========\n');

    // 1. 注册新用户
    const userName = generateRandomEmail();
    console.log('[Test] 使用随机邮箱账号:', userName);

    console.log('[Test] 开始注册账号...');
    const registerResult = emailRegister(userName, data);

    // 处理不同的返回格式
    let userToken = null;
    if (typeof registerResult === 'string') {
        userToken = registerResult;
    } else if (registerResult && registerResult.token) {
        userToken = registerResult.token;
    } else if (registerResult && registerResult.data && registerResult.data.token) {
        userToken = registerResult.data.token;
    }

    if (!userToken) {
        console.error('[Test] 注册失败，无法继续测试');
        return;
    }

    const tokenDisplay = userToken && typeof userToken === 'string' && userToken.length > 20
        ? userToken.substring(0, 20) + '...'
        : userToken;
    console.log('[Test] 注册成功，获得前台 token:', tokenDisplay);

    // 2. 查询充值分类列表
    console.log('\n[Test] 开始查询充值分类列表...');
    const categories = getRechargeCategoryList(userToken);

    if (categories && categories.length > 0) {
        console.log('[Test] ✅ 充值分类列表查询成功');
        console.log('[Test] 充值分类总数:', categories.length);

        // 显示前3个分类
        console.log('\n[Test] 前3个充值分类:');
        categories.slice(0, 3).forEach((cat, index) => {
            console.log(`  ${index + 1}. ID: ${cat.id}, 类型: ${cat.rechargeType}, 金额范围: ${cat.minAmount}-${cat.maxAmount}`);
        });

        // 3. 测试按类型筛选
        console.log('\n[Test] 测试按类型筛选充值分类...');
        const usdtCategories = getRechargeCategoryByType(userToken, 'USDT');
        if (usdtCategories && usdtCategories.length > 0) {
            console.log('[Test] ✅ USDT 类型充值分类:', usdtCategories.length, '个');
        }

        const bankCardCategories = getRechargeCategoryByType(userToken, 'BankCard');
        if (bankCardCategories && bankCardCategories.length > 0) {
            console.log('[Test] ✅ BankCard 类型充值分类:', bankCardCategories.length, '个');
        }

        // 4. 测试随机选择
        console.log('\n[Test] 测试随机选择充值分类...');
        const randomCategory = getRandomRechargeCategory(userToken);
        if (randomCategory) {
            console.log('[Test] ✅ 随机选择的充值分类:', JSON.stringify(randomCategory));
        }

    } else {
        console.log('[Test] ❌ 充值分类列表查询失败');
    }

    console.log('\n========== 充值功能测试完成 ==========\n');
}
