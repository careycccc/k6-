/**
 * workOrderSuite/lib/upload.js
 * 图片上传工具库
 *
 * - uploadAdmin()            后台上传 /api/UploadFile/UploadToOss
 * - uploadFrontend()         前台上传 /api/WorkOrder/UploadToOss
 * - uploadWorkOrderFile()    前台按工单字段类型上传（ImageUpload/FileUpload/VideoUpload/PdfUpload）
 * - maybeUpload()            30% 概率触发上传的包装器
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';
import { SignatureUtil } from '../../../../../libs/utils/signature.js';
import { getTimeRandom } from '../../../../utils/utils.js';
import { resolveQueryRoute } from '../../../../../libs/http/groupRouting.js';

// ============================================================
// 文件预加载（模块初始化阶段）
// 4 张图片全部预加载，运行时随机选择；PDF / 视频各一份，给对应字段类型用
// ============================================================
const IMAGES = [
    { content: open('../../../uploadFile/img/oneToone/1.png', 'b'), name: '1.png', mime: 'image/png' },
    { content: open('../../../uploadFile/img/oneToone/2.png', 'b'), name: '2.png', mime: 'image/png' },
    { content: open('../../../uploadFile/img/oneToone/3.png', 'b'), name: '3.png', mime: 'image/png' },
    { content: open('../../../uploadFile/img/oneToone/4.png', 'b'), name: '4.png', mime: 'image/png' },
];
const PDF_FILE = { content: open('../../../uploadFile/pdf/99.pdf', 'b'), name: '99.pdf', mime: 'application/pdf' };
// 约 9.5MB，每个 VU 各持有一份；前台视频上限 100MB
const VIDEO_FILE = { content: open('../../../uploadFile/video/IMG_0619.MOV', 'b'), name: 'IMG_0619.MOV', mime: 'video/quicktime' };

/**
 * 工单字段类型 → 上传什么文件（与前台 accept 规则一致，2026-11-06 读 3004 前台包确认）：
 *   ImageUpload 只收 jpg/jpeg/png；VideoUpload 只收视频；
 *   FileUpload 收 .pdf + 视频（不收图片）；PdfUpload 只收 pdf
 */
const FILE_BY_FIELD_TYPE = {
    ImageUpload: () => randomImage(),
    VideoUpload: () => VIDEO_FILE,
    FileUpload: () => PDF_FILE,
    PdfUpload: () => PDF_FILE,
};

/** 30% 上传概率常量，统一在此调整 */
export const UPLOAD_PROBABILITY = 0.3;

const TAG = 'Upload';

// ============================================================
// 内部工具
// ============================================================

function randomImage() {
    return IMAGES[Math.floor(Math.random() * IMAGES.length)];
}

function extractAttachment(responseBody) {
    if (!responseBody || responseBody.code !== 0) return null;
    const items = responseBody.data;
    if (!items || items.length === 0) return null;
    const item = items[0];
    const fullUrl = item.src || item.file || '';
    const attachmentPath = fullUrl.replace(/^https?:\/\/[^/]+\//, '');
    return { attachmentName: item.title, attachmentPath };
}

// ============================================================
// 后台图片上传
// ============================================================

/**
 * 后台上传图片到 /api/UploadFile/UploadToOss
 * @param {string} adminToken
 * @param {object} env  - 当前环境配置（含 BASE_ADMIN_URL、TENANTID）
 * @param {boolean} [forceTenant=false] - adminToken 是商户自己登录拿到的（非集团token）时传
 *   true，否则集团模式下这里原来硬编码走商户域名，会和集团 token 错配报 "Account type
 *   does not match the admin site"（2026-11-07 实测踩坑，见 libs/http/groupRouting.js
 *   顶部注释）。现在改成和其它后台接口一样走 resolveQueryRoute 判断域名。
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
export function uploadAdmin(adminToken, env, forceTenant = false) {
    const img = randomImage();
    try {
        const formData = {
            files: http.file(img.content, img.name, 'image/png'),
            fileType: 'other',
            customPath: '',
        };
        const { baseUrl, extraHeaders } = resolveQueryRoute(false, env.TENANTID, forceTenant);
        const host = baseUrl.replace(/^(https?:\/\/)?([^:/\s]+).*$/, '$2');
        const params = {
            headers: {
                'Host': host,
                'ignorecanceltoken': 'true',
                'referer': `${baseUrl}/`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'accept': 'application/json, text/plain, */*',
                'origin': `${baseUrl}/`,
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${adminToken}`,
                'domainurl': `${baseUrl}/`,
                ...extraHeaders,
            },
        };
        const res = http.post(`${baseUrl}/api/UploadFile/UploadToOss`, formData, params);
        check(res, { '[uploadAdmin] status 200': (r) => r.status === 200 });
        const body = JSON.parse(res.body);
        const attachment = extractAttachment(body);
        if (attachment) {
            logger.info(`[${TAG}] 后台图片上传成功: ${attachment.attachmentName}`);
            return { success: true, ...attachment };
        }
        logger.error(`[${TAG}] 后台图片上传失败: ${res.body}`);
        return { success: false, error: body.msg || res.body };
    } catch (e) {
        logger.error(`[${TAG}] 后台图片上传异常: ${e.message}`);
        return { success: false, error: e.message };
    }
}

// ============================================================
// 前台图片上传（未登录）
// ============================================================

/**
 * 前台上传图片到 /api/WorkOrder/UploadToOss（无需 token）
 * @param {object} env  - 当前环境配置（含 BASE_DESK_URL）
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
export function uploadFrontend(env) {
    return _uploadFrontendWithToken(env, '');
}

/**
 * 前台上传图片到 /api/WorkOrder/UploadToOss（已登录，带 token）
 * @param {object} env         - 当前环境配置（含 BASE_DESK_URL）
 * @param {string} memberToken - 会员前台 token
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
export function uploadFrontendWithToken(env, memberToken) {
    return _uploadFrontendWithToken(env, memberToken || '');
}

/**
 * 前台按工单字段类型上传对应文件，返回值里直接带上提交用的 fieldValue
 * （前台提交格式：`${imagePath}?${fileName}`）
 * @param {object} env
 * @param {string} memberToken
 * @param {string} fieldTypeCode - ImageUpload / FileUpload / VideoUpload / PdfUpload
 * @returns {{ success, attachmentName, attachmentPath, fieldValue } | { success: false, error }}
 */
export function uploadWorkOrderFile(env, memberToken, fieldTypeCode) {
    const pick = FILE_BY_FIELD_TYPE[fieldTypeCode] || FILE_BY_FIELD_TYPE.ImageUpload;
    const result = _uploadFrontendWithToken(env, memberToken || '', pick());
    if (result.success) result.fieldValue = `${result.attachmentPath}?${result.attachmentName}`;
    return result;
}

/**
 * 前台上传：和前台 selfService 页一致（2026-11-06 读 3004 前台包确认）——
 * multipart 字段名是 file（不是 files），并且像普通接口一样带 language/random/signature/timestamp
 * 签名（File 对象不参与签名）。旧写法 files + fileType/customPath、不签名，后端一律回
 * "Param is Invalid"(msgCode 6)。响应 data 是对象 { fileName, imagePath, imageDomain }。
 */
function _uploadFrontendWithToken(env, token, file) {
    const img = file || randomImage();
    try {
        const baseUrl = env.BASE_DESK_URL;
        const host = baseUrl.replace(/^(https?:\/\/)?([^:/\s]+).*$/, '$2');
        const headers = {
            'Host': host,
            'ignorecanceltoken': 'true',
            'referer': `${baseUrl}/`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'accept': 'application/json, text/plain, */*',
            'origin': `${baseUrl}/`,
            'accept-language': 'zh-CN,zh;q=0.9',
            'domainurl': `${baseUrl}/`,
        };
        if (token) {
            headers['authorization'] = `Bearer ${token}`;
        }
        let res = null;
        let body = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            // 每次重试都重新签名（timestamp/random 要新的）
            const t = getTimeRandom();
            const signed = SignatureUtil.signRequest({ language: t.language, random: t.random, signature: '' }, '');
            const formData = {
                file: http.file(img.content, img.name, img.mime || 'image/png'),
                language: String(signed.language),
                random: String(signed.random),
                signature: String(signed.signature),
                timestamp: String(signed.timestamp),
            };
            res = http.post(`${baseUrl}/api/WorkOrder/UploadToOss`, formData, { headers, timeout: '120s' });
            body = JSON.parse(res.body);
            if (!body || body.msgCode !== 13) break; // 13 = Too frequent access
            logger.warn(`[${TAG}] 上传太频繁，${attempt * 3}s 后重试 (${attempt}/3)`);
            sleep(attempt * 3);
        }
        check(res, { '[uploadFrontend] status 200': (r) => r.status === 200 });
        const attachment = extractFrontendAttachment(body);
        if (attachment) {
            logger.info(`[${TAG}] 前台上传成功: ${attachment.attachmentName}`);
            return { success: true, ...attachment };
        }
        logger.error(`[${TAG}] 前台上传失败(${img.name}): ${res.body}`);
        return { success: false, error: (body && body.msg) || res.body };
    } catch (e) {
        logger.error(`[${TAG}] 前台上传异常: ${e.message}`);
        return { success: false, error: e.message };
    }
}

function extractFrontendAttachment(responseBody) {
    if (!responseBody || responseBody.code !== 0 || !responseBody.data) return null;
    const item = Array.isArray(responseBody.data) ? responseBody.data[0] : responseBody.data;
    if (!item || !item.imagePath) return null;
    return { attachmentName: item.fileName, attachmentPath: item.imagePath };
}

// ============================================================
// 概率上传包装器
// ============================================================

/**
 * 以 UPLOAD_PROBABILITY(30%) 的概率触发上传
 * @param {'admin'|'frontend'} side - 上传方向
 * @param {string|null} adminToken  - 后台 token（side=admin 时必填）
 * @param {object} env              - 环境配置
 * @param {boolean} [forceTenant=false] - 同 uploadAdmin，仅 side='admin' 时生效
 * @returns {{ attachmentName: string, attachmentPath: string }}
 *   命中但失败时返回空字符串，未命中返回空字符串
 */
export function maybeUpload(side, adminToken, env, forceTenant = false) {
    const empty = { attachmentName: '', attachmentPath: '' };
    if (Math.random() >= UPLOAD_PROBABILITY) return empty;

    logger.info(`[${TAG}] 触发 ${side} 图片上传（概率 ${UPLOAD_PROBABILITY * 100}%）`);
    const result = side === 'admin' ? uploadAdmin(adminToken, env, forceTenant) : uploadFrontend(env);
    if (result.success) {
        return { attachmentName: result.attachmentName, attachmentPath: result.attachmentPath };
    }
    logger.warn(`[${TAG}] ${side} 图片上传失败，退回纯文字`);
    return empty;
}
