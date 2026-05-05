/**
 * 渠道邀请下级服务
 *
 * 核心逻辑：
 *   1. 总代注册成功后，用固定 URL（ar-cfdeploy.club）邀请下级
 *   2. 下级注册：40% 普通注册，60% 带埋点注册（和总代相同的 eventConfigId/pixelId）
 *   3. 下级行为分层：
 *      - 90% 充值（随机 1~3 次）
 *        - 充值成功的 80% 投注（随机 1~2 次）
 *        - 充值成功的 60% 提现（按余额区间）
 *      - 10% 不做任何操作
 *   4. 打印团队报表
 *
 * 邀请码模式（INVITE_CODE_MODE）：
 *   1 → 上级 inviteCode 原样
 *   2 → 上级 inviteCode 去掉最后一位补 W
 *   3 → 上级 userId 字符串
 *   mix → 50% 模式1 / 30% 模式2 / 20% 模式3
 */

import { sleep } from 'k6';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { sendToGetVerCode } from '../login/SendVerifiyCode.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
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

// 下级注册固定 URL（三个渠道共用）
const CHANNEL_INVITE_BASE_URL = 'https://ar-cfdeploy.club';

// ============================================================
// 工具函数
// ============================================================

/**
 * 按层级递减随机分配人数（复用 multiLevelRebate 的逻辑）
 */
export function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }

    const weights = [];
    for (let i = 0; i < levels; i++) {
        const base = (levels - i) / levels;
        weights.push(base * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));

    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

/**
 * 根据 INVITE_CODE_MODE 计算实际使用的邀请标识
 */
function resolveInviteIdentifier(parentInviteCode, parentUserId) {
    const mode = (__ENV.INVITE_CODE_MODE || '1');
    let effectiveMode;

    if (mode === 'mix') {
        const r = Math.random();
        effectiveMode = r < 0.5 ? '1' : r < 0.8 ? '2' : '3';
    } else {
        effectiveMode = mode;
    }

    if (effectiveMode === '3' && parentUserId) {
        return { identifier: String(parentUserId), modeLabel: '模式3(userId)' };
    }
    if (effectiveMode === '2') {
        const converted = parentInviteCode.slice(0, -1) + 'W';
        return { identifier: converted, modeLabel: `模式2(转盘:${converted})` };
    }
    return { identifier: parentInviteCode, modeLabel: '模式1(inviteCode)' };
}

/**
 * 提现金额计算
 */
function calcWithdrawAmount(balance) {
    if (balance <= 300)   return 0;
    if (balance <= 1000)  return Math.floor(balance * 0.3);
    if (balance <= 10000) return Math.floor(balance * 0.1);
    return Math.floor(200 + Math.random() * 4800);
}

// ============================================================
// 注册函数
// ============================================================

/**
 * 注册单个下级（走 ar-cfdeploy.club）
 *
 * @param {string} userName       - 手机号
 * @param {string} inviteIdentifier - 邀请标识（inviteCode / userId / 转盘码）
 * @param {string} adminToken     - 后台 token（用于获取验证码）
 * @param {object} embedOptions   - 埋点参数（null 表示普通注册）
 *   { pixelId, eventConfigId, eventType, packageName }
 * @param {string} countryCode    - 区号
 * @returns {object|null} { token, userId, account, isEmbed }
 */
function registerSubUser(userName, inviteIdentifier, adminToken, embedOptions, countryCode) {
    const isEmbed = embedOptions !== null;

    // 1. 发送验证码（走 ar-cfdeploy.club）
    const verifyCode = sendToGetVerCode(1, 1, userName, adminToken, CHANNEL_INVITE_BASE_URL);
    if (!verifyCode) {
        console.error(`[ChannelInvite] 获取验证码失败: ${userName}`);
        return null;
    }

    const codeStr   = String(verifyCode).trim();
    const timeData  = getTimeRandom();
    const deviceId  = generateCryptoRandomString(16);
    const browserId = generateCryptoRandomString(32);
    const api       = '/api/Home/Register';

    // 2. 组装 payload
    const payload = {
        loginType:   'Mobile',
        userName:    userName,
        password:    'qwer1234',
        inviteCode:  inviteIdentifier,
        code:        codeStr,
        captchaId:   null,
        deviceId:    deviceId,
        browserId:   browserId,
        packageName: isEmbed ? embedOptions.packageName : '',
        language:    'en',
        random:      timeData.random,
        signature:   '',
        timestamp:   timeData.timestamp
    };

    // 埋点注册：加入 eventIdentity
    if (isEmbed) {
        const eventIdentityInfo = JSON.stringify({
            PixelId:        embedOptions.pixelId,
            Fbp:            embedOptions.fbp || '',
            Fbc:            '',
            Ttclid:         '',
            Ttcsid:         '',
            AdjustDeviceId: ''
        });
        payload.eventIdentity = [{
            eventConfigId:     embedOptions.eventConfigId,
            eventType:         embedOptions.eventType,
            eventIdentityInfo: eventIdentityInfo
        }];
    }

    // 3. 签名
    const signPayload = {
        loginType:   'Mobile',
        userName:    userName,
        password:    'qwer1234',
        inviteCode:  inviteIdentifier,
        code:        codeStr,
        captchaId:   null,
        deviceId:    deviceId,
        browserId:   browserId,
        packageName: payload.packageName,
        language:    'en',
        random:      timeData.random
    };
    const signClient   = new httpClient.constructor();
    const signedParams = signClient.signData(signPayload);
    payload.signature  = signedParams.signature;
    payload.timestamp  = signedParams.timestamp;

    // 4. 发送请求（走 ar-cfdeploy.club）
    const fullUrl      = CHANNEL_INVITE_BASE_URL + api;
    const httpResponse = httpClient.post(api, payload, { fullUrl, sign: false }, true);

    if (!httpResponse || !httpResponse.body) {
        console.error(`[ChannelInvite] 注册无响应: ${userName}`);
        return null;
    }

    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string'
            ? JSON.parse(httpResponse.body)
            : httpResponse.body;
    } catch (e) {
        console.error(`[ChannelInvite] 解析响应失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode !== 0) {
        console.error(`[ChannelInvite] 注册失败: code=${statusCode}, msg=${parsedBody.msg}`);
        return null;
    }

    const token  = parsedBody.data?.token;
    const userId = parsedBody.data?.userId;

    if (!token || !userId) {
        console.error(`[ChannelInvite] 注册响应缺少 token/userId`);
        return null;
    }

    return { token, userId, account: userName, isEmbed };
}

// ============================================================
// 行为执行
// ============================================================

/**
 * 执行充值（随机 1~3 次）
 */
function doRecharge(userToken, userId, adminToken) {
    const rand  = Math.random();
    const count = rand < 0.6 ? 1 : rand < 0.9 ? 2 : 3;
    let totalAmount = 0;
    let success = false;

    for (let i = 0; i < count; i++) {
        if (i > 0) sleep(2);
        const label  = ['首充', '二充', '三充'][i];
        const amount = getConfigRechargeAmount();
        const result = hybridRecharge({ userToken, adminToken, userId, amount, frontendFirst: true, remark: `Channel-${label}` });
        if (result.success) {
            success = true;
            totalAmount += result.amount;
            console.log(`[ChannelInvite] ✅ ${label}成功: ${amount}`);
        } else {
            console.error(`[ChannelInvite] ❌ ${label}失败`);
            break;
        }
    }
    return { success, totalAmount, count };
}

/**
 * 执行投注（随机 1~2 次）
 */
function doBet(userToken, account) {
    const count = Math.random() < 0.5 ? 1 : 2;
    let totalAmount = 0;
    let successCount = 0;

    for (let b = 0; b < count; b++) {
        if (b > 0) sleep(3);
        const result = betRun(userToken, account);
        if (result) {
            successCount++;
            totalAmount += result.amount || 0;
        }
    }
    return { successCount, totalAmount, count };
}

/**
 * 执行提现
 */
function doWithdraw(userToken, userId, adminToken, enableBackendApproval) {
    const balanceInfo = getAccountBalance(userToken);
    if (!balanceInfo) return { success: false, amount: 0, reason: '获取余额失败' };

    const balance        = balanceInfo.balance || 0;
    const withdrawAmount = calcWithdrawAmount(balance);
    if (withdrawAmount <= 0) return { success: false, amount: 0, reason: `余额${balance}不足` };

    addAllWallets(adminToken, userId);
    sleep(1);

    const pwdRes = setWithdrawPassword(userToken, '123456');
    if (!pwdRes || (pwdRes.msgCode !== 0 && pwdRes.msgCode !== undefined)) {
        console.warn('[ChannelInvite] 设置提现密码可能失败，继续尝试');
    }

    const withdrawInfo = getWithdrawBasicInfo(userToken);
    if (!withdrawInfo) return { success: false, amount: 0, reason: '获取提现信息失败' };
    if (withdrawInfo.userTodayWithdrawCount === 0) return { success: false, amount: 0, reason: '今日提现次数为0' };
    if (withdrawInfo.amountCoding !== 0) return { success: false, amount: 0, reason: `打码量未完成(${withdrawInfo.amountCoding})` };

    const categoryList = (withdrawInfo.withdrawCategoryList || []).filter(c => c.withdrawType !== 'UPI');
    if (categoryList.length === 0) return { success: false, amount: 0, reason: '无可用通道' };

    const category     = categoryList[Math.floor(Math.random() * categoryList.length)];
    const withdrawType = category.withdrawType;
    const withdrawId   = category.id;

    const walletId = getUserWithdrawWallet(userToken, withdrawType);
    if (!walletId) return { success: false, amount: 0, reason: '获取钱包ID失败' };

    const applyResult = withdrawApply(userToken, withdrawAmount, walletId, withdrawId, withdrawType, '123456');
    if (!applyResult) return { success: false, amount: 0, reason: '提现申请失败' };

    if (enableBackendApproval) {
        sleep(2);
        runBackendWithdrawApproval(adminToken, userId, withdrawType, withdrawAmount);
    }

    return { success: true, amount: withdrawAmount, reason: '成功' };
}

// ============================================================
// 主入口：构建团队
// ============================================================

/**
 * 构建渠道团队（总代已注册，邀请下级并执行行为）
 *
 * @param {object} rootInfo       - 总代信息 { token, userId, inviteCode, account }
 * @param {object} adminData      - { token: adminToken }
 * @param {object} embedOptions   - 埋点参数 { pixelId, eventConfigId, eventType, packageName }
 * @param {object} envConfig      - 租户环境配置
 * @param {object} options        - 行为开关
 *   - totalPeople:          总人数（默认50）
 *   - levels:               层级数（默认4）
 *   - embedRate:            埋点注册比例（默认0.6）
 *   - rechargeRate:         充值比例（默认0.9）
 *   - betRate:              投注比例（充值成功中，默认0.8）
 *   - withdrawRate:         提现比例（充值成功中，默认0.6）
 *   - enableBackendApproval: 是否后台审核提现（默认false）
 * @returns {Array} 团队成员报表数据
 */
export function buildChannelTeam(rootInfo, adminData, embedOptions, envConfig, options = {}) {
    const {
        totalPeople          = 50,
        levels               = 4,
        embedRate            = 0.6,
        rechargeRate         = 0.9,
        betRate              = 0.8,
        withdrawRate         = 0.6,
        enableBackendApproval = false
    } = options;

    const countryCode = envConfig.COUNTRY_CODE || '91';
    const distribution = distributePeople(totalPeople, levels);

    console.log(`\n[ChannelInvite] ========== 开始构建渠道团队 ==========`);
    console.log(`[ChannelInvite] 总代: ${rootInfo.userId} (${rootInfo.account})`);
    console.log(`[ChannelInvite] 总人数: ${totalPeople} | 层级: ${levels} | 分配: ${distribution.join('->')}`);
    console.log(`[ChannelInvite] 埋点比例: ${(embedRate*100).toFixed(0)}% | 充值: ${(rechargeRate*100).toFixed(0)}% | 投注: ${(betRate*100).toFixed(0)}% | 提现: ${(withdrawRate*100).toFixed(0)}%`);

    // 报表数据
    const report = [];

    // 层级队列：每层存 [{ inviteCode, userId }]
    let currentLayer = [{ inviteCode: rootInfo.inviteCode, userId: rootInfo.userId }];

    for (let levelIdx = 0; levelIdx < distribution.length; levelIdx++) {
        const count     = distribution[levelIdx];
        const levelLabel = `L${levelIdx + 1}`;
        const nextLayer  = [];

        console.log(`\n[ChannelInvite] === ${levelLabel} 层：注册 ${count} 人 ===`);

        for (let i = 0; i < count; i++) {
            sleep(1);

            // 随机选一个上级
            const parent = currentLayer[Math.floor(Math.random() * currentLayer.length)];
            const { identifier, modeLabel } = resolveInviteIdentifier(parent.inviteCode, parent.userId);

            // 决定是否带埋点
            const isEmbed = Math.random() < embedRate;
            const embed   = isEmbed ? embedOptions : null;

            const userName = generateRandomPhone(countryCode);
            console.log(`[ChannelInvite] [${levelLabel}][${i+1}/${count}] 注册: ${userName} | ${modeLabel} | ${isEmbed ? '埋点' : '普通'}`);

            const userInfo = registerSubUser(userName, identifier, adminData.token, embed, countryCode);

            const record = {
                level:         levelLabel,
                account:       userName,
                userId:        userInfo ? userInfo.userId : null,
                isEmbed:       isEmbed,
                registerOk:    !!userInfo,
                rechargeAmt:   0,
                rechargeTimes: 0,
                betAmt:        0,
                betTimes:      0,
                withdrawAmt:   0,
                withdrawStatus: '未执行'
            };

            if (!userInfo) {
                record.withdrawStatus = '注册失败';
                report.push(record);
                continue;
            }

            // 保存到下一层父级列表
            sleep(1);
            const frontInfo = getFrontUserInfo(userInfo.token);
            const inviteCode = frontInfo ? frontInfo.inviteCode : null;
            nextLayer.push({ inviteCode: inviteCode || String(userInfo.userId), userId: userInfo.userId });

            // ── 行为分层 ──────────────────────────────────────
            const doRechargeFlag = Math.random() < rechargeRate;

            if (!doRechargeFlag) {
                record.withdrawStatus = '不活跃';
                report.push(record);
                continue;
            }

            // 充值
            sleep(2);
            const rechargeResult = doRecharge(userInfo.token, userInfo.userId, adminData.token);
            record.rechargeAmt   = rechargeResult.totalAmount;
            record.rechargeTimes = rechargeResult.count;

            if (!rechargeResult.success) {
                record.withdrawStatus = '充值失败';
                report.push(record);
                continue;
            }

            // 投注
            if (Math.random() < betRate) {
                sleep(2);
                const betResult  = doBet(userInfo.token, userName);
                record.betAmt    = betResult.totalAmount;
                record.betTimes  = betResult.successCount;
            }

            // 提现
            if (Math.random() < withdrawRate) {
                sleep(2);
                const wResult          = doWithdraw(userInfo.token, userInfo.userId, adminData.token, enableBackendApproval);
                record.withdrawAmt     = wResult.amount;
                record.withdrawStatus  = wResult.success ? '✅成功' : `❌${wResult.reason}`;
            } else {
                record.withdrawStatus = '跳过';
            }

            report.push(record);
        }

        currentLayer = nextLayer.length > 0 ? nextLayer : currentLayer;
    }

    return report;
}

// ============================================================
// 报表打印
// ============================================================

/**
 * 打印团队报表
 */
export function printTeamReport(rootInfo, report, startDate) {
    const total       = report.length;
    const regOk       = report.filter(r => r.registerOk).length;
    const embedCount  = report.filter(r => r.isEmbed).length;
    const rechargeOk  = report.filter(r => r.rechargeAmt > 0).length;
    const betOk       = report.filter(r => r.betTimes > 0).length;
    const withdrawOk  = report.filter(r => r.withdrawStatus === '✅成功').length;
    const totalRecharge  = report.reduce((s, r) => s + r.rechargeAmt, 0);
    const totalBet       = report.reduce((s, r) => s + r.betAmt, 0);
    const totalWithdraw  = report.reduce((s, r) => s + r.withdrawAmt, 0);

    // 辅助：中文字符按2位计算显示宽度
    const dispW = (s) => [...String(s)].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
    const padW  = (s, n) => { const w = dispW(s); return String(s) + ' '.repeat(Math.max(0, n - w)); };

    // 列定义
    const cols = [
        { label: '层级',   key: 'level',          width: 4  },
        { label: 'userId', key: 'userId',          width: 10 },
        { label: '账号',   key: 'account',         width: 14 },
        { label: '埋点',   key: '_embed',          width: 4  },
        { label: '充值额', key: 'rechargeAmt',     width: 10 },
        { label: '充次',   key: 'rechargeTimes',   width: 4  },
        { label: '投注额', key: 'betAmt',          width: 10 },
        { label: '投次',   key: 'betTimes',        width: 4  },
        { label: '提现额', key: 'withdrawAmt',     width: 10 },
        { label: '提现状态', key: 'withdrawStatus', width: 10 }
    ];

    // 动态调整列宽
    report.forEach(r => {
        r._embed = r.isEmbed ? '✅' : '❌';
        cols.forEach(col => {
            const w = dispW(String(r[col.key] ?? ''));
            if (w + 1 > col.width) col.width = w + 1;
        });
    });

    const sep = '+' + cols.map(c => '-'.repeat(c.width + 2)).join('+') + '+';

    console.log(`\n${'═'.repeat(sep.length)}`);
    console.log(`  📊 渠道团队报表 | 总代: ${rootInfo.userId}(${rootInfo.account}) | ${startDate || new Date().toISOString().slice(0,10)}`);
    console.log(`${'═'.repeat(sep.length)}`);
    console.log(sep);
    console.log('|' + cols.map(c => ' ' + padW(c.label, c.width) + ' ').join('|') + '|');
    console.log(sep);

    // 按层级分组打印
    const layers = [...new Set(report.map(r => r.level))];
    layers.forEach(lv => {
        const rows = report.filter(r => r.level === lv);
        rows.forEach(r => {
            console.log('|' + cols.map(c => ' ' + padW(r[c.key] ?? '', c.width) + ' ').join('|') + '|');
        });
        // 层级小计
        const lvRecharge = rows.reduce((s, r) => s + r.rechargeAmt, 0);
        const lvBet      = rows.reduce((s, r) => s + r.betAmt, 0);
        const lvWithdraw = rows.reduce((s, r) => s + r.withdrawAmt, 0);
        console.log(`|${' '.repeat(sep.length - 2)}|`);
        console.log(`  ${lv}小计: ${rows.length}人 | 充值:${lvRecharge.toFixed(2)} | 投注:${lvBet.toFixed(2)} | 提现:${lvWithdraw.toFixed(2)}`);
        console.log(sep);
    });

    // 汇总
    console.log(`\n${'─'.repeat(sep.length)}`);
    console.log(`  📈 团队汇总`);
    console.log(`  总人数: ${total} | 注册成功: ${regOk} | 埋点注册: ${embedCount}(${((embedCount/total)*100).toFixed(0)}%)`);
    console.log(`  充值: ${rechargeOk}人 / 总额: ${totalRecharge.toFixed(2)}`);
    console.log(`  投注: ${betOk}人 / 总额: ${totalBet.toFixed(2)}`);
    console.log(`  提现: ${withdrawOk}人 / 总额: ${totalWithdraw.toFixed(2)}`);
    console.log(`${'═'.repeat(sep.length)}\n`);
}
