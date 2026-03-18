/**
 * 前台充值相关 API 接口封装
 */

import { sendRequest, sendQueryRequest } from '../common/request.js';
import { httpClient } from '../../../libs/http/client.js';
import { getTimeRandom } from '../../utils/utils.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../../config/envconfig.js';

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

    // 动态获取当前运行的机场(租户)配置以生成前台 URL
    const tenantIdStr = __ENV.TENANT_ID || ENV_CONFIG.TENANTID;
    const currentEnv = getEnvByTenantId(tenantIdStr);
    const frontBaseUrl = currentEnv.BASE_DESK_URL || "https://arplatsaassit4.club";

    // 组装完整的请求数据，补充必需字段
    const requestData = {
        returnUrl: `${frontBaseUrl}/#/main`,
        urlInfo: `${frontBaseUrl},status/rechargeStatus`,
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
 * 生成12位随机数字字符串
 * @returns {string} 12位纯数字字符串
 */
function generate12DigitTransactionId() {
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += Math.floor(Math.random() * 10);
    }
    return result;
}

/**
 * 提交本地充值凭证 (SubmitCertificate)
 * 仅用于 LocalEWallet 通道
 * 支持重试机制：第一次失败后，使用12位随机数字作为 transactionId 重试
 * @param {string} token - 前台用户 token
 * @param {string} orderNo - 订单号
 * @param {number} createTime - 订单创建时间 (毫秒时间戳)
 * @param {string} transactionId - 交易ID，通常为空字符串
 * @param {number} maxRetries - 最大重试次数，默认2次
 * @returns {object|null}
 */
export function submitCertificate(token, orderNo, createTime, transactionId = "", maxRetries = 2) {
    const tag = 'SubmitCertificate';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const timeData = getTimeRandom();

        // 第一次使用传入的 transactionId（通常为空），后续重试使用12位随机数字
        const currentTransactionId = attempt === 1 ? transactionId : generate12DigitTransactionId();

        const payload = {
            orderNo: orderNo,
            createTime: createTime,
            transactionId: currentTransactionId,
            language: timeData.language,
            random: timeData.random,
            signature: '',
            timestamp: timeData.timestamp
        };

        console.log(`[${tag}] 第${attempt}次提交凭证，transactionId: "${currentTransactionId}"`);

        if (token) {
            httpClient.setAuthToken(token);
        }

        const response = httpClient.post(
            apiSubmitCertificate,
            payload,
            {
                params: {
                    tags: { type: tag, name: `${tag}_request_${attempt}` }
                }
            },
            true // isDesk
        );

        if (!response || !response.body) {
            console.error(`[${tag}] 第${attempt}次提交失败: 无响应体`);
            if (attempt < maxRetries) {
                console.log(`[${tag}] 准备重试...`);
                continue;
            }
            return null;
        }

        let parsedBody = null;
        try {
            parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        } catch (e) {
            console.error(`[${tag}] 第${attempt}次响应体解析失败: ${e.message}`);
            if (attempt < maxRetries) {
                console.log(`[${tag}] 准备重试...`);
                continue;
            }
            return null;
        }

        // 检查响应是否成功
        if (parsedBody && (parsedBody.code === 0 || parsedBody.msgCode === 0)) {
            console.log(`[${tag}] ✅ 第${attempt}次提交成功`);
            return parsedBody;
        } else {
            console.warn(`[${tag}] 第${attempt}次提交返回错误: code=${parsedBody.code}, msgCode=${parsedBody.msgCode}, msg=${parsedBody.msg}`);
            if (attempt < maxRetries) {
                console.log(`[${tag}] 准备使用随机 transactionId 重试...`);
                continue;
            }
            return parsedBody; // 最后一次尝试，返回结果即使失败
        }
    }

    return null;
}
