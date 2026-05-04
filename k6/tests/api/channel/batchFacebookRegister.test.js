/**
 * Facebook 埋点批量注册 - 多租户版本
 *
 * 使用方法：
 *
 *   # 单租户，仅注册
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e REGISTER_ONLY=true batchFacebookRegister.test.js
 *
 *   # 注册 + 充值
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 batchFacebookRegister.test.js
 *
 *   # 注册 + 充值 + 投注（1~2次随机）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e ENABLE_BET=true batchFacebookRegister.test.js
 *
 *   # 注册 + 充值 + 投注 + 提现（后台自动审核）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e ENABLE_BET=true -e ENABLE_WITHDRAW=true \
 *          -e ENABLE_BACKEND_APPROVAL=true batchFacebookRegister.test.js
 *
 *   # 多租户并行
 *   k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 batchFacebookRegister.test.js
 *
 * 参数说明：
 *   REGISTER_ONLY            仅注册，跳过充值/投注/提现（默认 false）
 *   ENABLE_RECHARGE          是否执行充值（默认 true）
 *   ENABLE_BET               是否执行投注，需充值成功（默认 false）
 *   ENABLE_WITHDRAW          是否执行提现，需充值成功（默认 false）
 *   ENABLE_BACKEND_APPROVAL  提现后是否后台自动审核（默认 false）
 *   FB_DOMAIN                覆盖注册域名（可选）
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
import { facebookIdentityRegister } from './facebookRegister.js';
import { getFbConfig } from './facebookRegisterConfig.js';

// ============================================================
// 自定义指标
// ============================================================
const regSuccessCounter      = new Counter('fb_reg_success');
const firstRechargeCounter   = new Counter('fb_first_recharge_total');
const doubleRechargeCounter  = new Counter('fb_double_recharge_users');
const betSuccessCounter      = new Counter('fb_bet_success');
const withdrawSuccessCounter = new Counter('fb_withdraw_success');

const tag         = 'batchFacebookRegister';
const packageType = __ENV.PACKAGE_TYPE || '';

// ============================================================
// 提现金额计算（根据余额区间）
// ============================================================
function calcWithdrawAmount(balance) {
    if (balance <= 300)   return 0;
    if (balance <= 1000)  return Math.floor(balance * 0.3);
    if (balance <= 10000) return Math.floor(balance * 0.1);
    return Math.floor(200 + Math.random() * 4800);
}

// ============================================================
// 完整提现流程
// ============================================================
function runWithdraw(userToken, userId, adminToken, enableBackendApproval) {
    console.log(`[FbBatch] 开始提现流程 userId=${userId}`);

    const balanceInfo = getAccountBalance(userToken);
    if (!balanceInfo) { console.error('[FbBatch] 获取余额失败'); return false; }

    const balance = balanceInfo.balance || 0;
    console.log(`[FbBatch] 当前余额: ${balance}`);

    const withdrawAmount = calcWithdrawAmount(balance);
    if (withdrawAmount <= 0) {
        console.warn(`[FbBatch] 余额 ${balance} 不满足提现条件（需 > 300），跳过`);
        return false;
    }
    console.log(`[FbBatch] 计划提现金额: ${withdrawAmount}`);

    addAllWallets(adminToken, userId);
    sleep(1);

    const pwdRes = setWithdrawPassword(userToken, '123456');
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn('[FbBatch] 设置提现密码可能失败，继续尝试');
    }

    const withdrawInfo = getWithdrawBasicInfo(userToken);
    if (!withdrawInfo) { console.error('[FbBatch] 获取提现基础信息失败'); return false; }

    if (withdrawInfo.userTodayWithdrawCount === 0) {
        console.warn('[FbBatch] 今日提现次数为0，跳过'); return false;
    }
    if (withdrawInfo.amountCoding !== 0) {
        console.warn(`[FbBatch] 打码量未完成: ${withdrawInfo.amountCoding}，跳过`); return false;
    }

    const categoryList = (withdrawInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (categoryList.length === 0) { console.warn('[FbBatch] 无可用提现通道'); return false; }

    const category     = categoryList[Math.floor(Math.random() * categoryList.length)];
    const withdrawType = category.withdrawType;
    const withdrawId   = category.id;
    console.log(`[FbBatch] 选择提现通道: ${withdrawType} (ID: ${withdrawId})`);

    const walletId = getUserWithdrawWallet(userToken, withdrawType);
    if (!walletId) { console.error(`[FbBatch] 获取钱包ID失败`); return false; }

    const applyResult = withdrawApply(userToken, withdrawAmount, walletId, withdrawId, withdrawType, '123456');
    if (!applyResult) { console.error('[FbBatch] 提现申请失败'); return false; }

    console.log(`[FbBatch] ✅ 提现申请成功: 金额=${withdrawAmount}, 通道=${withdrawType}`);

    if (enableBackendApproval) {
        sleep(2);
        const approved = runBackendWithdrawApproval(adminToken, userId, withdrawType, withdrawAmount);
        console.log(approved ? '[FbBatch] ✅ 后台审核通过' : '[FbBatch] ⚠️ 后台审核失败');
    }

    return true;
}

// ============================================================
// 动态构建 options
// ============================================================
function buildOptions() {
    const userCount  = __ENV.USER_COUNT ? parseInt(__ENV.USER_COUNT) : 1;
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());
    const scenarios  = {};

    if (tenants.length === 1) {
        scenarios['batch_fb_register'] = {
            executor: 'per-vu-iterations', vus: userCount, iterations: 1, maxDuration: '60m',
            env: { TENANT_ID: tenants[0] }, tags: { tenant: tenants[0], package_type: packageType }
        };
    } else {
        for (const tenantId of tenants) {
            scenarios[`batch_fb_register_${tenantId}`] = {
                executor: 'per-vu-iterations', vus: userCount, iterations: 1, maxDuration: '60m',
                env: { TENANT_ID: tenantId }, tags: { tenant: tenantId, package_type: packageType }
            };
        }
    }

    return {
        scenarios,
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'api', service: 'user', operation: tag, package_type: packageType }
    };
}

export const options = buildOptions();

// ============================================================
// Setup
// ============================================================
export function setup() {
    console.log('[FbBatch] ========== 开始测试准备阶段 ==========');
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());
    const adminTokens = {}, envConfigs = {};

    for (const tenantId of tenants) {
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
        console.error(`[FbBatch] ❌ 未找到租户 ${tenantId} 的配置`);
        return;
    }

    const registerOnly          = (__ENV.REGISTER_ONLY          || '').toLowerCase() === 'true';
    const enableRecharge        = (__ENV.ENABLE_RECHARGE        || 'true').toLowerCase() !== 'false';
    const enableBet             = (__ENV.ENABLE_BET             || '').toLowerCase() === 'true';
    const enableWithdraw        = (__ENV.ENABLE_WITHDRAW        || '').toLowerCase() === 'true';
    const enableBackendApproval = (__ENV.ENABLE_BACKEND_APPROVAL|| '').toLowerCase() === 'true';

    if (__ITER === 0) {
        const staggerTime = (__VU - 1) * 10;
        console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 交错等待 ${staggerTime}s 后启动...`);
        sleep(staggerTime);
    }

    const countryCode     = envConfig.COUNTRY_CODE || '91';
    const userName        = generateRandomPhone(countryCode);
    const fbCfg           = getFbConfig(tenantId, packageType);
    const finalInviteCode = __ENV.INVITE_CODE || fbCfg.inviteCode;
    const fbDomain        = __ENV.FB_DOMAIN || fbCfg.registerDomain || envConfig.BASE_DESK_URL;

    group('Facebook 埋点批量注册', function () {
        console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 注册: ${userName} | ${fbCfg.desc}`);
        console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 开关: 充值=${enableRecharge} 投注=${enableBet} 提现=${enableWithdraw}`);

        sleep(3 + Math.random() * 4);

        // ── 注册 ──────────────────────────────────────────────
        const registerResult = facebookIdentityRegister(userName, { token: adminToken, envConfig }, {
            pixelId:        fbCfg.pixelId,
            eventConfigId:  fbCfg.id,
            eventType:      fbCfg.eventType,
            packageName:    fbCfg.packageName,
            inviteCode:     finalInviteCode,
            registerUrl:    fbDomain,
            customFrontUrl: fbDomain
        });

        if (!registerResult || registerResult.code !== 0) {
            console.error(`[FbBatch] [VU${__VU}][租户${tenantId}] ❌ 注册失败: ${userName}`);
            return;
        }

        console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] ✅ 注册成功: ${userName}`);
        regSuccessCounter.add(1, { tenant: tenantId });

        if (registerOnly || !enableRecharge) {
            console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] ⏭️ 跳过充值/投注/提现`);
            return;
        }

        const userToken = registerResult.data.token;
        const userId    = registerResult.data.userId;

        // ── 充值（随机双充逻辑）────────────────────────────────
        const isDoubleRecharger = Math.random() < 0.4;
        let rechargeSuccess = false;

        if (isDoubleRecharger) {
            if (Math.random() < 0.5) {
                console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 🚀 Mode B: 两次连冲`);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                sleep(3);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                doubleRechargeCounter.add(1, { tenant: tenantId });
                eventBatchAuditUserOrders(adminToken, userId);
                rechargeSuccess = true;
            } else {
                console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 🚶 Mode A: 串行双充`);
                const r1 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                sleep(3);
                const r2 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                doubleRechargeCounter.add(1, { tenant: tenantId });
                rechargeSuccess = r1.success || r2.success;
            }
        } else {
            console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 标准单充`);
            sleep(2);
            const r = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
            firstRechargeCounter.add(1, { tenant: tenantId });
            rechargeSuccess = r.success;
        }

        if (!rechargeSuccess) {
            console.error(`[FbBatch] [VU${__VU}][租户${tenantId}] ❌ 充值失败，跳过投注/提现`);
            return;
        }

        // ── 投注（1~2次随机）────────────────────────────────────
        if (enableBet) {
            const betCount = Math.random() < 0.5 ? 1 : 2;
            console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 🎲 开始投注，共 ${betCount} 次`);
            for (let b = 0; b < betCount; b++) {
                if (b > 0) sleep(3);
                const betResult = betRun(userToken, userName);
                if (betResult) {
                    betSuccessCounter.add(1, { tenant: tenantId });
                    console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] ✅ 第 ${b + 1} 次投注成功`);
                } else {
                    console.error(`[FbBatch] [VU${__VU}][租户${tenantId}] ❌ 第 ${b + 1} 次投注失败`);
                }
            }
            sleep(2);
        }

        // ── 提现 ─────────────────────────────────────────────────
        if (enableWithdraw) {
            console.log(`[FbBatch] [VU${__VU}][租户${tenantId}] 💸 开始提现流程`);
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
    const reportCfg  = getFbConfig(tenants[0], packageType);
    const reportInviteCode = __ENV.INVITE_CODE || reportCfg.inviteCode || '(无)';

    const totalReg      = data.metrics.fb_reg_success?.values?.count || 0;
    const totalFirst    = data.metrics.fb_first_recharge_total?.values?.count || 0;
    const totalDouble   = data.metrics.fb_double_recharge_users?.values?.count || 0;
    const totalBet      = data.metrics.fb_bet_success?.values?.count || 0;
    const totalWithdraw = data.metrics.fb_withdraw_success?.values?.count || 0;

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
┃        📘 Facebook 埋点批量注册与充值测试汇总报告            ┃
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
    console.log('[FbBatch] 测试结束');
}
