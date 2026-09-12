/**
 * 并发提现验证 - Node 包装器（跑 withdrawConcurrentVerify.js，提取结果、打印报表、落档）
 *
 * 用法（在本目录运行）：
 *   node withdrawConcurrentRunner.js --tenant 3004 --conc 5
 *   node withdrawConcurrentRunner.js --tenant 3004 --conc 10 --same 1   # 相同 payload 并发重放
 *
 * 参数：
 *   --tenant        租户ID（默认 3004）
 *   --conc          并发提现数（默认 5）
 *   --same          1=所有并发用相同 payload 重放，0=各自独立签名（默认 0）
 *   --subs          下级数（默认 3）
 *   --sub-recharge  每个下级充值额（默认 1000）
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
const conc = args.conc || '5';
const same = args.same || '0';
const subs = args.subs || '3';
const subRecharge = args['sub-recharge'] || '1000';

const scriptDir = __dirname;
const SCRIPT = 'withdrawConcurrentVerify.js';

const envs = { TENANT_ID: tenant, CONC: conc, SAME: same, SUBS: subs, SUB_RECHARGE: subRecharge, VIA_RUNNER: '1' };
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 并发提现验证  租户=${tenant}  并发=${conc}  模式=${same === '1' ? '相同payload重放' : '各自独立签名'}  下级=${subs}x${subRecharge}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const captured = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##C##([^"]*)/);
    if (m) captured.push(m[1].trim());
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

    const out = [];
    out.push('===== 并发提现验证（重复提现 / 竞态条件）=====');
    captured.forEach(s => out.push(s));
    const report = out.join('\n');

    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'retention', 'withdraw_concurrent_result.txt');
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
