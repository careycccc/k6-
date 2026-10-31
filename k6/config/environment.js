import { loadConfigFromFile } from './load.js';
import { resolveTenant } from '../libs/http/primitives.js';
import { resolveQueryRoute } from '../libs/http/groupRouting.js';

const config = loadConfigFromFile();

/**
 * 获取当前环境信息
 * @returns {Object} 环境信息对象
 */
export function getEnvironment() {
  return {
    name: config.environment,
    baseUrl: config.local.API_BASE_URL,
    adminUrl: config.local.API_ADMIN_URL,
    version: config.apiVersion
  };
}

/**
 * 解析一次请求的完整路由：完整 URL + baseUrl + 需要额外合并的请求头。
 * 默认优先走集团查询，集团登录失败时自动降级为商户自己的域名（isDesk=true 的前台
 * 请求不受影响，见 libs/http/groupRouting.js 的 resolveQueryRoute）。这是
 * sendRequest 路径（libs/http/client.js）判断"该打到哪、该带什么 tenantId 头"的
 * 唯一入口，避免 getApiUrl 和 getBaseUrl 各算一遍导致两边不一致。
 * @param {string} endpoint - API端点
 * @param {boolean} isDesk - 是否是前台请求，true前台，false后台
 * @param {boolean} [forceTenant=false] - 强制走商户自己的域名，不套集团路由（2026-10-30
 *   新增，透传给 resolveQueryRoute）。给已经用商户 token 登录的调用方用，避免 token 和
 *   路由不同步导致 "Account type does not match the admin site"。
 * @returns {{url: string, baseUrl: string, extraHeaders: object}}
 */
export function resolveApiRoute(endpoint, isDesk = true, forceTenant = false) {
  const tenantIdStr = resolveTenant();
  const route = resolveQueryRoute(isDesk, tenantIdStr, forceTenant);

  // resolveQueryRoute 商户降级分支本身等价于旧版 getTenantBaseUrl，这里只是在
  // 极端情况（配置里连商户自己的域名都没配）下兜底到 config.local，和旧版 getApiUrl
  // 的兜底行为保持一致。
  const baseUrl = route.baseUrl || (isDesk ? config.local.API_BASE_URL : config.local.API_ADMIN_URL);

  const path = String(endpoint || '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const version = config.apiVersion ? `/${config.apiVersion}` : '';

  return { url: `${baseUrl}${version}${normalizedPath}`, baseUrl, extraHeaders: route.extraHeaders };
}

/**
 * 根据端点获取完整的API URL
 * @param {string} endpoint - API端点
 * @param {boolean} isDesk - 是否是前台请求，true前台，false后台
 * @returns {string} 完整的API URL
 */
export function getApiUrl(endpoint, isDesk = true) {
  return resolveApiRoute(endpoint, isDesk).url;
}
