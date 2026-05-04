/**
 * Adjust 埋点批量注册 - 多租户版本
 *
 * 使用方法：
 *
 *   # 单租户，仅注册
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e REGISTER_ONLY=true batchAdjustRegister.test.js
 *
 *   # 注册 + 充值（保留原有随机双充逻辑）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 batchAdjustRegister.test.js
 *
 *   # 注册 + 充值 + 投注（1~2次随机）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e ENABLE_BET=true batchAdjustRegister.test.js
 *
 *   # 注册 + 充值 + 投注 + 提现（后台自动审核）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e ENABLE_BET=true -e ENABLE_WITHDRAW=true \
 *          -e ENABLE_BACKEND_APPROVAL=true batchAdjustRegister.test.js
 *
 *   # 多租户并行
 *   k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 batchAdjustRegister.test.js
 *
 * 参数说明：
 *   REGISTER_ONLY            仅注册，跳过充值/投注/提现（默认 false）
 *   ENABLE_RECHARGE          是否执行充值（默认 true）
 *   ENABLE_BET               是否执行投注，需充值成功（默认 false）
 *   ENABLE_WITHDRAW          是否执行提现，需充值成功（默认 false）
 *   ENABLE_BACKEND_APPROVAL  提现后是否后台自动审核（默认 false）
 *
 * 提现金额规则：
 *   余额 ≤ 300        → 不提现
 *   余额 300~1000     → 提现 30%
 *   余额 1000~10000   → 提现 10%
 *   余额 > 10000      → 随机 200~5000
 */

import { group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import {
    hybridRecharge,
    getConfigRechargeAmount,
    eventBatchFrontendRechargeRequest,
    eventBatchAuditUserOrders
} from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import {
    getWithdrawBasicInfo,
    setWithdrawPassword,
    getUserWithdrawWallet,
    withdrawApply
} from '../withdraw/withdrawApi.js';
import { runBackendWithdrawApproval } from '../withdraw/backendWithdrawApi.js';
import { adjustIdentityRegister } from './adjustRegister.js';
import { getAdjustConfig } from './adjustRegisterConfig.js';

// ============================================================
// 自定义指标
// ============================================================
const regSuccessCounter      = new Counter('adjust_reg_success');
const firstRechargeCounter   = new Counter('adjust_first_recharge_total');
const doubleRechargeCounter  = new Counter('adjust_double_recharge_users');
const betSuccessCounter      = new Counter('adjust_bet_success');
const withdrawSuccessCounter = new Counter('adjust_withdraw_success');

const tag         = 'batchAdjustRegister';
const packageType = __ENV.PACKAGE_TYPE || '';

// ============================================================
// 提现金额计算（根据余额区间）
// ============================================================
function calcWithdrawAmount(balance) {
    if (balance <= 300)  return 0;                                      // ≤300 不提现
    if (balance <= 1000) return Math.floor(balance * 0.3);             // 300~1000：30%
    if (balance <= 10000) return Math.floor(balance * 0.1);            // 1000~10000：10%
    return Math.floor(200 + Math.random() * 4800);                     // >10000：随机 200~5000
}

// ============================================================
// 完整提现流程（复用 batchRechargeWithdrawWithBet 的逻辑）
// ============================================================
function runWithdraw(userToken, userId, adminToken, enableBackendApproval) {
    console.log(`[AdjustBatch] 开始提现流程 userId=${userId}`);

    // 1. 获取余额
    const balanceInfo = getAccountBalance(userToken);
    if (!balanceInfo) {
        console.error('[AdjustBatch] 获取余额失败，跳过提现');
        return false;
    }
    const balance = balanceInfo.balance || 0;
    console.log(`[AdjustBatch] 当前余额: ${balance}`);

    // 2. 计算提现金额
    const withdrawAmount = calcWithdrawAmount(balance);
    if (withdrawAmount <= 0) {
        console.warn(`[AdjustBatch] 余额 ${balance} 不满足提现条件（需 > 300），跳过`);
        return false;
    }
    console.log(`[AdjustBatch] 计划提现金额: ${withdrawAmount}`);

    // 3. 添加钱包
    addAllWallets(adminToken, userId);
    sleep(1);

    // 4. 设置提现密码
    const pwdRes = setWithdrawPassword(userToken, '123456');
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn(`[AdjustBatch] 设置提现密码可能失败，继续尝试`);
    }

    // 5. 获取提现基础信息
    const withdrawInfo = getWithdrawBasicInfo(userToken);
    if (!withdrawInfo) {
        console.error('[AdjustBatch] 获取提现基础信息失败');
        return false;
    }

    // 6. 检查提现条件
    if (withdrawInfo.userTodayWithdrawCount === 0) {
        console.warn('[AdjustBatch] 今日提现次数为0，跳过');
        return false;
    }
    if (withdrawInfo.amountCoding !== 0) {
        console.warn(`[AdjustBatch] 打码量未完成: ${withdrawInfo.amountCoding}，跳过`);
        return false;
    }

    // 7. 选择提现通道（排除 UPI）
    const categoryList = (withdrawInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (categoryList.length === 0) {
        console.warn('[AdjustBatch] 无可用提现通道，跳过');
        return false;
    }
    const category     = categoryList[Math.floor(Math.random() * categoryList.length)];
    const withdrawType = category.withdrawType;
    const withdrawId   = category.id;
    console.log(`[AdjustBatch] 选择提现通道: ${withdrawType} (ID: ${withdrawId})`);

    // 8. 获取钱包ID
    const walletId = getUserWithdrawWallet(userToken, withdrawType);
    if (!walletId) {
        console.error(`[AdjustBatch] 获取钱包ID失败，通道: ${withdrawType}`);
        return false;
    }

    // 9. 提交提现申请
    const applyResult = withdrawApply(userToken, withdrawAmount, walletId, withdrawId, withdrawType, '123456');
    if (!applyResult) {
        console.error('[AdjustBatch] 提现申请失败');
        return false;
    }
    console.log(`[AdjustBatch] ✅ 提现申请成功: 金额=${withdrawAmount}, 通道=${withdrawType}`);

    // 10. 后台审核（可选）
    if (enableBackendApproval) {
        sleep(2);
        const approved = runBackendWithdrawApproval(adminToken, userId, withdrawType, withdrawAmount);
        console.log(approved ? '[AdjustBatch] ✅ 后台审核通过' : '[AdjustBatch] ⚠️ 后台审核失败');
    }

    return true;
}

// ============================================================
// 动态构建 options（支持多租户并行）
// ============================================================
function buildOptions() {
    const userCount  = __ENV.USER_COUNT ? parseInt(__ENV.USER_COUNT) : 1;
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());

    const scenarios = {};

    if (tenants.length === 1) {
        scenarios['batch_adjust_register'] = {
            executor:    'per-vu-iterations',
            vus:         userCount,
            iterations:  1,
            maxDuration: '60m',
            env:         { TENANT_ID: tenants[0] },
            tags:        { tenant: tenants[0], package_type: packageType }
        };
    } else {
        for (const tenantId of tenants) {
            scenarios[`batch_adjust_register_${tenantId}`] = {
                executor:    'per-vu-iterations',
                vus:         userCount,
                iterations:  1,
                maxDuration: '60m',
                env:         { TENANT_ID: tenantId },
                tags:        { tenant: tenantId, package_type: packageType }
            };
        }
    }

    return {
        scenarios,
        thresholds: hanlderThresholds(tag),
        tags: {
            environment:  __ENV.ENVIRONMENT || 'local',
            test_type:    'api',
            service:      'user',
            operation:    tag,
            package_type: packageType
        }
    };
}

export const options = buildOptions();

// ============================================================
// Setup：多租户管理员登录
// ============================================================
export function setup() {
    console.log('[AdjustBatch] ========== 开始测试准备阶段 ==========');

    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());

    const adminTokens = {};
    const envConfigs  = {};

    for (const tenantId of tenants) {
        console.log(`[Setup] 租户 ${tenantId} 管理员登录...`);
        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) throw new Error(`[Setup] ❌ 租户 ${tenantId} 管理员登录失败`);

        adminTokens[tenantId] = adminToken;
        envConfigs[tenantId]  = getEnvByTenantId(tenantId);

        console.log(`[Setup] ✅ 租户 ${tenantId} 登录成功 | 前台: ${envConfigs[tenantId].BASE_DESK_URL}`);
    }

    return { adminTokens, envConfigs };
}

// ============================================================
// 主函数
// ============================================================
export default function (data) {
    const tenantId   = __ENV.TENANT_ID || '3004';
    const adminToken = data.adminTokens[tenantId];
    const envConfig  = data.envConfigs[tenantId];

    if (!adminToken || !envConfig) {
        console.error(`[AdjustBatch] ❌ 未找到租户 ${tenantId} 的配置`);
        return;
    }

    // ── 功能开关 ──────────────────────────────────────────────
    const registerOnly          = (__ENV.REGISTER_ONLY          || '').toLowerCase() === 'true';
    const enableRecharge        = (__ENV.ENABLE_RECHARGE        || 'true').toLowerCase() !== 'false';
    const enableBet             = (__ENV.ENABLE_BET             || '').toLowerCase() === 'true';
    const enableWithdraw        = (__ENV.ENABLE_WITHDRAW        || '').toLowerCase() === 'true';
    const enableBackendApproval = (__ENV.ENABLE_BACKEND_APPROVAL|| '').toLowerCase() === 'true';

    // 交错启动
    if (__ITER === 0) {
        const staggerTime = (__VU - 1) * 10;
        console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 交错等待 ${staggerTime}s 后启动...`);
        sleep(staggerTime);
    }

    const countryCode     = envConfig.COUNTRY_CODE || '91';
    const userName        = generateRandomPhone(countryCode);
    const adjustCfg       = getAdjustConfig(tenantId, packageType);
    const finalInviteCode = __ENV.INVITE_CODE || adjustCfg.inviteCode;
    const adjustDomain    = __ENV.ADJUST_DOMAIN || adjustCfg.registerDomain || envConfig.BASE_DESK_URL;

    group('Adjust 埋点批量注册', function () {
        console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 注册: ${userName} | ${adjustCfg.desc}`);
        console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 开关: 充值=${enableRecharge} 投注=${enableBet} 提现=${enableWithdraw}`);

        sleep(3 + Math.random() * 4);

        // ── 注册 ──────────────────────────────────────────────
        const registerResult = adjustIdentityRegister(userName, { token: adminToken, envConfig }, {
            pixelId:        adjustCfg.pixelId,
            eventConfigId:  adjustCfg.id,
            eventType:      adjustCfg.eventType,
            packageName:    adjustCfg.packageName,
            inviteCode:     finalInviteCode,
            registerUrl:    adjustDomain,
            customFrontUrl: adjustDomain
        });

        if (!registerResult || registerResult.code !== 0) {
            console.error(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ❌ 注册失败: ${userName}`);
            return;
        }

        console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ✅ 注册成功: ${userName}`);
        regSuccessCounter.add(1, { tenant: tenantId });

        if (registerOnly || !enableRecharge) {
            console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ⏭️ 跳过充值/投注/提现`);
            return;
        }

        const userToken = registerResult.data.token;
        const userId    = registerResult.data.userId;

        // ── 充值（保留原有随机双充逻辑）────────────────────────
        const isDoubleRecharger = Math.random() < 0.4;
        let rechargeSuccess = false;

        if (isDoubleRecharger) {
            const isBurstMode = Math.random() < 0.5;
            if (isBurstMode) {
                console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 🚀 Mode B: 两次连冲`);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                sleep(3);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                doubleRechargeCounter.add(1, { tenant: tenantId });
                eventBatchAuditUserOrders(adminToken, userId);
                rechargeSuccess = true;
            } else {
                console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 🚶 Mode A: 串行双充`);
                const r1 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                sleep(3);
                const r2 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                doubleRechargeCounter.add(1, { tenant: tenantId });
                rechargeSuccess = r1.success || r2.success;
            }
        } else {
            console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 标准单充`);
            sleep(2);
            const r = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
            firstRechargeCounter.add(1, { tenant: tenantId });
            rechargeSuccess = r.success;
        }

        if (!rechargeSuccess) {
            console.error(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ❌ 充值失败，跳过投注/提现`);
            return;
        }

        // ── 投注（1~2次随机）────────────────────────────────────
        if (enableBet) {
            const betCount = Math.random() < 0.5 ? 1 : 2;
            console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 🎲 开始投注，共 ${betCount} 次`);
            for (let b = 0; b < betCount; b++) {
                if (b > 0) sleep(3);
                const betResult = betRun(userToken, userName);
                if (betResult) {
                    betSuccessCounter.add(1, { tenant: tenantId });
                    console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ✅ 第 ${b + 1} 次投注成功`);
                } else {
                    console.error(`[AdjustBatch] [VU${__VU}][租户${tenantId}] ❌ 第 ${b + 1} 次投注失败`);
                }
            }
            sleep(2);
        }

        // ── 提现 ─────────────────────────────────────────────────
        if (enableWithdraw) {
            console.log(`[AdjustBatch] [VU${__VU}][租户${tenantId}] 💸 开始提现流程`);
            const ok = runWithdraw(userToken, userId, adminToken, enableBackendApproval);
            if (ok) withdrawSuccessCounter.add(1, { tenant: tenantId });
        }
    });

    sleep(1);
}

// ============================================================
// 汇总报告
// ============================================================
export function handleSummary(data) {
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());

    const reportCfg        = getAdjustConfig(tenants[0], packageType);
    const reportInviteCode = __ENV.INVITE_CODE || reportCfg.inviteCode || '(无)';

    const totalReg      = data.metrics.adjust_reg_success?.values?.count || 0;
    const totalFirst    = data.metrics.adjust_first_recharge_total?.values?.count || 0;
    const totalDouble   = data.metrics.adjust_double_recharge_users?.values?.count || 0;
    const totalBet      = data.metrics.adjust_bet_success?.values?.count || 0;
    const totalWithdraw = data.metrics.adjust_withdraw_success?.values?.count || 0;

    const registerOnly   = (__ENV.REGISTER_ONLY   || '').toLowerCase() === 'true';
    const enableBet      = (__ENV.ENABLE_BET      || '').toLowerCase() === 'true';
    const enableWithdraw = (__ENV.ENABLE_WITHDRAW || '').toLowerCase() === 'true';

    const modeLabel = registerOnly
        ? '仅注册'
        : `注册+充值${enableBet ? '+投注' : ''}${enableWithdraw ? '+提现' : ''}`;

    const rechargeRows = registerOnly ? '' : `
┃ 💰 仅单充用户数                  ┃ ${String(totalFirst).padEnd(25)} ┃
┃ 🔄 执行双充用户数                ┃ ${String(totalDouble).padEnd(25)} ┃
┃ 💳 实际充值总人数                ┃ ${String(totalFirst + totalDouble).padEnd(25)} ┃
┃ 📈 双充转化率                    ┃ ${((totalDouble / (totalReg || 1)) * 100).toFixed(2)}%                  ┃`;

    const betRow      = enableBet      ? `\n┃ 🎲 投注成功次数                  ┃ ${String(totalBet).padEnd(25)} ┃` : '';
    const withdrawRow = enableWithdraw ? `\n┃ 💸 提现成功人数                  ┃ ${String(totalWithdraw).padEnd(25)} ┃` : '';

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃         📊 Adjust 埋点批量注册与充值测试汇总报告             ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 测试场景模式                  ┃ ${reportCfg.desc.padEnd(25)} ┃
┃ 🎫 当前使用邀请码                ┃ ${reportInviteCode.padEnd(25)} ┃
┃ 🏢 测试租户                      ┃ ${tenants.join(', ').padEnd(25)} ┃
┃ 🔧 运行模式                      ┃ ${modeLabel.padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 注册成功总人数                ┃ ${String(totalReg).padEnd(25)} ┃${rechargeRows}${betRow}${withdrawRow}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;

    return { stdout: table };
}

export function teardown() {
    console.log('[AdjustBatch] 测试结束');
}
