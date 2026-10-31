/**
 * 多租户请求工具
 * 完全支持多环境配置和签名机制
 */

import http from 'k6/http';
import { buildBaseHeaders, signPayload, resolveTenant, getTenantBaseUrl } from './primitives.js';
import { resolveQueryRoute, getGroupToken } from './groupRouting.js';
import { getTimeRandom } from '../../tests/utils/utils.js';
import { getEnvByTenantId } from '../../config/envconfig.js';

// 2026-10-30：TOTP 计算逻辑迁移到了 libs/utils/totp.js（独立的纯工具模块，不依赖任何
// 业务模块）。迁移原因：groupRouting.js 登录集团后台时也要算 TOTP，而 tenantAdminLogin()
// (本文件)又要反过来调用 groupRouting.js 优先尝试集团登录——如果 totpVCode 留在本文件，
// 会成环。注意：必须先 import 再单独 export——`export {x} from 'y'` 这种一步到位的转发
// 导出语法只会把 x 加进本模块的对外导出列表，不会在本模块内部创建 x 的本地绑定，本文件
// 下面 backendLogin() 内部直接用 totpVCode(...) 会拿到 ReferenceError（已实测踩坑）。
import { totpVCode } from '../utils/totp.js';
export { totpVCode };

/**
 * 发送多租户请求
 * @param {string} api - API路径，如 '/api/Login/Login'
 * @param {object} payload - 请求数据
 * @param {object} options - 选项
 *   - isDesk: 是否前台请求，默认 true
 *   - token: 认证token，可选
 *   - tenantId: 租户ID，可选（默认从环境变量读取）
 *   - forceTenant: 强制走商户自己的域名，不套集团路由（可选，默认 false）。
 *     和 tenantAdminLogin(tenantId, true) 的 forceTenant 参数是同一个概念：
 *     登录拿到商户 token 后，后续用这个 token 发请求也要传 forceTenant:true，
 *     否则 resolveQueryRoute 会独立判断"集团可用"、把请求路由到集团域名，
 *     商户 token 打到集团域名会报 "Account type does not match the admin
 *     site"（已实测踩坑：tenantAdminLogin 的 forceTenant 只管登录这一步，不会
 *     被后续 tenantRequest 调用自动继承）。
 * @returns {object} 响应对象 {status, body, data, msgCode, msg}
 */
export function tenantRequest(api, payload = {}, options = {}) {
    const {
        isDesk = true,
        token = null,
        tenantId = null,
        forceTenant = false
    } = options;

    // 租户 / 域名：默认优先走集团查询，集团登录失败时自动降级为商户自己的域名
    // （resolveQueryRoute 内部复用 core.js 的 resolveTenant 规则，isDesk=true 时
    // 不受集团模式影响，直接走商户前台域名）。
    // 但登录接口(/api/Login/Login)例外，永远不套集团路由——backendLogin() 这个
    // 通用登录函数不止给 tenantAdminLogin(主管理员)用，也被受限账号/客服/工单角色
    // 等登录场景直接调用（见 tests/api/withdraw/concurrentLockWithdraw.test.js、
    // tests/api/activity/workOrderSuite/runWorkOrderFull.test.js 等），这些账号的
    // 用户名密码是商户私有的，集团后台认不出来，打过去只会登录失败。真正的"集团
    // 管理员登录"由 groupRouting.js 的 groupAdminLogin 独立实现，不经过这个函数。
    // forceTenant 同理：调用方已经拿到商户 token 时，显式传它跳过集团路由。
    const isLoginApi = api === '/api/Login/Login';
    const { baseUrl, extraHeaders } = (isLoginApi || forceTenant)
        ? { baseUrl: getTenantBaseUrl(isDesk, tenantId), extraHeaders: {} }
        : resolveQueryRoute(isDesk, tenantId);
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

    const signedData = signPayload(requestData);
    const headers = { ...buildBaseHeaders(baseUrl, token), ...extraHeaders };
    if (token) {
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
    const tenant = resolveTenant(options.tenantId);
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
 * 后台管理员登录（主管理员账号）。默认优先登录集团后台，拿到集团token就直接返回——
 * 这个token和路由天然匹配：后续任何经过 resolveQueryRoute 的查询请求，会自动识别出
 * 该 tenantId 处于集团模式并把请求打到集团域名，不会出现"集团token打到商户域名"的
 * 错配。只有该 tenantId 不属于任何集团实例、或集团登录失败时，才降级为商户自己登录
 * （现有行为不变）。
 * @param {string} tenantId - 租户ID，可选
 * @param {boolean} [forceTenant=false] - 强制走商户自己登录，跳过集团模式（逃生舱口，
 *   用于明确要测试"这个特定商户自己后台"行为的场景）
 * @returns {string|null} token
 */
export function tenantAdminLogin(tenantId = null, forceTenant = false) {
    const tenant = resolveTenant(tenantId);

    if (!forceTenant) {
        const groupToken = getGroupToken(tenant);
        if (groupToken) return groupToken;
    }

    const envConfig = getEnvByTenantId(tenant);
    return backendLogin(envConfig.ADMIN_USERNAME, envConfig.ADMIN_PASSWORD, envConfig.GOOGLE_SECRET, tenant);
}
