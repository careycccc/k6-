/**
 * workOrderSuite/lib/upload.js
 * 图片上传工具库
 *
 * - uploadAdmin()      后台上传 /api/UploadFile/UploadToOss
 * - uploadFrontend()   前台上传 /api/WorkOrder/UploadToOss
 * - maybeUpload()      30% 概率触发上传的包装器
 */

import http from 'k6/http';
import { check } from 'k6';
import { logger } from '../../../../../libs/utils/logger.js';

// ============================================================
// 图片预加载（模块初始化阶段）
// 4 张图片全部预加载，运行时随机选择
// ============================================================
const IMAGES = [
    { content: open('../../../uploadFile/img/oneToone/1.png', 'b'), name: '1.png' },
    { content: open('../../../uploadFile/img/oneToone/2.png', 'b'), name: '2.png' },
    { content: open('../../../uploadFile/img/oneToone/3.png', 'b'), name: '3.png' },
    { content: open('../../../uploadFile/img/oneToone/4.png', 'b'), name: '4.png' },
];

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
 * @param {object} env  - 当前环境配置（含 BASE_ADMIN_URL）
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
export function uploadAdmin(adminToken, env) {
    const img = randomImage();
    try {
        const formData = {
            files: http.file(img.content, img.name, 'image/png'),
            fileType: 'other',
            customPath: '',
        };
        const baseUrl = env.BASE_ADMIN_URL;
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

function _uploadFrontendWithToken(env, token) {
    const img = randomImage();
    try {
        const formData = {
            files: http.file(img.content, img.name, 'image/png'),
            fileType: 'other',
            customPath: '',
        };
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
        const res = http.post(`${baseUrl}/api/WorkOrder/UploadToOss`, formData, { headers });
        check(res, { '[uploadFrontend] status 200': (r) => r.status === 200 });
        const body = JSON.parse(res.body);
        const attachment = extractAttachment(body);
        if (attachment) {
            logger.info(`[${TAG}] 前台图片上传成功: ${attachment.attachmentName}`);
            return { success: true, ...attachment };
        }
        logger.error(`[${TAG}] 前台图片上传失败: ${res.body}`);
        return { success: false, error: body.msg || res.body };
    } catch (e) {
        logger.error(`[${TAG}] 前台图片上传异常: ${e.message}`);
        return { success: false, error: e.message };
    }
}

// ============================================================
// 概率上传包装器
// ============================================================

/**
 * 以 UPLOAD_PROBABILITY(30%) 的概率触发上传
 * @param {'admin'|'frontend'} side - 上传方向
 * @param {string|null} adminToken  - 后台 token（side=admin 时必填）
 * @param {object} env              - 环境配置
 * @returns {{ attachmentName: string, attachmentPath: string }}
 *   命中但失败时返回空字符串，未命中返回空字符串
 */
export function maybeUpload(side, adminToken, env) {
    const empty = { attachmentName: '', attachmentPath: '' };
    if (Math.random() >= UPLOAD_PROBABILITY) return empty;

    logger.info(`[${TAG}] 触发 ${side} 图片上传（概率 ${UPLOAD_PROBABILITY * 100}%）`);
    const result = side === 'admin' ? uploadAdmin(adminToken, env) : uploadFrontend(env);
    if (result.success) {
        return { attachmentName: result.attachmentName, attachmentPath: result.attachmentPath };
    }
    logger.warn(`[${TAG}] ${side} 图片上传失败，退回纯文字`);
    return empty;
}
