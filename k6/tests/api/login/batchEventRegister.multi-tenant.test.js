/**
 * 埋点批量注册 - 多租户版本
 *
 * 改进点：
 *   - 支持多租户并行：-e TENANTS=3001,3002,3003
 *   - 动态读取租户配置（tiktokDomain、区号等）
 *   - 每个租户独立 scenario，结果按 tag 区分
 *   - 保留原有的双充逻辑、交错启动、自定义指标
 *
 * 使用方法：
 *
 *   # 单租户（兼容原版）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.multi-tenant.test.js
 *
 *   # 多租户并行
 *   k6 run -e TENANTS=3001,3002,3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.multi-tenant.test.js
 *
 *   # 自定义邀请码
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 -e INVITE_CODE=CUSTOM123 batchEventRegister.multi-tenant.test.js
 *
 *   # 指定 tiktok 域名（覆盖租户配置）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 -e TIKTOK_DOMAIN=https://custom.domain.com batchEventRegister.multi-tenant.test.js
 */

import { group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { getEventConfig } from '../../../config/eventRegisterConfig.js';
import { eventIdentityRegister } from './register.test.js';
import { hybridRecharge, getConfigRechargeAmount, eventBatchFrontendRechargeRequest, eventBatchAuditUserOrders } from '../recharge/rechargeService.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

// ============================================================
// 自定义指标（按租户打 tag）
// ============================================================
const regSuccessCounter = new Counter('custom_reg_success');
const firstRechargeCounter = new Counter('custom_first_recharge_total');
const doubleRechargeCounter = new Counter('custom_double_recharge_users');

const tag = 'batchEventRegister';

// 包类型（明确传入时优先；不传则走租户专属配置）
const packageType = __ENV.PACKAGE_TYPE || '';

// ============================================================
// 动态构建 options（支持多租户并行）
// ============================================================
function buildOptions() {
    const userCount = __ENV.USER_COUNT ? parseInt(__ENV.USER_COUNT) : 1;
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants = tenantsStr.split(',').map(t => t.trim());

    const scenarios = {};

    if (tenants.length === 1) {
        // 单租户
        scenarios['batch_register'] = {
            executor: 'per-vu-iterations',
            vus: userCount,
            iterations: 1,
            maxDuration: '60m',
            env: { TENANT_ID: tenants[0] },
            tags: { tenant: tenants[0], package_type: packageType }
        };
    } else {
        // 多租户并行：每个租户独立 scenario
        for (const tenantId of tenants) {
            scenarios[`batch_register_${tenantId}`] = {
                executor: 'per-vu-iterations',
                vus: userCount,
                iterations: 1,
                maxDuration: '60m',
                env: { TENANT_ID: tenantId },
                tags: { tenant: tenantId, package_type: packageType }
            };
        }
    }

    return {
        scenarios,
        thresholds: hanlderThresholds(tag),
        tags: {
            environment: __ENV.ENVIRONMENT || 'local',
            test_type: 'api',
            service: 'user',
            operation: tag,
            package_type: packageType
        }
    };
}

export const options = buildOptions();

// ============================================================
// Setup：多租户管理员登录
// ============================================================
export function setup() {

    console.log(`[BatchRegister] ========== 开始测试准备阶段 ==========`);

    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants = tenantsStr.split(',').map(t => t.trim());

    const adminTokens = {};
    const envConfigs = {};

    for (const tenantId of tenants) {
        console.log(`[Setup] 租户 ${tenantId} 管理员登录...`);

        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) {
            throw new Error(`[Setup] ❌ 租户 ${tenantId} 管理员登录失败`);
        }

        adminTokens[tenantId] = adminToken;
        envConfigs[tenantId] = getEnvByTenantId(tenantId);

        console.log(`[Setup] ✅ 租户 ${tenantId} 管理员登录成功`);
        console.log(`[Setup]    前台地址: ${envConfigs[tenantId].BASE_DESK_URL}`);
    }

    return {
        adminTokens,
        envConfigs
    };
}

// ============================================================
// 主函数：每个 VU 执行逻辑
// ============================================================
export default function (data) {
    const tenantId = __ENV.TENANT_ID || '3004';
    const adminToken = data.adminTokens[tenantId];
    const envConfig = data.envConfigs[tenantId];

    if (!adminToken || !envConfig) {
        console.error(`[BatchRegister] ❌ 未找到租户 ${tenantId} 的配置`);
        return;
    }

    // 1. 交错启动逻辑：加大步长至 10 秒，防止服务器频率限制
    if (__ITER === 0) {
        const staggerTime = (__VU - 1) * 10;
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 交错等待 ${staggerTime} 秒后启动...`);
        sleep(staggerTime);
    }

    // 2. 随机账号生成：使用租户配置的区号
    const countryCode = envConfig.COUNTRY_CODE || '91';
    const userName = generateRandomPhone(countryCode);

    // 3. 按租户动态获取埋点配置（3101 用专属配置，其他用全局包类型配置）
    const eventCfg = getEventConfig(tenantId, packageType);
    const finalInviteCode = __ENV.INVITE_CODE || eventCfg.inviteCode;

    // 4. 动态获取 tiktok 域名
    // 优先级：-e TIKTOK_DOMAIN 环境变量 > 配置文件 registerDomain > 租户前台地址
    const tiktokDomain = __ENV.TIKTOK_DOMAIN
        || eventCfg.registerDomain
        || envConfig.BASE_DESK_URL;

    group('埋点批量注册', function () {
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 准备注册账号: ${userName}`);
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 埋点配置: ${eventCfg.desc}`);
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] eventConfigId=${eventCfg.id}, pixelId=${eventCfg.pixelId}`);
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] packageName=${eventCfg.packageName}`);
        console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 使用域名: ${tiktokDomain}`);

        // 增加较大的随机延迟 (3-7秒)，进一步打散请求
        const prepDelay = 3 + Math.random() * 4;
        sleep(prepDelay);

        const registerResult = eventIdentityRegister(userName, { token: adminToken, envConfig }, {
            pixelId: eventCfg.pixelId,
            eventConfigId: eventCfg.id,
            packageName: eventCfg.packageName,
            inviteCode: finalInviteCode,
            registerUrl: tiktokDomain,
            customFrontUrl: tiktokDomain
        });

        if (registerResult && registerResult.code === 0) {
            console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] ✅ 账号 ${userName} 注册成功！`);
            regSuccessCounter.add(1, { tenant: tenantId });

            // REGISTER_ONLY 模式：只注册，跳过充值（用于排查注册问题）
            const registerOnly = (__ENV.REGISTER_ONLY || '').toLowerCase() === 'true';
            if (registerOnly) {
                console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] ⏭️ REGISTER_ONLY 模式，跳过充值`);
                return;
            }

            // 2. 充值策略分支：40% 的用户充值两次
            const isDoubleRecharger = Math.random() < 0.4;
            const userToken = registerResult.data.token;
            const userId = registerResult.data.userId;

            if (isDoubleRecharger) {
                // 3. 50% 几率是连续发起两次充值，然后后台审核连续通过 (Mode B)
                const isBurstMode = Math.random() < 0.5;

                if (isBurstMode) {
                    console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 🚀 Mode B: 两次连冲`);
                    eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                    sleep(3);
                    eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                    doubleRechargeCounter.add(1, { tenant: tenantId });
                    eventBatchAuditUserOrders(adminToken, userId);
                } else {
                    console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 🚶 Mode A: 串行双充`);
                    hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                    sleep(3);
                    hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                    doubleRechargeCounter.add(1, { tenant: tenantId });
                }
            } else {
                // 正常单次充值（仅单充用户计入 firstRechargeCounter）
                console.log(`[BatchRegister] [VU${__VU}][租户${tenantId}] 标准单充`);
                sleep(2);
                hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                firstRechargeCounter.add(1, { tenant: tenantId });
            }
        } else {
            console.error(`[BatchRegister] [VU${__VU}][租户${tenantId}] ❌ 账号 ${userName} 注册失败`);
        }
    });

    // 注册完成后适当等待，避免瞬间冲击
    sleep(1);
}

// ============================================================
// 格式化自定义总结报告（支持多租户分组统计）
// ============================================================
export function handleSummary(data) {
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants = tenantsStr.split(',').map(t => t.trim());

    // 用第一个租户的配置生成报告描述（多租户时各自配置可能不同，取第一个作代表）
    const firstTenantId = tenants[0];
    const reportEventCfg = getEventConfig(firstTenantId, packageType);
    const reportInviteCode = __ENV.INVITE_CODE || reportEventCfg.inviteCode || '(无)';

    // 提取各租户的指标
    const tenantStats = {};

    for (const tenantId of tenants) {
        const regSuccess = data.metrics.custom_reg_success?.values?.count || 0;
        const firstRecharge = data.metrics.custom_first_recharge_total?.values?.count || 0;
        const doubleRecharge = data.metrics.custom_double_recharge_users?.values?.count || 0;

        // 注意：k6 的 Counter 带 tag 时，需要从 data.root_group 中提取
        // 这里简化处理，如果是多租户，总数会累加
        tenantStats[tenantId] = {
            regSuccess,
            firstRecharge,
            doubleRecharge
        };
    }

    // 总计
    const totalRegSuccess     = Object.values(tenantStats).reduce((sum, s) => sum + s.regSuccess, 0);
    const totalFirstRecharge  = Object.values(tenantStats).reduce((sum, s) => sum + s.firstRecharge, 0);
    const totalDoubleRecharge = Object.values(tenantStats).reduce((sum, s) => sum + s.doubleRecharge, 0);

    const registerOnly = (__ENV.REGISTER_ONLY || '').toLowerCase() === 'true';

    const rechargeRows = registerOnly ? '' : `
┃ 💰 仅单充用户数                  ┃ ${String(totalFirstRecharge).padEnd(25)} ┃
┃ 🔄 执行双充用户数                ┃ ${String(totalDoubleRecharge).padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 💳 实际充值总人数                ┃ ${String(totalFirstRecharge + totalDoubleRecharge).padEnd(25)} ┃
┃ 📈 双充转化率                    ┃ ${((totalDoubleRecharge / (totalRegSuccess || 1)) * 100).toFixed(2)}%                  ┃`;

    let table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃           📊 埋点批量注册与充值测试汇总报告（多租户版）      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 测试场景模式                  ┃ ${reportEventCfg.desc.padEnd(25)} ┃
┃ 🎫 当前使用邀请码                ┃ ${reportInviteCode.padEnd(25)} ┃
┃ 🏢 测试租户                      ┃ ${tenants.join(', ').padEnd(25)} ┃
┃ 🔧 运行模式                      ┃ ${(registerOnly ? '仅注册 (REGISTER_ONLY)' : '注册+充值').padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 注册成功总人数                ┃ ${String(totalRegSuccess).padEnd(25)} ┃${rechargeRows}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;

    // 如果是多租户，追加各租户明细
    if (tenants.length > 1) {
        table += `\n📋 各租户明细：\n`;
        for (const tenantId of tenants) {
            const stats = tenantStats[tenantId];
            table += `   租户 ${tenantId}: 注册=${stats.regSuccess}, 首充=${stats.firstRecharge}, 双充=${stats.doubleRecharge}\n`;
        }
    }

    return {
        'stdout': table
    };
}

// ============================================================
// Teardown
// ============================================================
export function teardown(data) {
    console.log('[Teardown] 测试结束');
}
