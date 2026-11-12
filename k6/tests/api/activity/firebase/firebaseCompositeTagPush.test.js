/**
 * firebaseCompositeTagPush.test.js
 * Firebase 推送 —— "组合标签"定向(targetType=17)
 *
 * 前置：先运行 ../../../../playwrith/collect-tagged-users.js 生成 tagIds.txt
 * （同目录下的 positive-accounts.txt / negative-accounts.txt / 2.txt 供
 *  delivery-verify.js 使用，这个脚本本身只用 tagIds.txt）
 *
 * 2026-11-12 实测确认（用户提供的手动验证案例，已复用格式）：
 *   targetType=17 表示"组合标签"定向；targetDetail是逗号分隔的组合标签ID
 *   列表，例如 "90042,90041,90040,90039"——**注意跟 targetType=6(指定会员)
 *   不是同一种分隔符**：targetType=6 的 targetDetail 用 \r\n 拼接userId
 *   (见 firebaseBatchImport.test.js)，这里是逗号，别搞混。
 *
 * 运行方式（在 k6/tests/api/activity/firebase/ 目录下执行）：
 *   k6p -e TENANT=3004 firebaseCompositeTagPush.test.js
 *
 * 参数说明：
 *   TENANT   租户 ID（默认 3004）
 *   REMARK   后台备注（可选，不传自动生成"组合标签推送自动化测试备注<时间戳>"）
 */

import { tenantAdminLogin, tenantRequest } from '../../../../libs/http/tenantRequest.js';
import { createImageUploader } from '../../uploadFile/uploadFactory.js';

// ============================================================
// 参数
// ============================================================

const TENANT_ID = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const FIREBASE_ID = 300023; // 固定值(跟用户提供的手动验证案例一致)
const TAG = 'FirebaseCompositeTagPush';

// ============================================================
// 模块顶层：预加载图片（k6 要求 open() 必须在顶层调用）
// ============================================================

// 路径相对于本文件（firebaseCompositeTagPush.test.js）
const uploadFirebaseImage = createImageUploader(
    '../../uploadFile/img/firebase/1.png',
    TAG
);

// 读取组合标签ID列表（同目录下的 tagIds.txt，逗号分隔单行，由
// collect-tagged-users.js 生成）
const tagIdsFileContent = open('./tagIds.txt');

// ============================================================
// K6 Options
// ============================================================

export const options = {
    scenarios: {
        firebase_composite_tag: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '10m'
        }
    }
};

// ============================================================
// setup：登录 + 上传图片 + 解析组合标签ID列表
// ============================================================

export function setup() {
    console.log(`[${TAG}] ========== Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID}`);

    // 1. 后台登录（强制商户模式，理由同 firebaseBatchImport.test.js：图片上传
    //    硬编码走商户域名，集团token会域名/token错配）
    const adminToken = tenantAdminLogin(TENANT_ID, true);
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
    const imageUrl = (uploadResult.src || '').replace(/^https?:\/\/[^/]+\//, '');
    console.log(`[${TAG}] ✅ 图片上传成功，imageUrl: ${imageUrl}`);

    // 3. 解析组合标签ID列表（tagIds.txt：单行，逗号分隔，如 "90042,90041,90040,90039"）
    const tagIdsLine = tagIdsFileContent.trim();
    if (!tagIdsLine) {
        throw new Error(`[${TAG}] tagIds.txt 为空，请先运行 collect-tagged-users.js`);
    }
    const tagIds = tagIdsLine.split(',').map(s => s.trim()).filter(s => s.length > 0);
    console.log(`[${TAG}] 从 tagIds.txt 读取 ${tagIds.length} 个组合标签ID: ${tagIds.join(',')}`);

    console.log(`[${TAG}] ========== Setup 完成 ==========`);

    return { adminToken, imageUrl, tagIds };
}

// ============================================================
// default：发送组合标签定向消息
// ============================================================

export default function (data) {
    const { adminToken, imageUrl, tagIds } = data;

    const ts = Date.now();
    const title = `组合标签推送${ts}`;
    const content = `组合标签推送${ts}`;
    const remark = __ENV.REMARK || `组合标签推送自动化测试备注${ts}`;

    // targetDetail：组合标签ID逗号拼接（跟targetType=6的\r\n拼接userId不同，见文件头说明）
    const targetDetail = tagIds.join(',');

    console.log(`[${TAG}] ===== 发送组合标签定向消息 =====`);
    console.log(`[${TAG}] title:         ${title}`);
    console.log(`[${TAG}] imageUrl:      ${imageUrl}`);
    console.log(`[${TAG}] targetType:    17 (组合标签)`);
    console.log(`[${TAG}] targetDetail:  ${targetDetail}`);
    console.log(`[${TAG}] sendTime:      ${ts}`);
    console.log(`[${TAG}] remark:        ${remark}`);

    const res = tenantRequest('/api/Firebase/AddUserMsg', {
        firebaseId: FIREBASE_ID,
        targetType: 17,
        title: title,
        content: content,
        imageUrl: imageUrl,
        clickType: 0,
        sendTimeType: 1,
        sendTime: ts,
        pushPriority: 1,
        survivalTime: 3600,
        targetDetail: targetDetail,
        remark: remark
    }, { token: adminToken, isDesk: false, forceTenant: true });

    if (!res || res.msgCode !== 0) {
        console.error(`[${TAG}] ❌ AddUserMsg 失败: msgCode=${res ? res.msgCode : 'null'} msg=${res ? res.msg : ''}`);
        return;
    }

    console.log(`\n[${TAG}] ========== 🎉 组合标签推送发送成功 ==========`);
    console.log(`[${TAG}] 推送标题:      ${title}`);
    console.log(`[${TAG}] 图片路径:      ${imageUrl}`);
    console.log(`[${TAG}] 组合标签ID:    ${targetDetail}`);
    console.log(`[${TAG}] 下一步：去 delivery-verify.js 的终端看"组合标签定向验证"报表，`);
    console.log(`[${TAG}]   确认 positive-accounts.txt 里的会员都收到了、negative-accounts.txt 里的都没收到。`);
    console.log(`[${TAG}] ================================================\n`);
}

// ============================================================
// handleSummary
// ============================================================

export function handleSummary(_data) {
    return {
        stdout: [
            '='.repeat(50),
            '  Firebase 组合标签推送 - 完成',
            '  请去 delivery-verify.js 的终端查看送达闭环报表',
            '='.repeat(50)
        ].join('\n') + '\n'
    };
}
