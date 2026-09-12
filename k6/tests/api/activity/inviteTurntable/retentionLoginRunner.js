/**
 * 真实留存核验 - Node 包装器（跑 retentionLoginVerify.js，提取结果、打印报表、落档）
 *
 * 以后台登录日志判定真实留存（解决"别人共用后台帮登录、本地 txt 没写"的偏差）。
 *
 * 用法（在本目录运行）：
 *   node retentionLoginRunner.js --tenant 3004
 *   node retentionLoginRunner.js --tenant 3004 --part participants_day02.txt --days 2026-09-10,2026-09-11,2026-09-12
 *
 * 参数：
 *   --tenant  租户ID（默认 3004）
 *   --part    基期号文件名或路径（默认 participants_day01.txt，仅文件名时自动补 ./retention/）
 *   --days    三个自然日，逗号分隔：第一天,第二天,第三天（默认 2026-09-09,2026-09-10,2026-09-11）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k && k.startsWith('--')) {
            const key = k.slice(2);
            const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
            a[key] = val;
        }
    }
    return a;
}
const args = parseArgs(process.argv);

const tenant = args.tenant || '3004';
let part = args.part || 'participants_day01.txt';
if (!part.includes('/') && !part.includes('\\')) part = './retention/' + part;
const days = args.days || '2026-09-09,2026-09-10,2026-09-11';

const scriptDir = __dirname;
const SCRIPT = 'retentionLoginVerify.js';

const envs = { TENANT_ID: tenant, PART_FILE: part, DAYS: days };
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 真实留存核验（后台登录日志）  租户=${tenant}  基期=${part}  天=${days}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const captured = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##(ROW|SUM|R)##([^"]*)/);
    if (m) captured.push({ type: m[1], content: m[2].trim() });
}
function scan(chunk) {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
}

child.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
child.stdout.on('data', (d) => { process.stdout.write(d); scan(d); });

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf);

    const infos = captured.filter(c => c.type === 'R').map(c => c.content);
    const rows = captured.filter(c => c.type === 'ROW').map(c => c.content);
    const sums = captured.filter(c => c.type === 'SUM').map(c => c.content);

    const out = [];
    out.push('===== 真实留存核验（后台登录日志口径）=====');
    infos.forEach(s => out.push('· ' + s));
    out.push('');
    out.push('----- 逐号明细（1=当天有登录日志，0=无）-----');
    rows.forEach(r => out.push(r));
    out.push('');
    out.push('----- 汇总 -----');
    sums.forEach(s => out.push('· ' + s));
    const report = out.join('\n');

    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'retention', 'login_verify_result.txt');
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
