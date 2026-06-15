/**
 * runCsReply.test.js
 * 工单客服回复流程自动化脚本
 *
 * 流程：
 * 1. 后台管理员获取待处理工单列表 (一对一客服)
 * 2. 锁定工单（模拟客服抢单）
 * 3. 客服随机回复 1~3 次（50% 概率上传图片）
 * 4. 通过会员账号查出 userId，拼接 14 位长 ID
 * 5. 会员前台随机回复 1~3 次（50% 概率上传图片）
 *
 * 运行示例：
 *   k6 run -e TENANT_ID=3101 runCsReply.test.js
 */

import { sleep } from 'k6';
import http from 'k6/http';
import { check } from 'k6';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { logger } from '../../../../libs/utils/logger.js';
import { httpClient } from '../../../../libs/http/client.js';
import { SignatureUtil } from '../../../../libs/utils/signature.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../../../config/envconfig.js';

// ============================================================
// 图片预加载（模块初始化阶段，4 张图全部加载）
// ============================================================
const ONE_TO_ONE_IMAGES = [
    { content: open('../../uploadFile/img/oneToone/1.png', 'b'), name: '1.png' },
    { content: open('../../uploadFile/img/oneToone/2.png', 'b'), name: '2.png' },
    { content: open('../../uploadFile/img/oneToone/3.png', 'b'), name: '3.png' },
    { content: open('../../uploadFile/img/oneToone/4.png', 'b'), name: '4.png' },
];

// ============================================================
// K6 选项
// ============================================================
export const options = {
    vus: 1,
    iterations: 1,
    maxDuration: '15m',
};

const TAG = 'CsReply';

// ============================================================
// 工具函数
// ============================================================

/**
 * 获取当前租户环境配置
 */
function getCurrentEnv() {
    const tenantId = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    return getEnvByTenantId(tenantId);
}

/**
 * 根据租户ID和短 userId 拼接 14 位长 userId
 * 规则: 4位租户ID + 补0 + 短userId，总长14位
 * 例: 3004 + 138649 => 30040000138649
 */
function buildLongUserId(tenantId, shortUserId) {
    const tenantStr = String(tenantId);         // "3004"
    const userStr = String(shortUserId);         // "138649"
    const padLength = 14 - tenantStr.length - userStr.length;
    const padding = '0'.repeat(Math.max(0, padLength));
    return tenantStr + padding + userStr;
}

/**
 * 根据租户 ID 和账号类型推断客服 remark 前缀
 * 主账号: systemkefu3004
 * 副账号 (后续新增): kefu3004
 * @param {string} tenantId
 * @param {boolean} isMainAdmin - 是否是主管理账号
 */
function buildKefuPrefix(tenantId, isMainAdmin = true) {
    return isMainAdmin ? `systemkefu${tenantId}` : `kefu${tenantId}`;
}

/**
 * 随机从 ONE_TO_ONE_IMAGES 中取一张
 */
function randomImage() {
    const idx = Math.floor(Math.random() * ONE_TO_ONE_IMAGES.length);
    return ONE_TO_ONE_IMAGES[idx];
}

/**
 * 后台上传图片 /api/UploadFile/UploadToOss
 * @param {string} adminToken
 * @param {object} env - 当前环境配置
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
function uploadImageAdmin(adminToken, env) {
    const img = randomImage();
    try {
        const formData = {
            files: http.file(img.content, img.name, 'image/png'),
            fileType: 'other',
            customPath: '',
        };
        const host = env.BASE_ADMIN_URL.replace(/^(https?:\/\/)?([^:/\s]+).*$/, '$2');
        const params = {
            headers: {
                'Host': host,
                'ignorecanceltoken': 'true',
                'referer': `${env.BASE_ADMIN_URL}/`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'accept': 'application/json, text/plain, */*',
                'origin': `${env.BASE_ADMIN_URL}/`,
                'accept-language': 'zh-CN,zh;q=0.9',
                'authorization': `Bearer ${adminToken}`,
                'domainurl': `${env.BASE_ADMIN_URL}/`,
            },
        };
        const res = http.post(`${env.BASE_ADMIN_URL}/api/UploadFile/UploadToOss`, formData, params);
        check(res, { '[Admin Upload] status 200': (r) => r.status === 200 });
        if (res.status === 200) {
            const body = JSON.parse(res.body);
            if (body.code === 0 && body.data && body.data.length > 0) {
                const item = body.data[0];
                // src 通常是完整URL，提取相对路径作为 attachmentPath
                const fullUrl = item.src || item.file || '';
                const attachmentPath = fullUrl.replace(/^https?:\/\/[^/]+\//, '');
                logger.info(`[${TAG}] 后台图片上传成功: ${item.title}`);
                return { success: true, attachmentName: item.title, attachmentPath };
            }
        }
        logger.error(`[${TAG}] 后台图片上传失败: ${res.body}`);
        return { success: false, error: res.body };
    } catch (e) {
        logger.error(`[${TAG}] 后台图片上传异常: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * 前台上传图片 /api/WorkOrder/UploadToOss（未登录）
 * @param {object} env - 当前环境配置
 * @returns {{ success, attachmentName, attachmentPath } | { success: false, error }}
 */
function uploadImageFrontend(env) {
    const img = randomImage();
    try {
        const formData = {
            files: http.file(img.content, img.name, 'image/png'),
            fileType: 'other',
            customPath: '',
        };
        const host = env.BASE_DESK_URL.replace(/^(https?:\/\/)?([^:/\s]+).*$/, '$2');
        const params = {
            headers: {
                'Host': host,
                'ignorecanceltoken': 'true',
                'referer': `${env.BASE_DESK_URL}/`,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'accept': 'application/json, text/plain, */*',
                'origin': `${env.BASE_DESK_URL}/`,
                'accept-language': 'zh-CN,zh;q=0.9',
                'domainurl': `${env.BASE_DESK_URL}/`,
            },
        };
        const res = http.post(`${env.BASE_DESK_URL}/api/WorkOrder/UploadToOss`, formData, params);
        check(res, { '[Frontend Upload] status 200': (r) => r.status === 200 });
        if (res.status === 200) {
            const body = JSON.parse(res.body);
            if (body.code === 0 && body.data && body.data.length > 0) {
                const item = body.data[0];
                const fullUrl = item.src || item.file || '';
                const attachmentPath = fullUrl.replace(/^https?:\/\/[^/]+\//, '');
                logger.info(`[${TAG}] 前台图片上传成功: ${item.title}`);
                return { success: true, attachmentName: item.title, attachmentPath };
            }
        }
        logger.error(`[${TAG}] 前台图片上传失败: ${res.body}`);
        return { success: false, error: res.body };
    } catch (e) {
        logger.error(`[${TAG}] 前台图片上传异常: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * 后台客服提交工单回复
 * 签名规避：先签基础字段，再追加附件字段（不参与签名）
 */
function adminSubmitReply(adminToken, workOrderId, remark, env, attachmentName, attachmentPath) {
    const basePayload = {
        workOrderId: workOrderId,
        state: 2,
        remark: remark,
    };

    // 加入附件字段（有图片时）
    if (attachmentName && attachmentPath) {
        basePayload.attachmentName = attachmentName;
        basePayload.attachmentPath = attachmentPath;
    }

    const timeData = getTimeRandom();
    const dataToSign = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        ...basePayload,
    };

    const signedData = SignatureUtil.signRequest(dataToSign, '');

    let result = null;
    try {
        const response = httpClient.post(
            '/api/WorkOrder/Submit',
            signedData,
            { sign: false, params: { tags: { type: TAG, name: `${TAG}_AdminSubmit` } } },
            false // isDesk=false 走后台
        );
        if (response && response.status === 200) {
            result = JSON.parse(response.body);
        }
    } catch (e) {
        logger.error(`[${TAG}] 客服回复请求异常: ${e.message}`);
    }

    // 限流重试
    if (result && result.msgCode === 13) {
        logger.warn(`[${TAG}] 客服回复请求过快，等待 1s 重试...`);
        sleep(1);
        try {
            const retryRes = httpClient.post(
                '/api/WorkOrder/Submit',
                signedData,
                { sign: false, params: { tags: { type: TAG, name: `${TAG}_AdminSubmit` } } },
                false
            );
            if (retryRes && retryRes.status === 200) {
                result = JSON.parse(retryRes.body);
            }
        } catch (e) {}
    }

    return result;
}

/**
 * 前台会员提交工单回复
 * orderId / userId / commentContent（不含 workOrderId，字段名不同）
 * 同样规避签名对复杂内容的问题
 */
function memberSubmitReply(orderId, longUserId, commentContent, env, attachmentName, attachmentPath) {
    const basePayload = {
        orderId: orderId,
        userId: longUserId,
        commentContent: commentContent,
    };

    if (attachmentName && attachmentPath) {
        basePayload.attachmentName = attachmentName;
        basePayload.attachmentPath = attachmentPath;
    }

    const timeData = getTimeRandom();
    const dataToSign = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        ...basePayload,
    };

    const signedData = SignatureUtil.signRequest(dataToSign, '');

    let result = null;
    try {
        const response = httpClient.post(
            '/api/WorkOrder/Submit',
            signedData,
            { sign: false, params: { tags: { type: TAG, name: `${TAG}_MemberSubmit` } } },
            true // isDesk=true 走前台
        );
        if (response && response.status === 200) {
            result = JSON.parse(response.body);
        }
    } catch (e) {
        logger.error(`[${TAG}] 会员回复请求异常: ${e.message}`);
    }

    if (result && result.msgCode === 13) {
        logger.warn(`[${TAG}] 会员回复请求过快，等待 1s 重试...`);
        sleep(1);
        try {
            const retryRes = httpClient.post(
                '/api/WorkOrder/Submit',
                signedData,
                { sign: false, params: { tags: { type: TAG, name: `${TAG}_MemberSubmit` } } },
                true
            );
            if (retryRes && retryRes.status === 200) {
                result = JSON.parse(retryRes.body);
            }
        } catch (e) {}
    }

    return result;
}

// ============================================================
// setup：登录获取管理员 token
// ============================================================
export function setup() {
    logger.info(`[${TAG}] ========== 初始化：管理员登录 ==========`);
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('[CsReply] 管理员登录失败，终止测试');
    logger.info(`[${TAG}] 管理员登录成功`);
    return { adminToken };
}

// ============================================================
// default：主流程
// ============================================================
export default function (data) {
    const { adminToken } = data;
    const env = getCurrentEnv();
    const tenantId = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);

    // ----------------------------------------------------------------
    // 阶段 1：获取待处理工单列表（一对一客服）
    // ----------------------------------------------------------------
    logger.info(`\n[${TAG}] ========== 阶段 1：获取待处理工单列表 ==========`);

    const now = Date.now();
    // 今日 0 点到明天 0 点（毫秒时间戳）
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const pendingPayload = {
        submissionTimeBegin: todayStart.getTime(),
        submissionTimeEnd: todayEnd.getTime(),
        sortField: 'submissionTime',
        pageNo: 1,
        pageSize: 200,
    };

    const pendingRes = sendQueryRequest(pendingPayload, '/api/WorkOrder/GetPageListByPending', TAG, false, adminToken);

    if (!pendingRes || !pendingRes.list || pendingRes.list.length === 0) {
        logger.warn(`[${TAG}] 今日暂无待处理工单，脚本结束`);
        return;
    }

    // 筛选 "一对一客服" 工单
    const oneToOneOrders = pendingRes.list.filter(
        (o) => o.workOrderTypeName === '一对一客服'
    );

    if (oneToOneOrders.length === 0) {
        logger.warn(`[${TAG}] 今日暂无 "一对一客服" 待处理工单，脚本结束`);
        return;
    }

    logger.info(`[${TAG}] 共发现 ${oneToOneOrders.length} 笔 "一对一客服" 待处理工单`);

    // ----------------------------------------------------------------
    // 对每笔工单执行完整的客服 + 会员对话流程
    // ----------------------------------------------------------------
    for (let oi = 0; oi < oneToOneOrders.length; oi++) {
        const order = oneToOneOrders[oi];
        const workOrderId = order.id;
        logger.info(`\n[${TAG}] ---- 开始处理工单 [${oi + 1}/${oneToOneOrders.length}] ID: ${workOrderId} ----`);

        // 从 jsonData 提取用户账号（第一个字段值即为账号）
        const memberAccount = Object.values(order.jsonData || {})[0] || '';
        logger.info(`[${TAG}] 关联会员账号: ${memberAccount}`);

        // ----------------------------------------------------------------
        // 阶段 2：锁定工单
        // ----------------------------------------------------------------
        logger.info(`[${TAG}] ========== 阶段 2：锁定工单 ==========`);
        const lockRes = sendRequest(
            { workOrderId: workOrderId, isLockWorkOrder: 1 },
            '/api/WorkOrder/UpdateWordOrderState',
            TAG,
            false,
            adminToken
        );

        if (!lockRes || lockRes.msgCode !== 0) {
            logger.error(`[${TAG}] 工单锁定失败，跳过此工单: ${JSON.stringify(lockRes)}`);
            sleep(1);
            continue;
        }
        logger.info(`[${TAG}] ✅ 工单 ${workOrderId} 锁定成功`);
        sleep(0.5);

        // ----------------------------------------------------------------
        // 阶段 3：客服随机回复 1~3 次
        // ----------------------------------------------------------------
        logger.info(`[${TAG}] ========== 阶段 3：客服回复 ==========`);
        const kefuPrefix = buildKefuPrefix(tenantId, true);
        const adminReplyCount = Math.floor(Math.random() * 3) + 1; // 1~3 次
        logger.info(`[${TAG}] 本次客服回复次数: ${adminReplyCount}`);

        for (let ri = 1; ri <= adminReplyCount; ri++) {
            const remark = `${kefuPrefix}:${ri}`;
            let attachmentName = '';
            let attachmentPath = '';

            // 50% 概率上传图片
            if (Math.random() < 0.5) {
                logger.info(`[${TAG}] 客服回复 #${ri}：触发图片上传...`);
                const uploadResult = uploadImageAdmin(adminToken, env);
                if (uploadResult.success) {
                    attachmentName = uploadResult.attachmentName;
                    attachmentPath = uploadResult.attachmentPath;
                } else {
                    logger.warn(`[${TAG}] 客服回复 #${ri}：图片上传失败，改为纯文字回复`);
                }
                sleep(1);
            }

            logger.info(`[${TAG}] 客服提交回复 #${ri}，remark: ${remark}, 附件: ${attachmentName || '无'}`);
            const submitRes = adminSubmitReply(adminToken, workOrderId, remark, env, attachmentName, attachmentPath);

            if (submitRes && (submitRes.code === 0 || submitRes.msgCode === 0)) {
                logger.info(`[${TAG}] ✅ 客服回复 #${ri} 成功`);
            } else {
                logger.error(`[${TAG}] ❌ 客服回复 #${ri} 失败: ${JSON.stringify(submitRes)}`);
            }

            // 模拟真实打字间隔
            sleep(1 + Math.random() * 2);
        }

        // ----------------------------------------------------------------
        // 阶段 4：查询会员 userId，拼接 14 位长 ID
        // ----------------------------------------------------------------
        logger.info(`[${TAG}] ========== 阶段 4：查询会员 userId ==========`);

        let longUserId = '';

        if (memberAccount) {
            const userRes = sendQueryRequest(
                { account: memberAccount, pageNo: 1, pageSize: 20 },
                '/api/Users/GetPageList',
                TAG,
                false,
                adminToken
            );

            if (userRes && userRes.list && userRes.list.length > 0) {
                const shortUserId = userRes.list[0].userId;
                longUserId = buildLongUserId(tenantId, shortUserId);
                logger.info(`[${TAG}] 会员 ${memberAccount} -> shortId: ${shortUserId} -> longId: ${longUserId}`);
            } else {
                logger.warn(`[${TAG}] 未能查到会员 ${memberAccount} 的 userId，跳过会员回复`);
            }
        } else {
            logger.warn(`[${TAG}] 工单 jsonData 中未能提取到会员账号，跳过会员回复`);
        }

        sleep(1);

        // ----------------------------------------------------------------
        // 阶段 5：会员前台随机回复 1~3 次
        // ----------------------------------------------------------------
        if (longUserId) {
            logger.info(`[${TAG}] ========== 阶段 5：会员回复 ==========`);
            const memberReplyCount = Math.floor(Math.random() * 3) + 1; // 1~3 次
            logger.info(`[${TAG}] 本次会员回复次数: ${memberReplyCount}`);

            for (let mi = 1; mi <= memberReplyCount; mi++) {
                const commentContent = `${memberAccount}:${mi}`;
                let attachmentName = '';
                let attachmentPath = '';

                // 50% 概率上传图片（前台接口）
                if (Math.random() < 0.5) {
                    logger.info(`[${TAG}] 会员回复 #${mi}：触发图片上传...`);
                    const uploadResult = uploadImageFrontend(env);
                    if (uploadResult.success) {
                        attachmentName = uploadResult.attachmentName;
                        attachmentPath = uploadResult.attachmentPath;
                    } else {
                        logger.warn(`[${TAG}] 会员回复 #${mi}：图片上传失败，改为纯文字回复`);
                    }
                    sleep(1);
                }

                logger.info(`[${TAG}] 会员提交回复 #${mi}，commentContent: ${commentContent}, 附件: ${attachmentName || '无'}`);
                const memberSubmitRes = memberSubmitReply(
                    workOrderId,
                    longUserId,
                    commentContent,
                    env,
                    attachmentName,
                    attachmentPath
                );

                if (memberSubmitRes && (memberSubmitRes.code === 0 || memberSubmitRes.msgCode === 0)) {
                    logger.info(`[${TAG}] ✅ 会员回复 #${mi} 成功`);
                } else {
                    logger.error(`[${TAG}] ❌ 会员回复 #${mi} 失败: ${JSON.stringify(memberSubmitRes)}`);
                }

                sleep(1 + Math.random() * 2);
            }
        }

        logger.info(`[${TAG}] ---- 工单 ${workOrderId} 处理完毕 ----`);
        sleep(1); // 工单间间隔
    }

    logger.info(`\n[${TAG}] ========== 🎉 所有工单处理完毕 ==========`);
}
