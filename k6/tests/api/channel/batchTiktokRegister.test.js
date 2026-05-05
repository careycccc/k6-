/**
 * TikTok 埋点批量注册 - 多租户版本（含团队模式）
 *
 * 使用方法：
 *
 *   # 单租户，仅注册（总代模式）
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e REGISTER_ONLY=true batchTiktokRegister.test.js
 *
 *   # 注册 + 充值
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 batchTiktokRegister.test.js
 *
 *   # 注册 + 充值 + 投注 + 提现
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e ENABLE_BET=true -e ENABLE_WITHDRAW=true \
 *          -e ENABLE_BACKEND_APPROVAL=true batchTiktokRegister.test.js
 *
 *   # 团队模式（总代 + 邀请下级 + 行为分层）
 *   k6 run -e TENANT_ID=3004 -e TEAM_MODE=true -e TEAM_TOTAL=50 -e TEAM_LEVELS=4 -e EMBED_RATE=0.6 -e RECHARGE_RATE=0.9 -e BET_RATE=0.8 -e WITHDRAW_RATE=0.6 -e ENABLE_BACKEND_APPROVAL=true batchTiktokRegister.test.js
 *
 *   # 多租户并行（仅总代模式）
 *   k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 batchTiktokRegister.test.js
 *
 * 参数说明：
 *   REGISTER_ONLY            仅注册，跳过充值/投注/提现（默认 false）
 *   ENABLE_RECHARGE          是否执行充值（默认 true）
 *   ENABLE_BET               是否执行投注，需充值成功（默认 false）
 *   ENABLE_WITHDRAW          是否执行提现，需充值成功（默认 false）
 *   ENABLE_BACKEND_APPROVAL  提现后是否后台自动审核（默认 false）
 *   TIKTOK_DOMAIN            覆盖注册域名（可选）
 *   TEAM_MODE                是否启用团队模式（默认 false）
 *   TEAM_TOTAL               团队总人数（默认 50）
 *   TEAM_LEVELS              团队层级数（默认 4）
 *   EMBED_RATE               下级埋点注册比例（默认 0.6）
 *   RECHARGE_RATE            下级充值比例（默认 0.9）
 *   BET_RATE                 充值成功后投注比例（默认 0.8）
 *   WITHDRAW_RATE            充值成功后提现比例（默认 0.6）
 *   INVITE_CODE_MODE         邀请码模式 1/2/3/mix（默认 1）
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
import { eventIdentityRegister } from '../login/register.test.js';
import { getEventConfig } from '../../../config/eventRegisterConfig.js';
import { buildChannelTeam, printTeamReport } from './channelInviteService.js';
import { getFrontUserInfo } from '../user/userManagement.js';

// ============================================================
// 自定义指标
// ============================================================
const regSuccessCounter      = new Counter('tiktok_reg_success');
const firstRechargeCounter   = new Counter('tiktok_first_recharge_total');
const doubleRechargeCounter  = new Counter('tiktok_double_recharge_users');
const betSuccessCounter      = new Counter('tiktok_bet_success');
const withdrawSuccessCounter = new Counter('tiktok_withdraw_success');

const tag         = 'batchTiktokRegister';
const packageType = __ENV.PACKAGE_TYPE || '';

// ============================================================
// 提现金额计算
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
    const balanceInfo = getAccountBalance(userToken);
    if (!balanceInfo) { console.error('[TiktokBatch] 获取余额失败'); return false; }

    const balance = balanceInfo.balance || 0;
    const withdrawAmount = calcWithdrawAmount(balance);
    if (withdrawAmount <= 0) {
        console.warn(`[TiktokBatch] 余额 ${balance} 不满足提现条件（需 > 300），跳过`);
        return false;
    }

    addAllWallets(adminToken, userId);
    sleep(1);

    const pwdRes = setWithdrawPassword(userToken, '123456');
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn('[TiktokBatch] 设置提现密码可能失败，继续尝试');
    }

    const withdrawInfo = getWithdrawBasicInfo(userToken);
    if (!withdrawInfo) { console.error('[TiktokBatch] 获取提现基础信息失败'); return false; }
    if (withdrawInfo.userTodayWithdrawCount === 0) { console.warn('[TiktokBatch] 今日提现次数为0'); return false; }
    if (withdrawInfo.amountCoding !== 0) { console.warn(`[TiktokBatch] 打码量未完成: ${withdrawInfo.amountCoding}`); return false; }

    const categoryList = (withdrawInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (categoryList.length === 0) { console.warn('[TiktokBatch] 无可用提现通道'); return false; }

    const category     = categoryList[Math.floor(Math.random() * categoryList.length)];
    const withdrawType = category.withdrawType;
    const withdrawId   = category.id;

    const walletId = getUserWithdrawWallet(userToken, withdrawType);
    if (!walletId) { console.error('[TiktokBatch] 获取钱包ID失败'); return false; }

    const applyResult = withdrawApply(userToken, withdrawAmount, walletId, withdrawId, withdrawType, '123456');
    if (!applyResult) { console.error('[TiktokBatch] 提现申请失败'); return false; }

    console.log(`[TiktokBatch] ✅ 提现申请成功: 金额=${withdrawAmount}, 通道=${withdrawType}`);

    if (enableBackendApproval) {
        sleep(2);
        const approved = runBackendWithdrawApproval(adminToken, userId, withdrawType, withdrawAmount);
        console.log(approved ? '[TiktokBatch] ✅ 后台审核通过' : '[TiktokBatch] ⚠️ 后台审核失败');
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
    const teamMode   = (__ENV.TEAM_MODE || '').toLowerCase() === 'true';
    const scenarios  = {};

    if (tenants.length === 1) {
        if (teamMode) {
            scenarios['batch_tiktok_team'] = {
                executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '4h',
                env: { TENANT_ID: tenants[0] }, tags: { tenant: tenants[0], mode: 'team' }
            };
        } else {
            scenarios['batch_tiktok_register'] = {
                executor: 'per-vu-iterations', vus: userCount, iterations: 1, maxDuration: '60m',
                env: { TENANT_ID: tenants[0] }, tags: { tenant: tenants[0], package_type: packageType }
            };
        }
    } else {
        for (const tenantId of tenants) {
            scenarios[`batch_tiktok_register_${tenantId}`] = {
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
    console.log('[TiktokBatch] ========== 开始测试准备阶段 ==========');
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
        console.error(`[TiktokBatch] ❌ 未找到租户 ${tenantId} 的配置`);
        return;
    }

    const teamMode = (__ENV.TEAM_MODE || '').toLowerCase() === 'true';
    if (teamMode) {
        runWithTeam(data, tenantId, adminToken, envConfig);
        return;
    }

    // ── 功能开关 ──────────────────────────────────────────────
    const registerOnly          = (__ENV.REGISTER_ONLY          || '').toLowerCase() === 'true';
    const enableRecharge        = (__ENV.ENABLE_RECHARGE        || 'true').toLowerCase() !== 'false';
    const enableBet             = (__ENV.ENABLE_BET             || '').toLowerCase() === 'true';
    const enableWithdraw        = (__ENV.ENABLE_WITHDRAW        || '').toLowerCase() === 'true';
    const enableBackendApproval = (__ENV.ENABLE_BACKEND_APPROVAL|| '').toLowerCase() === 'true';

    if (__ITER === 0) {
        const staggerTime = (__VU - 1) * 10;
        console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 交错等待 ${staggerTime}s 后启动...`);
        sleep(staggerTime);
    }

    const countryCode     = envConfig.COUNTRY_CODE || '91';
    const userName        = generateRandomPhone(countryCode);
    const tiktokCfg       = getEventConfig(tenantId, packageType);
    const finalInviteCode = __ENV.INVITE_CODE || tiktokCfg.inviteCode;
    const tiktokDomain    = __ENV.TIKTOK_DOMAIN || tiktokCfg.registerDomain || envConfig.BASE_DESK_URL;

    group('TikTok 埋点批量注册', function () {
        console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 注册: ${userName} | ${tiktokCfg.desc}`);
        console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 开关: 充值=${enableRecharge} 投注=${enableBet} 提现=${enableWithdraw}`);

        sleep(3 + Math.random() * 4);

        // ── 注册 ──────────────────────────────────────────────
        const registerResult = eventIdentityRegister(userName, { token: adminToken, envConfig }, {
            pixelId:        tiktokCfg.pixelId,
            eventConfigId:  tiktokCfg.id,
            packageName:    tiktokCfg.packageName,
            inviteCode:     finalInviteCode,
            registerUrl:    tiktokDomain,
            customFrontUrl: tiktokDomain
        });

        if (!registerResult || registerResult.code !== 0) {
            console.error(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ❌ 注册失败: ${userName}`);
            return;
        }

        console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ✅ 注册成功: ${userName}`);
        regSuccessCounter.add(1, { tenant: tenantId });

        if (registerOnly || !enableRecharge) {
            console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ⏭️ 跳过充值/投注/提现`);
            return;
        }

        const userToken = registerResult.data.token;
        const userId    = registerResult.data.userId;

        // ── 充值（随机双充逻辑）────────────────────────────────
        const isDoubleRecharger = Math.random() < 0.4;
        let rechargeSuccess = false;

        if (isDoubleRecharger) {
            if (Math.random() < 0.5) {
                console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 🚀 Mode B: 两次连冲`);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                sleep(3);
                eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                doubleRechargeCounter.add(1, { tenant: tenantId });
                eventBatchAuditUserOrders(adminToken, userId);
                rechargeSuccess = true;
            } else {
                console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 🚶 Mode A: 串行双充`);
                const r1 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                sleep(3);
                const r2 = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                doubleRechargeCounter.add(1, { tenant: tenantId });
                rechargeSuccess = r1.success || r2.success;
            }
        } else {
            console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 标准单充`);
            sleep(2);
            const r = hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
            firstRechargeCounter.add(1, { tenant: tenantId });
            rechargeSuccess = r.success;
        }

        if (!rechargeSuccess) {
            console.error(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ❌ 充值失败，跳过投注/提现`);
            return;
        }

        // ── 投注（1~2次随机）────────────────────────────────────
        if (enableBet) {
            const betCount = Math.random() < 0.5 ? 1 : 2;
            console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 🎲 开始投注，共 ${betCount} 次`);
            for (let b = 0; b < betCount; b++) {
                if (b > 0) sleep(3);
                const betResult = betRun(userToken, userName);
                if (betResult) {
                    betSuccessCounter.add(1, { tenant: tenantId });
                    console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ✅ 第 ${b + 1} 次投注成功`);
                } else {
                    console.error(`[TiktokBatch] [VU${__VU}][租户${tenantId}] ❌ 第 ${b + 1} 次投注失败`);
                }
            }
            sleep(2);
        }

        // ── 提现 ─────────────────────────────────────────────────
        if (enableWithdraw) {
            console.log(`[TiktokBatch] [VU${__VU}][租户${tenantId}] 💸 开始提现流程`);
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
    const reportCfg  = getEventConfig(tenants[0], packageType);
    const reportInviteCode = __ENV.INVITE_CODE || reportCfg.inviteCode || '(无)';

    const totalReg      = data.metrics.tiktok_reg_success?.values?.count || 0;
    const totalFirst    = data.metrics.tiktok_first_recharge_total?.values?.count || 0;
    const totalDouble   = data.metrics.tiktok_double_recharge_users?.values?.count || 0;
    const totalBet      = data.metrics.tiktok_bet_success?.values?.count || 0;
    const totalWithdraw = data.metrics.tiktok_withdraw_success?.values?.count || 0;

    const registerOnly   = (__ENV.REGISTER_ONLY   || '').toLowerCase() === 'true';
    const teamMode       = (__ENV.TEAM_MODE        || '').toLowerCase() === 'true';
    const enableBet      = (__ENV.ENABLE_BET      || '').toLowerCase() === 'true';
    const enableWithdraw = (__ENV.ENABLE_WITHDRAW || '').toLowerCase() === 'true';

    const modeLabel = teamMode ? `团队模式(${__ENV.TEAM_TOTAL||50}人${__ENV.TEAM_LEVELS||4}层)`
        : registerOnly ? '仅注册'
        : `注册+充值${enableBet ? '+投注' : ''}${enableWithdraw ? '+提现' : ''}`;

    const rechargeRows = (registerOnly || teamMode) ? '' : `
┃ 💰 仅单充用户数                  ┃ ${String(totalFirst).padEnd(25)} ┃
┃ 🔄 执行双充用户数                ┃ ${String(totalDouble).padEnd(25)} ┃
┃ 💳 实际充值总人数                ┃ ${String(totalFirst + totalDouble).padEnd(25)} ┃
┃ 📈 双充转化率                    ┃ ${((totalDouble / (totalReg || 1)) * 100).toFixed(2)}%                  ┃`;

    const betRow      = enableBet      ? `\n┃ 🎲 投注成功次数                  ┃ ${String(totalBet).padEnd(25)} ┃` : '';
    const withdrawRow = enableWithdraw ? `\n┃ 💸 提现成功人数                  ┃ ${String(totalWithdraw).padEnd(25)} ┃` : '';

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃        🎵 TikTok 埋点批量注册与充值测试汇总报告              ┃
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
    console.log('[TiktokBatch] 测试结束');
}

// ============================================================
// 团队模式
// ============================================================

/**
 * 团队模式主函数
 */
function runWithTeam(data, tenantId, adminToken, envConfig) {
    const tiktokCfg       = getEventConfig(tenantId, packageType);
    const finalInviteCode = __ENV.INVITE_CODE || tiktokCfg.inviteCode;
    const tiktokDomain    = __ENV.TIKTOK_DOMAIN || tiktokCfg.registerDomain || envConfig.BASE_DESK_URL;
    const countryCode     = envConfig.COUNTRY_CODE || '91';
    const enableBackendApproval = (__ENV.ENABLE_BACKEND_APPROVAL || '').toLowerCase() === 'true';

    console.log(`\n[TiktokTeam] ========== TikTok 团队模式 ==========`);
    console.log(`[TiktokTeam] 租户: ${tenantId} | 配置: ${tiktokCfg.desc}`);

    // 1. 注册总代
    const rootPhone = generateRandomPhone(countryCode);
    console.log(`[TiktokTeam] 注册总代: ${rootPhone}`);

    const rootResult = eventIdentityRegister(rootPhone, { token: adminToken, envConfig }, {
        pixelId:        tiktokCfg.pixelId,
        eventConfigId:  tiktokCfg.id,
        packageName:    tiktokCfg.packageName,
        inviteCode:     finalInviteCode,
        registerUrl:    tiktokDomain,
        customFrontUrl: tiktokDomain
    });

    if (!rootResult || rootResult.code !== 0) {
        console.error('[TiktokTeam] ❌ 总代注册失败');
        return;
    }

    console.log(`[TiktokTeam] ✅ 总代注册成功: userId=${rootResult.data.userId}`);
    regSuccessCounter.add(1, { tenant: tenantId });

    sleep(1);
    const rootFrontInfo  = getFrontUserInfo(rootResult.data.token);
    const rootInviteCode = rootFrontInfo ? rootFrontInfo.inviteCode : String(rootResult.data.userId);

    const rootInfo = {
        token:      rootResult.data.token,
        userId:     rootResult.data.userId,
        inviteCode: rootInviteCode,
        account:    rootPhone
    };

    // 2. 构建团队（TikTok 的 eventType 默认为 6）
    const embedOptions = {
        pixelId:       tiktokCfg.pixelId,
        eventConfigId: tiktokCfg.id,
        eventType:     6,
        packageName:   tiktokCfg.packageName
    };

    const teamReport = buildChannelTeam(rootInfo, { token: adminToken }, embedOptions, envConfig, {
        totalPeople:          parseInt(__ENV.TEAM_TOTAL  || '50', 10),
        levels:               parseInt(__ENV.TEAM_LEVELS || '4',  10),
        embedRate:            parseFloat(__ENV.EMBED_RATE    || '0.6'),
        rechargeRate:         parseFloat(__ENV.RECHARGE_RATE || '0.9'),
        betRate:              parseFloat(__ENV.BET_RATE      || '0.8'),
        withdrawRate:         parseFloat(__ENV.WITHDRAW_RATE || '0.6'),
        enableBackendApproval
    });

    // 3. 打印报表
    printTeamReport(rootInfo, teamReport, new Date().toISOString().slice(0, 10));
}
