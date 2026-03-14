/**
 * 充值功能模块
 * 包含充值列表查询、充值操作等功能
 * 
 * 注意：充值接口需要用户登录后才能调用（需要前台 token）
 */

import http from 'k6/http';
import { getTimeRandom } from '../../utils/utils.js';
import { SignedHttpClient } from '../../../libs/utils/signature.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

/**
 * 获取充值分类列表
 * @param {string} token - 前台登录成功后的 token
 * @returns {Array} 充值分类列表，每项包含 {id, minAmount, maxAmount, rechargeType}
 */
export function getRechargeCategoryList(token) {
    console.log('[Recharge] 开始查询充值分类列表');

    if (!token) {
        console.error('[Recharge] token 为空，无法查询充值列表');
        return null;
    }

    const api = '/api/Recharge/GetRechargeCategoryList';
    const fullUrl = ENV_CONFIG.BASE_DESK_URL + api;

    try {
        const timeData = getTimeRandom();
        console.log('[Recharge] timeData:', JSON.stringify(timeData));
        
        const requestData = {
            language: timeData.language,
            random: timeData.random,
            signature: '',
            timestamp: timeData.timestamp
        };

        console.log('[Recharge] requestData:', JSON.stringify(requestData));

        // 生成签名
        const signClient = new SignedHttpClient();
        console.log('[Recharge] 开始生成签名...');
        
        const signedData = signClient.signData(requestData);
        console.log('[Recharge] 签名生成成功:', JSON.stringify(signedData));

        console.log('[Recharge] 请求 URL:', fullUrl);

        const response = http.post(fullUrl, JSON.stringify(signedData), {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Domainurl': ENV_CONFIG.BASE_DESK_URL,
                'Referrer': ENV_CONFIG.BASE_DESK_URL
            }
        });

        console.log('[Recharge] 响应状态:', response.status);
        console.log('[Recharge] 响应体:', response.body);

        if (response.status === 200 && response.body) {
            const result = JSON.parse(response.body);
            console.log('[Recharge] 响应 msgCode:', result.msgCode);

            if (result.msgCode === 0 && result.data) {
                const categories = result.data;
                console.log('[Recharge] 获取到充值分类数量:', categories.length);

                // 提取需要的字段：id, minAmount, maxAmount, rechargeType
                const simplifiedList = categories.map(item => ({
                    id: item.id,
                    minAmount: item.minAmount,
                    maxAmount: item.maxAmount,
                    rechargeType: item.rechargeType
                }));

                console.log('[Recharge] 充值分类列表:', JSON.stringify(simplifiedList));
                return simplifiedList;
            } else {
                console.error('[Recharge] 查询失败:', result.msg || '未知错误');
                return null;
            }
        } else {
            console.error('[Recharge] 请求失败，状态码:', response.status);
            if (response.body) {
                console.error('[Recharge] 响应内容:', response.body);
            }
            return null;
        }
    } catch (error) {
        console.error('[Recharge] 充值分类查询异常:', error.message);
        console.error('[Recharge] 错误堆栈:', error.stack);
        return null;
    }
}

/**
 * 根据充值类型筛选充值分类
 * @param {string} token - 前台登录成功后的 token
 * @param {string} rechargeType - 充值类型，如 "USDT", "BankCard", "ARPay" 等
 * @returns {Array} 符合条件的充值分类列表
 */
export function getRechargeCategoryByType(token, rechargeType) {
    const allCategories = getRechargeCategoryList(token);
    
    if (!allCategories) {
        return null;
    }

    const filtered = allCategories.filter(item => item.rechargeType === rechargeType);
    console.log(`[Recharge] 筛选 ${rechargeType} 类型，找到 ${filtered.length} 个分类`);
    
    return filtered;
}

/**
 * 获取随机充值分类
 * @param {string} token - 前台登录成功后的 token
 * @returns {Object} 随机选择的充值分类
 */
export function getRandomRechargeCategory(token) {
    const allCategories = getRechargeCategoryList(token);
    
    if (!allCategories || allCategories.length === 0) {
        console.error('[Recharge] 没有可用的充值分类');
        return null;
    }

    const randomIndex = Math.floor(Math.random() * allCategories.length);
    const selected = allCategories[randomIndex];
    
    console.log('[Recharge] 随机选择充值分类:', JSON.stringify(selected));
    return selected;
}