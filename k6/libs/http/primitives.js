/**
 * HTTP 请求层最底层基础设施：租户解析、公共请求头、签名。
 *
 * 2026-10-30 从 core.js 提取到这里。原因：core.js 的 getBaseUrl 要改为默认走
 * "登录集团、集团查询"路由（见 groupRouting.js 的 resolveQueryRoute），但
 * groupRouting.js 的 groupAdminLogin 又需要 buildBaseHeaders/signPayload 这几个
 * 函数来拼登录请求——如果这几个函数留在 core.js，会形成
 * core.js → groupRouting.js → core.js 的循环依赖。
 * 提取到这个不做任何路由决策的纯基础设施模块，core.js 和 groupRouting.js
 * 都能单向 import，不会成环。
 *
 * core.js 保留 `export {...} from './primitives.js'` 转发，向后兼容所有原来
 * `import { resolveTenant, buildBaseHeaders, signPayload } from '.../core.js'` 的调用点。
 */
import { SignedHttpClient } from '../utils/signature.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../config/envconfig.js';

/** 租户 ID：显式传入 > -e TENANT > -e TENANT_ID > envconfig 默认 */
export function resolveTenant(tenantId) {
    return String(tenantId || __ENV.TENANT || __ENV.TENANT_ID || ENV_CONFIG.TENANTID);
}

/**
 * 纯商户域名（不考虑集团路由），前台 / 后台域名，不含路径。
 * 给明确不该套集团模式的场景用——目前只有"登录"请求本身：登录接口的用户名密码是
 * 商户私有账号体系的凭证，集团后台认不出来，必须老老实实打到商户自己的域名
 * （见 tenantRequest.js 对 /api/Login/Login 的特判，以及 groupRouting.js 的
 * resolveQueryRoute 在集团不可用时的降级分支，两处都复用这个函数）。
 */
export function getTenantBaseUrl(isDesk, tenantId) {
    const env = getEnvByTenantId(resolveTenant(tenantId));
    return isDesk ? env.BASE_DESK_URL : env.BASE_ADMIN_URL;
}

/** 后端要求的公共请求头：Domainurl / Referrer 为前台或后台域名，有 token 时带 Authorization */
export function buildBaseHeaders(baseUrl, token) {
    const headers = {
        'Content-Type': 'application/json',
        'Domainurl': baseUrl,
        'Referrer': baseUrl
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

const signer = new SignedHttpClient();

/** 按项目统一规则给请求体签名（signature 字段） */
export function signPayload(data, options = {}) {
    return signer.signData(data, options);
}
