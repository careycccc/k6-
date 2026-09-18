/**
 * 前台充值工单重复提交验证 - Node 包装器（跑 depositWorkOrderRepeatVerify.js，提取结果、打印、落档）
 *
 * 用法（在 workOrderSuite 目录运行）：
 *   node depositWorkOrderRepeatRunner.js --tenant 3004 --account 91xxxxxxxxxx
 *   node depositWorkOrderRepeatRunner.js --tenant 3004 --account 918879053132 --wait 180
 *
 * 参数：
 *   --tenant   租户ID（默认 3004）
 *   --account  会员账号（必填，需有 Wait 的 USDT/BankCard 充值记录）
 *   --wait     两次提交间隔秒（默认 180 = 3分钟）
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
const account = args.account || '';
const wait = args.wait || '180';

if (!account) {
    console.error('❌ 必须指定 --account 账号（需有 Wait 的 USDT/BankCard 充值记录）');
    process.exit(1);
}

const scriptDir = __dirname;
const SCRIPT = 'depositWorkOrderRepeatVerify.js';

const envs = { TENANT_ID: tenant, ACCOUNT: account, WAIT: wait, VIA_RUNNER: '1' };
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 充值工单重复提交验证  租户=${tenant}  账号=${account}  两次间隔=${wait}s`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const captured = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##WO##([^"]*)/);
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
    out.push('===== 充值工单重复提交验证 =====');
    captured.forEach(s => out.push(s));
    const report = out.join('\n');

    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'deposit_wo_repeat_result.txt');
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
