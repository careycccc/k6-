/**
 * 请求层公共核心：租户解析、前后台域名、公共请求头、签名
 *
 * sendRequest（tests/api/common/request.js → libs/http/client.js）和
 * tenantRequest（libs/http/tenantRequest.js）都走这里，保证两套请求用同一套租户/域名/签名规则。
 *
 * 2026-10-30：getBaseUrl 默认改为"登录集团、集团查询"——优先把后台查询路由到集团
 * 后台(见 groupRouting.js 的 resolveQueryRoute)，只有集团登录失败时才自动降级为
 * 商户自己的域名。resolveTenant/buildBaseHeaders/signPayload 这三个不做路由决策的
 * 基础函数挪到了 primitives.js（避免这里反过来依赖 groupRouting.js 时形成循环依赖），
 * 这里转发导出，向后兼容所有原来从这个文件 import 它们的调用点。
 *
 * 注意：getBaseUrl 只返回 baseUrl 字符串，不包含集团模式下必须附带的 tenantId
 * 请求头——直接调用这个函数的地方（如 client.js 生成 Domainurl/Referrer 头的分支）
 * 不会自动获得 tenantId 头。真正需要发起查询请求的调用方应该用 resolveQueryRoute
 * 或者已经处理好这件事的 tenantRequest()/resolveApiRoute()，不要绕过它们直接拼请求。
 */

export { resolveTenant, buildBaseHeaders, signPayload } from './primitives.js';
import { resolveQueryRoute } from './groupRouting.js';

/** 前台 / 后台域名（不含路径）。默认优先走集团查询，集团登录失败时自动降级为商户自己的域名 */
export function getBaseUrl(isDesk, tenantId) {
    return resolveQueryRoute(isDesk, tenantId).baseUrl;
}
