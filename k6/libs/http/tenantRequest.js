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

    console.log(`[TenantRequest] ========== 请求详情 ==========`);
    console.log(`[TenantRequest] 租户ID: ${tenant}`);
    console.log(`[TenantRequest] 请求类型: ${isDesk ? '前台' : '后台'}`);
    console.log(`[TenantRequest] 基础URL: ${baseUrl}`);
    console.log(`[TenantRequest] 完整URL: ${url}`);
    console.log(`[TenantRequest] 原始payload: ${JSON.stringify(payload, null, 2)}`);

    // 添加时间戳、随机数、签名
    // 注意：payload 中已有 language 时优先使用（支持多语言降级重试），否则使用 getTimeRandom 的随机语言
    const timeData = getTimeRandom();
    const requestData = {
        ...payload,
        random: timeData.random,
        language: payload.language !== undefined ? payload.language : timeData.language,
        timestamp: timeData.timestamp
    };

    console.log(`[TenantRequest] 添加时间参数后: ${JSON.stringify(requestData, null, 2)}`);

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    console.log(`[TenantRequest] 签名后数据: ${JSON.stringify(signedData, null, 2)}`);

    // 构建请求头
    const headers = {
        'Content-Type': 'application/json',
        'Domainurl': baseUrl,
        'Referrer': baseUrl
    };

    // 添加认证token
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log(`[TenantRequest] 添加认证token: ${token.substring(0, 20)}...`);
    }

    console.log(`[TenantRequest] 请求Headers: ${JSON.stringify(headers, null, 2)}`);

    // 发送请求
    const response = http.post(url, JSON.stringify(signedData), { headers });

    console.log(`[TenantRequest] ========== 响应详情 ==========`);
    console.log(`[TenantRequest] 响应状态码: ${response.status}`);
    //console.log(`[TenantRequest] 响应体: ${response.body}`);

    // 解析响应
    let parsedBody = null;
    if (response.body) {
        try {
            parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
        } catch (e) {
            console.error(`[TenantRequest] 响应解析失败: ${e.message}`);
        }
    }

    console.log(`[TenantRequest] 解析后响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
