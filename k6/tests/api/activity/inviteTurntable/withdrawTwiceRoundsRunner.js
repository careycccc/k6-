/**
 * 多轮二次提现验证 - Node 包装器（跑 withdrawTwiceRoundsVerify.js，提取结果、打印报表、落档）
 *
 * 用法（在本目录运行）：
 *   node withdrawTwiceRoundsRunner.js --tenant 3004 --rounds 2 --subs 3 --sub-recharge 1000 --gap 15
 *
 * 参数：
 *   --tenant        租户ID（默认 3004）
 *   --rounds        轮数（默认 2）
 *   --subs          每轮下级数（默认 3）
 *   --sub-recharge  每个下级充值额（默认 1000）
 *   --gap           每轮两次提现的间隔秒（默认 3）
 *   --round-gap     轮间缓冲秒（默认 3，避免下一轮点礼物盒撞频率限流）
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
const rounds = args.rounds || '2';
const subs = args.subs || '3';
const subRecharge = args['sub-recharge'] || '1000';
const gap = args.gap || '3';
const roundGap = args['round-gap'] || '3';

const scriptDir = __dirname;
const SCRIPT = 'withdrawTwiceRoundsVerify.js';

const envs = { TENANT_ID: tenant, ROUNDS: rounds, SUBS: subs, SUB_RECHARGE: subRecharge, GAP: gap, ROUND_GAP: roundGap, VIA_RUNNER: '1' };
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 多轮二次提现验证  租户=${tenant}  轮数=${rounds}  每轮下级=${subs}x${subRecharge}  间隔=${gap}s`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const captured = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##W##([^"]*)/);
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
    out.push('===== 多轮二次提现验证（相同 payload 重放 / 重复提现防护）=====');
    captured.forEach(s => out.push(s));
    const report = out.join('\n');

    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'retention', 'withdraw_twice_rounds_result.txt');
    if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
