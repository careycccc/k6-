/**
 * 彩票投注 Token 获取模块
 * 根据实际抓包分析重写
 * 
 * Token传递链：
 * 1. 登录token → GetGameUrl → 获得游戏token (在响应URL中)
 * 2. 游戏token → GetGameList → 获得刷新token (在响应Authorization头中)
 * 3. 刷新token → GetBalance → 获得新刷新token
 * 4. 最新token → 投注
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

/**
 * 步骤1: 获取游戏token
 * @param {string} loginToken - 登录token
 * @param {string} gameCode - 游戏代码
 * @returns {object} {gameToken, gameBaseUrl}
 */
export function getGameToken(loginToken, gameCode) {
    console.log('[BetToken] 步骤1: 获取游戏token');

    const tenantIdStr = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    const currentEnv = getEnvByTenantId(tenantIdStr);
    const baseUrl = currentEnv.BASE_DESK_URL;
    const api = '/api/ThirdGame/GetGameUrl';

    console.log(`[BetToken] 租户: ${tenantIdStr} | 前台地址: ${baseUrl}`);

    const timeData = getTimeRandom();
    const deviceTypeId = generateCryptoRandomString(32);
    const returnUrl = `${baseUrl}/game/allGames?categoryCode=C202505280608510046&vendorCode=ARLottery`;

    const payload = {
        gameCode: gameCode,
        vendorCode: 'ARLottery',
        gameId: 10304,
        returnUrl: returnUrl,
        deviceType: 'PC',
        deviceTypeId: deviceTypeId,
        language: 'en', // 强制使用 en，避免第三方游戏因不支持小语种（如 ur/bn）报错 "Game requires recharge to enter"
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(payload);

    const headers = {
        'Content-Type': 'application/json',
        'Referer': baseUrl,
        'Origin': baseUrl,
        'Authorization': `Bearer ${loginToken}`,
    };

    // 在 GetGameUrl 之前增加 CheckCanBet 请求，失败时重试（充值后余额同步需要时间）
    const checkApi = '/api/Home/CheckCanBet';
    const checkPayload = {
        language: 'en',
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };
    const signedCheckData = signClient.signData(checkPayload);

    const maxCheckRetries = 3;
    const checkRetryInterval = 3; // 秒
    let checkPassed = false;

    for (let checkAttempt = 1; checkAttempt <= maxCheckRetries; checkAttempt++) {
        const checkResponse = http.post(baseUrl + checkApi, JSON.stringify(signedCheckData), { headers });
        console.log(`[BetToken] CheckCanBet 第${checkAttempt}次 响应状态: ${checkResponse.status}`);
        console.log(`[BetToken] CheckCanBet 第${checkAttempt}次 完整响应: ${checkResponse.body}`);

        if (checkResponse.status === 200 && checkResponse.body) {
            try {
                const checkResult = JSON.parse(checkResponse.body);
                if (checkResult.data === true) {
                    console.log('[BetToken] ✅ CheckCanBet 校验通过');
                    checkPassed = true;
                    break;
                } else {
                    console.warn(`[BetToken] CheckCanBet 返回 false（第${checkAttempt}/${maxCheckRetries}次），等待 ${checkRetryInterval}s 后重试...`);
                    if (checkAttempt < maxCheckRetries) {
                        sleep(checkRetryInterval);
                    }
                }
            } catch (e) {
                console.error('[BetToken] 解析 CheckCanBet 响应失败:', e.message);
                break;
            }
        } else {
            console.error('[BetToken] CheckCanBet 请求失败');
            break;
        }
    }

    if (!checkPassed) {
        console.error('[BetToken] CheckCanBet 多次重试后仍返回 false，无法执行投注操作');
        return null;
    }

    const response = http.post(baseUrl + api, JSON.stringify(signedData), { headers });

    console.log('[BetToken] GetGameUrl请求URL:', baseUrl + api);
    console.log('[BetToken] GetGameUrl响应状态:', response.status);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            console.log('[BetToken] GetGameUrl完整响应:', response.body);
            if (result.msgCode === 0 && result.data && result.data.url) {
                const url = result.data.url;
                //console.log('[BetToken] 游戏URL:', url);

                // 从URL中提取token
                const tokenMatch = url.match(/Token=([^&]+)/);
                if (tokenMatch && tokenMatch[1]) {
                    const gameToken = decodeURIComponent(tokenMatch[1]);
                    const gameBaseUrl = url.split('?')[0].split('/').slice(0, 3).join('/');

                    console.log('[BetToken] ✅ 游戏token获取成功');
                    console.log('[BetToken] 游戏域名:', gameBaseUrl);

                    return { gameToken, gameBaseUrl };
                }
            }
        } catch (e) {
            console.error('[BetToken] 解析GetGameUrl响应失败:', e.message);
        }
    }

    return null;
}

/**
 * 步骤2: 获取游戏列表并刷新token
 * @param {string} gameToken - 游戏token
 * @param {string} gameBaseUrl - 游戏域名
 * @returns {string} 刷新后的token
 */
export function refreshTokenWithGameList(gameToken, gameBaseUrl) {
    console.log('[BetToken] 步骤2: 获取游戏列表并刷新token');

    const api = '/api/Lottery/GetGameList';
    const lotteryBaseUrl = 'https://sit-lotteryh5.wmgametransit.com';
    console.log(`[BetToken] 步骤2 请求URL: ${lotteryBaseUrl + api}`);

    const timeData = getTimeRandom();
    const params = {
        language: 'en',
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    const signClient = new SignedHttpClient();
    const signedParams = signClient.signData(params);

    const queryString = Object.entries(signedParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

    const headers = {
        'Authorization': `Bearer ${gameToken}`,
        'Referer': gameBaseUrl + '/',
        'Origin': gameBaseUrl,
        'Accept': 'application/json, text/plain, */*'
    };

    const response = http.get(lotteryBaseUrl + api + '?' + queryString, { headers });

    console.log('[BetToken] GetGameList响应状态:', response.status);
    console.log('[BetToken] GetGameList响应体:', response.body ? response.body.substring(0, 200) : '空');

    if (response.status === 200) {
        const authHeader = response.headers['Authorization'] || response.headers['authorization'];
        if (authHeader) {
            const refreshedToken = authHeader.replace(/^Bearer\s+/i, '');
            console.log('[BetToken] ✅ Token已刷新 (GetGameList)');
            return refreshedToken;
        }
    }

    console.error('[BetToken] GetGameList未返回新token，使用原token');
    return gameToken;
}

/**
 * 步骤3: 获取余额并刷新token
 * @param {string} currentToken - 当前token
 * @param {string} gameBaseUrl - 游戏域名
 * @returns {object} {token, balance}
 */
export function getBalanceAndRefreshToken(currentToken, gameBaseUrl) {
    console.log('[BetToken] 步骤3: 获取余额并刷新token');

    const api = '/api/Lottery/GetBalance';
    const lotteryBaseUrl = 'https://sit-lotteryh5.wmgametransit.com';
    console.log(`[BetToken] 步骤3 请求URL: ${lotteryBaseUrl + api}`);

    const timeData = getTimeRandom();
    const params = {
        language: 'en',
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    const signClient = new SignedHttpClient();
    const signedParams = signClient.signData(params);

    const queryString = Object.entries(signedParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

    const headers = {
        'Authorization': `Bearer ${currentToken}`,
        'Referer': gameBaseUrl + '/',
        'Origin': gameBaseUrl,
        'Accept': 'application/json, text/plain, */*'
    };

    const response = http.get(lotteryBaseUrl + api + '?' + queryString, { headers });

    console.log('[BetToken] GetBalance响应状态:', response.status);
    console.log('[BetToken] GetBalance响应体:', response.body ? response.body.substring(0, 200) : '空');

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            const authHeader = response.headers['Authorization'] || response.headers['authorization'];

            let finalToken = currentToken;
            if (authHeader) {
                finalToken = authHeader.replace(/^Bearer\s+/i, '');
                console.log('[BetToken] ✅ Token已刷新 (GetBalance)');
            }

            const balance = result.data ? result.data.balance : 0;
            console.log('[BetToken] 余额:', balance);

            return { token: finalToken, balance };
        } catch (e) {
            console.error('[BetToken] 解析GetBalance响应失败:', e.message);
        }
    }

    return { token: currentToken, balance: 0 };
}

/**
 * 完整的token获取流程
 * @param {string} loginToken - 登录token
 * @param {string} gameCode - 游戏代码
 * @returns {object} {token, gameToken, balance, gameBaseUrl}
 */
export function getBetToken(loginToken, gameCode) {
    console.log('[BetToken] ========== 开始获取投注token ==========');

    // 步骤1: 获取游戏token
    const gameInfo = getGameToken(loginToken, gameCode);
    if (!gameInfo) {
        console.error('[BetToken] 获取游戏token失败');
        return null;
    }

    // 保存游戏token，用于获取期号
    const originalGameToken = gameInfo.gameToken;

    // 步骤2: 刷新token (GetGameList)
    const refreshedToken1 = refreshTokenWithGameList(gameInfo.gameToken, gameInfo.gameBaseUrl);

    // 步骤3: 获取余额并再次刷新token
    const balanceInfo = getBalanceAndRefreshToken(refreshedToken1, gameInfo.gameBaseUrl);

    console.log('[BetToken] ========== 投注token获取完成 ==========');

    return {
        token: balanceInfo.token,           // 最终投注token
        gameToken: originalGameToken,       // 原始游戏token (用于获取期号)
        balance: balanceInfo.balance,
        gameBaseUrl: gameInfo.gameBaseUrl
    };
}
