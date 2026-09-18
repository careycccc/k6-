/**
 * 出款自动审核「通过规则(含累计)」验证 - Node 包装器（跑 auditRuleVerify.js，汇总，报「实际≠预期」）
 *
 * 用法（在 inviteTurntable 目录运行）：
 *   node auditRuleRunner.js --tenant 3004
 *   node auditRuleRunner.js --tenant 3004 --cases R2_g1,R2_g2,R2_reject,nomatch
 *
 * 参数：
 *   --tenant  租户ID（默认 3004）
 *   --cases   用例清单（逗号分隔，默认脚本内全部）；一条用例一个账号并发
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
const cases = args.cases || '';

const scriptDir = __dirname;
const SCRIPT = 'auditRuleVerify.js';

const envs = { TENANT_ID: tenant, VIA_RUNNER: '1' };
if (cases) envs.CASES = cases;
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 出款自动审核通过规则验证(含累计)  租户=${tenant}${cases ? `  用例=${cases}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const results = [];
let buf = '';

function handleLine(line) {
    const m = line.match(/##A##([^"]*)/);
    if (!m) return;
    const parts = m[1].split('|');
    if (parts.length < 4) return;
    // name | userId | msg | status
    results.push({ name: parts[0].trim(), userId: parts[1].trim(), msg: parts.slice(2, parts.length - 1).join('|').trim(), status: parts[parts.length - 1].trim() });
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
    out.push('===== 出款自动审核通过规则验证(含累计) =====');
    out.push(`用例数：${results.length}`);
    out.push('');
    out.push('---- 全部用例 ----');
    for (const r of results) {
        out.push(`[${r.status}] ${r.name} (userId=${r.userId})`);
        out.push(`      ${r.msg}`);
    }
    const fails = results.filter(r => r.status !== 'PASS');
    out.push('');
    out.push('---- ⚠️ 实际≠预期（需排查） ----');
    if (fails.length === 0) out.push('（无，全部符合预期 ✅）');
    else for (const r of fails) { out.push(`🔴 ${r.name}  userId=${r.userId}`); out.push(`   ${r.msg}`); }
    const report = out.join('\n');
    console.log('\n' + report + '\n');

    if (code !== 0) { console.error(`\n❌ k6 退出码 ${code}；不落档。`); process.exit(code); }
    const f = path.join(scriptDir, 'audit_rule_result.txt');
    fs.writeFileSync(f, report + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}`);
});
