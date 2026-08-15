/**
 * 邀请转盘 - 同设备只计一次邀请次数 验证测试
 *
 * 通过 TEST_MODE 环境变量选择验证场景：
 *
 *   TEST_MODE=concurrent  （默认）
 *     并发场景：同一轮中，部分下级共享同一个 deviceId 并发注册，
 *     验证同设备并发注册只触发一次邀请次数。
 *
 *   TEST_MODE=cross_round
 *     跨轮场景：第一轮产生的 deviceId 在后续轮次中被复用（1-2个），
 *     验证跨轮次同设备注册不重复触发邀请次数。
 *
 *   TEST_MODE=agent_device
 *     总代设备作弊场景：总代注册时产生一个 deviceId，然后下级注册时填写这个
 *     总代的 deviceId。验证这种自刷行为不会触发邀请次数。
 *
 * 使用方式：
 *   # 并发场景（同轮多人共享同一设备ID）
 *   k6 run verifySameDeviceInvite.test.js -e TENANT_ID=3004 -e TEST_MODE=concurrent
 *
 *   # 跨轮场景（第二轮复用第一轮的设备ID）
 *   k6 run verifySameDeviceInvite.test.js -e TENANT_ID=3004 -e TEST_MODE=cross_round -e WHEEL_NUMBER=3
 *  # 总代设备作弊场景，使用总代的设备id注册下级，验证这种自刷行为不会触发邀请次数。
 *   k6 run verifySameDeviceInvite.test.js -e TENANT_ID=3004 -e TEST_MODE=agent_device
 *
 * 环境变量：
 *   TENANT_ID           租户ID（默认 3004）
 *   TEST_MODE           concurrent | cross_round | agent_device（默认 concurrent）
 *   WHEEL_NUMBER        轮次数量（cross_round 模式下至少 2，默认 2）
 *   SUB_NUMBER          每轮正常下级数量（默认 4）
 *   SHARED_DEVICE_COUNT concurrent 模式下每轮共享同一设备ID的人数（默认 3）
 *   REUSE_DEVICE_COUNT  cross_round 模式下每轮复用旧设备ID的数量（默认 2）
 *   AGENT_SUB_NUMBER    agent_device 模式下使用总代设备ID的下级数量（默认 2）
 *   MIN_MONEY           最小充值金额（默认 1000）
 *   MAX_MONEY           最大充值金额（默认 3000）
 */

import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { phoneRegister, emailRegister, phoneRegisterByInvite, emailRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { generateRandomPhone, generateRandomEmail } from '../../../utils/accountGenerator.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    getInvitedWheelConfig,
    updateInvitedWheelConfig,
    clickSpinInvitedWheel,
    clickShareLink,
    clickSpinningTurntable,
    getUserInvitedWheelInfo,
    clickWheelWithdraw,
} from './inviteTurntableApi.js';

const tag = 'SameDeviceInvite';

// ============================================================
//  配置读取
// ============================================================
function getConfig() {
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const testMode = (__ENV.TEST_MODE || 'concurrent').toLowerCase();
    const subNumber = parseInt(__ENV.SUB_NUMBER) || 5;
    const sharedDeviceCount = parseInt(__ENV.SHARED_DEVICE_COUNT) || 3;  // concurrent 模式
    const reuseDeviceCount = parseInt(__ENV.REUSE_DEVICE_COUNT) || 2;   // cross_round 模式
    const agentSubNumber = parseInt(__ENV.AGENT_SUB_NUMBER) || 2;     // agent_device 模式
    const minMoney = parseInt(__ENV.MIN_MONEY) || 1000;
    const maxMoney = parseInt(__ENV.MAX_MONEY) || 3000;
    // cross_round 至少需要 2 轮，最多 7 轮
    let requestedWheel = parseInt(__ENV.WHEEL_NUMBER) || 2;
    requestedWheel = Math.min(Math.max(requestedWheel, 2), 7);
    const wheelNumber = testMode === 'cross_round'
        ? requestedWheel
        : 1;

    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    return { tenantId, testMode, wheelNumber, subNumber, sharedDeviceCount, reuseDeviceCount, agentSubNumber, minMoney, maxMoney, countryCode, envConfig };
}

// ============================================================
//  工具函数
// ============================================================
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr, n) {
    const copy = arr.slice();
    const result = [];
    for (let i = 0; i < Math.min(n, copy.length); i++) {
        const idx = Math.floor(Math.random() * copy.length);
        result.push(copy.splice(idx, 1)[0]);
    }
    return result;
}

// ============================================================
//  总代注册（可指定 deviceId）
// ============================================================
function registerGeneralAgent(data, config) {
    const phone = generateRandomPhone(config.countryCode);
    const agentDeviceId = generateCryptoRandomString(16);

    let result = phoneRegister(phone, data, 'qwer1234', '', null, agentDeviceId);
    if (result && result.code === 0) {
        return { success: true, account: phone, token: result.data.token, deviceId: agentDeviceId };
    }
    const email = generateRandomEmail();
    result = emailRegister(email, data);
    if (result && result.code === 0) {
        return { success: true, account: email, token: result.data.token, deviceId: 'email-random' };
    }
    return { success: false };
}

// ============================================================
//  单个下级注册（deviceOverride 传入即使用指定设备ID）
// ============================================================
function registerOneSub(inviteCode, data, config, deviceOverride) {
    const modifiedCode = inviteCode.slice(0, -1) + 'W';
    const customUrls = {
        frontUrl: config.envConfig.INVITE_REGISTER_URL,
        adminUrl: config.envConfig.BASE_ADMIN_URL,
        registerUrl: config.envConfig.INVITE_REGISTER_URL
    };

    const phone = generateRandomPhone(config.countryCode);
    const result = phoneRegisterByInvite(phone, modifiedCode, data, 'qwer1234', '', customUrls, deviceOverride || '', '');
    if (result && result.code === 0) {
        return { success: true, account: phone, token: result.data.token, deviceId: deviceOverride || '(random)' };
    }

    // 手机号失败 → 邮箱（邮箱不支持固定deviceId，符合 H5 无效说明）
    const email = generateRandomEmail();
    const result2 = emailRegisterByInvite(email, modifiedCode, data, 'qwer1234', '', customUrls);
    if (result2 && result2.code === 0) {
        return { success: true, account: email, token: result2.data.token, deviceId: 'email-random' };
    }
    return { success: false, deviceId: deviceOverride || '(random)' };
}

// ============================================================
//  下级充值
// ============================================================
function rechargeOneSub(subToken, adminToken, config, label) {
    const amount = randInt(config.minMoney, config.maxMoney);
    const userInfo = getFrontUserInfo(subToken);
    if (!userInfo || !userInfo.userId) return { success: false, amount: 0 };

    const r = hybridRecharge({ userToken: subToken, adminToken, userId: userInfo.userId, amount, frontendFirst: true, remark: `SameDevice-${label}` });
    return r.success ? { success: true, amount, userId: userInfo.userId } : { success: false, amount: 0, userId: userInfo.userId };
}

// ============================================================
//  转盘前置步骤（礼物盒→旋转→邀请码）
// ============================================================
function prepareWheel(agentToken, roundIndex) {
    console.log(`\n[${tag}] [第${roundIndex}轮] 点击礼物盒...`);
    const spin = clickSpinInvitedWheel(agentToken);
    if (!spin || !spin.success) return null;
    sleep(5);

    console.log(`[${tag}] [第${roundIndex}轮] 旋转转盘...`);
    const turntable = clickSpinningTurntable(agentToken);
    if (!turntable || !turntable.success) return null;

    console.log(`[${tag}] [第${roundIndex}轮] 获取邀请码...`);
    const share = clickShareLink(agentToken);
    if (!share || !share.success) return null;

    return { inviteCode: share.inviteCode, prizeAmount: turntable.prizeAmount };
}

// ============================================================
//  配置检查 & 更新
// ============================================================
function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) return false;

    const updates = [];
    if (!cfg.isOpen) updates.push({ key: 'IsOpenInvitedWheel', value: '1' });
    if (!cfg.cashToMainWallet) updates.push({ key: 'IsInvitedWheelCashToMainWallet', value: '1' });
    if (!cfg.autoRotate) updates.push({ key: 'InviteAutoRotate', value: '1' });

    for (const u of updates) {
        const r = updateInvitedWheelConfig(adminToken, u.key, u.value);
        if (!r || !r.success) return false;
    }
    if (updates.length > 0) sleep(10);
    return true;
}

// ============================================================
//  提现检查
// ============================================================
function checkAndWithdraw(agentToken, wheelInfo) {
    if (!wheelInfo || !wheelInfo.success) return;
    
    if (wheelInfo.totalPrizeAmount > 0 && wheelInfo.totalPrizeAmount === wheelInfo.userWheelAmount) {
        console.log(`\n[${tag}] 满足提现条件 (${wheelInfo.totalPrizeAmount})，正在进行提现...`);
        const withdrawResult = clickWheelWithdraw(wheelInfo.totalPrizeAmount, agentToken);
        if (withdrawResult && withdrawResult.success) {
            console.log(`[${tag}] ✅ 提现成功，等待 15 秒进入下一轮...`);
            sleep(15);
        } else {
            console.error(`[${tag}] ❌ 提现失败`);
        }
    }
}

// ============================================================
//  ★ 场景一：并发场景
//  同一轮内，生成 1 个「共享设备ID」，让 sharedDeviceCount 个下级
//  使用该相同设备ID注册，其余下级各自随机设备ID。
//  预期：共享设备ID只计 1 次邀请次数。
// ============================================================
function runConcurrentMode(agentToken, adminToken, data, config) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【并发场景】开始验证`);
    console.log(`[${tag}] 正常下级（各自随机deviceId）: ${config.subNumber} 人`);
    console.log(`[${tag}] 共享同一deviceId 的下级:      ${config.sharedDeviceCount} 人`);
    console.log(`${'='.repeat(80)}`);

    const wheel = prepareWheel(agentToken, 1);
    if (!wheel) { console.error(`[${tag}] ❌ 转盘准备失败`); return; }

    const { inviteCode } = wheel;
    const sharedDeviceId = generateCryptoRandomString(16);

    console.log(`\n[${tag}] 生成共享设备ID: ${sharedDeviceId}`);
    console.log(`[${tag}] 邀请码: ${inviteCode}`);

    const normalResults = [];
    const sharedResults = [];

    // Part A：正常下级（随机设备ID）
    console.log(`\n[${tag}] ── Part A：正常下级注册（随机设备ID）──`);
    for (let i = 0; i < config.subNumber; i++) {
        sleep(Math.random() * 1.5);
        const reg = registerOneSub(inviteCode, data, config, '');
        if (!reg.success) { normalResults.push({ success: false }); continue; }
        const rech = rechargeOneSub(reg.token, adminToken, config, `Normal-${i + 1}`);
        normalResults.push({ success: rech.success, account: reg.account, amount: rech.amount, userId: rech.userId });
    }

    // Part B：共享设备ID下级（全部使用同一个 sharedDeviceId）
    console.log(`\n[${tag}] ── Part B：共享设备ID下级注册（deviceId=${sharedDeviceId}）──`);
    for (let i = 0; i < config.sharedDeviceCount; i++) {
        sleep(Math.random() * 1.5);
        const reg = registerOneSub(inviteCode, data, config, sharedDeviceId);
        if (!reg.success) { sharedResults.push({ success: false, deviceId: sharedDeviceId }); continue; }
        const rech = rechargeOneSub(reg.token, adminToken, config, `Shared-${i + 1}`);
        sharedResults.push({ success: rech.success, account: reg.account, deviceId: sharedDeviceId, amount: rech.amount, userId: rech.userId });
    }

    sleep(5);
    const wheelInfo = getUserInvitedWheelInfo(agentToken);
    checkAndWithdraw(agentToken, wheelInfo);

    // 输出报告
    printConcurrentReport(config, sharedDeviceId, normalResults, sharedResults, wheelInfo);
}

function printConcurrentReport(config, sharedDeviceId, normalResults, sharedResults, wheelInfo) {
    const normalOk = normalResults.filter(r => r.success).length;
    const sharedOk = sharedResults.filter(r => r.success).length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【并发场景】结果报告`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[${tag}] 共享设备ID: ${sharedDeviceId}`);
    console.log(`\n[${tag}] Part A - 正常下级（随机设备ID）`);
    console.log(`[${tag}]   注册+充值成功: ${normalOk} / ${normalResults.length}`);
    console.log(`\n[${tag}] Part B - 共享设备ID 下级（${config.sharedDeviceCount} 人使用同一设备）`);
    console.log(`[${tag}]   注册+充值成功: ${sharedOk} / ${sharedResults.length}`);
    sharedResults.forEach((r, i) => {
        console.log(`[${tag}]   [${i + 1}] userId=${r.userId || r.account || 'N/A'} | ${r.success ? '✅' : '❌'}`);
    });
    if (wheelInfo && wheelInfo.success) {
        console.log(`\n[${tag}] 转盘总金额: ${wheelInfo.totalPrizeAmount} / 已旋转: ${wheelInfo.userWheelAmount}`);
    }
    console.log(`\n[${tag}] 【请后台手动核查】`);
    console.log(`[${tag}]   预期邀请次数 = Part A 成功数量（${normalOk}）+ 1`);
    console.log(`[${tag}]   （Part B ${config.sharedDeviceCount} 个共享设备下级只计 1 次，不是 ${config.sharedDeviceCount} 次）`);
    console.log(`${'='.repeat(80)}`);
}

// ============================================================
//  ★ 场景二：跨轮场景
//  第一轮用全新随机设备ID注册下级，把这些 deviceId 存起来。
//  第二轮（及后续轮）从旧池中随机抽 reuseDeviceCount 个旧设备ID
//  混入注册，其余下级仍用新随机设备ID。
//  预期：被复用的设备ID不再触发新的邀请次数。
// ============================================================
function runCrossRoundMode(agentToken, adminToken, data, config) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【跨轮场景】开始验证`);
    console.log(`[${tag}] 总轮次: ${config.wheelNumber}，每轮正常下级: ${config.subNumber}，每轮复用旧设备: ${config.reuseDeviceCount}`);
    console.log(`${'='.repeat(80)}`);

    const allRounds = [];
    let usedDevicePool = [];   // 累积所有轮次的新设备ID

    for (let round = 1; round <= config.wheelNumber; round++) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[${tag}] ▶ 第 ${round} 轮开始 | 旧设备池大小: ${usedDevicePool.length}`);
        console.log(`${'─'.repeat(60)}`);

        const wheel = prepareWheel(agentToken, round);
        if (!wheel) { console.error(`[${tag}] ❌ 第 ${round} 轮转盘准备失败`); break; }

        const { inviteCode } = wheel;
        const roundNewDeviceIds = [];
        const normalResults = [];
        const reuseResults = [];

        // Part A：正常下级（本轮新随机设备ID）
        console.log(`\n[${tag}] [第${round}轮] Part A：正常下级（新随机设备ID）`);
        for (let i = 0; i < config.subNumber; i++) {
            const newDeviceId = generateCryptoRandomString(16);
            roundNewDeviceIds.push(newDeviceId);
            sleep(Math.random() * 1.5);
            const reg = registerOneSub(inviteCode, data, config, newDeviceId);
            if (!reg.success) { normalResults.push({ success: false, deviceId: newDeviceId }); continue; }
            const rech = rechargeOneSub(reg.token, adminToken, config, `R${round}-Normal-${i + 1}`);
            normalResults.push({ success: rech.success, account: reg.account, deviceId: newDeviceId, amount: rech.amount, userId: rech.userId });
        }

        // Part B：复用旧设备ID（第一轮无可复用，跳过）
        const pickedOld = pickRandom(usedDevicePool, config.reuseDeviceCount);
        if (pickedOld.length === 0) {
            console.log(`\n[${tag}] [第${round}轮] Part B：无旧设备可复用（第一轮跳过）`);
        } else {
            console.log(`\n[${tag}] [第${round}轮] Part B：复用旧设备ID: ${pickedOld.join(', ')}`);
            for (let i = 0; i < pickedOld.length; i++) {
                const reuseDeviceId = pickedOld[i];
                sleep(Math.random() * 1.5);
                const reg = registerOneSub(inviteCode, data, config, reuseDeviceId);
                if (!reg.success) { reuseResults.push({ success: false, deviceId: reuseDeviceId }); continue; }
                const rech = rechargeOneSub(reg.token, adminToken, config, `R${round}-Reuse-${i + 1}`);
                reuseResults.push({ success: rech.success, account: reg.account, deviceId: reuseDeviceId, amount: rech.amount, userId: rech.userId });
            }
        }

        // 本轮新设备ID加入池
        usedDevicePool = usedDevicePool.concat(roundNewDeviceIds);

        sleep(5);
        const wheelInfo = getUserInvitedWheelInfo(agentToken);
        checkAndWithdraw(agentToken, wheelInfo);

        allRounds.push({ round, inviteCode, normalResults, reuseResults, pickedOld, wheelInfo });

        if (round < config.wheelNumber) {
            console.log(`\n[${tag}] 等待 5 秒后开始下一轮...`);
            sleep(5);
        }
    }

    printCrossRoundReport(config, allRounds);
}

function printCrossRoundReport(config, allRounds) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【跨轮场景】结果报告`);
    console.log(`${'='.repeat(80)}`);

    let grandNormal = 0, grandReuse = 0;

    allRounds.forEach(r => {
        const normalOk = r.normalResults.filter(x => x.success).length;
        const reuseOk = r.reuseResults.filter(x => x.success).length;
        grandNormal += r.normalResults.length;
        grandReuse += r.reuseResults.length;

        console.log(`\n[${tag}] ── 第 ${r.round} 轮 ──`);
        console.log(`[${tag}]   邀请码: ${r.inviteCode}`);
        console.log(`[${tag}]   Part A（新设备）: 成功 ${normalOk}/${r.normalResults.length}`);
        if (r.reuseResults.length > 0) {
            console.log(`[${tag}]   Part B（复用旧设备）: 成功 ${reuseOk}/${r.reuseResults.length}`);
            console.log(`[${tag}]   复用的设备ID: ${r.pickedOld.join(', ')}`);
            r.reuseResults.forEach((x, i) => {
                console.log(`[${tag}]     [${i + 1}] deviceId=${x.deviceId} | userId=${x.userId || x.account || 'N/A'} | ${x.success ? '✅' : '❌'}`);
            });
        } else {
            console.log(`[${tag}]   Part B: 本轮无旧设备复用（第一轮）`);
        }
        if (r.wheelInfo && r.wheelInfo.success) {
            console.log(`[${tag}]   转盘总额: ${r.wheelInfo.totalPrizeAmount} / 已旋转: ${r.wheelInfo.userWheelAmount}`);
        }
    });

    console.log(`\n[${tag}] ─── 汇总 ───`);
    console.log(`[${tag}]   正常新设备下级总数: ${grandNormal}`);
    console.log(`[${tag}]   复用旧设备下级总数: ${grandReuse}`);
    console.log(`\n[${tag}] 【请后台手动核查】`);
    console.log(`[${tag}]   预期邀请次数 = 各轮新设备下级成功数之和（${grandNormal}）`);
    console.log(`[${tag}]   复用旧设备的 ${grandReuse} 个下级不应再触发新的邀请次数`);
    console.log(`${'='.repeat(80)}`);
}

// ============================================================
//  Setup
// ============================================================
export function setup() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 同设备邀请次数验证 - 初始化`);
    console.log(`${'='.repeat(80)}`);

    const config = getConfig();
    console.log(`[${tag}] 测试模式:   ${config.testMode}`);
    console.log(`[${tag}] 租户ID:     ${config.tenantId}`);
    if (config.testMode === 'concurrent') {
        console.log(`[${tag}] 正常下级:  ${config.subNumber}，共享设备下级: ${config.sharedDeviceCount}`);
    } else {
        console.log(`[${tag}] 轮次:     ${config.wheelNumber}，每轮正常下级: ${config.subNumber}，复用设备: ${config.reuseDeviceCount}`);
    }

    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, config.envConfig);
        console.log(`[${tag}] ✅ ENV_CONFIG 已切换为租户 ${config.tenantId}`);
    }

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('后台登录失败');
    console.log(`[${tag}] ✅ 后台登录成功`);

    return { token: adminToken, envConfig: config.envConfig, config };
}

// ============================================================
//  主测试函数
// ============================================================
export default function (data) {
    const config = data.config;
    const adminToken = data.token;

    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, data.envConfig);
    }

    // 注册总代
    const agentReg = registerGeneralAgent(data, config);
    if (!agentReg.success) {
        console.error(`[${tag}] ❌ 总代注册失败，测试终止`);
        return;
    }
    console.log(`[${tag}] ✅ 总代注册成功: ${agentReg.account}`);

    // 确保配置开关正确
    if (!ensureWheelConfig(adminToken)) {
        console.error(`[${tag}] ❌ 配置检查失败，测试终止`);
        return;
    }

    // 按模式分支执行
    if (config.testMode === 'concurrent') {
        runConcurrentMode(agentReg.token, adminToken, data, config);
    } else if (config.testMode === 'cross_round') {
        runCrossRoundMode(agentReg.token, adminToken, data, config);
    } else if (config.testMode === 'agent_device') {
        runAgentDeviceMode(agentReg, adminToken, data, config);
    } else {
        console.error(`[${tag}] ❌ 未知 TEST_MODE: ${config.testMode}，支持: concurrent | cross_round | agent_device`);
    }
}

// ============================================================
//  ★ 场景三：总代自身设备作弊场景 (Agent's Own Device)
//  总代注册时生成一个 deviceId。
//  下级注册时，有一部分正常注册（随机deviceId），
//  另一部分下级使用总代的 deviceId 进行注册。
//  预期：使用总代设备ID注册的下级不触发邀请次数。
// ============================================================
function runAgentDeviceMode(agentReg, adminToken, data, config) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【总代自身设备作弊场景】开始验证`);
    console.log(`[${tag}] 总代设备ID: ${agentReg.deviceId}`);
    console.log(`[${tag}] 正常下级数: ${config.subNumber}，使用总代设备作弊下级数: ${config.agentSubNumber}`);
    console.log(`${'='.repeat(80)}`);

    const wheel = prepareWheel(agentReg.token, 1);
    if (!wheel) { console.error(`[${tag}] ❌ 转盘准备失败`); return; }

    const { inviteCode } = wheel;
    const normalResults = [];
    const agentResults = [];

    // Part A：正常下级（随机设备ID）
    console.log(`\n[${tag}] ── Part A：正常下级注册（随机设备ID）──`);
    for (let i = 0; i < config.subNumber; i++) {
        sleep(Math.random() * 1.5);
        const reg = registerOneSub(inviteCode, data, config, '');
        if (!reg.success) { normalResults.push({ success: false }); continue; }
        const rech = rechargeOneSub(reg.token, adminToken, config, `Normal-${i + 1}`);
        normalResults.push({ success: rech.success, account: reg.account, amount: rech.amount, userId: rech.userId });
    }

    // Part B：作弊下级（使用总代设备ID）
    console.log(`\n[${tag}] ── Part B：总代作弊下级注册（deviceId=${agentReg.deviceId}）──`);
    for (let i = 0; i < config.agentSubNumber; i++) {
        sleep(Math.random() * 1.5);
        const reg = registerOneSub(inviteCode, data, config, agentReg.deviceId);
        if (!reg.success) { agentResults.push({ success: false, deviceId: agentReg.deviceId }); continue; }
        const rech = rechargeOneSub(reg.token, adminToken, config, `AgentDevice-${i + 1}`);
        agentResults.push({ success: rech.success, account: reg.account, deviceId: agentReg.deviceId, amount: rech.amount, userId: rech.userId });
    }

    sleep(5);
    const wheelInfo = getUserInvitedWheelInfo(agentReg.token);
    checkAndWithdraw(agentReg.token, wheelInfo);

    printAgentDeviceReport(config, agentReg.deviceId, normalResults, agentResults, wheelInfo);
}

function printAgentDeviceReport(config, agentDeviceId, normalResults, agentResults, wheelInfo) {
    const normalOk = normalResults.filter(r => r.success).length;
    const agentOk = agentResults.filter(r => r.success).length;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 【总代作弊场景】结果报告`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[${tag}] 总代设备ID: ${agentDeviceId}`);
    console.log(`\n[${tag}] Part A - 正常下级（随机设备ID）`);
    console.log(`[${tag}]   注册+充值成功: ${normalOk} / ${normalResults.length}`);
    console.log(`\n[${tag}] Part B - 使用总代设备ID注册的下级`);
    console.log(`[${tag}]   注册+充值成功: ${agentOk} / ${agentResults.length}`);
    agentResults.forEach((r, i) => {
        console.log(`[${tag}]   [${i + 1}] userId=${r.userId || r.account || 'N/A'} | ${r.success ? '✅' : '❌'}`);
    });
    if (wheelInfo && wheelInfo.success) {
        console.log(`\n[${tag}] 转盘总金额: ${wheelInfo.totalPrizeAmount} / 已旋转: ${wheelInfo.userWheelAmount}`);
    }
    console.log(`\n[${tag}] 【请后台手动核查】`);
    console.log(`[${tag}]   预期邀请次数 = Part A 成功数量（${normalOk}）`);
    console.log(`[${tag}]   （Part B 使用总代自己的设备ID注册下级，属于自刷，不应计入邀请次数）`);
    console.log(`${'='.repeat(80)}`);
}
