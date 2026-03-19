/**
 * 多租户请求工具
 * 完全支持多环境配置和签名机制
 */

import http from 'k6/http';
import { SignedHttpClient } from '../utils/signature.js';
import { getTimeRandom } from '../../tests/utils/utils.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../config/envconfig.js';

/**
 * 发送多租户请求
 * @param {string} api - API路径，如 '/api/Login/Login'
 * @param {object} payload - 请求数据
 * @param {object} options - 选项
 *   - isDesk: 是否前台请求，默认 true
 *   - token: 认证token，可选
 *   - tenantId: 租户ID，可选（默认从环境变量读取）
 * @returns {object} 响应对象 {status, body, data, msgCode, msg}
 */
export function tenantRequest(api, payload = {}, options = {}) {
    const {
        isDesk = true,
        token = null,
        tenantId = null
    } = options;

    // 获取租户配置
    const tenant = tenantId || __ENV.TENANT || __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    const envConfig = getEnvByTenantId(tenant);

    // 确定请求URL
    const baseUrl = isDesk ? envConfig.BASE_DESK_URL : envConfig.BASE_ADMIN_URL;
    const url = baseUrl + api;

    // 添加时间戳、随机数、签名
    const timeData = getTimeRandom();
    const requestData = {
        ...payload,
        random: timeData.random,
        language: timeData.language,
        timestamp: timeData.timestamp
    };

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    // 构建请求头
    const headers = {
        'Content-Type': 'application/json',
        'Domainurl': baseUrl,
        'Referrer': baseUrl
    };

    // 添加认证token
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // 发送请求
    const response = http.post(url, JSON.stringify(signedData), { headers });

    // 解析响应
    let parsedBody = null;
    if (response.body) {
        try {
            parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        } catch (e) {
            console.error(`[TenantRequest] 响应解析失败: ${e.message}`);
        }
    }

    return {
        status: response.status,
        body: response.body,
        data: parsedBody ? parsedBody.data : null,
        msgCode: parsedBody ? (parsedBody.msgCode !== undefined ? parsedBody.msgCode : parsedBody.code) : null,
        msg: parsedBody ? parsedBody.msg : null,
        raw: parsedBody
    };
}

/**
 * 发送查询请求（带分页）
 * @param {string} api - API路径
 * @param {object} payload - 请求数据
 * @param {object} options - 选项（同 tenantRequest）
 * @returns {object} 响应对象
 */
export function tenantQueryRequest(api, payload = {}, options = {}) {
    const tenant = options.tenantId || __ENV.TENANT || __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    const envConfig = getEnvByTenantId(tenant);

    const queryPayload = {
        pageNo: envConfig.PAGENO || 1,
        pageSize: envConfig.PAGESIZE || 200,
        orderBy: 'Desc',
        ...payload
    };

    return tenantRequest(api, queryPayload, options);
}

/**
 * 后台登录
 * @param {string} tenantId - 租户ID，可选
 * @returns {string|null} token
 */
export function tenantAdminLogin(tenantId = null) {
    const tenant = tenantId || __ENV.TENANT || __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    const envConfig = getEnvByTenantId(tenant);

    const response = tenantRequest('/api/Login/Login', {
        userName: envConfig.ADMIN_USERNAME,
        pwd: envConfig.ADMIN_PASSWORD
    }, {
        isDesk: false
    });

    if (response.msgCode === 0 && response.data && response.data.token) {
        return response.data.token;
    }

    console.error(`[TenantAdminLogin] 登录失败: ${response.msg}`);
    return null;
}
