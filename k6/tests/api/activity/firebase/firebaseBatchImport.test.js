/**
 * firebaseBatchImport.test.js
 * Firebase 批量导入消息推送
 *
 * 前置：先运行 collectUserIds.test.js 生成 1.txt
 *
 * 运行方式（在 k6/tests/api/activity/firebase/ 目录下执行）：
 *   k6 run -e TENANT=3004 firebaseBatchImport.test.js
 *
 * 参数说明：
 *   TENANT   租户 ID（默认 3004）
 */

import { tenantAdminLogin, tenantRequest } from '../../../../libs/http/tenantRequest.js';
import { createImageUploader } from '../../uploadFile/uploadFactory.js';

// ============================================================
// 参数
// ============================================================

const TENANT_ID  = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const FIREBASE_ID = 300019; // 固定值
const TAG = 'FirebaseBatchImport';

// ============================================================
// 模块顶层：预加载图片（k6 要求 open() 必须在顶层调用）
// ============================================================

// 路径相对于本文件（firebaseBatchImport.test.js）
const uploadFirebaseImage = createImageUploader(
    '../../uploadFile/img/firebase/1.png',
    TAG
);

// 读取 userId 列表（同目录下的 1.txt）
// open() 返回字符串内容
const userIdFileContent = open('./1.txt');

// ============================================================
// K6 Options
// ============================================================

export const options = {
    scenarios: {
        firebase_import: {
            executor:    'per-vu-iterations',
            vus:         1,
            iterations:  1,
            maxDuration: '10m'
        }
    }
};

// ============================================================
// setup：登录 + 上传图片 + 解析 userId 列表
// ============================================================

export function setup() {
    console.log(`[${TAG}] ========== Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID}`);

    // 1. 后台登录
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) {
        throw new Error(`[${TAG}] 后台登录失败，终止测试`);
    }
    console.log(`[${TAG}] ✅ 后台登录成功`);

    // 2. 上传图片，获取 imageUrl（相对路径）
    console.log(`[${TAG}] 上传 firebase 图片...`);
    const uploadResult = uploadFirebaseImage(adminToken);
    if (!uploadResult.success) {
        throw new Error(`[${TAG}] 图片上传失败: ${uploadResult.error}`);
    }

    // 从完整 URL 里提取相对路径，如：3004/other/xxx.webp
    const imageUrl = (uploadResult.src || '').replace(/^https?:\/\/[^/]+\//, '');
    console.log(`[${TAG}] ✅ 图片上传成功，imageUrl: ${imageUrl}`);

    // 3. 解析 userId 列表
    // 1.txt 每行一个 userId，过滤空行
    const userIds = userIdFileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    console.log(`[${TAG}] 从 1.txt 读取 ${userIds.length} 个 userId`);

    if (userIds.length === 0) {
        throw new Error(`[${TAG}] 1.txt 为空，请先运行 collectUserIds.test.js`);
    }

    console.log(`[${TAG}] ========== Setup 完成 ==========`);

    return { adminToken, imageUrl, userIds };
}

// ============================================================
// default：发送批量导入消息
// ============================================================

export default function (data) {
    const { adminToken, imageUrl, userIds } = data;

    // title / content = 批量导入 + 时间戳
    const ts      = Date.now();
    const title   = `批量导入${ts}`;
    const content = `批量导入${ts}`;

    // targetDetail：每个 userId 以 \r\n 结尾，最后一个不加
    const targetDetail = userIds.join('\r\n');

    console.log(`[${TAG}] ===== 发送批量导入消息 =====`);
    console.log(`[${TAG}] title:         ${title}`);
    console.log(`[${TAG}] imageUrl:      ${imageUrl}`);
    console.log(`[${TAG}] userId 数量:   ${userIds.length}`);
    console.log(`[${TAG}] sendTime:      ${ts}`);

    const res = tenantRequest('/api/Firebase/AddUserMsg', {
        firebaseId:    FIREBASE_ID,
        targetType:    6,
        title:         title,
        content:       content,
        imageUrl:      imageUrl,
        clickType:     0,
        sendTimeType:  1,
        sendTime:      ts,
        pushPriority:  1,
        survivalTime:  3600,
        targetDetail:  targetDetail
    }, { token: adminToken, isDesk: false });

    if (!res || res.msgCode !== 0) {
        console.error(`[${TAG}] ❌ AddUserMsg 失败: msgCode=${res ? res.msgCode : 'null'} msg=${res ? res.msg : ''}`);
        return;
    }

    console.log(`\n[${TAG}] ========== 🎉 批量导入成功 ==========`);
    console.log(`[${TAG}] 推送标题:    ${title}`);
    console.log(`[${TAG}] 图片路径:    ${imageUrl}`);
    console.log(`[${TAG}] userId 总数: ${userIds.length}`);
    console.log(`[${TAG}] ==========================================\n`);
}

// ============================================================
// handleSummary
// ============================================================

export function handleSummary(_data) {
    return {
        stdout: [
            '='.repeat(50),
            '  Firebase 批量导入 - 完成',
            '  请查阅上方日志确认推送结果',
            '='.repeat(50)
        ].join('\n') + '\n'
    };
}
