/**
 * 首充分析报表多日查询脚本
 * 复充查询报表 —— Node 包装器（多天并发查询 + 按天统一打印）
 *
 * 为什么需要它：k6 里多个 VU 内存互相隔离、日志会交错，无法把各 VU 的结果收集到一处
 * "最后按天统一打印"。因此由本 Node 脚本 spawn k6：
 *   - k6 内对 REPORT_DATE→今天 的每一天各起 1 个 VU 并发查询（提速）；
 *   - 每个 VU 把当天结果 base64 编码成 `##RETRPT## <base64>` 行输出（base64 避免 k6 日志
 *     msg="…" 把 JSON 引号转义）；
 *   - 本脚本实时透传 k6 进度、拦截并收集 marker，k6 结束后按天(升序)依次美化打印
 *     每天的复充报表 + 与后台报表的逐项对比（对不上打印脚本算出的会员id）。
 *
 * 用法（在本目录内运行）：
 *   node retentionRunner.js --date 2026-09-07 --tenant 3101
 *   node retentionRunner.js --date 2026-09-05                 # 租户默认 3004
 *   node retentionRunner.js --date 2026-09-07 --exclude-manual   # 排除人工充值
 *   node retentionRunner.js --date 2026-09-07 --debug 165935,165940
 *
 * 参数：
 *   --date            统计起始日 D0，YYYY-MM-DD（必需）；到"今天"之间每天各出一份报表
 *   --tenant          租户ID（默认 3004）
 *   --exclude-manual  排除人工充值(ManualRecharge)；默认都算
 *   --debug           逗号分隔 userId，打印其判定明细（透传到 k6 stderr）
 *   --max-reg         注册数保护上限（默认脚本内 3000）
 */

const { spawn } = require('child_process');
const path = require('path');

// -------- 解析 --key value 形式参数 --------
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

const date = args.date || process.env.REPORT_DATE || '';
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const excludeManual = args['exclude-manual'] !== undefined || process.env.EXCLUDE_MANUAL === '1';
const debugUids = args.debug || process.env.DEBUG_UIDS || '';
const maxReg = args['max-reg'] || process.env.MAX_REG || '';

if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('❌ 必须提供起始日：node retentionRunner.js --date YYYY-MM-DD [--tenant 3004]');
    process.exit(1);
}

const SCRIPT = 'rechargeRetentionReport.js';
const scriptDir = __dirname;

// -------- 组装 k6 -e 参数 --------
const envs = { REPORT_DATE: date, TENANT_ID: tenant, VIA_RUNNER: '1' };
if (excludeManual) envs.EXCLUDE_MANUAL = '1';
if (debugUids) envs.DEBUG_UIDS = debugUids;
if (maxReg) envs.MAX_REG = maxReg;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 复充查询报表  起始=${date}  租户=${tenant}${excludeManual ? '  [排除人工充值]' : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})`);
console.log(`   （REPORT_DATE→今天 的每一天各起 1 个 VU 并发查询，完成后按天统一打印）\n`);

// -------- spawn k6，实时透传进度 + 拦截 marker --------
const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const days = [];                                   // 收集的每天结果对象
const MARKER_RE = /##RETRPT## ([A-Za-z0-9+/=]+)/;  // base64：字符类内含 + / =
let buf = '';

function handleLine(line) {
    const m = line.match(MARKER_RE);
    if (m) {
        try {
            days.push(JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8')));
        } catch (e) {
            console.error('⚠️ marker 解析失败:', e.message);
        }
        return; // marker 行不透传（避免长 base64 刷屏）
    }
    process.stderr.write(line + '\n'); // 其余（k6 进度日志）实时透传
}

function scan(chunk) {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
    }
}

child.stderr.on('data', scan);                                   // k6 console.log 走 stderr
child.stdout.on('data', (d) => process.stdout.write(d));         // k6 stdout 原样透传

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf); // flush 末行（可能无换行）

    if (days.length === 0) {
        console.error(`\n❌ 未收集到任何天的结果（k6 退出码 ${code}）。请看上方 k6 日志排查。`);
        process.exit(code || 1);
    }

    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    printAllDays(days, tenant);

    if (code !== 0) {
        console.error(`\n⚠️ k6 退出码 ${code}：以上为已收集到的 ${days.length} 天结果（可能不全）。`);
        process.exit(code);
    }
    console.log(`\n✅ 完成：共 ${days.length} 天（${days.map(d => d.date).join(', ')}）`);
});

// ================= 报表美化打印（Node 端：换行正常、无 k6 前缀） =================

function pct(n, d) {
    if (!d) return '0.00%';
    return (n / d * 100).toFixed(2) + '%';
}

function printAllDays(list, tenant) {
    const dline = '═'.repeat(60);
    const sline = '─'.repeat(60);
    console.log('\n\n' + '█'.repeat(60));
    console.log(`  📚 复充查询汇总   共 ${list.length} 天   租户 ${tenant}   （按天升序）`);
    console.log('█'.repeat(60));

    for (const day of list) {
        const c = day.counts || {};
        const denom = c.denom || 0;
        console.log('');
        console.log(dline);
        console.log(`  📊 统计日 = ${day.date}      今天 = ${day.today}      租户 = ${day.tenant}`);
        console.log(dline);
        console.log(`  当日注册首充   : ${c.regFirst || 0}`);
        console.log(`  当日注册未首充 : ${c.regNoFirst || 0}`);
        console.log(sline);
        console.log(`  当日首充(基准) : ${c.firstPay || 0}`);
        console.log(`  当日复充       : ${c.sameDayRepay || 0}  (${pct(c.sameDayRepay || 0, denom)})`);
        console.log(`  当日无复充     : ${c.sameDayNoRepay || 0}  (${pct(c.sameDayNoRepay || 0, denom)})`);
        console.log(sline);
        for (const nd of (day.nDay || [])) {
            if (!nd.reached) {
                console.log(`  ${nd.label}(${nd.date}) : --  (未到)`);
            } else {
                console.log(`  ${nd.label}(${nd.date}) : ${nd.count}  (${pct(nd.count, denom)})`);
            }
        }
        console.log(sline);

        // 与后台对比
        console.log('  🔍 与后台报表对比 (GetUserRptFirstRechargeRetentionPageList)');
        if (day.backendMissing || !day.compare || day.compare.length === 0) {
            console.log('  ⚠️ 未取到后台报表数据，跳过对比');
            console.log(dline);
            continue;
        }
        let fail = 0;
        for (const item of day.compare) {
            if (item.isRate) {
                const tag = item.match ? '✅' : '❌';
                if (!item.match) fail++;
                console.log(`  ${tag} ${item.name}: 脚本=${Number(item.script).toFixed(4)} 后台=${Number(item.backend).toFixed(4)}`);
                continue;
            }
            if (item.match) {
                console.log(`  ✅ ${item.name}: 脚本=${item.script} 后台=${item.backend}`);
            } else {
                fail++;
                const bv = item.backend === null ? '(无)' : item.backend;
                const diff = item.diff === null ? '' : ` (差 ${item.diff > 0 ? '+' : ''}${item.diff})`;
                console.log(`  ❌ ${item.name}: 脚本=${item.script} 后台=${bv}${diff}`);
                if (item.ids && item.ids.length) {
                    console.log(`      脚本算出的会员id(${item.ids.length}): [${item.ids.join(', ')}]`);
                }
            }
        }
        console.log(sline);
        console.log(fail === 0 ? '  🎉 全部与后台一致' : `  ⚠️ 有 ${fail} 项与后台对不上（见上方 ❌ 的会员id）`);
        console.log(dline);
    }
}
