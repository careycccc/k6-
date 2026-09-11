/**
 * 邀请转盘 · 出款自动审核 —— Node 包装器（spawn k6 + 收集结果打印报表）
 *
 * 用法（在本目录内运行；跑前先按该 case 的开关提示在后台配好）：
 *   node auditRunner.js --case R3 --tenant 3004
 *   node auditRunner.js --case P1_ok --tenant 3004                 # 通过用例，自动捞轮次≥1老号
 *   node auditRunner.js --case P1_ok --old-user 918888888888       # 手动指定老号(密码 qwer1234)
 *   node auditRunner.js --suite reject --tenant 3004               # 顺序跑 R1,R2,R3,R5（每条前会暂停提示改开关）
 *
 * 参数：
 *   --case      单个用例：R1/R2/R3/R5/P0/P1_ok/P1_ok_sub/P1_fail/P2_ok/P2_fail/C_priority/C_downgrade
 *   --suite     成组：reject(R1..R5) / pass(P0,P1*,P2*) / combo(C_*)
 *   --tenant    租户（默认 3004）
 *   --old-user  通过用例手动指定的轮次≥1老号 account
 *   --wait      自动审核等待秒数（默认脚本内 60）
 */

const { spawn } = require('child_process');

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
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const oldUser = args['old-user'] || '';
const oldPwd = args['old-pwd'] || '';
const wait = args.wait || '';

const SUITES = {
    reject: ['R1', 'R2', 'R3', 'R5'],
    pass: ['P0', 'P1_ok', 'P1_ok_sub', 'P1_fail', 'P2_ok', 'P2_fail'],
    combo: ['C_priority', 'C_downgrade']
};

let cases;
if (args.suite && SUITES[args.suite]) cases = SUITES[args.suite];
else if (args.case) cases = [args.case];
else { console.error('❌ 需指定 --case <ID> 或 --suite reject|pass|combo'); process.exit(1); }

const SCRIPT = 'auditVerify.js';
const scriptDir = __dirname;
const results = [];

function runOne(caseId) {
    return new Promise((resolve) => {
        const envs = { TENANT_ID: tenant, CASE: caseId };
        if (oldUser) envs.OLD_USER = oldUser;
        if (oldPwd) envs.OLD_PWD = oldPwd;
        if (wait) envs.AUDIT_WAIT = wait;
        const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

        console.log(`\n${'═'.repeat(70)}\n🚀 CASE ${caseId}  租户 ${tenant}\n💻 k6 ${k6Args.join(' ')}\n${'═'.repeat(70)}`);
        const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });
        let buf = '';
        const RE = /##AUDIT## ([A-Za-z0-9+/=]+)/;
        function handle(line) {
            const m = line.match(RE);
            if (m) { try { results.push(JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'))); } catch (e) { console.error('marker 解析失败', e.message); } return; }
            process.stderr.write(line + '\n');
        }
        function scan(c) { buf += c.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } }
        child.stderr.on('data', scan);
        child.stdout.on('data', (d) => process.stdout.write(d));
        child.on('error', (e) => { console.error(`❌ 启动 k6 失败: ${e.message}`); resolve(); });
        child.on('close', () => { if (buf) handle(buf); resolve(); });
    });
}

function ask(q) {
    return new Promise((resolve) => {
        process.stdout.write(q);
        process.stdin.resume();
        process.stdin.once('data', (d) => { process.stdin.pause(); resolve(d.toString().trim()); });
    });
}

(async () => {
    for (let i = 0; i < cases.length; i++) {
        // suite 模式：每条前提示改后台开关（因为逐条隔离，开关不同）
        if (cases.length > 1) {
            await ask(`\n⏸️  即将跑 ${cases[i]}，请先在后台按该 case 要求切换开关，改好后按回车继续...`);
        }
        await runOne(cases[i]);
    }
    printReport(results, tenant);
    process.exit(0);
})();

// ================= 报表 =================
function printReport(list, tenant) {
    const bar = '━'.repeat(96);
    console.log('\n\n' + bar);
    console.log(`  📋 邀请转盘出款自动审核 验证报表    租户 ${tenant}`);
    console.log(bar);
    if (!list.length) { console.log('  ⚠️ 无结果'); console.log(bar); return; }

    const H = ['case', 'userId', '下级', '场景', '本人充值', '下级总和', '轮次', '预期', '后台', '命中规则', '符合'];
    const rows = list.map(r => [
        r.case,
        r.userId == null ? '-' : String(r.userId),
        String(r.subCount),
        r.title,
        String(r.selfRecharge),
        String(r.subRechargeSum),
        String(r.rounds),
        r.expect,
        r.errNote ? ('⚠️' + r.errNote) : `${r.actual}(${r.auditState})`,
        (r.reason !== '' && r.reason != null) ? ('规则' + r.reason) : '-',
        r.errNote ? '—' : (r.match ? '✅' : '❌')
    ]);
    const widths = H.map((h, i) => Math.max(strW(h), ...rows.map(row => strW(row[i]))));
    const line = (cols) => '  ' + cols.map((c, i) => padTo(c, widths[i])).join(' │ ');
    console.log(line(H));
    console.log('  ' + widths.map(w => '─'.repeat(w)).join('─┼─'));
    rows.forEach(row => console.log(line(row)));
    console.log(bar);
    const pass = list.filter(r => !r.errNote && r.match).length;
    const fail = list.filter(r => !r.errNote && !r.match).length;
    const err = list.filter(r => r.errNote).length;
    console.log(`  合计 ${list.length}：✅符合 ${pass} · ❌不符 ${fail} · ⚠️造数异常 ${err}`);
    console.log(bar);
}
// 中文按 2 宽度对齐
function strW(s) { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1; return w; }
function padTo(s, w) { s = String(s); return s + ' '.repeat(Math.max(0, w - strW(s))); }
