/**
 * 邀请转盘验证测试
 * 功能：验证邀请转盘活动的完整流程
 * 
 * 流程：
 * 1. 总代注册（手机号优先，失败则邮箱）
 * 2. 点击4个礼物盒（开启邀请转盘）
 * 3. 旋转转盘（免费次数）
 * 4. 获取邀请码
 * 5. 并发邀请下级（随机数量）
 * 6. 下级注册+充值
 * 7. 获取转盘总金额
 * 8. 提现
 * 
 * 环境变量：
 * - TENANT_ID: 租户ID（必需）
 * - LANGUAGE: 语言（默认en）
 * - GENERAL_AGENT_COUNT: 总代数量（默认1）
 * - WHEEL_NUMBER: 轮次数量（默认1）
 * - SUB_MIN_NUMBER: 最小下级数量（默认2）
 * - SUB_MAX_NUMBER: 最大下级数量（默认5）
 * - SUB_CONCURRENT: 下级并发数（默认3）
 * - MIN_MONEY: 最小充值金额（默认1000）
 * - MAX_MONEY: 最大充值金额（默认5000）
 */

import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegister, emailRegister, phoneRegisterByInvite, emailRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { generateRandomPhone, generateRandomEmail } from '../../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    getInvitedWheelConfig,
    updateInvitedWheelConfig,
    clickSpinInvitedWheel,
    clickShareLink,
    clickSpinningTurntable,
    getUserInvitedWheelInfo,
    clickWheelWithdraw
} from './inviteTurntableApi.js';

const tag = 'VerifyInviteTurntable';

/**
 * 获取环境变量配置
 */
function getConfig() {
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const language = __ENV.LANGUAGE || 'en';

    const generalAgentCount = parseInt(__ENV.GENERAL_AGENT_COUNT) || 1;
    const wheelNumber = parseInt(__ENV.WHEEL_NUMBER) || 1;
    const subMinNumber = parseInt(__ENV.SUB_MIN_NUMBER) || 2;
    const subMaxNumber = parseInt(__ENV.SUB_MAX_NUMBER) || 5;
    const subConcurrent = parseInt(__ENV.SUB_CONCURRENT) || 3;
    const minMoney = parseInt(__ENV.MIN_MONEY) || 1000;
    const maxMoney = parseInt(__ENV.MAX_MONEY) || 5000;

    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    return {
        tenantId,
        language,
        generalAgentCount,
        wheelNumber,
        subMinNumber,
        subMaxNumber,
        subConcurrent,
        minMoney,
        maxMoney,
        countryCode,
        envConfig
    };
}

/**
 * 获取随机充值金额
 */
function getRandomRechargeAmount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 总代注册（手机号优先，失败则邮箱）
 */
function registerGeneralAgent(data, config) {
    const { countryCode } = config;

    // 1. 尝试手机号注册
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] 尝试手机号注册总代: ${phone}`);

    let registerResult = phoneRegister(phone, data);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 手机号注册成功: ${phone}`);
        return {
            success: true,
            account: phone,
            type: 'phone',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    // 2. 手机号失败，尝试邮箱注册
    console.log(`[${tag}] 手机号注册失败，尝试邮箱注册...`);
    const email = generateRandomEmail();
    console.log(`[${tag}] 尝试邮箱注册总代: ${email}`);

    registerResult = emailRegister(email, data);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 邮箱注册成功: ${email}`);
        return {
            success: true,
            account: email,
            type: 'email',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    console.error(`[${tag}] ❌ 总代注册失败`);
    return { success: false };
}

/**
 * 下级注册（手机号优先，失败则邮箱）
 * 注意：邀请转盘活动需要将邀请码最后一位替换成 'W'
 */
function registerSubordinate(inviteCode, data, config) {
    const { countryCode, envConfig } = config;

    // 将邀请码最后一位替换成 'W'（邀请转盘活动的特殊要求）
    const modifiedInviteCode = inviteCode.slice(0, -1) + 'W';
    console.log(`[${tag}] 原始邀请码: ${inviteCode}, 修改后邀请码: ${modifiedInviteCode}`);

    // 准备自定义URL（使用推广页域名）
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL,      // 推广页域名（发验证码）
        adminUrl: envConfig.BASE_ADMIN_URL,           // 后台域名（查验证码）
        registerUrl: envConfig.INVITE_REGISTER_URL    // 推广页域名（注册）
    };

    console.log(`[${tag}] 使用推广页域名: ${envConfig.INVITE_REGISTER_URL}`);

    // 1. 尝试手机号邀请注册
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] 尝试手机号邀请注册: ${phone}, 邀请码: ${modifiedInviteCode}`);

    let registerResult = phoneRegisterByInvite(phone, modifiedInviteCode, data, 'qwer1234', '', customUrls);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 手机号邀请注册成功: ${phone}`);
        return {
            success: true,
            account: phone,
            type: 'phone',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    // 2. 手机号失败，尝试邮箱邀请注册
    console.log(`[${tag}] 手机号邀请注册失败，尝试邮箱邀请注册...`);
    const email = generateRandomEmail();
    console.log(`[${tag}] 尝试邮箱邀请注册: ${email}, 邀请码: ${modifiedInviteCode}`);

    registerResult = emailRegisterByInvite(email, modifiedInviteCode, data, 'qwer1234', '', customUrls);

    if (registerResult && registerResult.code === 0) {
        console.log(`[${tag}] ✅ 邮箱邀请注册成功: ${email}`);
        return {
            success: true,
            account: email,
            type: 'email',
            token: registerResult.data.token,
            headers: registerResult.headers
        };
    }

    console.error(`[${tag}] ❌ 下级注册失败`);
    return { success: false };
}

/**
 * 单个下级的完整流程：注册 + 充值
 */
function processSubordinate(inviteCode, data, adminToken, config, index, total) {
    console.log(`\n[${tag}] [${index}/${total}] 开始处理下级...`);

    // 1. 注册下级
    const registerResult = registerSubordinate(inviteCode, data, config);
    if (!registerResult.success) {
        console.error(`[${tag}] [${index}/${total}] 下级注册失败`);
        return { success: false };
    }

    const { account, token } = registerResult;

    // 2. 获取用户信息（userId）
    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] [${index}/${total}] 获取用户信息失败: ${account}`);
        return { success: false };
    }

    const userId = userInfo.userId;
    console.log(`[${tag}] [${index}/${total}] 获取到用户ID: ${userId}`);

    // 3. 充值（使用混合充值策略）
    const rechargeAmount = getRandomRechargeAmount(config.minMoney, config.maxMoney);
    console.log(`[${tag}] [${index}/${total}] 开始充值: ${account}, 金额: ${rechargeAmount}`);

    const rechargeResult = hybridRecharge({
        userToken: token,
        adminToken: adminToken,
        userId: userId,
        amount: rechargeAmount,
        frontendFirst: true,
        remark: `InviteTurntable-Sub-${index}`
    });

    if (rechargeResult.success) {
        console.log(`[${tag}] [${index}/${total}] ✅ 充值成功: ${account}, 金额: ${rechargeAmount}, 方式: ${rechargeResult.method}`);
        return { success: true, account, userId, amount: rechargeAmount };
    } else {
        console.error(`[${tag}] [${index}/${total}] ❌ 充值失败: ${account}`);
        return { success: false, account, userId };
    }
}

/**
 * 并发处理多个下级
 */
function processSubordinatesConcurrently(inviteCode, data, adminToken, config) {
    // 随机生成下级数量
    const subCount = Math.floor(Math.random() * (config.subMaxNumber - config.subMinNumber + 1)) + config.subMinNumber;
    console.log(`\n[${tag}] 开始并发处理 ${subCount} 个下级，并发数: ${config.subConcurrent}`);

    const results = [];
    let successCount = 0;
    let failedCount = 0;

    // 分批处理（控制并发数）
    for (let i = 0; i < subCount; i += config.subConcurrent) {
        const batchSize = Math.min(config.subConcurrent, subCount - i);
        console.log(`\n[${tag}] 处理批次 [${i + 1}-${i + batchSize}/${subCount}]`);

        // 并发处理当前批次
        const batchPromises = [];
        for (let j = 0; j < batchSize; j++) {
            const index = i + j + 1;
            // 添加随机延迟，避免请求过快
            sleep(Math.random() * 2);
            const result = processSubordinate(inviteCode, data, adminToken, config, index, subCount);
            results.push(result);

            if (result.success) {
                successCount++;
            } else {
                failedCount++;
            }
        }

        // 批次间等待
        if (i + batchSize < subCount) {
            sleep(2);
        }
    }

    console.log(`\n[${tag}] 下级处理完成: 总数=${subCount}, 成功=${successCount}, 失败=${failedCount}`);

    return {
        total: subCount,
        success: successCount,
        failed: failedCount,
        results: results
    };
}

/**
 * 单轮邀请转盘流程
 */
function runSingleRound(generalAgentToken, adminToken, data, config, roundIndex) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 开始第 ${roundIndex} 轮邀请转盘流程`);
    console.log(`${'='.repeat(80)}\n`);

    // 0. 检查邀请转盘配置（仅第一轮执行）
    if (roundIndex === 1) {
        console.log(`[${tag}] 步骤0: 检查邀请转盘配置...`);
        const configResult = getInvitedWheelConfig(adminToken);

        if (!configResult || !configResult.success) {
            console.error(`[${tag}] ❌ 获取配置失败`);
            return { success: false, step: 'getConfig' };
        }

        // 检查需要更新的配置项
        const needsUpdate = [];

        // 1. 检查活动开关
        if (!configResult.isOpen) {
            console.log(`[${tag}] 活动已关闭，需要开启`);
            needsUpdate.push({ key: 'IsOpenInvitedWheel', value: '1', desc: '开启活动' });
        }

        // 2. 检查提现方式
        if (!configResult.cashToMainWallet) {
            console.log(`[${tag}] 提现方式为银行卡，需要改为主钱包`);
            needsUpdate.push({ key: 'IsInvitedWheelCashToMainWallet', value: '1', desc: '提现到主钱包' });
        }

        // 3. 检查自动旋转
        if (!configResult.autoRotate) {
            console.log(`[${tag}] 自动旋转已关闭，需要开启`);
            needsUpdate.push({ key: 'InviteAutoRotate', value: '1', desc: '开启自动旋转' });
        }

        // 如果有需要更新的配置，批量更新
        if (needsUpdate.length > 0) {
            console.log(`[${tag}] 需要更新 ${needsUpdate.length} 项配置`);

            let allSuccess = true;
            for (const item of needsUpdate) {
                console.log(`[${tag}] 更新配置: ${item.desc}`);
                const updateResult = updateInvitedWheelConfig(adminToken, item.key, item.value);

                if (!updateResult || !updateResult.success) {
                    console.error(`[${tag}] ❌ 更新配置失败: ${item.desc}`);
                    allSuccess = false;
                    break;
                }
            }

            if (!allSuccess) {
                return { success: false, step: 'updateConfig' };
            }

            console.log(`[${tag}] ✅ 所有配置更新成功，等待10秒...`);
            sleep(10);
        } else {
            console.log(`[${tag}] ✅ 所有配置已正确设置，无需更新`);
        }
    }

    // 1. 点击4个礼物盒（开启邀请转盘）
    console.log(`\n[${tag}] 步骤1: 点击4个礼物盒...`);
    const spinResult = clickSpinInvitedWheel(generalAgentToken);
    if (!spinResult || !spinResult.success) {
        console.error(`[${tag}] ❌ 点击礼物盒失败`);
        return { success: false, step: 'clickGiftBox' };
    }
    console.log(`[${tag}] ✅ 礼物盒点击成功，isFirstInvitedWheel: ${spinResult.isFirstInvitedWheel}`);

    // 等待5秒后再旋转转盘
    console.log(`\n[${tag}] 等待5秒后旋转转盘...`);
    sleep(5);

    // 2. 旋转转盘（免费次数，带重试逻辑）
    console.log(`\n[${tag}] 步骤2: 旋转转盘...`);
    const turntableResult = clickSpinningTurntable(generalAgentToken);
    if (!turntableResult || !turntableResult.success) {
        console.error(`[${tag}] ❌ 旋转转盘失败`);
        return { success: false, step: 'spinTurntable' };
    }
    console.log(`[${tag}] ✅ 旋转成功，本次金额: ${turntableResult.prizeAmount}, 是否中奖: ${turntableResult.isWin}`);

    // 3. 获取邀请码
    console.log(`\n[${tag}] 步骤3: 获取邀请码...`);
    const shareLinkResult = clickShareLink(generalAgentToken);
    if (!shareLinkResult || !shareLinkResult.success) {
        console.error(`[${tag}] ❌ 获取邀请码失败`);
        return { success: false, step: 'getInviteCode' };
    }
    const inviteCode = shareLinkResult.inviteCode;
    console.log(`[${tag}] ✅ 获取邀请码成功: ${inviteCode}`);

    // 4. 并发邀请下级并充值
    console.log(`\n[${tag}] 步骤4: 并发邀请下级并充值...`);
    const subResults = processSubordinatesConcurrently(inviteCode, data, adminToken, config);
    console.log(`[${tag}] ✅ 下级处理完成: 成功=${subResults.success}, 失败=${subResults.failed}`);

    // 5. 等待5秒（确保状态更新）
    console.log(`\n[${tag}] 步骤5: 等待5秒，确保状态更新...`);
    sleep(5);

    // 6. 获取转盘总金额并检查是否满足提现条件
    console.log(`\n[${tag}] 步骤6: 获取转盘总金额...`);
    const wheelInfoResult = getUserInvitedWheelInfo(generalAgentToken);
    if (!wheelInfoResult || !wheelInfoResult.success) {
        console.error(`[${tag}] ❌ 获取转盘信息失败`);
        return { success: false, step: 'getWheelInfo' };
    }

    const totalPrizeAmount = wheelInfoResult.totalPrizeAmount;
    const userWheelAmount = wheelInfoResult.userWheelAmount;

    console.log(`[${tag}] 转盘总金额: ${totalPrizeAmount}`);
    console.log(`[${tag}] 用户已旋转金额: ${userWheelAmount}`);

    // 检查是否满足提现条件
    const canWithdraw = (totalPrizeAmount === userWheelAmount);
    console.log(`[${tag}] 是否满足提现条件: ${canWithdraw ? '是' : '否'}`);

    if (!canWithdraw) {
        console.warn(`[${tag}] ⚠️ 未满足提现条件，跳过提现步骤`);
        console.log(`[${tag}] 第 ${roundIndex} 轮完成（未提现）`);
        return {
            success: true,
            roundIndex,
            inviteCode,
            subCount: subResults.total,
            subSuccess: subResults.success,
            totalAmount: totalPrizeAmount,
            prizeAmount: turntableResult.prizeAmount,
            withdrawn: false,
            withdrawSkipped: true
        };
    }

    // 7. 提现
    console.log(`\n[${tag}] 步骤7: 提现...`);
    const withdrawResult = clickWheelWithdraw(totalPrizeAmount, generalAgentToken);
    if (!withdrawResult || !withdrawResult.success) {
        console.error(`[${tag}] ❌ 提现失败`);
        return {
            success: false,
            step: 'withdraw',
            totalAmount: totalPrizeAmount,
            subCount: subResults.total,
            subSuccess: subResults.success
        };
    }
    console.log(`[${tag}] ✅ 提现成功，金额: ${totalPrizeAmount}`);

    console.log(`\n[${tag}] 第 ${roundIndex} 轮完成！`);
    return {
        success: true,
        roundIndex,
        inviteCode,
        subCount: subResults.total,
        subSuccess: subResults.success,
        totalAmount: totalPrizeAmount,
        prizeAmount: turntableResult.prizeAmount,
        withdrawn: true
    };
}

/**
 * 单个总代的完整流程
 */
function runGeneralAgentFlow(data, config, agentIndex) {
    console.log(`\n${'#'.repeat(100)}`);
    console.log(`[${tag}] 开始处理总代 [${agentIndex}/${config.generalAgentCount}]`);
    console.log(`${'#'.repeat(100)}\n`);

    // 1. 注册总代
    console.log(`[${tag}] 步骤1: 注册总代...`);
    const registerResult = registerGeneralAgent(data, config);
    if (!registerResult.success) {
        console.error(`[${tag}] ❌ 总代注册失败`);
        return { success: false, step: 'register' };
    }

    const { account, token } = registerResult;
    console.log(`[${tag}] ✅ 总代注册成功: ${account}`);

    // 2. 获取用户信息
    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] ❌ 获取总代用户信息失败`);
        return { success: false, step: 'getUserInfo' };
    }

    const userId = userInfo.userId;
    const inviteCode = userInfo.inviteCode;
    console.log(`[${tag}] ✅ 总代信息: userId=${userId}, inviteCode=${inviteCode}`);

    // 3. 执行多轮邀请转盘流程
    const roundResults = [];
    for (let round = 1; round <= config.wheelNumber; round++) {
        const roundResult = runSingleRound(token, data.token, data, config, round);
        roundResults.push(roundResult);

        if (!roundResult.success) {
            console.error(`[${tag}] ❌ 第 ${round} 轮失败，停止后续轮次`);
            break;
        }

        // 轮次间等待
        if (round < config.wheelNumber) {
            console.log(`\n[${tag}] 等待5秒后开始下一轮...`);
            sleep(5);
        }
    }

    console.log(`\n[${tag}] 总代 [${agentIndex}] 完成！账号: ${account}, 完成轮次: ${roundResults.filter(r => r.success).length}/${config.wheelNumber}`);

    return {
        success: true,
        account,
        userId,
        inviteCode,
        roundResults
    };
}

/**
 * Setup函数 - 初始化环境
 */
export function setup() {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 邀请转盘验证测试 - 初始化`);
    console.log(`${'='.repeat(100)}\n`);

    const config = getConfig();

    console.log(`[${tag}] 配置信息:`);
    console.log(`  - 租户ID: ${config.tenantId}`);
    console.log(`  - 语言: ${config.language}`);
    console.log(`  - 总代数量: ${config.generalAgentCount}`);
    console.log(`  - 轮次数量: ${config.wheelNumber}`);
    console.log(`  - 下级数量范围: ${config.subMinNumber}-${config.subMaxNumber}`);
    console.log(`  - 下级并发数: ${config.subConcurrent}`);
    console.log(`  - 充值金额范围: ${config.minMoney}-${config.maxMoney}`);
    console.log(`  - 区号: ${config.countryCode}`);

    // 更新全局 ENV_CONFIG（重要！）
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, config.envConfig);
        console.log(`[${tag}] ✅ 已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
        console.log(`[${tag}] BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[${tag}] INVITE_REGISTER_URL: ${ENV_CONFIG.INVITE_REGISTER_URL}`);
    }

    // 后台管理员登录
    console.log(`\n[${tag}] 后台管理员登录...`);
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('后台管理员登录失败');
    }
    console.log(`[${tag}] ✅ 后台管理员登录成功`);

    return {
        token: adminToken,
        envConfig: config.envConfig,
        config: config
    };
}

/**
 * 主测试函数
 */
export default function (data) {
    const config = data.config;

    // VU中重新应用环境配置（重要！）
    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, data.envConfig);
        console.log(`[${tag}] ✅ VU中已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
        console.log(`[${tag}] BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[${tag}] INVITE_REGISTER_URL: ${ENV_CONFIG.INVITE_REGISTER_URL}`);
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 开始邀请转盘验证测试`);
    console.log(`${'='.repeat(100)}\n`);

    const results = [];

    // 处理多个总代
    for (let i = 1; i <= config.generalAgentCount; i++) {
        const result = runGeneralAgentFlow(data, config, i);
        results.push(result);

        // 总代间等待
        if (i < config.generalAgentCount) {
            console.log(`\n[${tag}] 等待5秒后处理下一个总代...`);
            sleep(5);
        }
    }

    // 统计结果
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 邀请转盘验证测试完成`);
    console.log(`${'='.repeat(100)}`);

    // 打印详细表格
    console.log(`\n[${tag}] ========== 总代验证结果 ==========`);
    console.log(`[${tag}] `);
    console.log(`[${tag}] ┌────────────────────────┬──────────────┬──────────────────┬──────────────┐`);
    console.log(`[${tag}] │ 总代账号               │ 下级人数     │ 是否完成转盘提现 │ 提现金额     │`);
    console.log(`[${tag}] ├────────────────────────┼──────────────┼──────────────────┼──────────────┤`);

    results.forEach((r) => {
        if (r.success && r.roundResults && r.roundResults.length > 0) {
            // 统计所有轮次的下级人数和提现金额
            let totalSubCount = 0;
            let totalWithdrawAmount = 0;
            let allWithdrawn = true;
            let anySkipped = false;
            let anyFailed = false;

            r.roundResults.forEach(round => {
                if (round.success) {
                    totalSubCount += (round.subCount || 0);
                    if (round.withdrawn) {
                        totalWithdrawAmount += (round.totalAmount || 0);
                    } else if (round.withdrawSkipped) {
                        anySkipped = true;
                        allWithdrawn = false;
                    } else {
                        anyFailed = true;
                        allWithdrawn = false;
                    }
                } else {
                    anyFailed = true;
                    allWithdrawn = false;
                }
            });

            const account = (r.account || 'N/A').padEnd(22, ' ');
            const subCount = totalSubCount.toString().padEnd(12, ' ');
            const withdrawAmount = totalWithdrawAmount.toFixed(2).padEnd(12, ' ');

            // 判断是否完成提现
            let withdrawStatus;
            if (allWithdrawn) {
                withdrawStatus = '✅ 已提现'.padEnd(16, ' ');
            } else if (anySkipped) {
                withdrawStatus = '⚠️  未满足条件'.padEnd(16, ' ');
            } else if (anyFailed) {
                withdrawStatus = '❌ 提现失败'.padEnd(16, ' ');
            } else {
                withdrawStatus = '❌ 流程失败'.padEnd(16, ' ');
            }

            console.log(`[${tag}] │ ${account} │ ${subCount} │ ${withdrawStatus} │ ${withdrawAmount} │`);
        } else if (r.roundResults && r.roundResults.length > 0) {
            // 流程失败但有roundResults（比如提现失败）
            let totalSubCount = 0;
            r.roundResults.forEach(round => {
                totalSubCount += (round.subCount || 0);
            });

            const account = (r.account || 'N/A').padEnd(22, ' ');
            const subCount = totalSubCount.toString().padEnd(12, ' ');
            const withdrawStatus = '❌ 提现失败'.padEnd(16, ' ');
            const withdrawAmount = '0.00'.padEnd(12, ' ');
            console.log(`[${tag}] │ ${account} │ ${subCount} │ ${withdrawStatus} │ ${withdrawAmount} │`);
        } else {
            const account = (r.account || 'N/A').padEnd(22, ' ');
            const subCount = 'N/A'.padEnd(12, ' ');
            const withdrawStatus = '❌ 流程失败'.padEnd(16, ' ');
            const withdrawAmount = 'N/A'.padEnd(12, ' ');
            console.log(`[${tag}] │ ${account} │ ${subCount} │ ${withdrawStatus} │ ${withdrawAmount} │`);
        }
    });

    console.log(`[${tag}] └────────────────────────┴──────────────┴──────────────────┴──────────────┘`);
    console.log(`[${tag}] `);

    // 统计信息
    console.log(`[${tag}] ========== 统计信息 ==========`);
    console.log(`[${tag}] 总代处理结果: 总数=${config.generalAgentCount}, 成功=${successCount}, 失败=${failedCount}`);

    // 计算提现统计
    let withdrawnCount = 0;
    let skippedCount = 0;
    let withdrawFailedCount = 0;

    results.forEach(r => {
        if (r.roundResults && r.roundResults.length > 0) {
            const firstRound = r.roundResults[0];
            if (firstRound.success && firstRound.withdrawn) {
                withdrawnCount++;
            } else if (firstRound.success && firstRound.withdrawSkipped) {
                skippedCount++;
            } else if (firstRound.step === 'withdraw') {
                // 提现步骤失败
                withdrawFailedCount++;
            } else if (!firstRound.success) {
                // 其他步骤失败，不计入提现统计
            }
        }
    });

    console.log(`[${tag}] 提现统计: 已提现=${withdrawnCount}, 未满足条件=${skippedCount}, 提现失败=${withdrawFailedCount}`);

    if (successCount > 0) {
        console.log(`\n[${tag}] 成功的总代:`);
        results.filter(r => r.success).forEach((r, idx) => {
            const totalRounds = r.roundResults.filter(rr => rr.success).length;

            // 统计所有轮次的下级人数和提现金额
            let totalSubCount = 0;
            let totalWithdrawAmount = 0;
            let withdrawnRounds = 0;

            r.roundResults.forEach(round => {
                if (round.success) {
                    totalSubCount += (round.subCount || 0);
                    if (round.withdrawn) {
                        totalWithdrawAmount += (round.totalAmount || 0);
                        withdrawnRounds++;
                    }
                }
            });

            const withdrawInfo = withdrawnRounds === totalRounds ? `已提现 ${totalWithdrawAmount.toFixed(2)}` :
                withdrawnRounds > 0 ? `部分提现 ${totalWithdrawAmount.toFixed(2)} (${withdrawnRounds}/${totalRounds}轮)` :
                    '未提现';

            console.log(`  ${idx + 1}. ${r.account} - 完成轮次: ${totalRounds}/${config.wheelNumber}, 下级: ${totalSubCount}人, ${withdrawInfo}`);
        });
    }

    console.log(`\n[${tag}] 测试结束`);
}
