/**
 * 案例 3：拒绝服务 (DoS) —— 安全探测版（单文件、不打并发流量）
 *
 * 前台上传会"校验是否合法图片"，很可能会解码；解压炸弹(50000x50000, 仅68字节)若被同步解码
 * 将瞬间 OOM/超时，单个请求即可放大成 DoS。
 *
 * 安全约束（按用户选择）：仅上传单个精心构造的小文件，不做并发、不上传大体积文件。
 *
 * 判定：
 *   🟠 上传 5xx/超时/明显长耗时（服务端同步解码炸弹）  → DoS 成立
 *   🟡 秒级接受、完全不校验尺寸（下游解码环节仍可能爆） → 潜在 DoS
 *   🟢 上传层拒绝该畸形超大图片                          → 通过（有解压炸弹防护）
 *
 * 运行：k6 run -e TENANT_ID=3004 3_dos.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, absoluteUrl, classifyOrigin, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack } from './lib/uploadProbe.js';
import { RISK, reportCase, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const NAME = 'DoS';
const BOMB = open('./payloads/pixelflood.png', 'b');
const BOMB_BIG = open('./payloads/pixelflood_big.png', 'b');
const SLOW_MS = 8000;

export function runCase(env, token) {
    banner('案例 3 · 拒绝服务 DoS（图像解压炸弹 · 安全探测）');
    const run = `${Date.now().toString(36)}${__VU}`;

    const probes = [
        { desc: '像素洪水 50000x50000 (~10GB解码)', content: BOMB,     fileName: `k6st_${run}_bomb.png` },
        { desc: '像素洪水 65500x65500 (~17GB解码)', content: BOMB_BIG, fileName: `k6st_${run}_bomb2.png` },
    ];

    let dosConfirmed = false;
    let acceptedNoValidation = false;
    const evidence = [];

    for (const p of probes) {
        sub(`探针：${p.desc}  (仅 ${new Uint8Array(p.content).length} 字节)`);
        const up = frontendUpload(env, token, { content: p.content, fileName: p.fileName, contentType: 'image/png' });
        console.log(`   上传：http=${up.httpStatus}, code=${up.code}, msgCode=${up.msgCode}, 耗时=${up.durationMs}ms, msg=${up.msg || up.error || ''}`);

        if (up.httpStatus >= 500 || up.httpStatus === 0 || up.error) {
            dosConfirmed = true;
            console.log(`   🔴 服务端 ${up.httpStatus || '连接中断'}${up.error ? ' / ' + up.error : ''} —— 疑似解码炸弹导致崩溃/超时`);
            evidence.push(`${p.desc}: 上传触发 http=${up.httpStatus} error=${up.error || '无'}（疑似同步解码 OOM/超时）`);
        } else if (up.durationMs >= SLOW_MS) {
            dosConfirmed = true;
            console.log(`   🔴 上传耗时 ${up.durationMs}ms 远超正常 —— 服务端疑似同步解码超大位图`);
            evidence.push(`${p.desc}: 上传耗时 ${up.durationMs}ms（>${SLOW_MS}ms，疑似同步解码放大）`);
        } else if (up.accepted) {
            acceptedNoValidation = true;
            const origin = classifyOrigin(up.src, env);
            console.log(`   🟡 被快速接受（上传阶段未拦截超大尺寸）→ [${origin.kind}] ${up.src}`);
            evidence.push(`${p.desc}: 上传层接受畸形超大尺寸图 (code=0, ${up.durationMs}ms, ${origin.kind})`);
            const fb = fetchBack(absoluteUrl(up.src, env));
            console.log(`     回取：http=${fb.status}, CT=${fb.contentType || '(空)'}, 体积=${fb.length}`);
        } else {
            console.log(`   🟢 上传层拒绝 (code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg})`);
            evidence.push(`${p.desc}: 上传层拒绝 (msgCode=${up.msgCode} ${up.msg}) —— 具备解压炸弹防护`);
        }
        sleep(1.5);
    }

    let verdict;
    if (dosConfirmed) {
        verdict = {
            risk: RISK.HIGH,
            conclusion: '服务端对解压炸弹图片同步解码，单个 68 字节文件即可造成 OOM/长阻塞，构成放大型拒绝服务。',
            evidence,
            recommendation: '解码前先只读文件头校验声明尺寸并设上限(如 ≤ 4096x4096 / ≤ 2500万像素)；解码放独立进程+内存与超时限制；限制上传体积与频率。',
        };
    } else if (acceptedNoValidation) {
        verdict = {
            risk: RISK.MEDIUM,
            conclusion: '上传层接受了声明尺寸达 50000×50000/65500×65500 的图片且无任何尺寸/像素数校验（探针仅 68 字节，未在上传端触发同步解码）。风险直接命中"客服点开"场景：同尺寸、像素填充完整的解压炸弹会被同样接受并存储，当客服在后台点开该图片时，浏览器需为解码分配约 10–17GB 内存 → 客服端标签页卡死/崩溃（客户端 DoS）；若服务端缩略图/预览在别处同步解码亦会 OOM。（安全探针仅证明"无尺寸校验"这一必要条件，未投递完整炸弹。）',
            evidence,
            recommendation: '在上传入口即按文件头校验声明尺寸并设上限(如 ≤ 4096×4096 / ≤ 2500万像素)、拒绝畸形图；客服端渲染前用受限的缩略图服务(带内存/超时/像素上限)代替直接加载原图。',
        };
    } else {
        verdict = {
            risk: RISK.PASS,
            conclusion: '解压炸弹图片在上传层被拒绝，未观察到服务端解码放大，具备防护。',
            evidence,
            recommendation: '保持尺寸/体积校验；确认客服端预览、异步缩略图等环节同样受保护。',
        };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

export default function () {
    const env = getSafeEnv();
    runCase(env, getGuestToken(tenantId()));
}
