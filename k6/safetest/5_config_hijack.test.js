/**
 * 案例 5：服务端配置劫持 (Server-side Config Hijack)
 *
 * .NET/IIS 经典手法：上传 web.config 注入配置/放开执行/直至 RCE。
 * 前台要求"合法图片"，故纯 web.config 文本预期被 msgCode=20 拒绝；
 * 本案再验证图片型绕过（合法PNG命名 web.config / PNG+web.config polyglot）能否让配置落地，
 * 并用"上传前/后差分"检测同源资源是否出现注入的响应头（IIS 是否真处理了它）。
 *
 * 探针（良性可检测）：web.config 仅注入响应头 X-K6ST-Confighijack: K6ST_CFG_<run>，不放开执行。
 *
 * 判定：
 *   🔴 被接受且同源资源出现注入头        → IIS 处理了上传配置，配置劫持/可升级 RCE
 *   🟠 web.config(或其内容)被接受存储     → 危险文件未被拦截（疑落 OSS 非 IIS 目录）
 *   🟢 被拒 / 存储名由服务端生成非 web.config → 通过
 *
 * 运行：k6 run -e TENANT_ID=3004 5_config_hijack.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, classifyOrigin, absoluteUrl, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack, headerGet } from './lib/uploadProbe.js';
import { appendAscii } from './lib/payloads.js';
import { RISK, reportCase, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const NAME = 'Config Hijack';
const BASE_PNG = open('../tests/api/uploadFile/img/oneToone/2.png', 'b');
const HDR = 'X-K6ST-Confighijack';

function webConfig(run) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<configuration>\n  <system.webServer>\n    <httpProtocol>\n      <customHeaders>\n        <add name="${HDR}" value="K6ST_CFG_${run}" />\n      </customHeaders>\n    </httpProtocol>\n  </system.webServer>\n</configuration>`;
}

export function runCase(env, token) {
    banner('案例 5 · 服务端配置劫持 (web.config)');
    const run = `${Date.now().toString(36)}${__VU}`;
    const marker = `K6ST_CFG_${run}`;
    const cfg = webConfig(run);
    const evidence = [];

    // 1) 基线图片（用于差分检测注入头）
    sub('步骤1：上传基线图片，记录其 URL 与当前响应头');
    const base = frontendUpload(env, token, { content: BASE_PNG, fileName: `k6st_${run}_base.png`, contentType: 'image/png' });
    let baseUrl = '';
    if (base.accepted) {
        baseUrl = absoluteUrl(base.src, env);
        const fb0 = fetchBack(baseUrl);
        console.log(`   基线：[${classifyOrigin(base.src, env).kind}] 注入头(前)=${JSON.stringify(headerGet(fb0.headers, HDR))}`);
    } else {
        console.log(`   ⚠ 基线上传失败：msgCode=${base.msgCode}`);
    }
    sleep(1);

    // 2) 各 web.config 变体
    const polyCfg = appendAscii(BASE_PNG, `\n<!--${cfg}-->`);
    const variants = [
        { desc: '纯 web.config 文本（对照，应被拒）',    content: cfg,     fileName: 'web.config', contentType: 'text/xml' },
        { desc: '合法PNG 命名 web.config',              content: BASE_PNG, fileName: 'web.config', contentType: 'image/png' },
        { desc: 'PNG+web.config polyglot 命名 web.config', content: polyCfg, fileName: 'web.config', contentType: 'image/png' },
    ];

    let anyAccepted = false, acceptedOrigin = null;
    const acceptedUrls = [];
    for (const v of variants) {
        sub(`步骤2：上传 ${v.desc}`);
        const up = frontendUpload(env, token, { content: v.content, fileName: v.fileName, contentType: v.contentType });
        if (!up.accepted) {
            console.log(`   ⛔ 拒绝 (code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg})`);
            evidence.push(`${v.desc}: 拒绝 (msgCode=${up.msgCode} ${up.msg})`);
            sleep(1);
            continue;
        }
        anyAccepted = true;
        const origin = classifyOrigin(up.src, env);
        acceptedOrigin = acceptedOrigin || origin;
        acceptedUrls.push(absoluteUrl(up.src, env));
        console.log(`   🟠 接受 → 存储名=${up.title} [${origin.kind}] ${up.src}`);
        evidence.push(`${v.desc}: 接受存储，存储名=${up.title} [${origin.kind}]`);
        sleep(1);
    }

    // 3) 差分：重新回取基线，看是否出现注入头
    let hijackActive = false;
    if (anyAccepted && baseUrl) {
        sub('步骤3：重新回取基线图片，检测注入头是否出现');
        const targets = [baseUrl].concat(acceptedUrls);
        for (const u of targets) {
            const fb = fetchBack(u);
            const inj = headerGet(fb.headers, HDR);
            if (inj && String(inj).indexOf(marker) !== -1) hijackActive = true;
            console.log(`   回取 ${u} → http=${fb.status}, 注入头=${JSON.stringify(inj)}`);
        }
    }

    let verdict;
    if (hijackActive) {
        verdict = {
            risk: RISK.CRITICAL,
            conclusion: '上传的 web.config 被 IIS 实际处理（同源资源出现注入响应头），构成配置劫持，可升级为 RCE。',
            evidence,
            recommendation: '禁止上传 web.config/.config 等文件名与扩展名；用户文件目录与 IIS 应用目录物理隔离(对象存储)，禁用 config 继承、清空 handlers/modules。',
        };
    } else if (anyAccepted) {
        verdict = {
            risk: RISK.MEDIUM,
            conclusion: `web.config(或其图片型变体)被接受存储（位置：${acceptedOrigin ? acceptedOrigin.kind : '未知'}），但未观察到生效（疑落对象存储非 IIS 目录）。一旦存储位置为 IIS 目录即升级为配置劫持/RCE。`,
            evidence,
            recommendation: '上传白名单显式拒绝 web.config/.config 文件名；确认用户文件不落在任何 IIS 处理目录、存储名由服务端生成。',
        };
    } else {
        verdict = {
            risk: RISK.PASS,
            conclusion: 'web.config 各变体均被拒绝（非图片被拦），未落地、未生效。',
            evidence,
            recommendation: '保持对配置类文件名/扩展名的拒绝；持续确认用户文件与 IIS 目录隔离。',
        };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

export default function () {
    const env = getSafeEnv();
    runCase(env, getGuestToken(tenantId()));
}
