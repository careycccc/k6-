/**
 * 邀请转盘「每天 00 点免费次数发放」验证 - Node 包装器
 * 跑 inviteWheelDailyGrantVerify.js，汇总结果（账号 / 预期 / 实际），落档。
 *
 * 用法（在 inviteTurntable 目录运行）：
 *   # 00 点后直接验（用户在印度 00:00 之后手动跑）
 *   node inviteWheelDailyGrantRunner.js --tenant 3004 --phone 917718003385
 *
 *   # 跨天验（临近印度午夜启动，脚本等跨过 00:00 再查）——必须放宽 k6 时长
 *   node inviteWheelDailyGrantRunner.js --tenant 3004 --phone 917718003385 --wait-midnight 1 --max-duration 2h
 *
 * ⚠️ k6 运行时长：--wait-midnight 1 时，--max-duration 必须 ≥「从启动到下一个印度 00:00 + 循环耗时」，
 *    否则还没等到 00:00 就被 k6 中断。建议临近午夜启动并给足余量（如 2h）。
 *
 * 参数：
 *   --phone         账号(手机号)，必填
 *   --tenant        租户ID（默认 3004）
 *   --password      密码（默认 qwer1234）
 *   --wait-midnight 1=等印度跨过 00:00 再查；0/省略=立即循环查（默认 0）
 *   --times         循环请求次数（默认 5）
 *   --gap           每次间隔秒（默认 180=3分钟；00点派发可能延迟几分钟）
 *   --max-duration  k6 最大运行时长（默认 20m，够 5次×3min；--wait-midnight 1 时按需调大，如 12h）
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

const phone = args.phone || '';
if (!phone) {
    console.error('❌ 必须用 --phone 提供账号，例如：node inviteWheelDailyGrantRunner.js --tenant 3004 --phone 917718003385');
    process.exit(1);
}
const tenant = args.tenant || '3004';
const password = args.password || 'qwer1234';
const waitMidnight = (args['wait-midnight'] === '1' || args['wait-midnight'] === 'true') ? '1' : '0';
const maxDuration = args['max-duration'] || '20m';

const scriptDir = __dirname;
const SCRIPT = 'inviteWheelDailyGrantVerify.js';

const envs = {
    TENANT_ID: tenant,
    PHONE: phone,
    PASSWORD: password,
    WAIT_MIDNIGHT: waitMidnight,
    MAX_DURATION: maxDuration,
    VIA_RUNNER: '1',
};
if (args.times) envs.POLL_TIMES = args.times;
if (args.gap) envs.POLL_GAP = args.gap;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🎡 邀请转盘每日免费次数发放验证  租户=${tenant}  账号=${phone}`);
console.log(`   等跨午夜=${waitMidnight === '1' ? '是' : '否'}  最大时长=${maxDuration}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const results = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##R##([^\r\n]*)/);
    if (!m) return;
    const parts = m[1].split('|');
    if (parts.length < 5) return;
    results.push({
        case: (parts[0] || '').trim(),
        phone: (parts[1] || '').trim(),
        expect: (parts[2] || '').trim(),
        actual: (parts[3] || '').trim(),
        status: (parts[4] || '').trim(),
        detail: (parts[5] || '').trim(),
    });
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
    out.push('========== 邀请转盘每日免费次数发放验证结果 ==========');
    out.push(`租户：${tenant}    账号：${phone}    时间：${new Date().toISOString()}`);
    out.push('');
    for (const r of results) {
        out.push(`[${r.status}] 账号=${r.phone}`);
        out.push(`      预期：${r.expect}`);
        out.push(`      实际：${r.actual}`);
        if (r.detail) out.push(`      详情：${r.detail}`);
    }
    if (results.length === 0) {
        out.push('⚠️ 未产出结果（可能超时被中断/登录失败/脚本异常，见上方日志）');
    }
    const report = out.join('\n');
    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'invite_wheel_daily_grant_result.txt');
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
