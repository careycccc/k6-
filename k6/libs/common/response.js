/**
 * 响应解析公共工具（k6 脚本用，ESM）
 */

/**
 * 从注册/登录响应里取 token：
 *   1. 响应本身就是 token 字符串（sendRequest 登录成功时返回字符串）
 *   2. data.token
 *   3. headers.Authorization（去掉 Bearer 前缀）
 * 都没有返回 null
 */
export function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    if (res.headers) {
        const auth = res.headers['Authorization'] || res.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

/** 字符串/数字安全转数值，非数字返回 0 */
export function toNum(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}
