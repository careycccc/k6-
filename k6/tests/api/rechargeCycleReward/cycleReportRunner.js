/**
 * 充值循环奖励 —— 活动报表验证（Node 包装器：收集 marker + 美化打印对比结果 + 存 JSON 快照）
 *
 * 为什么需要它：k6 的 console.log 会被 msg="…" 转义、不便换行美化，也写不了本地文件。故由本脚本 spawn k6：
 *   - 实时透传 k6 进度日志；
 *   - 从 stderr 拦截 `##CRPT## <base64>`（每个奖励日期：后台查出的期望值 + 接口值 + 逐字段对比）
 *     与 `##CRPT_META## <base64>`（范围 / 总计对比 / 查询失败 / 错误）；
 *   - k6 结束后按奖励日期倒序打印每个字段「接口 / 后台查出 / ✅❌」，对不上的列出涉及的会员，
 *     并把结果写入 reports/cycleReportVerify_*.json。
 *
 * 用法（在本目录内运行）：
 *   node cycleReportRunner.js --tenant 3004                          # 默认验昨天（PRD 默认查询前一日）
 *   node cycleReportRunner.js --start 2026-10-05 --end 2026-10-08    # 奖励日期范围（超过昨天的截到昨天）
 *   node cycleReportRunner.js --days 8                               # 昨天往前共 8 个奖励日期
 *   node cycleRunner.js --day 2 --tenant 3004
 *
 * 参数：
 *   --start / --end  奖励日期范围 YYYY-MM-DD（end 默认=start）
 *   --days           >0 时取「昨天-(days-1) ~ 昨天」，覆盖 start/end
 *   --tenant         租户ID（默认 3004）
 *   --max            单次翻页保护上限（默认 200 页）
 *   --since          报表功能上线日（默认 2026-10-08），之前的历史数据不验
 *   --no-save        不写 JSON 快照
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../libs/node/args.js');

const args = parseArgs(process.argv);

const start = args.start || process.env.START_DATE || '';
const end = args.end || process.env.END_DATE || start;
const days = args.days || process.env.DAYS || '';
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const maxScan = args.max || process.env.MAX_SCAN || '';
const since = args.since || process.env.SINCE || '';
const noSave = args['no-save'] !== undefined;

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
if ((start && !dateRe.test(start)) || (end && !dateRe.test(end))) {
    console.error('❌ 日期格式应为 YYYY-MM-DD：node cycleReportRunner.js --start 2026-10-01 --end 2026-10-07 [--tenant 3004]');
    process.exit(1);
}

const SCRIPT = 'cycleRewardReport.js';
const scriptDir = __dirname;
const reportDir = path.join(scriptDir, 'reports');

const envs = { TENANT_ID: tenant, VIA_RUNNER: '1' };
if (days) envs.DAYS = String(days);
else if (start) { envs.START_DATE = start; envs.END_DATE = end; }
if (maxScan) envs.MAX_SCAN = maxScan;
if (since) envs.SINCE = since;
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

const rangeDesc = days ? `昨天往前 ${days} 个奖励日期` : (start ? `${start}~${end}` : '昨天（默认）');
console.log(`\n🚀 充值循环奖励 · 活动报表验证  奖励日期=${rangeDesc}  租户=${tenant}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})`);
console.log(`   （活动记录表的会员逐个查后台：充值订单 / 登录日志 / 领取状态 → 与报表接口逐字段对比）\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const rows = [];
let meta = null;
const ROW_RE = /##CRPT## ([A-Za-z0-9+/=]+)/;
const META_RE = /##CRPT_META## ([A-Za-z0-9+/=]+)/;
let buf = '';

function handleLine(line) {
    let m = line.match(ROW_RE);
    if (m) {
        try { rows.push(JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'))); }
        catch (e) { console.error('⚠️ CRPT 解析失败:', e.message); }
        return;
    }
    m = line.match(META_RE);
    if (m) {
        try { meta = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8')); }
        catch (e) { console.error('⚠️ CRPT_META 解析失败:', e.message); }
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

    if (meta && meta.error) {
        console.error(`\n❌ ${meta.error}`);
        process.exit(code || 1);
    }
    if (rows.length === 0) {
        console.error(`\n❌ 未收集到任何报表行（k6 退出码 ${code}）。请看上方 k6 日志排查。`);
        process.exit(code || 1);
    }

    printReport(rows, meta);
    if (!noSave) saveSnapshot(rows, meta);

    if (code !== 0) {
        console.error(`\n⚠️ k6 退出码 ${code}：以上为已收集到的结果（可能不全）。`);
        process.exit(code);
    }
    console.log(`\n✅ 完成`);
});

// ================= 美化打印 =================

// PRD 字段顺序：key → [一级字段, 二级字段, 类型]
const FIELDS = [
    ['loginCount', '当日登录', '登录人数', 'count'],
    ['loginRate', '当日登录', '登录率', 'rate'],
    ['winnerCount', '整体数据', '获奖人数', 'count'],
    ['activityRechargeAmount', '整体数据', '活动充值金额', 'money'],
    ['totalReceiveCount', '整体数据', '总领取人数', 'count'],
    ['totalBonusAmount', '整体数据', '总发放彩金', 'money'],
    ['totalReceiveRate', '整体数据', '总领取率', 'rate'],
    ['unclaimedCount', '整体数据', '充值达标未领取人数', 'count'],
    ['bonusRechargeRate', '整体数据', '彩金占充值比例', 'rate'],
    ['freeReceiveCount', '免费奖励', '领取人数', 'count'],
    ['freeReceiveRate', '免费奖励', '领取率', 'rate'],
    ['freeReceiveAmount', '免费奖励', '领取彩金', 'money'],
    ['paidReachCount', '付费奖励', '达成人数', 'count'],
    ['paidReachRate', '付费奖励', '达成率', 'rate'],
    ['paidRechargeAmount', '付费奖励', '付费金额', 'money'],
    ['paidReceiveCount', '付费奖励', '领取人数', 'count'],
    ['paidReceiveRate', '付费奖励', '领取率', 'rate'],
    ['paidReceiveAmount', '付费奖励', '领取彩金', 'money'],
    ['paidConvertRate', '付费奖励', '领取转化率', 'rate'],
    ['retention1Count', '登录留存', '次日留存人数', 'count'],
    ['retention1Rate', '登录留存', '次日留存率', 'rate'],
    ['retention3Count', '登录留存', '3日留存人数', 'count'],
    ['retention3Rate', '登录留存', '3日留存率', 'rate'],
    ['retention7Count', '登录留存', '7日留存人数', 'count'],
    ['retention7Rate', '登录留存', '7日留存率', 'rate']
];
const FIELD_MAP = {};
FIELDS.forEach(([k, g, n, t]) => { FIELD_MAP[k] = { group: g, name: n, type: t }; });

function fv(v, type) {
    if (v === null) return '--';
    if (v === undefined) return '(无)';
    if (type === 'money') return Number(v).toFixed(2);
    if (type === 'rate') return `${Number(v).toFixed(2)}%`;
    return String(v);
}
function ids(list, max = 30) { return `${list.slice(0, max).join(', ')}${list.length > max ? ', …' : ''}`; }
function padEndW(s, w) {
    s = String(s);
    // 中文按 2 宽度对齐
    const width = [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    return width >= w ? s : s + ' '.repeat(w - width);
}

/** 对不上的字段：补充涉及会员 / 明细 / 参考值 */
function mismatchHints(r, key) {
    const out = [];
    const ms = r.members || [];
    const fmtMembers = (list, f) => list.slice(0, 20).map(f).join('；') + (list.length > 20 ? `；… 共 ${list.length} 人` : '');
    const base = key.replace(/Rate$/, 'Count');
    if (r.ids && r.ids[base]) out.push(`后台查出的会员(${r.ids[base].length})：[${ids(r.ids[base])}]`);
    if (key === 'activityRechargeAmount') {
        out.push(`各会员充值日到账：${fmtMembers(ms.filter(m => m.prevRecharge > 0), m => `${m.userId}=${m.prevRecharge}`)}`);
    }
    if (key === 'paidRechargeAmount') {
        out.push(`参考：付费要求之和 ${fv(r.refs.paidRequireSum, 'money')}；达成会员当天全部充值 ${fv(r.refs.paidAmountAchieversAllDay, 'money')}；全部获奖会员当天充值 ${fv(r.refs.paidAmountAllWinners, 'money')}`);
        out.push(`达成会员（充到达标为止 / 当天全部）：${fmtMembers(ms.filter(m => m.achieved), m => `${m.userId}=${m.condAmount}/${m.dayRecharge}`) || '无'}`);
    }
    if (key === 'paidReachCount' || key === 'paidReachRate') {
        out.push(`各会员当天充值/要求：${fmtMembers(ms, m => `${m.userId} ${m.mode} ${m.dayRecharge}/${m.require}${m.achieved ? '✓' : ''}`)}`);
    }
    const rk = key.replace(/(Count|Rate)$/, '');
    const rt = r.retention && r.retention[rk];
    if (rt && rt.chain) {
        out.push(`以上是奖励日期领过奖、并在 ${rt.targetDate} 登录的会员`);
        out.push(`参考：连续留存（中间每天都领奖 + ${rt.targetDate} 登录）= ${rt.chainHit.length} 人 [${ids(rt.chainHit)}]`);
    }
    if (key === 'unclaimedCount') {
        const ul = r.unclaimedList || [];
        out.push(`其中免费没领 ${ul.filter(u => u.freeUnclaimed).length} 人，付费进度满足却没领 ${ul.filter(u => u.paidUnclaimed).length} 人（明细见下方未领取会员名单）`);
    }
    if (key === 'totalBonusAmount' || key === 'freeReceiveAmount' || key === 'paidReceiveAmount') {
        out.push(`领取明细：${fmtMembers(ms.filter(m => m.freeClaimed || m.paidClaimed), m => `${m.userId} 免费${m.freeClaimed ? m.freeReward : '-'} 付费${m.paidClaimed ? m.paidReward : '-'}`) || '无'}`);
    }
    return out;
}

function printRow(r, summary) {
    if (!r.winners) {
        const ok = !r.api;
        console.log('');
        console.log(`── 奖励日期 ${r.rewardDate}：活动记录表无获奖会员，接口${r.api ? '却有这一行 ❌' : '也没有这一行 ✅'}`);
        if (!ok) summary.push({ date: r.rewardDate, key: '(整行)', name: '接口多出一行' });
        return;
    }
    const fails = r.compare.filter(c => !c.ok);
    console.log('');
    console.log(`┌── 奖励日期 ${r.rewardDate}（充值日 ${r.rechargeDate}）   获奖 ${r.winners} 人   ` +
        (r.api ? (fails.length ? `❌ ${fails.length} / ${r.compare.length} 项不一致` : `✅ ${r.compare.length} 项全部一致`) : '❌ 接口没有这一行'));
    console.log(`│  ${padEndW('', 4)}${padEndW('字段', 30)}${padEndW('接口', 16)}后台查出`);
    for (const c of r.compare) {
        const f = FIELD_MAP[c.key] || { group: '', name: c.key, type: 'count' };
        let note = '';
        const rk = c.key.replace(/(Count|Rate)$/, '');
        if (r.retention && r.retention[rk]) {
            const rt = r.retention[rk];
            if (rt.state === 'realtime') note = `（目标日 ${rt.targetDate} 是今天，实时数）`;
            if (rt.state === 'future') note = `（目标日 ${rt.targetDate} 未到）`;
        }
        console.log(`│  ${c.ok ? '✅' : '❌'}  ${padEndW(`${f.group}·${f.name}`, 30)}${padEndW(fv(c.api, f.type), 16)}${fv(c.exp, f.type)}${note}`);
        if (!c.ok && r.api) {
            mismatchHints(r, c.key).forEach(h => console.log(`│        ↳ ${h}`));
            summary.push({ date: r.rewardDate, key: c.key, name: `${f.group}·${f.name}` });
        }
    }
    if (!r.api) summary.push({ date: r.rewardDate, key: '(整行)', name: '接口缺这一行' });

    // 留存两个口径并排：主口径=只看第 N 天登录（和平台原有留存一致，参与对比）；连续留存（参考）
    const rtKeys = ['retention1', 'retention3', 'retention7'].filter(k => r.retention && r.retention[k] && r.retention[k].state !== 'future');
    if (rtKeys.length) {
        const mainStr = rtKeys.map(k => `${r.retention[k].name} ${(r.ids[`${k}Count`] || []).length}人`).join('  ');
        const chainStr = rtKeys.map(k => `${r.retention[k].name} ${r.retention[k].chainHit.length}人/${fv(r.retention[k].chainRate, 'rate')}`).join('  ');
        console.log(`│  留存口径  第N天登录(对比用，同平台原有留存)：${mainStr}   ｜ 连续留存(参考)：${chainStr}`);
    }

    const dg = r.diag || {};
    const warns = [];
    if (dg.dupUsers && dg.dupUsers.length) warns.push(`同一会员多条奖励记录：[${ids(dg.dupUsers)}]（已按最新一条计）`);
    if (dg.notFinal && dg.notFinal.length) warns.push(`奖励状态还没过期结算（仍是待领取/未达成）：[${ids(dg.notFinal)}]，「充值达标未领取」可能不准`);
    if (dg.prevMismatch && dg.prevMismatch.length) warns.push(`充值日订单合计 ≠ 记录上的前一天充值：${ids(dg.prevMismatch, 10)}`);
    if (dg.receivedOutOfDay && dg.receivedOutOfDay.length) warns.push(`领取时间不在奖励日期当天：[${ids(dg.receivedOutOfDay)}]`);
    if (dg.claimedNotAchieved && dg.claimedNotAchieved.length) warns.push(`已领付费奖励、但按订单没达成：[${ids(dg.claimedNotAchieved)}]`);
    if (dg.preQualifyOrders && dg.preQualifyOrders.length) warns.push(`奖励日期当天、资格生成前的充值（不计入付费）：${ids(dg.preQualifyOrders)}`);
    if (dg.progressVsOrders && dg.progressVsOrders.length) warns.push(`记录上的付费进度 与 按订单判断的达成 不一致：${ids(dg.progressVsOrders, 10)}`);
    warns.forEach((w, i) => console.log(`│  ${i === 0 ? '⚠️ 诊断 ' : '        '}${w}`));
    printUnclaimed(r.unclaimedList || []);
    console.log(`└${'─'.repeat(79)}`);
}

/** 未领取会员名单（对应页面「下载未领取会员名单」，只打印）：过期 = 当天没领 */
function printUnclaimed(list) {
    if (!list.length) {
        console.log(`│  📋 未领取会员名单：0 人（暂无可下载数据）`);
        return;
    }
    const freeN = list.filter(u => u.freeUnclaimed).length;
    const paidN = list.filter(u => u.paidUnclaimed).length;
    const bothN = list.filter(u => u.freeUnclaimed && u.paidUnclaimed).length;
    console.log(`│  📋 未领取会员名单：${list.length} 人（免费没领 ${freeN} 人，付费进度满足却没领 ${paidN} 人，其中两项都没领 ${bothN} 人）`);
    console.log(`│     ${padEndW('会员ID', 10)}${padEndW('免费奖励', 18)}${padEndW('付费奖励', 22)}付费充值进度`);
    list.slice(0, 100).forEach(u => {
        const free = u.freeUnclaimed ? `未领取 ${fv(u.freeReward, 'money')}` : '已领取';
        // 付费不在名单里 = 已领取，或进度没满足（没资格领）
        const paid = u.paidUnclaimed ? `未领取 ${fv(u.paidReward, 'money')}` : (u.progressMet ? '已领取' : '进度未满足(无资格)');
        const prog = u.progress === undefined ? '-' : `${u.mode} ${u.progress} / ${u.require}${u.progressMet ? '（已满足）' : ''}`;
        console.log(`│     ${padEndW(u.userId, 10)}${padEndW(free, 18)}${padEndW(paid, 22)}${prog}`);
    });
    if (list.length > 100) console.log(`│     …… 共 ${list.length} 人，完整名单见 JSON`);
}

function printTotals(meta, summary) {
    const t = meta && meta.totals;
    if (!t) return;
    console.log('');
    console.log(`┌── 总计（不比页面总计）   ${t.apiMissing ? '❌ 接口没有返回总计' : ''}`);
    for (const c of t.compare) {
        const f = FIELD_MAP[c.key];
        console.log(`│  ${c.ok ? '✅' : '❌'}  ${padEndW(`${f.group}·${f.name}`, 30)}${padEndW(fv(c.api, f.type), 16)}${fv(c.exp, f.type)}`);
        if (!c.ok) summary.push({ date: '总计', key: c.key, name: `${f.group}·${f.name}` });
    }
    if (t.shouldBeNull.length) {
        console.log(`│  ❌  以下字段 PRD 不汇总、总计应为空，接口却有值：${t.shouldBeNull.join(', ')}`);
        summary.push({ date: '总计', key: '(应为空)', name: t.shouldBeNull.join(',') });
    } else if (!t.apiMissing) {
        console.log(`│  ✅  其余字段（人数 / 各类率 / 留存）总计为空，符合 PRD`);
    }
    console.log(`└${'─'.repeat(79)}`);
}

function printReport(list, meta) {
    const bar = '━'.repeat(80);
    const summary = [];
    console.log('\n' + bar);
    console.log(`  📊 充值循环奖励 · 活动报表验证   租户 ${meta ? meta.tenant : tenant}`);
    if (meta) {
        console.log(`     奖励日期 ${meta.start} ~ ${meta.end}   今天 ${meta.today}   时区 UTC${meta.tzOffsetHours >= 0 ? '+' : ''}${meta.tzOffsetHours}`);
        if (meta.capped) console.log(`     （接口不返回今天，结束日期已截到昨天 ${meta.yesterday}）`);
        if (meta.clippedStart) console.log(`     （报表功能 ${meta.featureStart} 上线，之前的历史数据不验，开始日期已调到 ${meta.featureStart}）`);
    }
    console.log(bar);

    // PRD：按奖励日期倒序
    list.slice().sort((a, b) => (a.rewardDate < b.rewardDate ? 1 : -1)).forEach(r => printRow(r, summary));
    printTotals(meta, summary);

    if (meta && meta.apiExtraDates && meta.apiExtraDates.length) {
        console.log(`\n❌ 接口多返回了范围外的日期：${meta.apiExtraDates.join(', ')}`);
    }
    if (meta && meta.queryErrors && meta.queryErrors.length) {
        console.log(`\n⚠️ 有 ${meta.queryErrors.length} 次后台查询重试 3 次仍失败，相关数字可能偏小：`);
        meta.queryErrors.slice(0, 10).forEach(e => console.log(`   ${e}`));
    }

    // 结论总览：按字段归并不一致的日期
    console.log('\n' + bar);
    console.log('  ▎结论总览');
    if (!summary.length) {
        console.log('     🎉 所有奖励日期和总计全部一致');
    } else {
        const byKey = {};
        summary.forEach(s => { (byKey[s.name] = byKey[s.name] || []).push(s.date); });
        Object.keys(byKey).forEach(name => console.log(`     ❌ ${padEndW(name, 30)}${byKey[name].join('、')}`));
    }
    console.log(bar);
}

// ================= JSON 快照 =================

function tsStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveSnapshot(list, meta) {
    try {
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const snap = { generatedAt: new Date().toISOString(), meta, rows: list };
        const name = `cycleReportVerify_${meta ? `${meta.start}_${meta.end}` : 'range'}_${tsStr(new Date())}.json`;
        const file = path.join(reportDir, name);
        fs.writeFileSync(file, JSON.stringify(snap, null, 2), 'utf-8');
        fs.writeFileSync(path.join(reportDir, 'cycleReportVerify_latest.json'), JSON.stringify(snap, null, 2), 'utf-8');
        console.log(`\n💾 结果已保存：${file}（同时覆盖 reports/cycleReportVerify_latest.json）`);
    } catch (e) {
        console.error(`\n⚠️ 结果保存失败：${e.message}`);
    }
}
