/**
 * 出款自动审核「条件组三(新增)」验证 - Node 包装器
 * 逐批次跑 auditG3Verify.js（每批：改规则→等30s→并发跑用例），账号跨批不复用，跑完恢复原始配置并汇总报表。
 *
 * 用法（在 inviteTurntable 目录运行）：
 *   node auditG3Runner.js --tenant 3004                         # 全部批次
 *   node auditG3Runner.js --tenant 3004 --batches OR --cases OR_sub_eq,D_apply_now
 *   node auditG3Runner.js --tenant 3004 --restore               # 只把 3 条通过规则恢复成原始配置
 *   node auditG3Runner.js --tenant 3004 --merge a.log,b.log     # 合并已有运行日志出报表(同名用例取后一次)
 *
 * 参数：
 *   --batches  批次(逗号分隔，默认 CH,MATCH,DISABLE,AND,OFF,ALL,RESET,EDGE,OR,ORX)
 *   --cases    只跑指定用例(需属于所选批次)
 *   --restore  false=跑完不恢复原始通过规则配置(默认恢复)
 *   --acct     指定账号，格式 用例名:手机号[,用例名:手机号]，如 --acct DIS_carey_r1:91xxxxxxxxxx（不符合条件会报原因，不会自动换号）
 *   其余透传 -e：--g3-x --g3-y --ch-x --audit-wait --wheel-wait --arrive-wait --hist-start --scan-start
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (k && k.startsWith('--')) {
            const val = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
            a[k.slice(2)] = val;
        }
    }
    return a;
}
const args = parseArgs(process.argv);
const tenant = args.tenant || '3004';
const BATCH_ORDER = ['CH', 'MATCH', 'DISABLE', 'AND', 'OFF', 'ALL', 'RESET', 'EDGE', 'OR', 'ORX'];
const restoreOnly = args.restore === 'true' && !args.batches && !args.cases;
const batches = restoreOnly ? [] : (args.batches || BATCH_ORDER.join(',')).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const scriptDir = __dirname;
const SCRIPT = 'auditG3Verify.js';
const PASS_ENV = { 'acct': 'ACCOUNTS', 'g3-x': 'G3_X', 'g3-y': 'G3_Y', 'ch-x': 'CH_X', 'audit-wait': 'AUDIT_WAIT', 'wheel-wait': 'WHEEL_WAIT', 'arrive-wait': 'ARRIVE_WAIT', 'hist-start': 'HIST_START', 'scan-start': 'SCAN_START' };
const PKG_NAME = { 0: '官网official', 1: '代理agent', 2: '转盘wheel', 100051: 'carey_tiktok_022' };

const results = [], configs = [];
const usedIds = new Set();

function decode(line, kind) {
    const m = line.match(new RegExp(`##${kind}##([A-Za-z0-9+/=]+)##`));
    if (!m) return null;
    try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch (e) { return null; }
}
function handleLine(line) {
    const a = decode(line, 'A'); if (a) results.push(a);
    const u = decode(line, 'U'); if (u) usedIds.add(String(u.userId));
    const c = decode(line, 'C'); if (c) configs.push(c);
}

function runBatch(batch) {
    return new Promise((resolve) => {
        const envs = { TENANT_ID: tenant, BATCH: batch, VIA_RUNNER: '1', EXCLUDE_IDS: [...usedIds].join(',') };
        if (args.cases) envs.CASES = args.cases;
        for (const [k, e] of Object.entries(PASS_ENV)) if (args[k]) envs[e] = args[k];
        const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];
        console.log(`\n🚀 批次 ${batch}  租户=${tenant}${args.cases ? `  用例=${args.cases}` : ''}  已用账号=${usedIds.size}`);
        const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });
        let buf = '';
        const scan = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, i)); buf = buf.slice(i + 1); } };
        child.stdout.on('data', (d) => { process.stdout.write(d); scan(d); });
        child.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
        child.on('error', (err) => { console.error(`❌ 无法启动 k6：${err.message}`); resolve(1); });
        child.on('close', (code) => { if (buf) handleLine(buf); resolve(code); });
    });
}

/** 实际≠预期时：打印当时数据 + 应匹配的规则及条件 + 预期依据 */
function ruleLines(r, p) {
    const lines = [];
    const round = p.round !== undefined ? p.round : (p.idx === 1 && r.roundBefore !== undefined ? r.roundBefore : '?');
    lines.push(`▶ 第${p.idx}次申请时数据：渠道=${PKG_NAME[r.pkg] || r.pkg} 成功轮次=${round} 本人新增=${p.selfNew}${p.selfCum !== undefined ? `(本人累计${p.selfCum})` : ''} 新增下级合计=${p.subNew}(${p.newSubCount}人)${p.roundSelf !== undefined ? ` 本轮本人=${p.roundSelf} 本轮下级=${p.roundSub}(${p.roundSubCount}人)` : ''}${p.src ? `；实际拒绝来源=${p.src}` : ''}`);
    if (p.rule) lines.push(`▶ 当时应匹配规则：${p.rule}`);
    else {
        const c = configs.filter(x => x.batch === r.batch).slice(-1)[0];
        lines.push(`▶ 当时批次[${r.batch}]规则配置：`);
        (c ? c.rules : ['(无配置记录)']).forEach(x => lines.push(`     ${x}`));
    }
    if (p.expectNote) lines.push(`▶ 预期依据：${p.expectNote}`);
    return lines;
}

function report() {
    results.sort((a, b) => (BATCH_ORDER.indexOf(a.batch) - BATCH_ORDER.indexOf(b.batch)) || a.name.localeCompare(b.name));
    const out = [];
    const pass = results.filter(r => r.ok).length;
    out.push('===== 出款自动审核 · 条件组三(新增) 验证报表 =====');
    out.push(`租户：${tenant}   批次：${batches.join(',') || '(仅恢复)'}   用例数：${results.length}   PASS=${pass}  FAIL=${results.length - pass}`);
    out.push('');
    out.push('---- 各批次规则配置 ----');
    for (const c of configs) { out.push(`[${c.batch}] ${c.ok ? '✅' : '❌'}`); c.rules.forEach(r => out.push(`   ${r}`)); }
    out.push('');
    out.push('---- 用例明细（userId → 用例 / 每次申请：预期 vs 实际(提现历史) ）----');
    for (const r of results) {
        out.push(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}  批次=${r.batch}  userId=${r.userId}  账号=${r.account || '-'}  渠道=${PKG_NAME[r.pkg] || r.pkg || '-'}${r.reset ? '(已改密码)' : ''}`);
        out.push(`      场景：${r.desc}`);
        if (r.error) out.push(`      ❗ ${r.error}`);
        if (r.roundBefore !== undefined) out.push(`      成功轮次：执行前=${r.roundBefore} 执行后=${r.roundAfter}`);
        for (const p of (r.phases || [])) {
            const same = p.actual === p.expect ? '一致' : '不一致';
            out.push(`      第${p.idx}次申请 单号=${p.orderNo || '-'} 本人新增=${p.selfNew} 新增下级(${p.newSubCount}人)=${p.subNew}${p.roundSelf !== undefined ? ` 本轮本人=${p.roundSelf} 本轮下级=${p.roundSub}` : ''} | 预期=${p.expect} 实际=${p.actual} → ${same} | 提现历史复核=${p.histNow || '-'}${p.src ? ` 拒绝来源=${p.src}` : ''}${p.completionTime ? ` 完成=${p.completionTime}` : ''}${p.recInvited !== undefined ? ` 记录本轮邀请=${p.recInvited}/累计=${p.recTotalInvited}` : ''}`);
            if (p.expectNote) out.push(`         预期依据：${p.expectNote}`);
            if (p.actual !== p.expect) ruleLines(r, p).forEach(l => out.push(`         ${l}`));
        }
        if (r.log && r.log.length) out.push(`      造数：${r.log.join('；')}`);
        if (r.dataErr && r.dataErr.length) out.push(`      ⚠️ 造数/验证无效：${r.dataErr.join('；')}`);
        if (r.warn && r.warn.length) out.push(`      ℹ️ 提示：${r.warn.join('；')}`);
        if (r.histIssues && r.histIssues.length) out.push(`      ⚠️ 提现历史不一致：${r.histIssues.join('；')}`);
        if (r.recIssues && r.recIssues.length) out.push(`      ℹ️ 记录邀请人数：${r.recIssues.join('；')}`);
    }
    const fails = results.filter(r => !r.ok);
    out.push('');
    out.push('---- ⚠️ 需排查（实际≠预期 / 造数失败 / 历史不一致） ----');
    if (!fails.length) out.push('（无，全部符合预期 ✅）');
    for (const r of fails) {
        const badPhases = (r.phases || []).filter(p => p.actual !== p.expect);
        const bad = badPhases.map(p => `第${p.idx}次 预期=${p.expect} 实际=${p.actual}`).join('；');
        out.push(`🔴 ${r.name} userId=${r.userId} ${r.error || ''} ${bad} ${(r.dataErr || []).join('；')} ${(r.histIssues || []).join('；')}`.trim());
        for (const p of badPhases) ruleLines(r, p).forEach(l => out.push(`   ${l}`));
        if (r.trail && r.trail.length) {
            out.push('   ▶ 复现步骤：');
            r.trail.forEach((t, i) => out.push(`     ${i + 1}. ${t}`));
        }
    }
    const recs = results.filter(r => r.recIssues && r.recIssues.length);
    out.push('');
    out.push('---- ℹ️ 提现记录「本轮邀请/累计邀请」核对（本轮邀请=本轮点礼物盒之后邀请的，普通码下级也算；仅提示，不判失败） ----');
    if (!recs.length) out.push('（全部一致）');
    for (const r of recs) out.push(`• ${r.name} userId=${r.userId}：${r.recIssues.join('；')}`);
    return out.join('\n');
}

(async () => {
    // --merge a.log,b.log：只合并已有运行日志出报表（同名用例取后一次结果）
    if (args.merge) {
        for (const f of args.merge.split(',')) fs.readFileSync(path.join(scriptDir, f.trim()), 'utf8').split('\n').forEach(handleLine);
        const last = {};
        results.forEach(r => { last[r.name] = r; });
        results.splice(0, results.length, ...Object.values(last));
        const lastC = {};
        configs.forEach(c => { lastC[c.batch] = c; });
        configs.splice(0, configs.length, ...Object.values(lastC));
        batches.splice(0, batches.length, ...[...new Set(results.map(r => r.batch))]);
        const text = report();
        console.log('\n' + text + '\n');
        fs.writeFileSync(path.join(scriptDir, 'audit_g3_result.txt'), text + '\n', 'utf-8');
        console.log('✅ 合并报表已写入 audit_g3_result.txt');
        return;
    }
    let lastCode = 0;
    for (const b of batches) lastCode = (await runBatch(b)) || lastCode;
    if (restoreOnly || args.restore !== 'false') { console.log('\n♻️ 恢复原始通过规则配置...'); await runBatch('RESTORE'); }
    else console.log('\n⏸️ --restore false：规则保持最后一个批次的配置');

    if (restoreOnly) { const c = configs.find(x => x.batch === 'RESTORE'); console.log(c && c.ok ? '✅ 已恢复' : '❌ 恢复失败'); return; }
    const text = report();
    console.log('\n' + text + '\n');
    const f = path.join(scriptDir, 'audit_g3_result.txt');
    fs.writeFileSync(f, text + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}${lastCode ? `（有批次 k6 退出码 ${lastCode}）` : ''}`);
})();
