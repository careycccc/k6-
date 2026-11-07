/**
 * workOrderSuite/lib/submitHelper.js
 * 签名安全的 POST 提交工具
 *
 * 背景：后台签名校验对 formFields 等嵌套数组字段不参与 MD5 计算。
 * 如果让 httpClient 自动签名，会把数组序列化进去导致签名错误。
 * 本模块统一提供「先签基础字段，再追加数组字段」的正确做法。
 *
 * 导出：
 *   signAndPost(payload, endpoint, isDesk, adminToken, tag)
 */

import { sleep } from 'k6';
import { httpClient } from '../../../../../libs/http/client.js';
import { SignatureUtil } from '../../../../../libs/utils/signature.js';
import { getTimeRandom } from '../../../../utils/utils.js';
import { logger } from '../../../../../libs/utils/logger.js';
import { probeResponse } from '../../../../../libs/monitor/perfIntegration.js';

/**
 * 需要被剥离出签名计算的数组/复杂字段列表
 * 后台 MD5 只计算同层简单字段，复杂嵌套字段在签名后再追加
 */
const ARRAY_FIELDS = ['formFields'];

/**
 * 签名安全的 POST 请求
 *
 * @param {object} payload    - 完整的业务 payload（含可能的数组字段）
 * @param {string} endpoint   - API 路径，如 '/api/WorkOrder/Submit'
 * @param {boolean} isDesk    - true=前台, false=后台
 * @param {string} adminToken - 如果是后台请求，传入 adminToken；前台传 ''
 * @param {string} tag        - 日志标签
 * @param {object} [monOpts]  - 监控选项（如 trendObj, errorCounter）
 * @param {boolean} [forceTenant=false] - adminToken 是商户自己登录拿到的（非集团token）时传
 *   true，否则集团模式下会被自动路由去集团域名，token/域名错配报 "Account type does not
 *   match the admin site"（2026-11-07 实测踩坑，见 libs/http/groupRouting.js 顶部注释）
 * @returns {object|null}     - 解析后的响应体，失败返回 null
 */
export function signAndPost(payload, endpoint, isDesk, adminToken, tag, monOpts = {}, forceTenant = false) {
    // 1. 分离数组字段
    const arrayParts = {};
    const simplePayload = {};
    for (const key in payload) {
        if (ARRAY_FIELDS.includes(key) || Array.isArray(payload[key])) {
            arrayParts[key] = payload[key];
        } else {
            simplePayload[key] = payload[key];
        }
    }

    // 2. 对简单字段进行签名
    const timeData = getTimeRandom();
    const dataToSign = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        ...simplePayload,
    };
    const signedData = SignatureUtil.signRequest(dataToSign, '');

    // 3. 签名完成后追加数组字段
    Object.assign(signedData, arrayParts);

    // 4. 设置 token
    if (adminToken) {
        httpClient.setAuthToken(adminToken);
    } else {
        httpClient.setAuthToken('');
    }

    // 5. 发送请求（禁用 httpClient 的再次自动签名）
    let result = _post(signedData, endpoint, isDesk, tag, monOpts, forceTenant);

    // 6. 限流重试（msgCode: 13）
    if (result && result.msgCode === 13) {
        logger.warn(`[${tag}] 请求过快 (msgCode 13)，1s 后重试: ${endpoint}`);
        sleep(1);
        result = _post(signedData, endpoint, isDesk, tag, monOpts, forceTenant);
    }

    return result;
}

function _post(signedData, endpoint, isDesk, tag, monOpts, forceTenant = false) {
    let response;
    try {
        response = httpClient.post(
            endpoint,
            signedData,
            {
                sign: false,
                forceTenant,
                params: { tags: { type: tag, name: `${tag}_post` } },
            },
            isDesk
        );
    } catch (e) {
        logger.error(`[${tag}] 请求异常: ${e.message}`);
        return null;
    }

    const { body } = probeResponse(response, tag, monOpts);
    return body;
}
