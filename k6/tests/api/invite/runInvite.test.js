/**
 * 多层级邀请测试脚本
 * 一键执行多层级用户邀请、充值和投注
 */

import { runMultiLevelInvite, clearInviteData } from './inviteService.js';
import { AdminLogin } from '../login/adminlogin.test.js';

/**
 * Setup 阶段：管理员登录
 */
export function setup() {
    console.log('[Setup] 开始管理员登录...');

    const adminToken = AdminLogin();
    if (!adminToken) {
        console.error('[Setup] 管理员登录失败');
        throw new Error('管理员登录失败');
    }

    console.log('[Setup] ✅ 管理员登录成功');
    return { token: adminToken };
}

/**
 * K6 配置选项
 */
export const options = {
    scenarios: {
        multi_level_invite: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'  // 最大执行时间30分钟
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<5000'], // 95%的请求应在5秒内完成
    },
};

/**
 * 主测试函数
 * @param {object} data - setup返回的数据
 */
export default async function (data) {
    console.log('\n========== 🚀 开始多层级邀请测试 ==========\n');

    // ========== 配置参数 ==========

    // 总代邀请码（需要修改为实际的邀请码）
    const rootInviteCode = 'W5LU89N';

    // 每层的人数配置
    // 例如：[2, 3, 5] 表示第1层2人，第2层3人，第3层5人
    const subordinates = [2, 1];

    // ========== 执行邀请流程 ==========

    try {
        await runMultiLevelInvite(rootInviteCode, subordinates, data);
        console.log('\n✅ 多层级邀请测试成功完成！');
    } catch (error) {
        console.error('\n❌ 多层级邀请测试失败:', error.message);
        console.error('错误堆栈:', error.stack);
        throw error;
    }

    console.log('\n========== 多层级邀请测试结束 ==========\n');
}

/**
 * Teardown 阶段：清理数据
 */
export function teardown(data) {
    console.log('[Teardown] 清理测试数据...');
    clearInviteData();
    console.log('[Teardown] ✅ 清理完成');
}
