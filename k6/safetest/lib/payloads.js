/**
 * safetest/lib/payloads.js
 * payload 构造工具（图片型绕过：polyglot 等）
 */

/** 把 ASCII 字符串追加到 ArrayBuffer 末尾，返回新的 ArrayBuffer（用于图片多态 polyglot） */
export function appendAscii(arrayBuffer, str) {
    const a = new Uint8Array(arrayBuffer);
    const out = new Uint8Array(a.length + str.length);
    out.set(a, 0);
    for (let i = 0; i < str.length; i++) out[a.length + i] = str.charCodeAt(i) & 0xff;
    return out.buffer;
}

/** 取内容字节长度（字符串或 ArrayBuffer 均可） */
export function byteLen(x) {
    if (typeof x === 'string') return x.length;
    try { return new Uint8Array(x).length; } catch (e) { return -1; }
}

/** 从 URL/文件名取小写扩展名（含点），无则空串 */
export function extOf(name) {
    const m = String(name || '').split('?')[0].match(/(\.[a-z0-9]{1,8})$/i);
    return m ? m[1].toLowerCase() : '';
}
