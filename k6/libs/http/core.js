/**
 * 请求层公共核心：租户解析、前后台域名、公共请求头、签名
 *
 * sendRequest（tests/api/common/request.js → libs/http/client.js）和
 * tenantRequest（libs/http/tenantRequest.js）都走这里，保证两套请求用同一套租户/域名/签名规则。
 */

import { SignedHttpClient } from '../utils/signature.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../config/envconfig.js';

/** 租户 ID：显式传入 > -e TENANT > -e TENANT_ID > envconfig 默认 */
export function resolveTenant(tenantId) {
    return String(tenantId || __ENV.TENANT || __ENV.TENANT_ID || ENV_CONFIG.TENANTID);
}

/** 前台 / 后台域名（不含路径） */
export function getBaseUrl(isDesk, tenantId) {
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
