/**
 * 测试前台 GetUserInfo 接口
 * 验证用户登录后获取 userId 和 inviteCode
 */

import { getFrontUserInfo } from './userManagement.js';
import { MobileAutoLogin } from '../login/MobileAutoLogin.test.js';

/**
 * Setup 阶段：用户登录
 */
export function setup() {
    console.log('[Setup] 开始用户登录...');

    // 使用已有的测试账号登录
    const loginResult = MobileAutoLogin();

    if (!loginResult || !loginResult.token) {
        console.error('[Setup] 用户登录失败');
        throw new Error('用户登录失败');
    }

    console.log('[Setup] ✅ 用户登录成功');
    return { token: loginResult.token };
}

/**
 * K6 配置选项
 */
export const options = {
    scenarios: {
        get_user_info: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m'
        },
    },
};

/**
 * 主测试函数
 * @param {object} data - setup返回的数据
 */
export default function (data) {
    console.log('\n========== 🚀 测试 GetUserInfo 接口 ==========\n');

    try {
        // 调用前台接口获取用户信息
        const userInfo = getFrontUserInfo(data.token);

        if (!userInfo) {
            console.error('❌ 获取用户信息失败');
            throw new Error('获取用户信息失败');
        }

        // 输出用户信息
        console.log('\n========== 用户信息 ==========');
        console.log(`用户ID (userId): ${userInfo.userId}`);
        console.log(`邀请码 (inviteCode): ${userInfo.inviteCode}`);
        console.log(`昵称 (nickName): ${userInfo.nickName}`);
        console.log(`用户类型 (userType): ${userInfo.userType}`);
        console.log(`钱包余额 (walletBalance): ${userInfo.walletBalance}`);
        console.log('================================\n');

        console.log('✅ GetUserInfo 接口测试成功！');
        console.log(`\n💡 提示：`);
        console.log(`  - userId (${userInfo.userId}) 可用于后台充值参数`);
        console.log(`  - inviteCode (${userInfo.inviteCode}) 可用于邀请下级参数`);

    } catch (error) {
        console.error('\n❌ GetUserInfo 接口测试失败:', error.message);
        throw error;
    }

    console.log('\n========== 测试结束 ==========\n');
}

/**
 * Teardown 阶段
 */
export function teardown(data) {
    console.log('[Teardown] 测试完成');
}
