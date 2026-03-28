/**
 * 带重试逻辑的多租户请求工具
 * 专门处理 "Too frequent access" 错误
 */

import { sleep } from 'k6';
import { tenantRequest, tenantQueryRequest } from './tenantRequest.js';

/**
 * 带重试逻辑的租户请求
 * 当遇到 "Too frequent access" 错误时，等待3秒后重试
 * 
 * @param {string} api - API路径
 * @param {object} payload - 请求数据
 * @param {object} options - 选项（同 tenantRequest）
 * @param {number} maxRetries - 最大重试次数，默认3次
 * @returns {object} 响应对象
 */
export function tenantRequestWithRetry(api, payload = {}, options = {}, maxRetries = 3) {
    const tag = options.tag || 'TenantRequestRetry';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            console.log(`[${tag}] 等待3秒后重试 (${attempt}/${maxRetries})...`);
            sleep(3);
        }

        const response = tenantRequest(api, payload, options);

        // 检查是否是 "Too frequent access" 错误
        if (response && response.msgCode === 13) {
            const msg = response.msg || '';
            if (msg.includes('Too frequent access') || msg.includes('please try again later')) {
                console.warn(`[${tag}] 访问过于频繁 (尝试 ${attempt + 1}/${maxRetries + 1}): ${msg}`);

                if (attempt < maxRetries) {
                    continue; // 重试
                } else {
                    console.error(`[${tag}] 达到最大重试次数，仍然访问过于频繁`);
                    return response; // 返回最后一次的错误响应
                }
            }
        }

        // 其他情况（成功或其他错误）直接返回
        return response;
    }

    // 理论上不会到这里
    return null;
}

/**
 * 带重试逻辑的查询请求
 * 
 * @param {string} api - API路径
 * @param {object} payload - 请求数据
 * @param {object} options - 选项（同 tenantQueryRequest）
 * @param {number} maxRetries - 最大重试次数，默认3次
 * @returns {object} 响应对象
 */
export function tenantQueryRequestWithRetry(api, payload = {}, options = {}, maxRetries = 3) {
    const tag = options.tag || 'TenantQueryRetry';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            console.log(`[${tag}] 等待3秒后重试 (${attempt}/${maxRetries})...`);
            sleep(3);
        }

        const response = tenantQueryRequest(api, payload, options);

        // 检查是否是 "Too frequent access" 错误
        if (response && response.msgCode === 13) {
            const msg = response.msg || '';
            if (msg.includes('Too frequent access') || msg.includes('please try again later')) {
                console.warn(`[${tag}] 访问过于频繁 (尝试 ${attempt + 1}/${maxRetries + 1}): ${msg}`);

                if (attempt < maxRetries) {
                    continue; // 重试
                } else {
                    console.error(`[${tag}] 达到最大重试次数，仍然访问过于频繁`);
                    return response;
                }
            }
        }

        // 其他情况直接返回
        return response;
    }

    return null;
}
