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
import { getEnvByTenantId } from '../../../../config/envconfig.js';
import {
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
 */
function registerSubordinate(inviteCode, data, config) {
    const { countryCode } = config;

    // 1. 尝试手机号邀请注册
    const phone = generateRandomPhone(countryCode);
    console.log(`[${tag}] 尝试手机号邀请注册: ${phone}, 邀请码: ${inviteCode}`);

    let registerResult = phoneRegisterByInvite(phone, inviteCode, data);

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
    console.log(`[${tag}] 尝试邮箱邀请注册: ${email}, 邀请码: ${inviteCode}`);

    registerResult = emailRegisterByInvite(email, inviteCode, data);

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

    // 1. 点击4个礼物盒（开启邀请转盘）
    console.log(`[${tag}] 步骤1: 点击4个礼物盒...`);
    const spinResult = clickSpinInvitedWheel(generalAgentToken);
    if (!spinResult || !spinResult.success) {
        console.error(`[${tag}] ❌ 点击礼物盒失败`);
        return { success: false, step: 'clickGiftBox' };
    }
    console.log(`[${tag}] ✅ 礼物盒点击成功，isFirstInvitedWheel: ${spinResult.isFirstInvitedWheel}`);

    // 2. 旋转转盘（免费次数）
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

    // 5. 等待10秒（确保状态更新）
    console.log(`\n[${tag}] 步骤5: 等待10秒，确保状态更新...`);
    sleep(10);

    // 6. 获取转盘总金额
    console.log(`\n[${tag}] 步骤6: 获取转盘总金额...`);
    const wheelInfoResult = getUserInvitedWheelInfo(generalAgentToken);
    if (!wheelInfoResult || !wheelInfoResult.success) {
        console.error(`[${tag}] ❌ 获取转盘信息失败`);
        return { success: false, step: 'getWheelInfo' };
    }
    const totalAmount = wheelInfoResult.totalPrizeAmount;
    console.log(`[${tag}] ✅ 转盘总金额: ${totalAmount}`);

    // 7. 提现
    console.log(`\n[${tag}] 步骤7: 提现...`);
    const withdrawResult = clickWheelWithdraw(totalAmount, generalAgentToken);
    if (!withdrawResult || !withdrawResult.success) {
        console.error(`[${tag}] ❌ 提现失败`);
        return { success: false, step: 'withdraw', totalAmount };
    }
    console.log(`[${tag}] ✅ 提现成功，金额: ${totalAmount}`);

    console.log(`\n[${tag}] 第 ${roundIndex} 轮完成！`);
    return {
        success: true,
        roundIndex,
        inviteCode,
        subCount: subResults.total,
        subSuccess: subResults.success,
        totalAmount,
        prizeAmount: turntableResult.prizeAmount
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
    console.log(`[${tag}] 总代处理结果: 总数=${config.generalAgentCount}, 成功=${successCount}, 失败=${failedCount}`);

    if (successCount > 0) {
        console.log(`\n[${tag}] 成功的总代:`);
        results.filter(r => r.success).forEach((r, idx) => {
            const totalRounds = r.roundResults.filter(rr => rr.success).length;
            console.log(`  ${idx + 1}. ${r.account} - 完成轮次: ${totalRounds}/${config.wheelNumber}`);
        });
    }

    console.log(`\n[${tag}] 测试结束`);
}
