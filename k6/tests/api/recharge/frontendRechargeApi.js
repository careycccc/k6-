/**
 * 前台充值相关 API 接口封装
 */

import { sendRequest, sendQueryRequest } from '../common/request.js';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom } from '../../utils/utils.js';

const apiRechargeCategoryList = '/api/Recharge/GetRechargeCategoryList';
const apiDepositRecharge = '/api/Recharge/DepositRecharge';
const apiSubmitCertificate = '/api/Recharge/SubmitCertificate';

/**
 * 获取充值分类列表
 * @param {string} token - 前台用户 token
 * @returns {Array|null} 充值分类数组，失败返回 null
 */
export function getRechargeCategoryList(token) {
    const tag = 'GetRechargeCategoryList';
    const payload = {};

    // 改用 sendRequest，避免 sendQueryRequest 附加的 pageNo, pageSize 导致签名错误
    const response = sendRequest(payload, apiRechargeCategoryList, tag, true, token);
    
    // sendQueryRequest 返回的可能是解析后的 data 或完整响应对象
    if (!response) {
        console.error(`[${tag}] 获取充值通道列表失败: 响应为空`);
        return null;
    }

    // 根据抓包数据，响应为 { data: [...], code: 0, msg: "Succeed", msgCode: 0 }
    // 如果 response 直接就是数组，说明 sendQueryRequest 已经提取了 data.list 或类似结构
    if (Array.isArray(response)) {
        return response;
    }
    
    // 如果包含 data 数组
    if (response.data && Array.isArray(response.data)) {
        return response.data;
    }

    return response;
}

/**
 * 提交充值请求 (DepositRecharge)
 * @param {string} token - 前台用户 token
 * @param {object} payload - 充值参数，包含 rechargeCategoryId, amount 等
 * @returns {object|null} 包含完整响应，用于判断 msgCode
 */
export function depositRecharge(token, payload) {
    const tag = 'DepositRecharge';
    const timeData = getTimeRandom();
    
    // 组装完整的请求数据，补充必需字段
    const requestData = {
        returnUrl: "https://arplatsaassit4.club/#/main",
        urlInfo: "https://arplatsaassit4.club,status/rechargeStatus",
        vendorId: 0,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp,
        ...payload
    };

    // 这里由于 sendRequest 会根据 msgCode === 0 来判断成功与否，
    // 而充值成功可能是 code: -2, msgCode: 41，我们需要使用底层的 httpClient 以便获取完整响应进行自定义判断
    if (token) {
        httpClient.setAuthToken(token);
    }
    
    const response = httpClient.post(
        apiDepositRecharge,
        requestData,
        {
            params: {
                tags: { type: tag, name: `${tag}_request` }
            }
        },
        true // isDesk
    );

    if (!response || !response.body) {
        console.error(`[${tag}] 充值请求失败: 无响应体`);
        return null;
    }

    let parsedBody = null;
    try {
        parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    } catch (e) {
        console.error(`[${tag}] 响应体解析失败: ${e.message}`);
        return null;
    }

    return parsedBody;
}

/**
 * 提交本地充值凭证 (SubmitCertificate)
 * 仅用于 LocalEWallet 通道
 * @param {string} token - 前台用户 token
 * @param {string} orderNo - 订单号
 * @param {number} createTime - 订单创建时间 (毫秒时间戳)
 * @param {string} transactionId - 交易ID，通常为空字符串
 * @returns {object|null}
 */
export function submitCertificate(token, orderNo, createTime, transactionId = "") {
    const tag = 'SubmitCertificate';
    const timeData = getTimeRandom();
    
    const payload = {
        orderNo: orderNo,
        createTime: createTime,
        transactionId: transactionId,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    if (token) {
        httpClient.setAuthToken(token);
    }

    const response = httpClient.post(
        apiSubmitCertificate,
        payload,
        {
            params: {
                tags: { type: tag, name: `${tag}_request` }
            }
        },
        true // isDesk
    );

    if (!response || !response.body) {
        console.error(`[${tag}] 提交充值凭证失败: 无响应体`);
        return null;
    }

    let parsedBody = null;
    try {
        parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    } catch (e) {
        console.error(`[${tag}] 响应体解析失败: ${e.message}`);
        return null;
    }

    return parsedBody;
}
