/**
 * safetest/lib/uploadProbe.js
 * 上传探针 + 回取(fetch-back)验证核心
 *
 * 真实契约（经诊断确认）：
 *   前台未登录上传 = POST {DESK}/api/WorkOrder/UploadToOss
 *     - Authorization: Bearer <游客token>
 *     - multipart 字段名为 file（单数!）+ fileType + customPath
 *     - 成功: { code:0, data:{ fileName, aliasFileName, imagePath, imageDomain } }
 *       完整URL = imageDomain + imagePath；存储名 = aliasFileName（服务端生成）
 *     - 校验: 非图片返回 code:1 msgCode:20 "Please upload a properly formatted image"
 *     - 限流: code:11 msgCode:13 "Too frequent..." → sleep 重试
 *   后台上传 = POST {ADMIN}/api/UploadFile/UploadToOss（字段名 files，data 为数组，会转 webp）
 *
 * - frontendUpload(env, token, opt)   未登录前台上传
 * - adminUpload(env, token, opt)      后台上传
 * - fetchBack(url)                    模拟"客服浏览器点开链接"
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { hostOf } from './env.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

/** 大小写不敏感取响应头 */
export function headerGet(headers, name) {
    if (!headers) return '';
    const lower = String(name).toLowerCase();
    for (const k in headers) {
        if (k.toLowerCase() === lower) return headers[k];
    }
    return '';
}

function frontHeaders(baseUrl, token) {
    const h = {
        'Host': hostOf(baseUrl),
        'ignorecanceltoken': 'true',
        'referer': `${baseUrl}/`,
        'user-agent': UA,
        'accept': 'application/json, text/plain, */*',
        'origin': `${baseUrl}/`,
        'accept-language': 'zh-CN,zh;q=0.9',
        'domainurl': `${baseUrl}/`,
    };
    if (token) h['authorization'] = `Bearer ${token}`;
    return h;
}

/** 统一解析上传响应（兼容前台对象结构 与 后台数组结构） */
function parseUploadResp(res) {
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch (e) { /* 非 JSON */ }
    let src = '', title = '', origName = '', imagePath = '', code = null, msgCode = null, msg = '';
    if (parsed) {
        code = parsed.code;
        msgCode = parsed.msgCode;
        msg = parsed.msg || parsed.message || '';
        const d = parsed.data;
        if (d && parsed.code === 0) {
            if (Array.isArray(d) && d.length > 0) {
                // 后台结构
                src = d[0].src || d[0].file || d[0].url || '';
                title = d[0].title || d[0].name || '';
                origName = d[0].fileName || d[0].originalName || '';
                imagePath = d[0].title || '';
            } else if (d.imagePath) {
                // 前台结构：imageDomain + imagePath
                const dom = String(d.imageDomain || '').replace(/\/$/, '');
                imagePath = String(d.imagePath); // 相对路径，提交工单 fieldValue 用
                src = dom + '/' + imagePath.replace(/^\//, '');
                title = d.aliasFileName || d.imagePath || '';
                origName = d.fileName || ''; // 服务端原样回显的原始文件名（会被带进工单显示给客服）
            }
        }
    }
    return {
        httpStatus: res.status,
        durationMs: res.timings ? Math.round(res.timings.duration) : -1,
        accepted: res.status === 200 && parsed && parsed.code === 0 && !!src,
        code, msgCode, msg, src, title, origName, imagePath,
        error: res.error || '',
        rawBody: res.body ? String(res.body).slice(0, 800) : '',
    };
}

function postWithRateRetry(url, form, headers, rebuildForm) {
    let res = null;
    for (let i = 0; i < 5; i++) {
        res = http.post(url, form, { headers, timeout: '60s', tags: { name: 'safetest_upload' } });
        let msgCode = null;
        try { msgCode = JSON.parse(res.body).msgCode; } catch (e) {}
        if (msgCode === 13) { // Too frequent → 退避重试
            sleep(2.5);
            if (rebuildForm) form = rebuildForm();
            continue;
        }
        break;
    }
    return res;
}

/**
 * 未登录前台上传
 * @param {object} env
 * @param {string} token - 游客 token
 * @param {object} opt - { content, fileName, contentType, fileType='other', customPath='', fieldName='file' }
 */
export function frontendUpload(env, token, opt) {
    const {
        content, fileName,
        contentType = 'application/octet-stream',
        fileType = 'other', customPath = '',
        fieldName = 'file',
    } = opt;
    const url = `${env.BASE_DESK_URL}/api/WorkOrder/UploadToOss`;
    const build = () => {
        const f = {};
        f[fieldName] = http.file(content, fileName, contentType);
        f.fileType = fileType;
        f.customPath = customPath;
        return f;
    };
    const res = postWithRateRetry(url, build(), frontHeaders(env.BASE_DESK_URL, token), build);
    const r = parseUploadResp(res);
    r.endpoint = url;
    return r;
}

/**
 * 后台上传（带 Bearer token，字段名 files）
 */
export function adminUpload(env, token, opt) {
    const {
        content, fileName,
        contentType = 'application/octet-stream',
        fileType = 'other', customPath = '',
    } = opt;
    const url = `${env.BASE_ADMIN_URL}/api/UploadFile/UploadToOss`;
    const build = () => ({
        files: http.file(content, fileName, contentType),
        fileType, customPath,
    });
    const res = postWithRateRetry(url, build(), frontHeaders(env.BASE_ADMIN_URL, token), build);
    const r = parseUploadResp(res);
    r.endpoint = url;
    return r;
}

/**
 * 回取验证：模拟客服浏览器"点开这个图片/附件链接"
 * @param {string} url - 绝对 URL
 */
export function fetchBack(url) {
    const res = http.get(url, {
        headers: {
            'user-agent': UA,
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        redirects: 2,
        timeout: '30s',
        tags: { name: 'safetest_fetchback' },
    });
    const h = res.headers || {};
    const body = res.body ? String(res.body) : '';
    return {
        url,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        headers: h,
        contentType: headerGet(h, 'Content-Type'),
        contentDisposition: headerGet(h, 'Content-Disposition'),
        xContentTypeOptions: headerGet(h, 'X-Content-Type-Options'),
        csp: headerGet(h, 'Content-Security-Policy'),
        server: headerGet(h, 'Server'),
        length: body.length,
        body,
        bodyHead: body.slice(0, 300),
        error: res.error || '',
    };
}
