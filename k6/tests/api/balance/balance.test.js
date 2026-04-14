/**
 * 账号余额查询模块
 * 包含获取账号余额等功能
 * 
 * 注意：余额接口需要用户登录后才能调用（需要前台 token）
 */

import http from 'k6/http';
import { getTimeRandom } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

/**
 * 获取账号余额
 * @param {string} token - 前台登录成功后的 token
 * @returns {Object} 余额信息 {balance, currency, tenantId, userId} 或 null
 */
export function getAccountBalance(token) {
    //console.log('[Balance] 开始查询账号余额');

    if (!token) {
        console.error('[Balance] token 为空，无法查询余额');
        return null;
    }

    const tenantIdStr = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    const currentEnv = getEnvByTenantId(tenantIdStr);
    
    const api = '/api/ThirdGame/RecoverSaasBalance';
    const fullUrl = currentEnv.BASE_DESK_URL + api;

    try {
        const timeData = getTimeRandom();
        //console.log('[Balance] timeData:', JSON.stringify(timeData));

        const requestData = {
            language: timeData.language,
            random: timeData.random,
            signature: '',
            timestamp: timeData.timestamp
        };

        console.log('[Balance] requestData:', JSON.stringify(requestData));

        // 生成签名
        const signClient = new SignedHttpClient();
        //console.log('[Balance] 开始生成签名...');

        const signedData = signClient.signData(requestData);
        //console.log('[Balance] 签名生成成功:', JSON.stringify(signedData));

        console.log('[Balance] 请求 URL:', fullUrl);

        const response = http.post(fullUrl, JSON.stringify(signedData), {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Domainurl': currentEnv.BASE_DESK_URL,
                'Referrer': currentEnv.BASE_DESK_URL
            }
        });

        console.log('[Balance] 响应状态:', response.status);
        console.log('[Balance] 响应体:', response.body);

        if (response.status === 200 && response.body) {
            const result = JSON.parse(response.body);
            console.log('[Balance] 响应 msgCode:', result.msgCode);

            if (result.msgCode === 0 && result.data) {
                const balanceInfo = {
                    balance: result.data.balance,
                    currency: result.data.currency,
                    tenantId: result.data.tenantId,
                    userId: result.data.userId
                };

                console.log('[Balance] 余额查询成功:', JSON.stringify(balanceInfo));
                return balanceInfo;
            } else {
                console.error('[Balance] 余额查询失败:', result.msg || '未知错误');
                return null;
            }
        } else {
            console.error('[Balance] 请求失败，状态码:', response.status);
            if (response.body) {
                console.error('[Balance] 响应内容:', response.body);
            }
            return null;
        }
    } catch (error) {
        console.error('[Balance] 余额查询异常:', error.message);
        console.error('[Balance] 错误堆栈:', error.stack);
        return null;
    }
}

/**
 * 检查账号是否有足够余额进行操作
 * @param {string} token - 前台登录成功后的 token
 * @param {number} requiredAmount - 需要的最小金额
 * @returns {boolean} 是否有足够余额
 */
export function checkSufficientBalance(token, requiredAmount = 0) {
    const balanceInfo = getAccountBalance(token);

    if (!balanceInfo) {
        console.error('[Balance] 无法获取余额信息');
        return false;
    }

    const hasEnough = balanceInfo.balance >= requiredAmount;
    console.log(`[Balance] 余额检查: 当前余额=${balanceInfo.balance}, 需要金额=${requiredAmount}, 是否足够=${hasEnough}`);

    return hasEnough;
}

/**
 * 格式化显示余额信息
 * @param {string} token - 前台登录成功后的 token
 * @returns {string} 格式化的余额信息字符串
 */
export function getFormattedBalance(token) {
    const balanceInfo = getAccountBalance(token);

    if (!balanceInfo) {
        return '余额查询失败';
    }

    return `余额: ${balanceInfo.balance} ${balanceInfo.currency} (用户ID: ${balanceInfo.userId})`;
}