/**
 * 邀请转盘 - 手动旋转验证测试
 *
 * 背景：后台 InviteAutoRotate（自动旋转）配置现在是关闭的——verifyInviteTurntable.test.js
 * 那套流程依赖这个配置自动把"邀请下级获得的旋转次数"转掉，脚本只手动点一次"免费旋转"。
 * 现在这个前提没了，邀请下级带来的旋转次数需要脚本自己手动发请求去转。
 *
 * 1个总代，每轮邀请3-5个下级，共9轮，按轮次号循环测试3种旋转触发策略：
 * - 策略A（第1/4/7轮）：邀请1个下级就立即顺序旋转2次（间隔2s），逐个下级重复。
 *   固定2次，不随下级数量变——故意跟"每人2次"的后台规则不严格对应。
 * - 策略B（第2/5/8轮）：逐个邀请下级，每凑够2个就并发旋转3次（http.batch真并发）。
 *   固定3次，不是按"2人×2=4"算——同样故意不对等。
 * - 策略C（第3/6/9轮）：先邀请完本轮全部下级，再按"实际成功人数×2"算总次数
 *   （这里严格按规则算），3个一批并发发完。
 * 不管次数对不对、不做客户端预判断，直接发请求，只看后端怎么处理。
 *
 * 第3轮专属：本轮下级+旋转流程走完、提现判断之后，总代自己充值2000-5000，
 * 再自己投注2000-3000（betRun 金额固定20/50/100不满足这个范围，这里走底层
 * 三件套 getBetToken→isBet→betWingo 自己控制金额），然后才进入第4轮。
 *
 * 环境变量：
 * - TENANT_ID/LANGUAGE：同 verifyInviteTurntable.test.js
 * - WHEEL_NUMBER：轮次数量（默认9）
 * - SUB_MIN_NUMBER/SUB_MAX_NUMBER：每轮下级数量范围（默认3/5）
 * - MIN_MONEY/MAX_MONEY：下级充值金额范围（默认1000/5000）
 * - SELF_RECHARGE_MIN/SELF_RECHARGE_MAX：总代自充值范围（默认2000/5000，仅第3轮）
 * - SELF_BET_MIN/SELF_BET_MAX：总代自投注范围（默认2000/3000，仅第3轮）
 *
 * k6p -e TENANT_ID=3004 -e LANGUAGE=en verifyInviteTurntableManualSpin.test.js
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { SignatureUtil } from '../../../../libs/utils/signature.js';
import { httpClient } from '../../../../libs/http/client.js';
import { resolveApiRoute } from '../../../../config/environment.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { randInt } from '../../../../libs/common/index.js';
import { getBetToken } from '../../runbet/betToken.js';
import { isBet } from '../../runbet/issueNumber.js';
import { betWingo } from '../../runbet/bet.js';
import {
    getInvitedWheelConfig,
    clickSpinInvitedWheel,
    clickShareLink,
    clickSpinningTurntable,
    getUserInvitedWheelInfo,
    clickWheelWithdraw
} from './inviteTurntableApi.js';
import {
    registerGeneralAgent,
    registerSubordinate,
    finishSubordinate,
    callWithRateLimitRetry
} from './verifyInviteTurntable.test.js';

const tag = 'ManualSpin';

// 2026-11-07 修复：没有 options 时 k6 用默认测试时长（约10分钟），9轮长流程会被
// 强制中断（实测跑到第7轮时报"No script iterations fully finished"）。单总代
// 不需要多VU，但仍要显式给够 maxDuration，照抄 verifyInviteTurntable.test.js
// 的做法。
export const options = {
    scenarios: {
        manualSpin: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2h'
        }
    }
};

// ============================================================
// 总代自投注用的游戏/下注内容列表 —— 跟 betRun.js 的 getBetResult 保持同款，
// 不引入新的随意值；已验证 3004/3007 只有 WinGo/TrxWinGo 族能下
// ============================================================
const BET_GAME_CODES = ['WinGo_5M', 'WinGo_30S', 'TrxWinGo_10M'];
const BET_CONTENT_LIST = ['Color_Green', 'Color_Violet', 'Color_Red', 'BigSmall_Big', 'BigSmall_Small'];
const BET_MULTIPLE = 10; // 固定倍数，简化按目标总额反推 amount

/**
 * 获取环境变量配置
 */
function getConfig() {
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const language = __ENV.LANGUAGE || 'en';

    const wheelNumber = parseInt(__ENV.WHEEL_NUMBER) || 9;
    const subMinNumber = parseInt(__ENV.SUB_MIN_NUMBER) || 3;
    const subMaxNumber = parseInt(__ENV.SUB_MAX_NUMBER) || 5;
    const minMoney = parseInt(__ENV.MIN_MONEY) || 1000;
    const maxMoney = parseInt(__ENV.MAX_MONEY) || 5000;
    const selfRechargeMin = parseInt(__ENV.SELF_RECHARGE_MIN) || 2000;
    const selfRechargeMax = parseInt(__ENV.SELF_RECHARGE_MAX) || 5000;
    const selfBetMin = parseInt(__ENV.SELF_BET_MIN) || 2000;
    const selfBetMax = parseInt(__ENV.SELF_BET_MAX) || 3000;

    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    return {
        tenantId, language, wheelNumber, subMinNumber, subMaxNumber,
        minMoney, maxMoney, selfRechargeMin, selfRechargeMax, selfBetMin, selfBetMax,
        countryCode, envConfig
    };
}

// ============================================================
// 旋转工具函数
// ============================================================

/**
 * 构造一份已签名的 SpinInvitedWheel 请求对象，供 http.batch 使用。
 * 照抄 verifyInviteTurntable.test.js 的 buildPhoneInviteRegisterRequest 手法：
 * 签名复用 SignatureUtil.signRequest(payload, '')（secret 固定为空字符串，跟
 * httpClient 内部签名逻辑一致），域名走 resolveApiRoute（前台会员请求，
 * isDesk=true，不涉及集团 token 问题）。
 */
function buildSpinRequest(userToken) {
    const api = '/api/Activity/SpinInvitedWheel';
    const timeData = getTimeRandom();
    const payload = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };
    const signedPayload = SignatureUtil.signRequest(payload, '');

    const route = resolveApiRoute(api, true, false);
    const headers = {
        ...httpClient.defaultHeaders,
        Authorization: `Bearer ${userToken}`,
        Domainurl: route.baseUrl,
        Referrer: route.baseUrl,
        ...route.extraHeaders
    };

    return {
        method: 'POST',
        url: route.url,
        body: JSON.stringify(signedPayload),
        params: { headers, tags: { type: tag, name: `${tag}_spin_batch` } }
    };
}

function parseSpinResponse(resp) {
    if (!resp || !resp.body) return { success: false, prizeAmount: 0, raw: null };
    try {
        const body = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
        const statusCode = body.code !== undefined ? body.code : body.msgCode;
        if (statusCode === 0) {
            const data = body.data || body;
            return { success: true, prizeAmount: data.prizeAmount || 0, isWin: data.isWin || false, raw: body };
        }
        return { success: false, prizeAmount: 0, raw: body };
    } catch (e) {
        console.error(`[${tag}] 旋转响应解析失败: ${e.message}`);
        return { success: false, prizeAmount: 0, raw: null };
    }
}

/**
 * 顺序旋转 times 次，每次间隔2秒（符合真实用户操作节奏）。
 * 复用现有 clickSpinningTurntable（自带3次限流重试）。
 */
function spinSequentialTimes(userToken, times, label = '') {
    const results = [];
    for (let i = 1; i <= times; i++) {
        console.log(`[${tag}] [${label}] 顺序旋转 ${i}/${times}...`);
        const result = clickSpinningTurntable(userToken);
        results.push(result || { success: false });
        if (i < times) sleep(2);
    }
    const successCount = results.filter(r => r.success).length;
    console.log(`[${tag}] [${label}] 顺序旋转完成: ${successCount}/${times} 成功`);
    return results;
}

/**
 * 并发旋转 times 次（http.batch 真并发，同一时刻发出）。不做"次数够不够"的
 * 客户端预判断——不管对不对直接发，只看后端返回什么。并发这一批算一次节奏
 * 单位（批内不插 2s 间隔，批次之间才插）。
 */
function spinConcurrentBatch(userToken, times, label = '') {
    console.log(`[${tag}] [${label}] 并发旋转 ${times} 次，真正同时发出...`);

    const batchRequests = {};
    for (let i = 1; i <= times; i++) {
        const r = buildSpinRequest(userToken);
        batchRequests[String(i)] = { method: r.method, url: r.url, body: r.body, params: r.params };
    }

    const startedAt = Date.now();
    const responses = http.batch(batchRequests);
    console.log(`[${tag}] [${label}] ${times} 个旋转请求已全部返回，耗时: ${Date.now() - startedAt}ms`);

    const results = [];
    for (let i = 1; i <= times; i++) {
        const parsed = parseSpinResponse(responses[String(i)]);
        results.push(parsed);
        console.log(`[${tag}] [${label}] 旋转[${i}/${times}]: ${parsed.success ? `✅ 成功 金额=${parsed.prizeAmount}` : `❌ 失败 ${JSON.stringify(parsed.raw)}`}`);
    }
    return results;
}

// ============================================================
// 3种旋转触发策略
// ============================================================

function summarizeStrategyResult(strategyName, subCount, results) {
    const subSuccessCount = results.filter(r => r.subSuccess).length;
    const allSpins = results.flatMap(r => r.spinResults);
    const spinSuccessCount = allSpins.filter(s => s.success).length;
    console.log(`\n[${tag}] 策略${strategyName}完成: 下级${subSuccessCount}/${subCount}成功, 旋转${spinSuccessCount}/${allSpins.length}成功`);
    return {
        strategy: strategyName,
        subCount,
        subSuccessCount,
        totalSpinAttempts: allSpins.length,
        spinSuccessCount
    };
}

/**
 * 策略A（第1/4/7轮）：邀请1个下级立即顺序旋转2次，逐个重复。
 */
function runStrategyA(generalAgentToken, inviteCode, data, adminToken, config) {
    const subCount = randInt(config.subMinNumber, config.subMaxNumber);
    console.log(`\n[${tag}] ===== 策略A：邀请1个下级立即旋转2次，共${subCount}个下级 =====`);

    const results = [];
    for (let i = 1; i <= subCount; i++) {
        const registerResult = registerSubordinate(inviteCode, data, config);
        let subSuccess = false;
        if (registerResult.success) {
            const { account, token } = registerResult;
            const finishResult = finishSubordinate(token, account, adminToken, config, i, subCount);
            subSuccess = finishResult.success;
        } else {
            console.error(`[${tag}] [策略A][${i}/${subCount}] 下级注册失败，跳过本次旋转`);
        }

        sleep(1);
        // 不管下级注册/充值成功与否都按策略旋转——不做客户端预判断，直接发
        const spinResults = spinSequentialTimes(generalAgentToken, 2, `策略A-第${i}个下级后`);
        results.push({ subSuccess, spinResults });
    }

    return summarizeStrategyResult('A', subCount, results);
}

/**
 * 策略B（第2/5/8轮）：逐个邀请下级，每凑够2个就并发旋转3次。
 */
function runStrategyB(generalAgentToken, inviteCode, data, adminToken, config) {
    const subCount = randInt(config.subMinNumber, config.subMaxNumber);
    console.log(`\n[${tag}] ===== 策略B：每凑够2个下级并发旋转3次，共${subCount}个下级 =====`);

    const results = [];
    let pendingInBatch = 0;

    for (let i = 1; i <= subCount; i++) {
        const registerResult = registerSubordinate(inviteCode, data, config);
        let subSuccess = false;
        if (registerResult.success) {
            const { account, token } = registerResult;
            const finishResult = finishSubordinate(token, account, adminToken, config, i, subCount);
            subSuccess = finishResult.success;
        } else {
            console.error(`[${tag}] [策略B][${i}/${subCount}] 下级注册失败`);
        }
        results.push({ subSuccess, spinResults: [] });
        pendingInBatch++;

        const isLast = (i === subCount);
        if (pendingInBatch === 2 || (isLast && pendingInBatch > 0)) {
            sleep(1);
            const spinResults = spinConcurrentBatch(generalAgentToken, 3, `策略B-凑够${pendingInBatch}个下级后`);
            results[results.length - 1].spinResults = spinResults;
            pendingInBatch = 0;
            if (!isLast) sleep(2);
        }
    }

    return summarizeStrategyResult('B', subCount, results);
}

/**
 * 策略C（第3/6/9轮）：先邀请完本轮全部下级，再按"实际成功人数×2"算总次数，
 * 3个一批并发发完。
 */
function runStrategyC(generalAgentToken, inviteCode, data, adminToken, config) {
    const subCount = randInt(config.subMinNumber, config.subMaxNumber);
    console.log(`\n[${tag}] ===== 策略C：先邀请完${subCount}个下级，再按人数×2并发补转 =====`);

    const results = [];
    let successCount = 0;
    for (let i = 1; i <= subCount; i++) {
        const registerResult = registerSubordinate(inviteCode, data, config);
        let subSuccess = false;
        if (registerResult.success) {
            const { account, token } = registerResult;
            const finishResult = finishSubordinate(token, account, adminToken, config, i, subCount);
            subSuccess = finishResult.success;
        } else {
            console.error(`[${tag}] [策略C][${i}/${subCount}] 下级注册失败`);
        }
        results.push({ subSuccess, spinResults: [] });
        if (subSuccess) successCount++;
        sleep(0.5);
    }

    const totalSpins = successCount * 2;
    console.log(`[${tag}] 本轮成功下级 ${successCount}/${subCount} 人，按人数×2 应转 ${totalSpins} 次，3个一批并发补转`);

    const allSpinResults = [];
    for (let i = 0; i < totalSpins; i += 3) {
        const batchSize = Math.min(3, totalSpins - i);
        const spinResults = spinConcurrentBatch(generalAgentToken, batchSize, `策略C-批次[${i + 1}-${i + batchSize}/${totalSpins}]`);
        allSpinResults.push(...spinResults);
        if (i + batchSize < totalSpins) sleep(2);
    }
    if (results.length > 0) results[results.length - 1].spinResults = allSpinResults;

    return summarizeStrategyResult('C', subCount, results);
}

// ============================================================
// 总代自充值 + 自投注（仅第3轮）
// ============================================================

/**
 * 总代自己投注，控制有效投注额（amount×betMultiple）落在 [minTotal, maxTotal]
 * 区间。betRun() 本身金额固定走 [20,50,100]×[10,20,50]，不满足"2000-3000"这个
 * 范围，所以这里直接走底层三件套：getBetToken → isBet → betWingo，自己算金额。
 */
function selfBet(loginToken, minTotal, maxTotal, maxRetries = 2) {
    const gameCode = BET_GAME_CODES[Math.floor(Math.random() * BET_GAME_CODES.length)];
    const betContent = BET_CONTENT_LIST[Math.floor(Math.random() * BET_CONTENT_LIST.length)];
    const minAmount = Math.ceil(minTotal / BET_MULTIPLE);
    const maxAmount = Math.floor(maxTotal / BET_MULTIPLE);
    const amount = randInt(minAmount, maxAmount);

    console.log(`[${tag}] [SelfBet] 开始总代自投注: game=${gameCode}, content=${betContent}, amount=${amount}, multiple=${BET_MULTIPLE}, 目标有效投注=${amount * BET_MULTIPLE}`);

    // 2026-11-07 实测：充值成功后立刻投注，余额可能还没同步到投注系统，报
    // msgCode 142 "Balance is not enough"——退避重试；其它真实失败不重试
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const tokenInfo = getBetToken(loginToken, gameCode);
        if (!tokenInfo || !tokenInfo.token) {
            console.error(`[${tag}] [SelfBet] ❌ 获取投注token失败`);
            return { success: false };
        }

        const betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (!betInfo.canBet) {
            console.error(`[${tag}] [SelfBet] ❌ 当期不可投注`);
            return { success: false };
        }

        const betResult = betWingo(gameCode, amount, BET_MULTIPLE, betContent, betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);

        if (betResult && betResult.code === 0 && betResult.msgCode === 0 && betResult.msg === 'Succeed') {
            console.log(`[${tag}] [SelfBet] ✅ 投注成功，有效投注: ${amount * BET_MULTIPLE}`);
            return { success: true, amount, betMultiple: BET_MULTIPLE, effectiveAmount: amount * BET_MULTIPLE };
        }

        const isBalanceNotReady = betResult && betResult.msgCode === 142;
        if (isBalanceNotReady && attempt < maxRetries) {
            console.warn(`[${tag}] [SelfBet] ⚠️ 余额未到账(${JSON.stringify(betResult)})，等待5秒后重试(${attempt + 1}/${maxRetries})...`);
            sleep(5);
            continue;
        }

        console.error(`[${tag}] [SelfBet] ❌ 投注失败: ${JSON.stringify(betResult)}`);
        return { success: false };
    }

    return { success: false };
}

/**
 * 第3轮专属：总代自己充值 + 自己投注。
 */
function selfRechargeAndBet(generalAgentToken, adminToken, userId, config) {
    console.log(`\n[${tag}] ===== 第3轮专属：总代自充值 + 自投注 =====`);

    const rechargeAmount = randInt(config.selfRechargeMin, config.selfRechargeMax);
    console.log(`[${tag}] [SelfRecharge] 总代自充值: ${rechargeAmount}`);
    const rechargeResult = hybridRecharge({
        userToken: generalAgentToken,
        adminToken: adminToken,
        userId: userId,
        amount: rechargeAmount,
        frontendFirst: true,
        remark: 'InviteTurntable-SelfRecharge-Round3'
    });

    if (rechargeResult.success) {
        console.log(`[${tag}] ✅ 总代自充值成功: ${rechargeAmount}, 方式: ${rechargeResult.method}`);
    } else {
        console.error(`[${tag}] ❌ 总代自充值失败`);
    }

    sleep(8); // 2026-11-07：充值到账跟余额同步到投注系统有延迟，3秒不够，加长到8秒
    const betResult = selfBet(generalAgentToken, config.selfBetMin, config.selfBetMax);

    return {
        rechargeSuccess: rechargeResult.success,
        rechargeAmount: rechargeResult.success ? rechargeAmount : 0,
        betSuccess: betResult.success,
        betAmount: betResult.success ? betResult.effectiveAmount : 0
    };
}

/**
 * 遇到"累计抽奖金额已达提现门槛"（msgCode 7043）导致旋转（包括免费旋转）被
 * 拒绝时的自救：查当前 userWheelAmount，若大于0就先提现掉它——不要求跟
 * totalPrizeAmount 严格相等，这是真实用户遇到这种情况时会做的操作：先把能提
 * 的提了，门槛才会降下来，才能继续转。
 * 2026-11-07 实测发现：9轮长流程里，如果某一轮因为次数不对等导致旋转有失败、
 * 最终 userWheelAmount 跟 totalPrizeAmount 有尾差，严格相等判断永远不满足，
 * 会导致余额一直卡着门槛、后续所有轮次（包括免费旋转）都转不动——这是本次
 * "次数不对等"压力测试本身要观察的真实风险点。
 */
function tryClearWithdrawThreshold(generalAgentToken, label = '') {
    const info = getUserInvitedWheelInfo(generalAgentToken);
    if (!info || !info.success) {
        console.warn(`[${tag}] [${label}] 查询转盘信息失败，无法自救`);
        return false;
    }
    if (!info.userWheelAmount || info.userWheelAmount <= 0) {
        console.warn(`[${tag}] [${label}] 已旋转金额为0，无法通过提现自救`);
        return false;
    }
    console.log(`[${tag}] [${label}] 尝试提现已旋转金额 ${info.userWheelAmount} 以清除门槛...`);
    const wr = clickWheelWithdraw(info.userWheelAmount, generalAgentToken);
    const ok = !!(wr && wr.success);
    console.log(`[${tag}] [${label}] 自救提现${ok ? '✅ 成功' : '❌ 失败'}`);
    return ok;
}

// ============================================================
// 单轮流程
// ============================================================

function runSingleRoundManualSpin(generalAgentToken, generalAgentUserId, adminToken, data, config, roundIndex) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${tag}] 开始第 ${roundIndex} 轮邀请转盘流程（手动旋转模式）`);
    console.log(`${'='.repeat(80)}\n`);

    // 0. 仅第一轮：检查配置，只打印不修改——现在测的就是"自动旋转关闭后手动
    // 旋转"这个场景，不像 verifyInviteTurntable.test.js 那样强制把它打开。
    if (roundIndex === 1) {
        console.log(`[${tag}] 步骤0: 检查邀请转盘配置（仅打印，不修改）...`);
        const configResult = getInvitedWheelConfig(adminToken);
        if (configResult && configResult.success) {
            console.log(`[${tag}] 当前配置: isOpen=${configResult.isOpen}, cashToMainWallet=${configResult.cashToMainWallet}, autoRotate=${configResult.autoRotate}`);
            if (configResult.autoRotate) {
                console.warn(`[${tag}] ⚠️ 自动旋转仍是开启状态，手动旋转次数会和自动旋转叠加，可能影响观察结论`);
            } else {
                console.log(`[${tag}] ✅ 自动旋转已关闭，符合本次手动旋转验证的前提`);
            }
        } else {
            console.warn(`[${tag}] ⚠️ 获取邀请转盘配置失败，继续执行（不影响主流程）`);
        }
    }

    // 1. 点击4个礼物盒
    console.log(`\n[${tag}] 步骤1: 点击4个礼物盒...`);
    const spinResult = clickSpinInvitedWheel(generalAgentToken);
    if (!spinResult || !spinResult.success) {
        console.error(`[${tag}] ❌ 点击礼物盒失败`);
        return { success: false, step: 'clickGiftBox', roundIndex };
    }

    console.log(`\n[${tag}] 等待5秒后旋转转盘...`);
    sleep(5);

    // 2. 免费旋转一次。失败大概率是上一轮次数不对等导致余额卡在提现门槛
    // （msgCode 7043），先尝试提现自救再重试一次，不要立即判定本轮失败。
    console.log(`\n[${tag}] 步骤2: 免费旋转一次...`);
    let freeSpinResult = clickSpinningTurntable(generalAgentToken);
    if (!freeSpinResult || !freeSpinResult.success) {
        console.warn(`[${tag}] ⚠️ 免费旋转失败，可能是累计金额已达提现门槛，尝试先提现自救...`);
        const rescued = tryClearWithdrawThreshold(generalAgentToken, '免费旋转自救');
        if (rescued) {
            sleep(3);
            freeSpinResult = clickSpinningTurntable(generalAgentToken);
        }
    }
    if (!freeSpinResult || !freeSpinResult.success) {
        console.error(`[${tag}] ❌ 免费旋转失败（自救后仍失败），本轮提前结束`);
        return { success: false, step: 'freeSpin', roundIndex };
    }
    console.log(`[${tag}] ✅ 免费旋转成功，金额: ${freeSpinResult.prizeAmount}`);

    // 3. 获取邀请码
    console.log(`\n[${tag}] 步骤3: 获取邀请码...`);
    const shareLinkResult = clickShareLink(generalAgentToken);
    if (!shareLinkResult || !shareLinkResult.success) {
        console.error(`[${tag}] ❌ 获取邀请码失败`);
        return { success: false, step: 'getInviteCode', roundIndex };
    }
    const inviteCode = shareLinkResult.inviteCode;
    console.log(`[${tag}] ✅ 获取邀请码成功: ${inviteCode}`);

    // 4. 按轮次号选策略：(roundIndex-1)%3 == 0→A(1/4/7), 1→B(2/5/8), 2→C(3/6/9)
    const strategyIndex = (roundIndex - 1) % 3;
    const strategyLabel = strategyIndex === 0 ? 'A' : (strategyIndex === 1 ? 'B' : 'C');
    console.log(`\n[${tag}] 步骤4: 本轮策略 = ${strategyLabel}`);
    let strategyResult;
    if (strategyIndex === 0) {
        strategyResult = runStrategyA(generalAgentToken, inviteCode, data, adminToken, config);
    } else if (strategyIndex === 1) {
        strategyResult = runStrategyB(generalAgentToken, inviteCode, data, adminToken, config);
    } else {
        strategyResult = runStrategyC(generalAgentToken, inviteCode, data, adminToken, config);
    }

    // 5. 等待5秒，查转盘金额
    console.log(`\n[${tag}] 步骤5: 等待5秒，确保状态更新...`);
    sleep(5);

    console.log(`\n[${tag}] 步骤6: 获取转盘总金额...`);
    const wheelInfoResult = getUserInvitedWheelInfo(generalAgentToken);
    if (!wheelInfoResult || !wheelInfoResult.success) {
        console.error(`[${tag}] ❌ 获取转盘信息失败`);
        return { success: false, step: 'getWheelInfo', roundIndex, strategyResult };
    }

    const totalPrizeAmount = wheelInfoResult.totalPrizeAmount;
    const userWheelAmount = wheelInfoResult.userWheelAmount;
    console.log(`[${tag}] 转盘总金额: ${totalPrizeAmount}, 已旋转金额: ${userWheelAmount}`);

    const canWithdraw = (totalPrizeAmount === userWheelAmount);
    console.log(`[${tag}] 是否满足提现条件: ${canWithdraw ? '是' : '否'}`);

    let withdrawResult = { withdrawn: false };
    if (canWithdraw && totalPrizeAmount > 0) {
        console.log(`\n[${tag}] 步骤7: 提现...`);
        const wr = clickWheelWithdraw(totalPrizeAmount, generalAgentToken);
        withdrawResult = { withdrawn: !!(wr && wr.success), amount: totalPrizeAmount };
        console.log(`[${tag}] 提现结果: ${withdrawResult.withdrawn ? '✅ 成功' : '❌ 失败'}`);
    } else {
        console.log(`[${tag}] 跳过提现（未满足条件或金额为0） —— 本轮故意用不对等旋转次数测试，这是预期中的观察点`);
    }

    // 6. 第3轮专属：总代自充值 + 自投注
    let selfActionResult = null;
    if (roundIndex === 3) {
        selfActionResult = selfRechargeAndBet(generalAgentToken, adminToken, generalAgentUserId, config);
    }

    console.log(`\n[${tag}] 第 ${roundIndex} 轮完成！`);
    return {
        success: true,
        roundIndex,
        strategyResult,
        totalPrizeAmount,
        userWheelAmount,
        canWithdraw,
        withdrawResult,
        selfActionResult
    };
}

// ============================================================
// 总代主流程（单总代，循环 wheelNumber 轮）
// ============================================================

function runGeneralAgentFlowManualSpin(data, config) {
    console.log(`\n${'#'.repeat(100)}`);
    console.log(`[${tag}] 开始处理总代（手动旋转验证）`);
    console.log(`${'#'.repeat(100)}\n`);

    const registerResult = registerGeneralAgent(data, config);
    if (!registerResult.success) {
        console.error(`[${tag}] ❌ 总代注册失败`);
        return { success: false, step: 'register' };
    }
    const { account, token } = registerResult;
    console.log(`[${tag}] ✅ 总代注册成功: ${account}`);

    const userInfo = getFrontUserInfo(token);
    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] ❌ 获取总代用户信息失败`);
        return { success: false, step: 'getUserInfo' };
    }
    const userId = userInfo.userId;
    console.log(`[${tag}] ✅ 总代信息: userId=${userId}`);

    const roundResults = [];
    for (let round = 1; round <= config.wheelNumber; round++) {
        const roundResult = runSingleRoundManualSpin(token, userId, data.token, data, config, round);
        roundResults.push(roundResult);

        if (!roundResult.success) {
            // 2026-11-07：单轮失败(比如被金额门槛卡住、免费旋转自救也没成功)只
            // 记录不终止整体流程——9轮压力测试要收集每一轮的真实表现，不该因为
            // 中间一次卡住就放弃剩余轮次
            console.error(`[${tag}] ❌ 第 ${round} 轮失败(${roundResult.step})，记录后继续下一轮`);
        }

        if (round < config.wheelNumber) {
            console.log(`\n[${tag}] 等待5秒后开始下一轮...`);
            sleep(5);
        }
    }

    console.log(`\n[${tag}] 总代完成！账号: ${account}, 完成轮次: ${roundResults.filter(r => r.success).length}/${config.wheelNumber}`);

    return { success: true, account, userId, roundResults };
}

// ============================================================
// Setup / Default
// ============================================================

export function setup() {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 邀请转盘手动旋转验证测试 - 初始化`);
    console.log(`${'='.repeat(100)}\n`);

    const config = getConfig();

    console.log(`[${tag}] 配置信息:`);
    console.log(`  - 租户ID: ${config.tenantId}`);
    console.log(`  - 语言: ${config.language}`);
    console.log(`  - 轮次数量: ${config.wheelNumber}（1/4/7策略A, 2/5/8策略B, 3/6/9策略C）`);
    console.log(`  - 下级数量范围: ${config.subMinNumber}-${config.subMaxNumber}`);
    console.log(`  - 下级充值金额范围: ${config.minMoney}-${config.maxMoney}`);
    console.log(`  - 总代自充值范围: ${config.selfRechargeMin}-${config.selfRechargeMax}（仅第3轮）`);
    console.log(`  - 总代自投注范围: ${config.selfBetMin}-${config.selfBetMax}（仅第3轮）`);

    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, config.envConfig);
        console.log(`[${tag}] ✅ 已更新 ENV_CONFIG 为租户 ${config.tenantId} 的配置`);
    }

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

export default function (data) {
    const config = data.config;

    if (config.tenantId !== '3004') {
        Object.assign(ENV_CONFIG, data.envConfig);
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 开始邀请转盘手动旋转验证测试`);
    console.log(`${'='.repeat(100)}\n`);

    const result = runGeneralAgentFlowManualSpin(data, config);

    console.log(`\n${'='.repeat(100)}`);
    console.log(`[${tag}] 邀请转盘手动旋转验证测试完成`);
    console.log(`${'='.repeat(100)}`);

    if (!result.success) {
        console.error(`[${tag}] ❌ 流程失败: ${result.step || 'unknown'}`);
        console.log(`\n[${tag}] 测试结束`);
        return;
    }

    console.log(`\n[${tag}] ========== 汇总报告 ==========`);
    result.roundResults.forEach(r => {
        if (!r.success) {
            console.log(`[${tag}] 第${r.roundIndex || '?'}轮: ❌ 失败 step=${r.step}`);
            return;
        }
        const sr = r.strategyResult;
        let line = `[${tag}] 第${r.roundIndex}轮(策略${sr.strategy}): 下级${sr.subSuccessCount}/${sr.subCount}成功, 旋转${sr.spinSuccessCount}/${sr.totalSpinAttempts}成功, 转盘总额=${r.totalPrizeAmount}, 已旋转=${r.userWheelAmount}, 提现=${r.withdrawResult.withdrawn ? '是' : '否'}`;
        if (r.selfActionResult) {
            line += `, 自充值=${r.selfActionResult.rechargeSuccess ? '成功' : '失败'}(${r.selfActionResult.rechargeAmount}), 自投注=${r.selfActionResult.betSuccess ? '成功' : '失败'}(${r.selfActionResult.betAmount})`;
        }
        console.log(line);
    });

    console.log(`\n[${tag}] 测试结束`);
}
