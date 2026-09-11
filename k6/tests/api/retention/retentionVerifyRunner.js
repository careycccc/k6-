/**
 * 留存率报表验证脚本（Node 包装器）
 * 7 张留存报表验证 —— Node 包装器（收集 marker + 按「表→天」打印对比）
 *
 * 为什么需要它：k6 单 VU 里 console.log 会被 msg="…" 转义、且不便美化换行。故由本脚本 spawn k6：
 *   - 实时透传 k6 进度日志；
 *   - 从 stderr 拦截 `##RETV## <base64>`（每表每天一条对比结果）与 `##RETV_META## <base64>`（元信息/错误）；
 *   - k6 结束后按「表(1~7) → 天(升序)」美化打印每张表的当日群体、各 N 日留存、以及与后台逐字段对比
 *     （对不上 ❌ 高亮并打印脚本算出的会员 id）。
 *
 * 用法（在本目录内运行）：
 *   node retentionVerifyRunner.js --start 2026-09-10 --end 2026-09-10 --tenant 3004
 *   node retentionVerifyRunner.js --start 2026-09-07                        # end 默认=start，租户默认 3004
 *
 * 参数：
 *   --start   注册/报表日范围起 YYYY-MM-DD（必需）
 *   --end     范围止 YYYY-MM-DD（默认=start）；脚本内部会收敛到「昨天」（统计不实时）
 *   --tenant  租户ID（默认 3004，默认全站）
 *   --max     单日全站翻页保护上限（默认 200 页）
 */

const { spawn } = require('child_process');
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

const start = args.start || process.env.START_DATE || '';
const end = args.end || process.env.END_DATE || start;
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const maxScan = args.max || process.env.MAX_SCAN || '';

if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    console.error('❌ 必须提供起始日：node retentionVerifyRunner.js --start YYYY-MM-DD [--end YYYY-MM-DD] [--tenant 3004]');
    process.exit(1);
}

const SCRIPT = 'retentionVerify.js';
const scriptDir = __dirname;

const envs = { START_DATE: start, END_DATE: end, TENANT_ID: tenant, VIA_RUNNER: '1' };
if (maxScan) envs.MAX_SCAN = maxScan;
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 留存报表验证  范围=${start}~${end}  租户=${tenant}（默认全站）`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})`);
console.log(`   （单 VU 串行全站预取 + 集合运算 + 逐字段对比后台；今天数据不完整，仅算到昨天）\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const results = [];   // 每表每天的对比结果
let meta = null;
const RETV_RE = /##RETV## ([A-Za-z0-9+/=]+)/;
const META_RE = /##RETV_META## ([A-Za-z0-9+/=]+)/;
let buf = '';

function handleLine(line) {
    let m = line.match(RETV_RE);
    if (m) {
        try { results.push(JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'))); }
        catch (e) { console.error('⚠️ RETV 解析失败:', e.message); }
        return;
    }
    m = line.match(META_RE);
    if (m) {
        try { meta = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8')); }
        catch (e) { console.error('⚠️ META 解析失败:', e.message); }
        return;
    }
    process.stderr.write(line + '\n'); // 其余 k6 进度日志实时透传
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

    if (meta && meta.error) {
        console.error(`\n⚠️ ${meta.error}`);
    }
    if (results.length === 0) {
        console.error(`\n❌ 未收集到任何对比结果（k6 退出码 ${code}）。请看上方 k6 日志排查。`);
        process.exit(code || 1);
    }

    printReport(results, tenant);

    if (code !== 0) {
        console.error(`\n⚠️ k6 退出码 ${code}：以上为已收集到的结果（可能不全）。`);
        process.exit(code);
    }
    console.log(`\n✅ 完成`);
});

// ================= 美化打印（按 表→天，紧凑对齐） =================

const RETAIN_NAME = { retention: '新增系列', behavior: '行为系列' };
function pct(n, d) { return d ? (n / d * 100).toFixed(1) + '%' : '0%'; }
function padEndW(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }

function printReport(list, tenant) {
    const today = list[0].today, yesterday = list[0].yesterday;
    const W = 72;
    const bar = '━'.repeat(W);

    console.log('\n' + bar);
    console.log(`  📚 留存报表验证汇总    租户 ${tenant}（全站）`);
    console.log(`     今天 ${today}  ·  最新完整日 ${yesterday}（今天数据不完整不参与）`);
    console.log(bar);

    const byTable = {};
    for (const r of list) { (byTable[r.idx] = byTable[r.idx] || []).push(r); }
    const idxs = Object.keys(byTable).map(Number).sort((a, b) => a - b);

    let grandFail = 0, grandCmp = 0, missing = 0;
    const tableVerdicts = [];

    for (const idx of idxs) {
        const rows = byTable[idx].sort((a, b) => (a.date < b.date ? -1 : 1));
        const h = rows[0];
        const extra = h.idx === 1 ? `  活跃阈值 ${h.threshold}` : '';
        console.log('');
        console.log(`┌── 表${h.idx} · ${h.name}  〔${RETAIN_NAME[h.series]} retainType=${h.retainType}〕${extra}`);

        let tableFail = 0, tableCmp = 0, tableMissing = 0;

        for (const day of rows) {
            const denom = day.series === 'retention' ? day.base.reg : day.base.baseUserCount;
            const baseStr = day.series === 'retention'
                ? `注册 ${day.base.reg} · 登录 ${day.base.login} · 首充 ${day.base.firstRecharge}`
                : `当日群体 ${day.base.baseUserCount}`;

            const reached = day.nDay.filter(nd => nd.reached);
            const retStr = reached.length
                ? reached.map(nd => `${nd.n === 2 ? '次日' : nd.n + '日'} ${nd.count}(${pct(nd.count, denom)})`).join('   ')
                : '（次日尚未到，暂无留存可比）';

            // 对比结论
            let verdict, expand = [];
            if (day.backendMissing || !day.compare || day.compare.length === 0) {
                verdict = '⚠️  后台暂无数据，跳过'; missing++; tableMissing++;
            } else {
                const fails = day.compare.filter(c => !c.match);
                grandCmp += day.compare.length; grandFail += fails.length;
                tableCmp += day.compare.length; tableFail += fails.length;
                verdict = fails.length === 0
                    ? `✅ 全部一致（${day.compare.length} 项）`
                    : `❌ ${fails.length} / ${day.compare.length} 项不符`;
                for (const c of fails) {
                    if (c.isRate) {
                        expand.push(`         ✗ ${c.name}：脚本 ${c.script}%  后台 ${c.backend}%`);
                    } else {
                        const bv = c.backend === null ? '(无)' : c.backend;
                        const diff = c.diff === null ? '' : `  差 ${c.diff > 0 ? '+' : ''}${c.diff}`;
                        expand.push(`         ✗ ${c.name}：脚本 ${c.script}  后台 ${bv}${diff}`);
                        if (c.ids && c.ids.length) {
                            const shown = c.ids.slice(0, 50).join(', ');
                            expand.push(`            脚本算出的会员id(${c.ids.length})：[${shown}${c.ids.length > 50 ? ', …' : ''}]`);
                        }
                    }
                }
            }

            console.log(`│  ▸ ${day.date}   ${baseStr}`);
            console.log(`│      留存  ${retStr}`);
            console.log(`│      对比  ${verdict}`);
            expand.forEach(l => console.log('│' + l));
            if (day.crossLogin) {
                const c = day.crossLogin;
                console.log('│      🔬 登录口径交叉诊断（排查与后台差异）:');
                console.log(`│         登录日志(全部)=${c.logA}   末登当日(全部)=${c.lastAll}   末登当日会员=${c.lastType02}`);
                console.log(`│         登录日志里正式会员(userType[0,2],逐个查)=${c.memberReal}  ← 与后台对比`);
                if (c.typeDist) {
                    const dist = Object.keys(c.typeDist).sort((a, b) => Number(a) - Number(b)).map(t => `type${t}:${c.typeDist[t]}`).join('  ');
                    console.log(`│         登录日志 userType 分布: ${dist}`);
                }
            }
        }

        // 每表小结
        let tv;
        if (tableCmp === 0) tv = tableMissing ? '⚠️ 后台无数据' : '—';
        else tv = tableFail === 0 ? '✅ 全绿' : `❌ ${tableFail}项不符`;
        tableVerdicts.push({ idx: h.idx, name: h.name, tv });
        console.log(`└${'─'.repeat(W - 1)}`);
    }

    // 总览
    console.log('\n' + bar);
    console.log('  ▎结论总览');
    for (const t of tableVerdicts) {
        console.log(`     表${padEndW(t.idx, 2)} ${padEndW(t.name, 12)} ${t.tv}`);
    }
    console.log('  ' + '─'.repeat(W - 2));
    if (grandFail === 0) {
        console.log(`  🎉 有后台数据的对比 ${grandCmp} 项全绿` + (missing ? `；另有 ${missing} 表/天后台无数据已跳过` : ''));
    } else {
        console.log(`  ⚠️ 合计 ${grandFail} / ${grandCmp} 项不符（见上方 ❌）` + (missing ? `；另 ${missing} 表/天后台无数据已跳过` : ''));
    }
    console.log(bar);
}
