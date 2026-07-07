/**
 * 案例 1：远程代码执行 / Webshell (RCE)
 *
 * 已知后端防御：前台上传要求"合法栅格图片"（纯 .aspx/.php 文本直接 msgCode=20 拒绝）。
 * 因此攻击面收窄为"图片型绕过"：
 *   - 扩展名保留：上传合法 PNG 但文件名带 .aspx/.php，看服务端存储时是否保留可执行扩展名
 *   - polyglot：合法 PNG 尾部追加 .NET 代码，文件名 .aspx，看是否被接受且执行
 *
 * 探针：良性 ASPX，仅计算 13337*13337=177875569（执行才会出现该结果）。
 *
 * 判定：
 *   🔴 回取响应出现 177875569                         → 代码被执行，RCE
 *   🟠 被接受且存储名保留 .aspx/.php 等可执行扩展名   → 扩展名防御缺失（当前 OSS 静态托管不执行，换存储/执行目录即 getshell）
 *   🟢 危险内容被拒 / 存储时强制改为图片扩展名        → 通过
 *
 * 运行：k6 run -e TENANT_ID=3004 1_rce_webshell.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, classifyOrigin, absoluteUrl, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack } from './lib/uploadProbe.js';
import { appendAscii, extOf } from './lib/payloads.js';
import { RISK, reportCase, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const NAME = 'RCE/Webshell';
const BASE_PNG = open('../tests/api/uploadFile/img/oneToone/1.png', 'b');
const EXEC_RESULT = '177875569';
const EXECUTABLE_EXTS = ['.aspx', '.ashx', '.asax', '.asp', '.php', '.jsp', '.config'];

function aspx(run) {
    return `<%@ Page Language="C#" %><% Response.Write("K6ST_RCE_${run}_["+(13337*13337).ToString()+"]"); %>`;
}

export function runCase(env, token) {
    banner('案例 1 · 远程代码执行 / Webshell (RCE)');
    const run = `${Date.now().toString(36)}${__VU}`;
    const code = aspx(run);
    const polyglot = appendAscii(BASE_PNG, `\n${code}`);

    const variants = [
        { desc: '合法PNG + 文件名.aspx（扩展名保留探测）', content: BASE_PNG,  fileName: `k6st_${run}.aspx`, contentType: 'image/png' },
        { desc: '合法PNG + 文件名.php',                    content: BASE_PNG,  fileName: `k6st_${run}.php`,  contentType: 'image/png' },
        { desc: 'PNG+ASPX polyglot + 文件名.aspx',         content: polyglot,  fileName: `k6st_${run}p.aspx`, contentType: 'image/png' },
        { desc: '纯ASPX文本（对照，应被拒）',              content: code,      fileName: `k6st_${run}.aspx`, contentType: 'image/png' },
    ];

    let anyExecuted = false;
    let dangerousExtKept = false;
    let acceptedOrigin = null;
    const evidence = [];

    for (const v of variants) {
        sub(`变体：${v.desc}`);
        const up = frontendUpload(env, token, { content: v.content, fileName: v.fileName, contentType: v.contentType });
        if (!up.accepted) {
            console.log(`   ⛔ 上传被拒绝 (code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg})`);
            evidence.push(`${v.desc}: 拒绝 (msgCode=${up.msgCode} ${up.msg})`);
            sleep(1);
            continue;
        }
        const origin = classifyOrigin(up.src, env);
        acceptedOrigin = acceptedOrigin || origin;
        const storedExt = extOf(up.title) || extOf(up.src);
        console.log(`   ✔ 接受 → 存储名=${up.title} 扩展名=${storedExt || '(无)'} [${origin.kind}]`);
        console.log(`     src=${up.src}`);

        const url = absoluteUrl(up.src, env);
        const fb = fetchBack(url);
        const executed = fb.body.indexOf(EXEC_RESULT) !== -1;
        console.log(`     回取：http=${fb.status}, CT=${fb.contentType || '(空)'}, 执行结果=${executed}`);

        if (executed) {
            anyExecuted = true;
            evidence.push(`${v.desc}: 【已执行】回取含 ${EXEC_RESULT}，src=${up.src}`);
        } else if (EXECUTABLE_EXTS.indexOf(storedExt) !== -1) {
            dangerousExtKept = true;
            evidence.push(`${v.desc}: 存储保留可执行扩展名 ${storedExt}（${origin.kind} 静态托管，当前未执行）`);
        } else {
            evidence.push(`${v.desc}: 已接受但存储扩展名为 ${storedExt || '非可执行'}（${origin.kind}），未执行`);
        }
        sleep(1);
    }

    let verdict;
    if (anyExecuted) {
        verdict = {
            risk: RISK.CRITICAL,
            conclusion: '上传的图片型 payload 被服务端当作 .NET 代码执行，构成远程代码执行(RCE)。',
            evidence,
            recommendation: '存储文件名与扩展名完全由服务端按图片真实类型生成；存储目录禁用一切脚本处理程序；用户文件仅经对象存储静态分发。',
        };
    } else if (dangerousExtKept) {
        const k = acceptedOrigin ? acceptedOrigin.kind : '未知';
        verdict = {
            risk: k === 'third-party' ? RISK.MEDIUM : RISK.HIGH,
            conclusion: `服务端存储时保留了用户文件名中的可执行扩展名（存储位置：${k}）。当前经对象存储静态分发不会执行，但一旦文件落入可执行目录/回源到应用服务器即可 getshell。`,
            evidence,
            recommendation: '存储扩展名一律由服务端按真实图片类型强制生成(.png/.webp)，忽略用户文件名；确认对象存储不回源到 IIS 可执行目录。',
        };
    } else {
        verdict = {
            risk: RISK.PASS,
            conclusion: '前台上传强制校验真实图片，且存储扩展名由服务端生成，未发现可执行文件落地或执行。',
            evidence,
            recommendation: '保持"真实图片校验 + 服务端生成文件名 + 对象存储静态分发"三重防御。',
        };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

export default function () {
    const env = getSafeEnv();
    runCase(env, getGuestToken(tenantId()));
}
