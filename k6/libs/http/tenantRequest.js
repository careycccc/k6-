/**
 * 多租户请求工具
 * 完全支持多环境配置和签名机制
 */

import http from 'k6/http';
import crypto from 'k6/crypto';
import { SignedHttpClient } from '../utils/signature.js';
import { getTimeRandom } from '../../tests/utils/utils.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../config/envconfig.js';

// ============================================================
// 后台谷歌验证码(TOTP)：标准 SHA1 / 30秒 / 6位，密钥 base32（取自 envconfig 的 GOOGLE_SECRET）
// ============================================================
function base32Decode(s) {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    s = String(s).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    let bits = '';
    for (let i = 0; i < s.length; i++) { const idx = a.indexOf(s[i]); if (idx < 0) continue; bits += idx.toString(2).padStart(5, '0'); }
    const by = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) by.push(parseInt(bits.slice(i, i + 8), 2));
    return new Uint8Array(by);
}
export function totpVCode(secret, windowOffset = 0, baseSec) {
    const key = base32Decode(secret);
    const t = (baseSec === undefined ? Math.floor(Date.now() / 1000) : baseSec);
    let ctr = Math.floor(t / 30) + windowOffset;
    const cbuf = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) { cbuf[i] = ctr & 0xff; ctr = Math.floor(ctr / 256); }
    const hex = crypto.hmac('sha1', key.buffer, cbuf.buffer, 'hex');
    const h = [];
    for (let i = 0; i < hex.length; i += 2) h.push(parseInt(hex.substr(i, 2), 16));
    const o = h[h.length - 1] & 0x0f;
    const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
    return String(code % 1000000).padStart(6, '0');
}

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

    // console.log(`[TenantRequest] ========== 请求详情 ==========`);
    // console.log(`[TenantRequest] 租户ID: ${tenant}`);
    // console.log(`[TenantRequest] 请求类型: ${isDesk ? '前台' : '后台'}`);
    // console.log(`[TenantRequest] 基础URL: ${baseUrl}`);
    // console.log(`[TenantRequest] 完整URL: ${url}`);
    // console.log(`[TenantRequest] 原始payload: ${JSON.stringify(payload, null, 2)}`);

    // 添加时间戳、随机数、签名
    // 注意：payload 中已有 language 时优先使用（支持多语言降级重试），否则使用 getTimeRandom 的随机语言
    const timeData = getTimeRandom();
    const requestData = {
        ...payload,
        random: timeData.random,
        language: payload.language !== undefined ? payload.language : timeData.language,
        timestamp: timeData.timestamp
    };

    //console.log(`[TenantRequest] 添加时间参数后: ${JSON.stringify(requestData, null, 2)}`);

    // 生成签名
    const signClient = new SignedHttpClient();
    const signedData = signClient.signData(requestData);

    //console.log(`[TenantRequest] 签名后数据: ${JSON.stringify(signedData, null, 2)}`);

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

    //console.log(`[TenantRequest] 请求Headers: ${JSON.stringify(headers, null, 2)}`);

    // 发送请求
    const response = http.post(url, JSON.stringify(signedData), { headers });

    // console.log(`[TenantRequest] ========== 响应详情 ==========`);
    // console.log(`[TenantRequest] 响应状态码: ${response.status}`);
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

    //console.log(`[TenantRequest] 解析后响应: ${JSON.stringify(parsedBody, null, 2)}`);

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
/**
 * 通用后台登录（带 Google 验证码 vCode + 多窗口重试）—— 所有后台账号（主管理员/受限/客服）统一走这里
 * @param {string} userName - 后台账号
 * @param {string} pwd      - 密码
 * @param {string} secret   - 谷歌验证码 base32 密钥（同租户后台账号共用 GOOGLE_SECRET）；为空则走旧登录
 * @param {string} tenantId - 租户ID（确定后台域）
 * @returns {string|null} token
 */
export function backendLogin(userName, pwd, secret, tenantId = null) {
    // 配了密钥则带 vCode；被拒自动试相邻时间窗口（容忍时钟偏差）。固定基准避免多次取码跨窗口边界。
    const offsets = secret ? [0, -1, 1] : [null];
    const baseSec = Math.floor(Date.now() / 1000);
    let response;
    for (const off of offsets) {
        const payload = { userName, pwd };
        if (off !== null) {
            payload.vCode = totpVCode(secret, off, baseSec);
            console.log(`[backendLogin] 🔐 ${userName} vCode=${payload.vCode}${off ? ` (窗口${off > 0 ? '+' : ''}${off})` : ''}`);
        }
        response = tenantRequest('/api/Login/Login', payload, { isDesk: false, tenantId });
        if (response.msgCode === 0 && response.data && response.data.token) {
            return response.data.token;
        }
        if (response.msgCode !== 1119 && !/vcode/i.test(response.msg || '')) break; // 非 vCode 错误不重试
    }
    console.error(`[backendLogin] ${userName} 登录失败: ${response ? response.msg : 'null'}`);
    return null;
}

/**
 * 后台管理员登录（主管理员账号）
 * @param {string} tenantId - 租户ID，可选
 * @returns {string|null} token
 */
export function tenantAdminLogin(tenantId = null) {
    const tenant = tenantId || __ENV.TENANT || __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    const envConfig = getEnvByTenantId(tenant);
    return backendLogin(envConfig.ADMIN_USERNAME, envConfig.ADMIN_PASSWORD, envConfig.GOOGLE_SECRET, tenant);
}
