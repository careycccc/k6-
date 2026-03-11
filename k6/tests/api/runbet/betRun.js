/**
 * 投注主流程模块
 * 根据实际抓包重写
 * 
 * Token传递链：
 * 1. 登录token → GetGameUrl → 游戏token
 * 2. 游戏token → GetGameList → 刷新token1
 * 3. 刷新token1 → GetBalance → 刷新token2 (最终投注token)
 * 4. 使用游戏token获取期号 (token在Referer中)
 * 5. 使用刷新token2进行投注
 */

import { getBetToken } from './betToken.js';
import { betWingo } from './bet.js';
import { isBet } from './issueNumber.js';
import { getAccountBalance } from '../balance/balance.test.js';

/**
 * 随机获取投注参数
 * @returns {object} 投注参数
 */
function getBetResult() {
    const gameCodeList = ['WinGo_5M', 'TrxWinGo_10M'];
    const gameCode = gameCodeList[Math.floor(Math.random() * gameCodeList.length)];

    const betContentList = ['Color_Green', 'Color_Violet', 'Color_Red', 'BigSmall_Big', 'BigSmall_Small'];
    const betContent = betContentList[Math.floor(Math.random() * betContentList.length)];

    const amountList = [20, 50, 100];
    const amount = amountList[Math.floor(Math.random() * amountList.length)];

    const betMultipleList = [10, 20, 50];
    const betMultiple = betMultipleList[Math.floor(Math.random() * betMultipleList.length)];

    return { gameCode, betContent, amount, betMultiple };
}

/**
 * 执行投注流程
 * @param {string} loginToken - 登录token
 * @param {string} userName - 用户名
 * @returns {boolean} 投注是否成功
 */
export function betRun(loginToken, userName = '') {
    console.log('[BetRun] ========== 开始投注流程 ==========');
    if (userName) {
        console.log('[BetRun] 用户:', userName);
    }

    if (!loginToken) {
        console.error('[BetRun] 登录token为空，无法投注');
        return false;
    }

    // 先查询账号余额
    console.log('[BetRun] 查询账号余额...');
    const balanceInfo = getAccountBalance(loginToken);
    if (!balanceInfo) {
        console.error('[BetRun] 无法获取账号余额');
        return false;
    }

    console.log('[BetRun] 账号余额:', balanceInfo.balance, balanceInfo.currency);

    if (balanceInfo.balance <= 0) {
        console.error('[BetRun] 账号余额不足，无法投注');
        return false;
    }

    // 执行投注
    return runBetFunc(loginToken, userName);
}

/**
 * 执行投注函数
 * @param {string} loginToken - 登录token
 * @param {string} userName - 用户名
 * @returns {boolean} 投注是否成功
 */
function runBetFunc(loginToken, userName) {
    console.log('[BetRun] 开始执行投注');

    // 获取随机投注参数
    const { gameCode, betContent, amount, betMultiple } = getBetResult();
    console.log('[BetRun] 投注参数:', { gameCode, betContent, amount, betMultiple });

    // 步骤1-3: 获取投注token (完整的token转换链)
    const tokenInfo = getBetToken(loginToken, gameCode);
    if (!tokenInfo || !tokenInfo.token) {
        console.error('[BetRun] 获取投注token失败');
        return false;
    }

    console.log('[BetRun] 游戏余额:', tokenInfo.balance);
    console.log('[BetRun] 游戏域名:', tokenInfo.gameBaseUrl);

    // 注意：获取期号需要使用游戏token (从GetGameUrl获取的原始token)
    // 但是我们已经经过了token刷新链，需要重新获取游戏token
    // 为了简化，我们直接使用最终的token，但Referer中需要包含token

    // 步骤4: 获取期号 (使用游戏token)
    // 这里有个问题：我们需要保存游戏token用于获取期号
    // 让我们修改getBetToken返回游戏token

    const betInfo = isBet(tokenInfo.gameToken, gameCode, tokenInfo.gameBaseUrl);
    if (!betInfo.canBet) {
        console.error('[BetRun] 当期期号不可以投注');
        return false;
    }

    console.log('[BetRun] 期号:', betInfo.issueNumber);

    // 步骤5: 执行投注 (使用最终刷新的token)
    const betResult = betWingo(gameCode, amount, betMultiple, betContent,
        betInfo.issueNumber, tokenInfo.token, tokenInfo.gameBaseUrl);

    if (betResult && betResult.code === 0 && betResult.msgCode === 0 && betResult.msg === 'Succeed') {
        console.log('[BetRun] ✅ 投注成功');
        console.log('[BetRun] ========== 投注流程完成 ==========');
        return true;
    } else {
        console.error('[BetRun] ❌ 投注失败');
        console.log('[BetRun] ========== 投注流程完成 ==========');
        return false;
    }
}
