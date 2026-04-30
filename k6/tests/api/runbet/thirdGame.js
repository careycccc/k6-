/**
 * 第三方游戏模块
 * 对应 Go 的 thirdGame.go
 */

import http from 'k6/http';
import { getTimeRandom, generateCryptoRandomString } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

/**
 * 获取第三方游戏 URL 和 Token
 * @param {string} token - 前台登录 token
 * @param {string} gameCode - 游戏代码
 * @returns {Promise<string>} 返回游戏 token
 */
export function getThirdGameUrl(token, gameCode) {
    const api = '/api/ThirdGame/GetGameUrl';
    const tenantIdStr = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    const currentEnv = getEnvByTenantId(tenantIdStr);
    const baseUrl = currentEnv.BASE_DESK_URL; // 使用环境配置的前台地址

    const timeData = getTimeRandom();
    const deviceTypeId = generateCryptoRandomString(32);
    const returnUrl = `${baseUrl}/game?categoryCode=C202505280608510046`;

    const payload = {
        gameCode: gameCode,
        vendorCode: 'ARLottery',
        gameId: 10003,
        returnUrl: returnUrl,
        deviceType: 'PC',
        deviceTypeId: deviceTypeId,
        random: timeData.random,
        language: 'en', // 强制使用 en
        signature: '',
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(payload);

    const headers = {
        'Content-Type': 'application/json',
        'Referer': baseUrl,
        'Origin': baseUrl,
        'Authorization': `Bearer ${token}`,
        'Domainurl': baseUrl
    };

    console.log('[ThirdGame] 请求 URL:', baseUrl + api);
    console.log('[ThirdGame] 请求 payload:', JSON.stringify(signedData));

    // 在 GetGameUrl 之前增加 CheckCanBet 请求
    const checkApi = '/api/Home/CheckCanBet';
    const checkPayload = {
        language: 'en',
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };
    const signedCheckData = signClient.signData(checkPayload);
    const checkResponse = http.post(baseUrl + checkApi, JSON.stringify(signedCheckData), { headers });
    console.log('[ThirdGame] CheckCanBet响应状态:', checkResponse.status);
    
    if (checkResponse.status === 200 && checkResponse.body) {
        try {
            const checkResult = JSON.parse(checkResponse.body);
            if (checkResult.data !== true) {
                console.error('[ThirdGame] CheckCanBet 返回不是 true，无法执行投注操作');
                return null;
            }
            console.log('[ThirdGame] ✅ CheckCanBet 校验通过');
        } catch (e) {
            console.error('[ThirdGame] 解析 CheckCanBet 响应失败:', e.message);
            return null;
        }
    } else {
        console.error('[ThirdGame] CheckCanBet 请求失败');
        return null;
    }

    const response = http.post(baseUrl + api, JSON.stringify(signedData), {
        headers: headers
    });

    console.log('[ThirdGame] 响应状态:', response.status);
    console.log('[ThirdGame] 响应体:', response.body);

    if (response.status === 200 && response.body) {
        try {
            const result = JSON.parse(response.body);
            if (result.msgCode === 0 && result.data) {
                const url = result.data.url;
                console.log('[ThirdGame] 获取到游戏 URL:', url);

                // 使用正则表达式提取 Token
                const tokenMatch = url.match(/Token=([^&]+)/);
                if (tokenMatch && tokenMatch[1]) {
                    console.log('[ThirdGame] ✅ 成功获取游戏 Token');
                    return tokenMatch[1];
                } else {
                    console.error('[ThirdGame] 无法从 URL 中提取 Token');
                    return null;
                }
            } else {
                console.error('[ThirdGame] 响应错误:', result.msg);
                return null;
            }
        } catch (e) {
            console.error('[ThirdGame] 解析响应失败:', e.message);
            return null;
        }
    } else {
        console.error('[ThirdGame] 请求失败:', response.status, response.body);
        return null;
    }
}
