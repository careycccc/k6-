/**
 * 投注组装器 —— 固定金额投注
 *
 * 项目没有维护一份共享导出的 betFixed，现有4个脚本(inviteWheelRetention.day.js、
 * inviteDownlineCases.test.js、runSameDeviceInviteTwoWays.test.js、
 * agentFullNotifyFlow.test.js)各自私有拷贝了一份逻辑完全一致的实现——这里
 * 照同样的模式再拷贝一份，不引入新设计。
 */

import { getBetToken } from '../runbet/betToken.js';
import { betWingo } from '../runbet/bet.js';
import { isBet } from '../runbet/issueNumber.js';
import { getAccountBalance } from '../balance/balance.test.js';

const GAMES = ['WinGo_5M', 'WinGo_30S', 'TrxWinGo_10M'];
const CONTENTS = ['BigSmall_Big', 'BigSmall_Small', 'Color_Green', 'Color_Red'];

/**
 * 固定金额投注一笔，总额 = unit × multiple。多游戏重试，isBet 内部不可投注时
 * 会自己 sleep(7) 重试，调用方不用额外等待。
 * @param {string} loginToken
 * @param {number} unit
 * @param {number} multiple
 * @param {string} userName - 仅用于日志
 * @returns {{amount:number, gameCode:string}|false}
 */
export function betFixed(loginToken, unit, multiple, userName) {
    if (!loginToken) return false;
    const target = unit * multiple;

    const balanceInfo = getAccountBalance(loginToken);
    if (!balanceInfo || balanceInfo.balance < target) {
        console.error(`[BetAssembler] 投注前余额不足(${balanceInfo ? balanceInfo.balance : 'N/A'} < ${target}): ${userName}`);
        return false;
    }

    for (const gameCode of GAMES) {
        const tokenInfo = getBetToken(loginToken, gameCode);
        if (!tokenInfo || !tokenInfo.token) continue;

        const betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
        if (!betInfo || !betInfo.canBet) continue;

        const betContent = CONTENTS[Math.floor(Math.random() * CONTENTS.length)];
        const r = betWingo(gameCode, unit, multiple, betContent, betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);
        if (r && r.code === 0 && r.msgCode === 0 && r.msg === 'Succeed') {
            console.log(`[BetAssembler] ✅ 投注成功 ${userName}: ${gameCode} ${betContent} 金额=${target}`);
            return { amount: target, gameCode };
        }
    }
    console.warn(`[BetAssembler] 所有游戏均投注失败: ${userName}`);
    return false;
}
