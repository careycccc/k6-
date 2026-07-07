/**
 * 0_positive_control.js  —— 正向对照 & 上传校验模型诊断（不是攻击，是基线）
 *
 * 作用：
 *   1) 证明"正常图片能未登录上传成功(code=0)"，从而确认后续案例里的"被拒绝"是真安全防护，
 *      而不是脚本请求不合法造成的假阴性。
 *   2) 揭示存储位置（独立OSS域 还是 同源）与返回的 Content-Type/Disposition/nosniff。
 *   3) 用几种组合探明前台按什么校验：真实图片内容 / 扩展名 / MIME。
 *
 * 运行：k6 run -e TENANT_ID=3004 0_positive_control.js
 */
import { sleep } from 'k6';
import { getSafeEnv, classifyOrigin, absoluteUrl, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack } from './lib/uploadProbe.js';
import { banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const REAL_PNG = open('../tests/api/uploadFile/img/oneToone/1.png', 'b');
const PLAIN_TEXT = 'this is definitely not an image, just plain text';

export default function () {
    const env = getSafeEnv();
    const token = getGuestToken(tenantId());
    banner(`正向对照 · 租户 ${tenantId()} · 未登录(游客) · ${env.BASE_DESK_URL}`);
    if (!token) { console.error('  游客注册失败，无法继续'); return; }
    const run = `${Date.now().toString(36)}${__VU}`;

    const matrix = [
        { desc: '① 真实PNG + .png + image/png（标准，应成功）', content: REAL_PNG,   fileName: `k6ok_${run}.png`,  contentType: 'image/png' },
        { desc: '② 真实PNG字节 + .txt + text/plain',            content: REAL_PNG,   fileName: `k6ok_${run}.txt`,  contentType: 'text/plain' },
        { desc: '③ 真实PNG字节 + .png + octet-stream',          content: REAL_PNG,   fileName: `k6ok_${run}b.png`, contentType: 'application/octet-stream' },
        { desc: '④ 纯文本内容 + .png + image/png（假图片）',    content: PLAIN_TEXT, fileName: `k6ok_${run}c.png`, contentType: 'image/png' },
    ];

    for (const m of matrix) {
        sub(m.desc);
        const up = frontendUpload(env, token, { content: m.content, fileName: m.fileName, contentType: m.contentType });
        console.log(`   http=${up.httpStatus}, code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg || ''}, 耗时=${up.durationMs}ms`);
        if (up.accepted) {
            const origin = classifyOrigin(up.src, env);
            console.log(`   ✔ 成功  存储名=${up.title}`);
            console.log(`   src=${up.src}`);
            console.log(`   存储域：${origin.kind}  host=${origin.srcHost}  (${origin.note})`);
            const fb = fetchBack(absoluteUrl(up.src, env));
            console.log(`   回取：http=${fb.status}, CT=${fb.contentType || '(空)'}, Disposition=${fb.contentDisposition || '(无)'}, nosniff=${fb.xContentTypeOptions || '(无)'}, Server=${fb.server || '(无)'}`);
        } else {
            console.log(`   ✘ 未成功：${up.rawBody.slice(0, 160)}`);
        }
        sleep(1.5);
    }

    console.log('\n  解读：');
    console.log('   - ①成功、④失败 → 前台按"真实图片内容"校验（假图片被拒，msgCode=20）');
    console.log('   - ①②③是否都成功 → 说明扩展名/MIME 不影响校验（只认内容）');
    console.log('   - 看①的存储域：third-party=独立对象存储(XSS被沙箱在该域)；same-origin-*=同源(可直取会话)');
}
