/**
 * 「有效邀请」测试的造数模块：建总代 → 邀请注册下级 → 按规格充值 / 指定游戏投注 → 等结算
 *
 * 每个场景都新建一棵干净的树（自己的总代 + 自己的下级），不碰现有团队，避免污染。
 */

import { sleep } from 'k6';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { loginByPasswordRetry } from '../../common/auth.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { getAccountBalance } from '../../balance/balance.test.js';
import { getBetToken } from '../../runbet/betToken.js';
import { getNowBetNumber } from '../../runbet/issueNumber.js';
import { betWingo } from '../../runbet/bet.js';
import { tenantRequest } from '../../../../libs/http/tenantRequest.js';
import { TAG } from './api.js';

export const PASSWORD = 'qwer1234';

/**
 * 各游戏族真实可用的投注内容（取自 3004 历史注单实测）。
 * K3_*(NumSame3_111) 和 D5_*(FirstNum_0) 虽然格式对，但 K3Bet/D5Bet 的请求体结构和
 * WinGoBet 不同，betWingo 发过去一律 Param is Invalid —— 所以造数只能用下面这几个。
 */
const BET_CONTENT = { WinGo: 'BigSmall_Big', TrxWinGo: 'BigSmall_Big', LuckyWinGo: 'BigSmall_Big', MotoRace: 'FirstNum_3' };
export const BETTABLE_GAMES = ['WinGo_30S', 'WinGo_1M', 'WinGo_3M', 'WinGo_5M',
    'TrxWinGo_1M', 'TrxWinGo_3M', 'TrxWinGo_5M', 'TrxWinGo_10M', 'MotoRace_1M'];

/** ARLottery 扣 2% 税，有效投注 = 投注额 × 0.98。要让有效投注达到 t，投注额至少 t/0.98 */
export const TAX_RATE = 0.02;
export function betAmountForValid(targetValid) {
    return Math.ceil(targetValid / (1 - TAX_RATE));
}

function contentFor(gameCode) {
    return BET_CONTENT[gameCode.split('_')[0]] || 'BigSmall_Big';
}

// ---------------- 注册 ----------------

/** 建一个总代（前台注册，不带邀请码）。返回 {account, userId, inviteCode, token} */
export function createAgent(adminToken, countryCode) {
    const account = generateRandomPhone(countryCode);
    const r = phoneRegister(account, { token: adminToken }, PASSWORD);
    if (!r || !r.data) { console.error(`[${TAG}] ❌ 总代注册失败: ${account}`); return null; }
    const token = r.data.token || (r.headers && String(r.headers['Authorization'] || '').replace(/^Bearer\s+/i, ''));
    const info = (r.data.userId && r.data.inviteCode) ? r.data : getFrontUserInfo(token);
    if (!info || !info.userId || !info.inviteCode) { console.error(`[${TAG}] ❌ 总代拿不到 userId/inviteCode: ${account}`); return null; }
    console.log(`[${TAG}] ✅ 总代 ${account} userId=${info.userId} 邀请码=${info.inviteCode}`);
    return { account, userId: info.userId, inviteCode: info.inviteCode, token };
}

/**
 * 邀请注册一个下级挂到 parentInviteCode 名下。
 * 每个下级用独立 deviceId —— 否则会撞上「同设备ID不计算有效邀请」开关，把结果带偏。
 */
export function createDownline(adminToken, parentInviteCode, countryCode, tenantId) {
    const account = generateRandomPhone(countryCode);
    const env = getEnvByTenantId(tenantId) || ENV_CONFIG;
    const inviteUrl = env.INVITE_REGISTER_URL || env.BASE_DESK_URL;
    const customUrls = { frontUrl: inviteUrl, adminUrl: env.BASE_ADMIN_URL, registerUrl: inviteUrl };
    const device = generateCryptoRandomString(16);

    const r = phoneRegisterByInvite(account, parentInviteCode, { token: adminToken }, PASSWORD, '', customUrls, device);
    if (!r || !r.data) { console.error(`[${TAG}] ❌ 下级注册失败: ${account}`); return null; }
    const token = r.data.token || (r.headers && String(r.headers['Authorization'] || '').replace(/^Bearer\s+/i, ''));
    let userId = r.data.userId;
    if (!userId) { const info = getFrontUserInfo(token); userId = info && info.userId; }
    if (!userId) { console.error(`[${TAG}] ❌ 下级拿不到 userId: ${account}`); return null; }
    return { account, userId, token, device };
}

// ---------------- 充值 / 投注 ----------------

export function doRecharge(adminToken, userId, account, amount) {
    const token = loginByPasswordRetry(account, PASSWORD);
    const r = hybridRecharge({ userToken: token, adminToken, userId, amount, frontendFirst: true, remark: 'InviteCondSeed' });
    const ok = !!(r && r.success);
    console.log(`[${TAG}] ${ok ? '✅' : '❌'} 充值 ${account} 目标=${amount} 实际=${r && r.amount}`);
    return { ok, amount: r && r.amount };
}

/** 取可投注期号。不用 issueNumber.js 的 isBet（它在封盘窗口会无限递归 sleep(7)） */
function fetchIssue(gameToken, gameCode, gameBaseUrl, minLeftMs) {
    for (let i = 0; i < 4; i++) {
        const info = getNowBetNumber(gameToken, gameCode, gameBaseUrl);
        if (!info) return null;
        const left = info.endTime - Date.now();
        if (left >= minLeftMs) return info.issueNumber;
        sleep(Math.min(12, Math.ceil(left / 1000) + 2));
    }
    return null;
}

/**
 * 指定游戏下一注指定金额。betMultiple 固定 1，所以注单 betAmount 就是 amount。
 * 一分钟一期的游戏封盘窗口紧，minLeftMs 给到 20 秒，否则下注落地时该期已结算。
 */
export function doBet(account, gameCode, amount, minLeftMs = 20000) {
    const token = loginByPasswordRetry(account, PASSWORD);
    if (!token) return { ok: false, reason: '重登失败' };
    // 先确认本金够：余额不足时下注会 Balance is not enough，但那会让这条用例静默失真，
    // 不如提前拦下来并把余额写进原因，复盘时一眼看出是造数问题不是业务问题。
    const bal = getAccountBalance(token);
    if (bal && Number(bal.balance) < amount) {
        console.error(`[${TAG}] ❌ 投注前余额不足 ${account}: 余额=${bal.balance} < 投注额=${amount}`);
        return { ok: false, amount, gameCode, reason: `余额不足(${bal.balance}<${amount})` };
    }
    const ti = getBetToken(token, gameCode);
    if (!ti || !ti.token) return { ok: false, reason: `开游戏失败(${gameCode} 对本租户不可用?)` };
    const issue = fetchIssue(ti.gameToken, gameCode, ti.gameBaseUrl, minLeftMs);
    if (!issue) return { ok: false, reason: '取不到可投注期号' };
    const content = contentFor(gameCode);
    const r = betWingo(gameCode, amount, 1, content, issue, ti.token, ti.gameBaseUrl);
    const ok = !!(r && r.code === 0 && r.msgCode === 0);
    console.log(`[${TAG}] ${ok ? '✅' : '❌'} 投注 ${account} ${gameCode} ${amount} ${content}`
        + (ok ? ` 期号=${issue}` : ` 失败: ${r ? r.msg : '无响应'}`));
    return { ok, issue, content, amount, gameCode, reason: ok ? '' : (r ? r.msg : '无响应') };
}

/**
 * 按规格造一个下级：注册 → 充值 → 逐笔投注。
 * @param {object} spec {label, recharge, bets:[{game, amount}]}
 */
export function seedDownline(adminToken, parentInviteCode, spec, countryCode, tenantId) {
    const d = createDownline(adminToken, parentInviteCode, countryCode, tenantId);
    if (!d) return null;
    console.log(`[${TAG}] --- 下级 ${spec.label}: ${d.account} userId=${d.userId} ---`);
    const out = Object.assign({ label: spec.label, spec, rechargeOk: true, bets: [] }, d);

    if (spec.recharge > 0) {
        const r = doRecharge(adminToken, d.userId, d.account, spec.recharge);
        out.rechargeOk = r.ok;
        out.rechargeAmount = r.amount;
        sleep(3);
    }
    for (const b of (spec.bets || [])) {
        const r = doBet(d.account, b.game, b.amount);
        out.bets.push(r);
        sleep(2);
    }
    return out;
}

// ---------------- 等结算 ----------------

/**
 * 轮询到这些会员的注单全部结算为止。
 * 有效投注(validAmount)在结算前恒为 0，不等结算就查 isOkInvite 必然得到错误结论。
 */
export function waitAllSettled(adminToken, userIds, sinceMs, maxWaitSec = 600, pollSec = 20) {
    const deadline = Date.now() + maxWaitSec * 1000;
    while (Date.now() < deadline) {
        let unsettled = 0, total = 0;
        for (const userId of userIds) {
            const r = tenantRequest('/api/ThirdGame/GetBetRecordPageList', {
                categoryType: 3, queryTimeType: 'BetTime', userId,
                beginTimeUnix: sinceMs, endTimeUnix: Date.now(),
                pageNo: 1, pageSize: 200, orderBy: 'Desc', sortField: 'BetTime'
            }, { token: adminToken, isDesk: false });
            const list = (r && r.data && r.data.list) || [];
            total += list.length;
            unsettled += list.filter(o => Number(o.orderState) !== 1).length;
            sleep(0.3);
        }
        if (unsettled === 0) {
            console.log(`[${TAG}] ✅ 注单全部结算（共 ${total} 单）`);
            return true;
        }
        console.log(`[${TAG}] ⏳ 等结算：${unsettled}/${total} 单未结算，${pollSec}s 后重查`);
        sleep(pollSec);
    }
    console.warn(`[${TAG}] ⚠️ 等结算超时（${maxWaitSec}s），后续有效投注可能偏小`);
    return false;
}
