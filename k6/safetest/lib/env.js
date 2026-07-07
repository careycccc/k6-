/**
 * safetest/lib/env.js
 * 环境解析与来源(origin)判定工具
 *
 * - getSafeEnv()      按 __ENV.TENANT_ID（默认 3004）取环境配置
 * - hostOf/baseOf     从 URL 提取 host / scheme+host
 * - classifyOrigin()  判定上传文件返回的 src 与后台/前台是否同源（影响 XSS 严重度）
 * - absoluteUrl()     把可能是相对路径的 src 补全成可访问的绝对 URL
 */
import { ENV_MAP, ENV_CONFIG } from '../../config/envconfig.js';

/** 默认租户：3004 SIT。用 -e TENANT_ID=3101 覆盖 */
export function getSafeEnv() {
    const tid = __ENV.TENANT_ID || '3004';
    return ENV_MAP[tid] || ENV_CONFIG;
}

export function tenantId() {
    return __ENV.TENANT_ID || '3004';
}

/** 提取主机名（小写，去端口） */
export function hostOf(url) {
    const m = String(url || '').match(/^https?:\/\/([^\/:]+)/i);
    return m ? m[1].toLowerCase() : '';
}

/** 提取 scheme + host（如 https://a.b.com） */
export function baseOf(url) {
    const m = String(url || '').match(/^(https?:\/\/[^\/]+)/i);
    return m ? m[1] : '';
}

/** 取可注册主域的近似（末两段），用于跨子域同源近似判断 */
function registrable(host) {
    const parts = String(host || '').split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    return parts.slice(-2).join('.');
}

/**
 * 判定上传返回的 src 与前台/后台的关系
 * @returns {{kind, srcHost, note}}
 *   kind: 'same-origin-admin' | 'same-origin-desk' | 'same-site' | 'third-party'
 */
export function classifyOrigin(src, env) {
    const srcHost = hostOf(src);
    const adminHost = hostOf(env.BASE_ADMIN_URL);
    const deskHost = hostOf(env.BASE_DESK_URL);

    if (!srcHost) return { kind: 'unknown', srcHost, note: 'src 非绝对 URL 或为空' };
    if (srcHost === adminHost) return { kind: 'same-origin-admin', srcHost, note: '与后台完全同源（最危险）' };
    if (srcHost === deskHost) return { kind: 'same-origin-desk', srcHost, note: '与前台完全同源' };

    const srcReg = registrable(srcHost);
    if (srcReg && (srcReg === registrable(adminHost) || srcReg === registrable(deskHost))) {
        return { kind: 'same-site', srcHost, note: `同主域(${srcReg})不同子域` };
    }
    return { kind: 'third-party', srcHost, note: '独立域名（疑似 OSS/CDN 对象存储）' };
}

/** 把 src 补全为绝对 URL（相对路径时默认拼前台域） */
export function absoluteUrl(src, env) {
    const s = String(src || '');
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('//')) return 'https:' + s;
    return baseOf(env.BASE_DESK_URL) + '/' + s.replace(/^\//, '');
}
