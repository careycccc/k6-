/**
 * 案例 4：路径遍历 (Path Traversal)
 *
 * 前台正常存储路径形如： 3004/User/WorkOrder-Frontend/<服务端生成名>.png
 * 本案用"合法 PNG 内容"（以通过图片校验）+ 在 customPath / fileType / 文件名注入遍历序列，
 * 观察返回的 imagePath 是否逃逸出固定前缀或保留了 ../ 序列（非破坏性，仅看存储路径是否可控）。
 *
 * 判定：
 *   🔴 返回路径含未归一化 ../、..\ 或明显跳出固定前缀  → 路径可控，遍历成立
 *   🟡 customPath/fileType 被原样拼进路径(可控子目录)   → 部分可控
 *   🟢 服务端忽略注入、固定前缀+服务端生成名           → 通过
 *
 * 运行：k6 run -e TENANT_ID=3004 4_path_traversal.test.js
 */
import { sleep } from 'k6';
import { getSafeEnv, tenantId } from './lib/env.js';
import { getGuestToken } from './lib/guest.js';
import { frontendUpload } from './lib/uploadProbe.js';
import { RISK, reportCase, banner, sub } from './lib/report.js';

export const options = { vus: 1, iterations: 1 };

const NAME = 'Path Traversal';
const BASE_PNG = open('../tests/api/uploadFile/img/oneToone/1.png', 'b');
const NORMAL_PREFIX = 'WorkOrder-Frontend';

function looksTraversed(s) {
    if (!s) return false;
    const t = String(s);
    return /\.\.[\/\\]/.test(t) || /%2e%2e/i.test(t) || /^[a-zA-Z]:[\\\/]/.test(t) || t.indexOf('..') !== -1;
}

export function runCase(env, token) {
    banner('案例 4 · 路径遍历 (Path Traversal)');
    const run = `${Date.now().toString(36)}${__VU}`;

    // 全部用合法 PNG 内容，确保能过图片校验，只变 customPath/fileType/文件名
    const list = [
        { desc: 'customPath = ../../',        fileName: `k6st_${run}.png`,           fileType: 'other',       customPath: '../../' },
        { desc: 'customPath = ../../../../',   fileName: `k6st_${run}.png`,           fileType: 'other',       customPath: '../../../../' },
        { desc: 'customPath 反斜杠 ..\\..\\',  fileName: `k6st_${run}.png`,           fileType: 'other',       customPath: '..\\..\\' },
        { desc: 'fileType 注入 ../../evil',    fileName: `k6st_${run}.png`,           fileType: '../../evil',  customPath: '' },
        { desc: '文件名内遍历 ../../x.png',    fileName: `../../k6st_${run}fn.png`,    fileType: 'other',       customPath: '' },
        { desc: 'customPath 普通子目录(基线)', fileName: `k6st_${run}b.png`,          fileType: 'other',       customPath: 'k6sttrav' },
    ];

    let traversed = false;
    let subdirControlled = false;
    const evidence = [];

    for (const c of list) {
        sub(`变体：${c.desc}  (fileType="${c.fileType}", customPath="${c.customPath}")`);
        const up = frontendUpload(env, token, { content: BASE_PNG, fileName: c.fileName, contentType: 'image/png', fileType: c.fileType, customPath: c.customPath });
        if (!up.accepted) {
            console.log(`   ⛔ 拒绝 (code=${up.code}, msgCode=${up.msgCode}, msg=${up.msg})`);
            evidence.push(`${c.desc}: 拒绝 (msgCode=${up.msgCode} ${up.msg})`);
            sleep(1);
            continue;
        }
        const stored = `${up.src} | ${up.title}`;
        console.log(`   ✔ 接受 → imagePath/src=${up.src}`);

        if (looksTraversed(up.src) || looksTraversed(up.title)) {
            traversed = true;
            console.log(`   🔴 返回路径保留遍历序列 —— 存储路径被控制`);
            evidence.push(`${c.desc}: 路径含遍历序列 → ${stored}`);
        } else if (c.customPath && c.customPath.indexOf('..') === -1 && String(up.src).indexOf(c.customPath) !== -1) {
            subdirControlled = true;
            console.log(`   🟡 customPath 被原样拼进路径`);
            evidence.push(`${c.desc}: customPath 生效可控子目录 → ${stored}`);
        } else {
            const escaped = String(up.src).indexOf(NORMAL_PREFIX) === -1;
            console.log(`   🟢 已归一化/忽略注入${escaped ? '（但前缀异常，需人工看）' : ''}`);
            evidence.push(`${c.desc}: 路径不可控${escaped ? '(前缀异常)' : ''} → ${stored}`);
        }
        sleep(1);
    }

    let verdict;
    if (traversed) {
        verdict = {
            risk: RISK.HIGH,
            conclusion: '存储路径可被 customPath/fileType/文件名中的遍历序列控制，可将文件写出预期目录。',
            evidence,
            recommendation: '忽略用户提供的路径/文件名，固定前缀+服务端随机名；customPath 做 Path.GetFullPath 归一化并校验仍在允许根内；拒绝含 ..、绝对路径、反斜杠的输入。',
        };
    } else if (subdirControlled) {
        verdict = {
            risk: RISK.MEDIUM,
            conclusion: 'customPath 会被原样拼入存储路径（子目录可控），虽未逃逸出根仍扩大攻击面。',
            evidence,
            recommendation: '将 customPath/fileType 收敛为服务端预定义枚举，禁止任意字符串拼接路径。',
        };
    } else {
        verdict = {
            risk: RISK.PASS,
            conclusion: '所有遍历注入均被归一化/忽略，存储路径固定前缀+服务端生成名，不可控。',
            evidence,
            recommendation: '保持固定前缀+服务端随机名策略。',
        };
    }
    return reportCase(NAME, { name: NAME, ...verdict });
}

export default function () {
    const env = getSafeEnv();
    runCase(env, getGuestToken(tenantId()));
}
