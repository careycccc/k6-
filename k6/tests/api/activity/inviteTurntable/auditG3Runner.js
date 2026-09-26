/**
 * 出款自动审核「条件组三(新增)」验证 - Node 包装器
 * 逐批次跑 auditG3Verify.js（每批：改规则→等30s→并发跑用例），账号跨批不复用，最后汇总报表 + 跨天手动清单。
 *
 * 用法（在 inviteTurntable 目录运行）：
 *   node auditG3Runner.js --tenant 3004                         # 全部批次 CH,AND,OFF,ALL,OR
 *   node auditG3Runner.js --tenant 3004 --batches OR --cases OR_sub_eq,X_multi
 *   node auditG3Runner.js --tenant 3004 --restore               # 只把 3 条通过规则恢复成原始配置
 *
 * 参数：
 *   --batches  批次(逗号分隔，默认 CH,AND,OFF,ALL,OR；OR 放最后，含跨天手动造数，跑完配置保留给明天手动验证)
 *   --cases    只跑指定用例(需属于所选批次)
 *   --restore  跑完后恢复原始通过规则配置(有跨天手动用例时默认不恢复，验证完再单独 --restore)
 *   其余透传 -e：--g3-x --g3-y --ch-x --audit-wait --hist-start --scan-start
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
const restoreOnly = args.restore === 'true' && !args.batches && !args.cases;
const batches = restoreOnly ? [] : (args.batches || 'CH,AND,OFF,ALL,OR').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const scriptDir = __dirname;
const SCRIPT = 'auditG3Verify.js';
const PASS_ENV = { 'g3-x': 'G3_X', 'g3-y': 'G3_Y', 'ch-x': 'CH_X', 'audit-wait': 'AUDIT_WAIT', 'hist-start': 'HIST_START', 'scan-start': 'SCAN_START' };
const PKG_NAME = { 0: '官网official', 1: '代理agent', 2: '转盘wheel', 100051: 'carey_tiktok_022' };

const results = [], manuals = [], configs = [];
const usedIds = new Set();

function decode(line, kind) {
    const m = line.match(new RegExp(`##${kind}##([A-Za-z0-9+/=]+)##`));
    if (!m) return null;
    try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch (e) { return null; }
}
function handleLine(line) {
    const a = decode(line, 'A'); if (a) results.push(a);
    const u = decode(line, 'U'); if (u) usedIds.add(String(u.userId));
    const mm = decode(line, 'M'); if (mm) manuals.push(mm);
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

/** 实际≠预期时：打印当时应匹配的规则及条件 + 当时数据 + 实际拒绝来源 */
function ruleLines(r, p) {
    const lines = [];
    lines.push(`▶ 第${p.idx}次申请时数据：渠道=${PKG_NAME[r.pkg] || r.pkg} 成功轮次=${p.round !== undefined ? p.round : (p.idx === 1 && r.roundBefore !== undefined ? r.roundBefore : '?')} 本人新增=${p.selfNew}${p.selfCum !== undefined ? `(本人累计${p.selfCum})` : ''} 新增下级合计=${p.subNew}(${p.newSubCount}人)${p.src ? `；实际拒绝来源=${p.src}` : ''}`);
    if (p.rule) lines.push(`▶ 当时应匹配规则：${p.rule}`);
    else {
        const c = configs.filter(x => x.batch === r.batch).slice(-1)[0];
        lines.push(`▶ 当时批次[${r.batch}]规则配置：`);
        (c ? c.rules : ['(无配置记录)']).forEach(x => lines.push(`     ${x}`));
    }
    return lines;
}

function report() {
    const out = [];
    out.push('===== 出款自动审核 · 条件组三(新增) 验证报表 =====');
    out.push(`租户：${tenant}   批次：${batches.join(',') || '(仅恢复)'}   用例数：${results.length}`);
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
            out.push(`      第${p.idx}次申请 单号=${p.orderNo || '-'} 本人新增=${p.selfNew} 新增下级(${p.newSubCount}人)=${p.subNew} | 预期=${p.expect} 实际=${p.actual} → ${same} | 提现历史复核=${p.histNow || '-'}${p.src ? ` 拒绝来源=${p.src}` : ''}${p.completionTime ? ` 完成=${p.completionTime}` : ''}`);
            if (p.actual !== p.expect) ruleLines(r, p).forEach(l => out.push(`         ${l}`));
        }
        if (r.log && r.log.length) out.push(`      造数：${r.log.join('；')}`);
        if (r.dataErr && r.dataErr.length) out.push(`      ⚠️ 造数/验证无效：${r.dataErr.join('；')}`);
        if (r.warn && r.warn.length) out.push(`      ℹ️ 提示：${r.warn.join('；')}`);
        if (r.histIssues && r.histIssues.length) out.push(`      ⚠️ 提现历史不一致：${r.histIssues.join('；')}`);
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
    if (manuals.length) {
        out.push('');
        out.push('---- 📅 跨天手动验证清单（明天执行；执行前规则需保持 OR 批次配置，勿先 --restore）----');
        for (const m of manuals) {
            out.push(`• ${m.name}：总代 userId=${m.agentUserId} 账号=${m.agentAccount} 密码=${m.pwd}  上次通过=${m.lastPass}`);
            out.push(`    1) 登录下级 手机号=${m.subPhone}(userId=${m.subUserId}) 密码=${m.pwd}，充值 ${m.amount}  （${m.note}；今日实测新增下级=${m.curSubNew} 本人新增=${m.curSelfNew}）`);
            out.push(`    2) 登录总代申请转盘提现 → 等约60s 看提现记录 auditState  预期=${m.expect === 'pass' ? '通过(2)' : '拒绝(3)'}`);
        }
        out.push(`    组三阈值：本人新增≥${manuals[0].X} 或 新增下级合计≥${manuals[0].Y}（规则 300048 全部/轮次=0、300049 全部/轮次>0）`);
        out.push(`    验证完恢复配置：node auditG3Runner.js --tenant ${tenant} --restore`);
    }
    return out.join('\n');
}

(async () => {
    // --merge a.log,b.log：只合并已有运行日志出报表（同名用例取后一次结果）
    if (args.merge) {
        for (const f of args.merge.split(',')) fs.readFileSync(path.join(scriptDir, f.trim()), 'utf8').split('\n').forEach(handleLine);
        const last = {};
        results.forEach(r => { last[r.name] = r; });
        results.splice(0, results.length, ...Object.values(last));
        const lastC = {}; configs.forEach(c => { lastC[c.batch] = c; }); configs.splice(0, configs.length, ...Object.values(lastC));
        const seenM = {}; manuals.forEach(m => { seenM[m.name] = m; }); manuals.splice(0, manuals.length, ...Object.values(seenM));
        batches.splice(0, batches.length, ...[...new Set(results.map(r => r.batch))]);
        const text = report();
        console.log('\n' + text + '\n');
        fs.writeFileSync(path.join(scriptDir, 'audit_g3_result.txt'), text + '\n', 'utf-8');
        console.log('✅ 合并报表已写入 audit_g3_result.txt');
        return;
    }
    let lastCode = 0;
    for (const b of batches) lastCode = (await runBatch(b)) || lastCode;
    const wantRestore = restoreOnly || (args.restore === 'true') || (batches.length && !manuals.length && args.restore !== 'false');
    if (wantRestore) { console.log('\n♻️ 恢复原始通过规则配置...'); await runBatch('RESTORE'); }
    else if (manuals.length) console.log('\n⏸️ 有跨天手动用例，规则保持 OR 批次配置；明天验证完执行 --restore');

    if (restoreOnly) { console.log(configs.length && configs[0].ok ? '✅ 已恢复' : '❌ 恢复失败'); return; }
    const text = report();
    console.log('\n' + text + '\n');
    const f = path.join(scriptDir, 'audit_g3_result.txt');
    fs.writeFileSync(f, text + '\n', 'utf-8');
    console.log(`✅ 结果已写入 ${f}${lastCode ? `（有批次 k6 退出码 ${lastCode}）` : ''}`);
})();
