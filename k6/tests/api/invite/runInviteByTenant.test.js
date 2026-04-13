/**
 * 多租户多层级邀请测试脚本
 * 支持指定租户ID进行邀请测试
 * 
 * 使用方法：
 * 1. 通过环境变量指定租户：
 *    k6 run -e TENANT_ID=3003 -e ROOT_INVITE_CODE=TQNA5XN -e LEVELS=4,5,3,5,4 k6/tests/api/invite/runInviteByTenant.test.js
 * 
 * 2. 或者在 tenantConfig.js 中配置租户信息后直接运行：
 *    k6 run -e TENANT_ID=3007 -e ROOT_INVITE_CODE=99UYYYN -e LEVELS=1,2,2,5,6 runInviteByTenant.test.js
 * 
 * 3. 不指定租户ID时使用默认租户3004：
 *    k6 run k6/tests/api/invite/runInviteByTenant.test.js
 */

import { runMultiLevelInvite, clearInviteData } from './inviteService.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getTenantConfig, validateTenantConfig, printTenantConfig } from './tenantConfig.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

/**
 * 从环境变量或配置获取测试参数
 */
function getTestConfig() {
    // 1. 从环境变量获取租户ID（优先级最高）
    const tenantId = __ENV.TENANT_ID || '3004';  // 默认3004

    console.log(`[Config] 目标租户: ${tenantId}`);

    // 2. 获取租户配置
    const tenantConfig = getTenantConfig(tenantId);

    // 3. 从环境变量覆盖配置（如果提供）
    const rootInviteCode = __ENV.ROOT_INVITE_CODE || (tenantConfig ? tenantConfig.rootInviteCode : '');

    // 4. 解析层级配置（格式：2,2,3 表示第1层2人，第2层2人，第3层3人）
    let subordinates = tenantConfig ? tenantConfig.defaultLevels : [2, 2];
    if (__ENV.LEVELS) {
        subordinates = __ENV.LEVELS.split(',').map(n => parseInt(n.trim()));
    }

    // 5. 验证配置
    if (!rootInviteCode) {
        throw new Error(`租户 ${tenantId} 未配置 rootInviteCode，请通过环境变量 ROOT_INVITE_CODE 指定或在 tenantConfig.js 中配置`);
    }

    // 6. 验证层级配置
    if (!subordinates || subordinates.length === 0) {
        throw new Error('层级配置不能为空，请通过环境变量 LEVELS 指定或在 tenantConfig.js 中配置');
    }

    return {
        tenantId: tenantId,
        tenantName: tenantConfig ? tenantConfig.name : `租户${tenantId}`,
        rootInviteCode: rootInviteCode,
        subordinates: subordinates,
        description: tenantConfig ? tenantConfig.description : ''
    };
}

/**
 * Setup 阶段：管理员登录
 */
export function setup() {
    console.log('[Setup] 开始管理员登录...');

    // 获取测试配置
    const config = getTestConfig();

    // 如果是非默认租户，需要切换到该租户的环境配置后再登录
    if (config.tenantId !== '3004') {
        console.log(`[Setup] 检测到非默认租户 ${config.tenantId}，切换环境配置`);

        const targetEnv = getEnvByTenantId(config.tenantId);

        if (targetEnv) {
            console.log(`[Setup] 切换到租户 ${config.tenantId} 的环境配置`);
            console.log(`[Setup]   前台域名: ${targetEnv.BASE_DESK_URL}`);
            console.log(`[Setup]   后台域名: ${targetEnv.BASE_ADMIN_URL}`);
            console.log(`[Setup]   管理员账号: ${targetEnv.ADMIN_USERNAME}`);

            // 更新 ENV_CONFIG（这会影响 AdminLogin 使用的账号和后台URL）
            Object.assign(ENV_CONFIG, targetEnv);
        }
    }

    // 使用目标租户的管理员登录
    const adminToken = AdminLogin();
    if (!adminToken) {
        console.error('[Setup] 管理员登录失败');
        throw new Error('管理员登录失败');
    }

    console.log('[Setup] ✅ 管理员登录成功');

    // 打印配置信息
    console.log('\n========== 测试配置 ==========');
    console.log(`租户ID: ${config.tenantId}`);
    console.log(`租户名称: ${config.tenantName}`);
    console.log(`总代邀请码: ${config.rootInviteCode}`);
    console.log(`层级配置: ${config.subordinates.join(' -> ')} (共${config.subordinates.length}层)`);
    console.log(`总用户数: ${config.subordinates.reduce((a, b) => a + b, 0)}`);
    if (config.description) {
        console.log(`描述: ${config.description}`);
    }
    console.log('===================================\n');

    return {
        token: adminToken,
        config: config
    };
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
    const config = data.config;

    // ✅ 重要：在 VU 中重新切换环境配置
    // K6 的 VU 会重新加载模块，ENV_CONFIG 会恢复为默认值
    if (config.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(config.tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
            console.log(`[VU] 重新切换到租户 ${config.tenantId} 的环境配置`);
            console.log(`[VU]   前台域名: ${ENV_CONFIG.BASE_DESK_URL}`);
            console.log(`[VU]   后台域名: ${ENV_CONFIG.BASE_ADMIN_URL}`);
        }
    }

    console.log('\n========== 🚀 开始多租户多层级邀请测试 ==========\n');
    console.log(`📋 租户: ${config.tenantId} - ${config.tenantName}`);
    console.log(`📋 总代邀请码: ${config.rootInviteCode}`);
    console.log(`📋 层级: ${config.subordinates.join(' -> ')}`);
    console.log('');

    // ========== 执行邀请流程 ==========

    try {
        // 传递完整的租户配置对象
        const configFromFile = getTenantConfig(config.tenantId);
        const tenantConfig = {
            tenantId: config.tenantId,
            frontUrl: configFromFile && configFromFile.frontUrl ? configFromFile.frontUrl : null,
            adminUrl: configFromFile && configFromFile.adminUrl ? configFromFile.adminUrl : null,
            registerApiUrl: configFromFile && configFromFile.registerApiUrl ? configFromFile.registerApiUrl : null
        };

        // 支持通过环境变量覆盖
        if (__ENV.FRONT_URL) tenantConfig.frontUrl = __ENV.FRONT_URL;
        if (__ENV.ADMIN_URL) tenantConfig.adminUrl = __ENV.ADMIN_URL;
        if (__ENV.REGISTER_API_URL) tenantConfig.registerApiUrl = __ENV.REGISTER_API_URL;

        await runMultiLevelInvite(config.rootInviteCode, config.subordinates, data, tenantConfig);

        console.log('\n========== 📊 测试结果 ==========');
        console.log(`✅ 租户 ${config.tenantId} 多层级邀请测试成功完成！`);
        console.log(`总代邀请码: ${config.rootInviteCode}`);
        console.log(`层级数: ${config.subordinates.length}`);
        console.log(`总用户数: ${config.subordinates.reduce((a, b) => a + b, 0)}`);
        console.log('===================================\n');

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
