/**
 * TOTP(RFC6238) 验证码计算 —— 标准 SHA1 / 30秒 / 6位
 *
 * 2026-10-30 从 libs/http/tenantRequest.js 提取到这个独立的纯工具模块
 * ——不依赖项目内任何业务模块（只用 k6/crypto），纯函数。提取的直接原因：
 * 新增的 libs/http/groupRouting.js 需要在集团登录时算 TOTP，而它本身又会
 * 被 tenantRequest.js 的 tenantAdminLogin() 引用(集团优先登录逻辑)——如果
 * totpVCode 还留在 tenantRequest.js 里，会出现
 * tenantRequest.js → groupRouting.js → tenantRequest.js 的循环依赖。
 * 挪到这个不依赖任何业务模块的独立文件，两边都能单向import，不会成环。
 *
 * tenantRequest.js 保留 `export { totpVCode } from '../utils/totp.js'` 转发，
 * 向后兼容所有原来 `import { totpVCode } from '.../tenantRequest.js'` 的调用点。
 */
import crypto from 'k6/crypto';

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
