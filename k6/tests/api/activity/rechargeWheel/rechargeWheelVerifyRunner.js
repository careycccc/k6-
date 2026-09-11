/**
 * 充值转盘 - 数据统计报表验证 —— Node 包装器（按天打印对比）
 *
 * spawn rechargeWheelVerify.js（k6 从原始记录自算 + 拉转盘数据统计报表逐字段对比），
 * 拦截 ##RWVERIFY## base64 → 解码 → 按天打印：每字段 脚本值 vs 转盘数据统计值(✅/❌)，
 * 对不上的高亮，并在结尾汇总有几项对不上。
 *
 * 用法（本目录内）：
 *   node rechargeWheelVerifyRunner.js --start 2026-09-10 --end 2026-09-10 --tenant 3004
 *   node rechargeWheelVerifyRunner.js --start 2026-09-08                 # end 默认=start，租户默认3004
 *
 * 参数：
 *   --start   开始日期 YYYY-MM-DD（不传=k6 用站点时区今天）
 *   --end     结束日期 YYYY-MM-DD（不传=start）
 *   --tenant  租户ID（默认 3004）
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

const start = args.start || process.env.START || '';
const end = args.end || process.env.END || '';
const tenant = args.tenant || process.env.TENANT_ID || '3004';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (start && !DATE_RE.test(start)) { console.error('❌ --start 格式应为 YYYY-MM-DD'); process.exit(1); }
if (end && !DATE_RE.test(end)) { console.error('❌ --end 格式应为 YYYY-MM-DD'); process.exit(1); }

const SCRIPT = 'rechargeWheelVerify.js';
const scriptDir = __dirname;

const envs = { TENANT_ID: tenant, VIA_RUNNER: '1' };
if (start) envs.START = start;
if (end) envs.END = end;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 充值转盘数据验证  时间段=${start || '(今天)'}~${end || start || '(今天)'}  租户=${tenant}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

let report = null;
const MARKER_RE = /##RWVERIFY## ([A-Za-z0-9+/=]+)/;
let buf = '';

function handleLine(line) {
    const m = line.match(MARKER_RE);
    if (m) {
        try { report = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8')); }
        catch (e) { console.error('⚠️ marker 解析失败:', e.message); }
        return;
    }
    process.stderr.write(line + '\n');
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

child.stderr.on('data', scan);
child.stdout.on('data', (d) => process.stdout.write(d));

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf);
    if (!report || !report.days) {
        console.error(`\n❌ 未收集到验证数据（k6 退出码 ${code}）。请看上方 k6 日志排查。`);
        process.exit(code || 1);
    }
    printReport(report);
    if (code !== 0) {
        console.error(`\n⚠️ k6 退出码 ${code}：以上为已收集到的结果（可能不全）。`);
        process.exit(code);
    }
});

// ================= 打印 =================

function fmt(v, money) { return money ? (Number(v) || 0).toFixed(2) : String(v); }

// 按显示宽度补空格（中文算 2 宽）
function padW(str, width) {
    const s = String(str);
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
    return w >= width ? s : s + ' '.repeat(width - w);
}

function printReport(rpt) {
    const dline = '═'.repeat(66);
    const sline = '─'.repeat(66);
    console.log('\n' + dline);
    console.log(`  📊 充值转盘数据验证   ${rpt.start} ~ ${rpt.end}   租户 ${rpt.tenant}   （按天）`);
    console.log(dline);

    let grandFail = 0;
    for (const day of rpt.days) {
        grandFail += day.failCount || 0;
        console.log('');
        console.log(`  📅 ${day.date}${day.hasBackend ? '' : '   ⚠️ 转盘数据统计该天无报表数据（按 0 对比）'}`);
        console.log(sline);
        console.log(`  ${padW('字段', 20)}${padW('脚本', 14)}${padW('转盘数据统计', 14)}结果`);
        for (const r of day.rows) {
            const tag = r.match ? '✅' : '❌';
            const line = `  ${padW(r.label, 20)}${padW(fmt(r.script, r.money), 14)}${padW(fmt(r.backend, r.money), 14)}${tag}`;
            console.log(r.match ? line : line + `  ← 对不上(差 ${fmt(r.script - r.backend, r.money)})`);
        }
        console.log(sline);
        console.log(day.failCount === 0
            ? `  🎉 本天 ${day.rows.length} 项全部一致`
            : `  ⚠️ 本天 ${day.rows.length} 项中有 ${day.failCount} 项对不上（见上方 ❌）`);
    }

    console.log('\n' + dline);
    console.log(grandFail === 0
        ? `  🎉 全部 ${rpt.days.length} 天与转盘数据统计报表完全一致`
        : `  ⚠️ 共 ${grandFail} 项与转盘数据统计报表对不上（分布见各天 ❌）`);
    console.log(dline + '\n');
}
