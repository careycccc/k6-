/**
 * 充值拉单黑名单风控验证 - Node 包装器
 * 跑 pullBlacklistVerify.js，汇总结果，打印「每条用例：执行了没 / 用户ID / 预期 / 实际 / 详情」，重点报 FAIL。
 *
 * 脚本分组：
 *   短脚本(默认全跑,16条)：当天/几十分钟内可完成
 *   长脚本(2条,默认不跑)：cross_day(半夜发起) / dubai_release(第二天迪拜10点解除) —— 要跑到午夜/第二天
 *
 * 用法（在 recharge 目录运行）：
 *   # 短脚本组：默认全跑（16条），默认 --max-duration 120m
 *   node pullBlacklistRunner.js --tenant 3004
 *   # 只跑指定短用例（先小范围验证接口）
 *   node pullBlacklistRunner.js --tenant 3004 --cases trigger,limit_block
 *   # 长脚本：下班时跑，必须放宽运行时长到 24h
 *   node pullBlacklistRunner.js --tenant 3004 --cases cross_day,dubai_release --max-duration 24h
 *
 * ⚠️ k6 运行时长：--max-duration 必须 ≥ 最慢用例内部等待总和，否则用例还在等轮询/等解除时会被 k6 强杀、跑不出结果。
 *    per-vu-iterations 下 maxDuration 只是上限，用例做完即退，所以宁大勿小。短脚本组默认 120m，长脚本必须 24h。
 *
 * 参数：
 *   --tenant        租户ID（默认 3004）
 *   --cases         用例清单（逗号分隔）；默认跑 16 条短脚本（不含 cross_day/dubai_release）
 *   --max-duration  k6 场景最大运行时长（默认 120m；长脚本必须传 24h）
 *   --poll-sec      进表轮询最长等待秒数（默认 900）
 *   --poll-interval 轮询间隔秒（默认 30）
 *   --threshold     触发阈值（默认 5，>阈值触发）
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
const cases = args.cases || 'trigger,no_trigger,cancel_still_trigger,limit_block,no_limit_pass,limit_bounds,limit_increase_absolute,limit_decrease_reject,paid_reduce_no_trigger,paid_partial_trigger,paid_during_no_release,paid_after_limit,data_keeps_updating,update_last_4,update_last_5,update_last_6';
const maxDuration = args['max-duration'] || '120m';

const scriptDir = __dirname;
const SCRIPT = 'pullBlacklistVerify.js';

const envs = {
    TENANT_ID: tenant,
    CASES: cases,
    MAX_DURATION: maxDuration,
    VIA_RUNNER: '1',
};
if (args['poll-sec']) envs.POLL_SEC = args['poll-sec'];
if (args['poll-interval']) envs.POLL_INTERVAL = args['poll-interval'];
if (args['threshold']) envs.THRESHOLD = args['threshold'];

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 充值拉单黑名单风控验证  租户=${tenant}`);
console.log(`   用例=${cases}`);
console.log(`   最大时长=${maxDuration}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const results = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##R##([^\r\n]*)/);
    if (!m) return;
    const parts = m[1].split('|');
    if (parts.length < 6) return;
    results.push({
        case: (parts[0] || '').trim(),
        userId: (parts[1] || '').trim(),
        phone: (parts[2] || '').trim(),
        expect: (parts[3] || '').trim(),
        actual: (parts[4] || '').trim(),
        status: (parts[5] || '').trim(),
        detail: (parts[6] || '').trim(),
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

    const requested = cases.split(',').map(s => s.trim()).filter(Boolean);
    const ranCases = new Set(results.map(r => r.case));
    const notRun = requested.filter(c => !ranCases.has(c));

    const pass = results.filter(r => r.status === 'PASS');
    const fails = results.filter(r => r.status !== 'PASS');

    const out = [];
    out.push('==================== 充值拉单黑名单风控验证结果 ====================');
    out.push(`租户：${tenant}    时间：${new Date().toISOString()}`);
    out.push(`请求用例数：${requested.length}    已执行：${results.length}    ✅通过：${pass.length}    🔴失败：${fails.length}`);
    out.push('');

    out.push('---------- 全部用例明细 ----------');
    for (const r of results) {
        out.push(`[${r.status}] 用例=${r.case}   用户userId=${r.userId}   手机号=${r.phone}`);
        out.push(`      预期：${r.expect}`);
        out.push(`      实际：${r.actual}`);
        if (r.detail) out.push(`      详情：${r.detail}`);
        out.push('');
    }

    if (notRun.length) {
        out.push('---------- ⚠️ 未产出结果的用例（可能超时/异常/未执行） ----------');
        for (const c of notRun) out.push(`   ❔ ${c}`);
        out.push('');
    }

    out.push('---------- 🔴 实际≠预期（需排查） ----------');
    if (fails.length === 0) {
        out.push('（无，全部符合预期 ✅）');
    } else {
        for (const r of fails) {
            out.push(`🔴 用例=${r.case}   用户userId=${r.userId}   手机号=${r.phone}`);
            out.push(`   预期：${r.expect}`);
            out.push(`   实际：${r.actual}`);
            if (r.detail) out.push(`   详情：${r.detail}`);
        }
    }

    const report = out.join('\n');
    console.log('\n' + report + '\n');

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；不落档。`);
        process.exit(code);
    }
    const f = path.join(scriptDir, 'pull_blacklist_result.txt');
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
