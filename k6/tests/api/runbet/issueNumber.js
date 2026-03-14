/**
 * 期号获取模块
 * 根据实际抓包重写
 * 
 * 关键点：获取期号时，token在URL的Referer中，不在Authorization头中
 */

import http from 'k6/http';
import { sleep } from 'k6';

/**
 * 获取当前期号
 * @param {string} gameToken - 游戏token (从GetGameUrl响应中获取)
 * @param {string} gameCode - 游戏代码 (如 TrxWinGo_10M)
 * @param {string} gameBaseUrl - 游戏域名
 * @returns {object} 期号信息
 */
export function getNowBetNumber(gameToken, gameCode, gameBaseUrl) {
    const api = '/webapi/kv/issue/' + gameCode;

    // 构建完整的Referer URL (包含token)
    const refererUrl = `${gameBaseUrl}/TrxWinGo/${gameCode}?Lang=en&Skin=Classic&SkinColor=Default&Token=${encodeURIComponent(gameToken)}&RedirectUrl=https%3A%2F%2Farplatsaassit4.club%2Fgame%2FallGames%3FcategoryCode%3DC202505280608510046&vendorCode=ARLottery&Beck=0`;

    const headers = {
        'Referer': refererUrl,
        'Accept': 'application/json, text/plain, */*'
    };

    //console.log('[IssueNumber] 请求期号 URL:', gameBaseUrl + api);

    const response = http.get(gameBaseUrl + api, { headers });

    //console.log('[IssueNumber] 期号响应状态:', response.status);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            if (result.code === 0 && result.data) {
                console.log('[IssueNumber] ✅ 期号获取成功:', result.data.issueNumber);
                return {
                    startTime: result.data.startTime,
                    endTime: result.data.endTime,
                    issueNumber: result.data.issueNumber,
                    intervalMinute: result.data.intervalMinute
                };
            } else {
                console.error('[IssueNumber] 获取期号失败:', result.msg);
                return null;
            }
        } catch (e) {
            console.error('[IssueNumber] 解析期号响应失败:', e.message);
            return null;
        }
    } else {
        console.error('[IssueNumber] 获取期号请求失败:', response.status);
        return null;
    }
}

/**
 * 判断是否可以下注
 * @param {string} gameToken - 游戏token
 * @param {string} gameCode - 游戏代码
 * @param {string} gameBaseUrl - 游戏域名
 * @returns {{canBet: boolean, issueNumber: string}} 是否可以下注和期号
 */
export function isBet(gameToken, gameCode, gameBaseUrl) {
    const nowBetNumber = getNowBetNumber(gameToken, gameCode, gameBaseUrl);

    if (!nowBetNumber) {
        console.error('[IssueNumber] 无法获取期号');
        return { canBet: false, issueNumber: '-1' };
    }

    const endTime = nowBetNumber.endTime;
    const issueNumber = nowBetNumber.issueNumber;

    // 获取当前时间戳（毫秒）
    const now = new Date().getTime();

    // 结束时间 - 当前时间 >= 7000ms（7秒）
    if (endTime - now >= 7000) {
        console.log('[IssueNumber] 可以投注，期号:', issueNumber);
        return { canBet: true, issueNumber: issueNumber };
    } else {
        console.log('[IssueNumber] 不可以投注，等待 7 秒后重试');
        sleep(7);
        return isBet(gameToken, gameCode, gameBaseUrl);
    }
}
