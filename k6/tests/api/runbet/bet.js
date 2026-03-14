/**
 * 彩票投注模块
 * 根据实际抓包重写
 * 
 * 关键点：
 * 1. 使用刷新后的最新token
 * 2. 请求发送到 sit-lotteryh5.wmgametransit.com
 * 3. Referer和Origin使用游戏域名
 */

import http from 'k6/http';
import { getTimeRandom } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';

/**
 * 执行 WinGo 投注
 * @param {string} gameCode - 游戏代码 (WinGo_5M, TrxWinGo_10M)
 * @param {number} amount - 投注金额
 * @param {number} betMultiple - 投注倍率
 * @param {string} betContent - 投注内容 (Color_Green, Color_Violet, Color_Red, BigSmall_Big, BigSmall_Small)
 * @param {string} issueNumber - 期号
 * @param {string} betToken - 投注token (经过完整token链刷新后的最新token)
 * @param {string} gameBaseUrl - 游戏域名
 * @returns {object} 投注响应
 */
export function betWingo(gameCode, amount, betMultiple, betContent, issueNumber, betToken, gameBaseUrl) {
    let apiArg = '';

    switch (gameCode) {
        case 'TrxWinGo_10M':
            apiArg = 'TrxWinGoBet';
            break;
        case 'WinGo_5M':
            apiArg = 'WinGoBet';
            break;
        default:
            console.error('[Bet] 未知的游戏代码:', gameCode);
            return null;
    }

    const api = '/api/Lottery/' + apiArg;
    const lotteryBaseUrl = 'https://sit-lotteryh5.wmgametransit.com';

    const timeData = getTimeRandom();

    const payload = {
        gameCode: gameCode,
        issueNumber: issueNumber,
        amount: amount,
        betMultiple: betMultiple,
        betContent: betContent,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(payload);

    const headers = {
        'Authorization': `Bearer ${betToken}`,
        'Content-Type': 'application/problem+json; charset=UTF-8',
        'Referer': gameBaseUrl + '/',
        'Origin': gameBaseUrl,
        'Accept': 'application/json, text/plain, */*'
    };

    //console.log('[Bet] 投注请求 URL:', lotteryBaseUrl + api);
    console.log('[Bet] 投注参数:', JSON.stringify(signedData));

    const response = http.post(lotteryBaseUrl + api, JSON.stringify(signedData), { headers });

    //console.log('[Bet] 投注响应状态:', response.status);
    console.log('[Bet] 投注响应体:', response.body);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);

            if (result.code === 0 && result.msgCode === 0 && result.msg === 'Succeed') {
                console.log('[Bet] ✅ 投注成功');
                return result;
            } else {
                console.error('[Bet] 投注失败:', result.msg);
                return result;
            }
        } catch (e) {
            console.error('[Bet] 解析投注响应失败:', e.message);
            return null;
        }
    } else {
        console.error('[Bet] 投注请求失败:', response.status, response.body);
        return null;
    }
}
