/**
 * FB广告分析 Tab3「充值分析」核对 - Node 包装器（跑 verifyRecharge.js，汇总打印报表）
 *
 * k6 脚本从"广告归因记录表"出发，逐用户查后端登录/订单自算期望值，再和被测报表
 * /api/RptFbAd/GetRechargePageList 逐行 + 合计行比对。后端取数在 k6 里一次跑完，这里只
 * 解析 ##GROUP##/##NEWPAY##/##FIRST##/##FIRSTRATE##/##DAYARPPU##/##REF##/##D0##/##CUM##/
 * ##CUMBASE##/##SUM## 标记行并汇总打印成表格。报表风格照抄 verifyRetentionRunner.js(Tab2)。
 *
 * 指标(字段+人群+窗口详见 verifyRecharge.js 头部注释)：
 *   新增付费(NEWPAY)     —— 当天注册的人，当天的充值行为，人数/金额/率/ARPPU 都判定
 *   首充(FIRST)           —— 首充日=当天的人，判定人数
 *   首充率(FIRSTRATE)     —— 分母=UnpaidBeforeCount+当天注册数，判定(2026-11-05 k6-go交叉验证过)
 *   当日ARPPU(DAYARPPU)   —— 该campaign组合全部历史归因会员里当天有充值的人，判定(同上验证过)
 *   首充ARPPU             —— 公式未独立验证过，只展示不判定(REF)
 *   D0复充档位(D0)        —— 首充日当天订单数，阈值[2,3,4,5,10]
 *   累计复充档位(CUM)     —— 该campaign组合全部历史首充会员，窗口=首充日~reportDate
 *
 * 判定状态：MATCH / MISMATCH / NO_BACKEND(归因表有人，报表没这行) / NO_LOCAL(整行，报表有人，归因表没人)
 *
 * 用法（在本目录内运行）：
 *   node verifyRechargeRunner.js --tenant 3004
 *   node verifyRechargeRunner.js --tenant 3004 --only-bad
 *   node verifyRechargeRunner.js --tenant 3004 --start-date 2026-11-03 --end-date 2026-11-03
 * 退出码：有任何 MISMATCH/NO_BACKEND/NO_LOCAL 时为 1。
 */

const { spawn } = require('child_process');
const { parseArgs } = require('../../../libs/node/args.js');
const { extractTaggedLine } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const tenant = args.tenant || '3004';
const onlyBad = args['only-bad'] === true || args['only-bad'] === 'true' || args['only-bad'] === '1';
const startDate = args['start-date'] && args['start-date'] !== 'true' ? args['start-date'] : '';
const endDate = args['end-date'] && args['end-date'] !== 'true' ? args['end-date'] : '';

const RECHARGE_REPEAT_TIER_MARKS = [2, 3, 4, 5, 10]; // 照抄 fbAdConfig.js，Node端不能直接 import ESM

const scriptDir = __dirname;
const SCRIPT = 'verifyRecharge.js';

const eArgs = ['-e', `TENANT_ID=${tenant}`];
if (startDate) eArgs.push('-e', `START_DATE=${startDate}`);
if (endDate) eArgs.push('-e', `END_DATE=${endDate}`);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 FB广告充值分析核对(新增付费+首充+D0复充+累计复充)  租户=${tenant}${startDate ? `  区间=${startDate}~${endDate || '今天'}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const infos = [];
const groups = new Map();
const sums = [];
let missing = { rows: 0, reg: 0, first: 0 };
let buf = '';

function ensureGroup(key) {
    if (!groups.has(key)) groups.set(key, { newpay: {}, d0: [], cum: [], ref: {} });
    return groups.get(key);
}

const num = s => (s === '' || s === undefined ? null : parseFloat(s));

function handleLine(line) {
    let text = extractTaggedLine(line, 'R');
    if (text !== null) { infos.push(text); return; }

    text = extractTaggedLine(line, 'GROUP');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 13) {
            const key = p.slice(0, 4).join('|');
            const [campaignName, adsetName, adName, localReg, localFirst, hasBackend, backendReg, backendFirst, hasLocal, channelInfo] = p.slice(4);
            Object.assign(ensureGroup(key), {
                reportDate: p[0], campaignName, adsetName, adName,
                localReg: parseInt(localReg, 10), localFirst: parseInt(localFirst, 10),
                hasBackend: hasBackend === '1', hasLocal: hasLocal === '1',
                backendReg: num(backendReg), backendFirst: num(backendFirst),
                channelInfo: channelInfo || ''
            });
        }
        return;
    }

    text = extractTaggedLine(line, 'NEWPAY');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 5) {
            const key = p.slice(0, 4).join('|');
            const [metric, expVal, bVal, status] = p.slice(4);
            ensureGroup(key).newpay[metric] = { exp: num(expVal), b: num(bVal), status };
        }
        return;
    }

    text = extractTaggedLine(line, 'FIRST');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 7) {
            const key = p.slice(0, 4).join('|');
            const [local, b, status] = p.slice(4);
            ensureGroup(key).firstJudge = { local: parseInt(local, 10), b: num(b), status };
        }
        return;
    }

    text = extractTaggedLine(line, 'REF');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 6) {
            const key = p.slice(0, 4).join('|');
            const [metric, bVal] = p.slice(4);
            ensureGroup(key).ref[metric] = num(bVal);
        }
        return;
    }

    for (const kind of ['FIRSTRATE', 'DAYARPPU']) {
        text = extractTaggedLine(line, kind);
        if (text !== null) {
            const p = text.split('|');
            if (p.length >= 7) {
                const key = p.slice(0, 4).join('|');
                const [exp, b, status] = p.slice(4);
                ensureGroup(key)[kind === 'FIRSTRATE' ? 'firstRate' : 'dayArppu'] = { exp: num(exp), b: num(b), status };
            }
            return;
        }
    }

    for (const kind of ['D0', 'CUM']) {
        text = extractTaggedLine(line, kind);
        if (text !== null) {
            const p = text.split('|');
            if (p.length >= 10) {
                const key = p.slice(0, 4).join('|');
                const [n, expCount, expRate, bCount, bRate, status] = p.slice(4);
                ensureGroup(key)[kind === 'D0' ? 'd0' : 'cum'].push({
                    n: parseInt(n, 10), expCount: num(expCount), expRate: num(expRate),
                    bCount: num(bCount), bRate: num(bRate), status
                });
            }
            return;
        }
    }

    text = extractTaggedLine(line, 'CUMBASE');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 7) {
            const key = p.slice(0, 4).join('|');
            const [base, bBase, status] = p.slice(4);
            ensureGroup(key).cumBase = { local: parseInt(base, 10), b: num(bBase), status };
        }
        return;
    }

    text = extractTaggedLine(line, 'SUM');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 7) {
            if (p[0] === 'MISSING') {
                missing = { rows: parseInt(p[1], 10), reg: num(p[2]) || 0, first: num(p[4]) || 0 };
            } else {
                sums.push({ kind: p[0], n: parseInt(p[1], 10), expCount: num(p[2]), expRate: num(p[3]), bCount: num(p[4]), bRate: num(p[5]), status: p[6] });
            }
        }
    }
}

function scan(chunk) {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
    }
}

function passthrough(d) {
    d.toString().split('\n').forEach(l => {
        if (/level=(error|warning)|##R##/.test(l) && !/unknown field|Error from API server/.test(l)) process.stderr.write(l + '\n');
    });
}

child.stderr.on('data', (d) => { passthrough(d); scan(d); });
child.stdout.on('data', (d) => { passthrough(d); scan(d); });

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

const BAD = new Set(['MISMATCH', 'NO_BACKEND']);
const fmt = (c, r) => (c === null || c === undefined ? '--' : (r === null || r === undefined ? String(c) : `${c}(${r.toFixed(2)}%)`));
const fmtNum = v => (v === null || v === undefined ? '--' : String(v));

const REASON = {
    MISMATCH: '期望值(按归因表+登录/订单自算)和后端报表给出的数字对不上，是真实的数据/口径差异',
    NO_BACKEND: '归因表里有这组符合条件的人/行为，但被测报表里找不到这一行或这个指标，像是报表漏算了',
    NO_LOCAL: '被测报表里有这一行数据，但归因表里找不到对应的人，像是报表统计了归因表之外的数据',
    ROW_MISMATCH: '这一行的注册人数或首充人数本身就和期望对不上，后面所有基于这两个数的指标都不可信，要先查这个'
};

const pad = (s, w) => { s = String(s); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); };
const padC = (s, w) => { s = String(s); const t = Math.max(0, w - s.length); const l = Math.floor(t / 2); return ' '.repeat(l) + s + ' '.repeat(t - l); };

child.on('close', (code) => {
    if (buf) handleLine(buf);

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}，不打印报表。`);
        process.exit(code);
    }

    const stat = { MATCH: 0, MISMATCH: 0, NO_BACKEND: 0, NO_LOCAL: 0, ROW_MISMATCH: 0 };
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const issues = [];

    console.log(`\n${'═'.repeat(100)}`);
    console.log(`  📊 FB广告充值分析核对(新增付费 + 首充 + D0复充 + 累计复充) | 租户=${tenant}`);
    console.log(`${'═'.repeat(100)}`);
    infos.forEach(s => console.log(`  ℹ️  ${s}`));
    console.log(`  数据源：期望值从后端「广告归因记录表」出发，逐用户查充值订单自算；被测=GetRechargePageList`);

    // ---- 1) 分组概览表 ----
    const rows = [];
    sortedGroups.forEach(([key, g], idx) => {
        const no = `G${idx + 1}`;
        const rowIssues = [];
        if (!g.hasBackend && g.hasLocal) {
            rowIssues.push({ field: '整行(注册/首充数)', status: 'NO_BACKEND', exp: `${g.localReg}/${g.localFirst}`, act: '(无此行)' });
            stat.NO_BACKEND++;
        }
        if (g.hasBackend && !g.hasLocal && ((g.backendReg || 0) > 0 || (g.backendFirst || 0) > 0)) {
            rowIssues.push({ field: '整行(注册/首充数)', status: 'NO_LOCAL', exp: '(归因表无此人)', act: `${g.backendReg}/${g.backendFirst}` });
            stat.NO_LOCAL++;
        }
        if (g.hasBackend && g.hasLocal && (g.backendReg !== g.localReg || g.backendFirst !== g.localFirst)) {
            rowIssues.push({ field: '注册数/首充数', status: 'ROW_MISMATCH', exp: `${g.localReg}/${g.localFirst}`, act: `${g.backendReg}/${g.backendFirst}` });
            stat.ROW_MISMATCH++;
        }
        rowIssues.forEach(ri => issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind: '基础人数', ...ri }));

        // newpay 四个指标
        Object.keys(g.newpay).forEach(metric => {
            const m = g.newpay[metric];
            if (m.status !== 'MATCH') {
                stat[m.status] = (stat[m.status] || 0) + 1;
                issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind: '新增付费', field: metric, status: m.status, exp: fmtNum(m.exp), act: fmtNum(m.b) });
            } else stat.MATCH++;
        });
        // 首充人数
        if (g.firstJudge) {
            if (g.firstJudge.status !== 'MATCH') {
                stat[g.firstJudge.status] = (stat[g.firstJudge.status] || 0) + 1;
                issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind: '首充', field: '首充人数', status: g.firstJudge.status, exp: fmtNum(g.firstJudge.local), act: fmtNum(g.firstJudge.b) });
            } else stat.MATCH++;
        }
        // cumBase
        if (g.cumBase) {
            if (g.cumBase.status !== 'MATCH') {
                stat[g.cumBase.status] = (stat[g.cumBase.status] || 0) + 1;
                issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind: '累计复充', field: '历史首充会员基数(cumRecharge1)', status: g.cumBase.status, exp: fmtNum(g.cumBase.local), act: fmtNum(g.cumBase.b) });
            } else stat.MATCH++;
        }
        // 首充率 + 当日ARPPU(2026-11-05新判定)
        [['首充率', 'firstRate'], ['当日ARPPU', 'dayArppu']].forEach(([label, field]) => {
            const m = g[field];
            if (!m) return;
            if (m.status !== 'MATCH') {
                stat[m.status] = (stat[m.status] || 0) + 1;
                issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind: label, field: label, status: m.status, exp: fmtNum(m.exp), act: fmtNum(m.b) });
            } else stat.MATCH++;
        });
        [['D0复充', g.d0], ['累计复充', g.cum]].forEach(([kind, list]) => {
            list.forEach(r => {
                if (r.status !== 'MATCH') {
                    stat[r.status] = (stat[r.status] || 0) + 1;
                    if (r.status !== 'NO_BACKEND' || r.expCount !== null) {
                        issues.push({ no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind, field: `N${r.n}`, status: r.status, exp: fmt(r.expCount, r.expRate), act: fmt(r.bCount, r.bRate) });
                    }
                } else stat.MATCH++;
            });
        });

        const hasBad = rowIssues.length > 0
            || Object.values(g.newpay).some(m => m.status !== 'MATCH')
            || (g.firstJudge && g.firstJudge.status !== 'MATCH')
            || (g.cumBase && g.cumBase.status !== 'MATCH')
            || (g.firstRate && g.firstRate.status !== 'MATCH')
            || (g.dayArppu && g.dayArppu.status !== 'MATCH')
            || g.d0.some(r => r.status !== 'MATCH') || g.cum.some(r => r.status !== 'MATCH');
        rows.push({ no, g, hasBad });
    });

    const shownRows = onlyBad ? rows.filter(r => r.hasBad) : rows;
    const W_NO = 4, W_DATE = 10, W_CAMP = 16, W_SET = 15, W_AD = 15, W_CNT = 14;
    if (shownRows.length === 0 && onlyBad) {
        console.log('\n  (--only-bad：所有分组逐行核对都一致，没有需要单独列出的行)');
    } else {
        const lineW = W_NO + W_DATE + W_CAMP + W_SET + W_AD + W_CNT * 2 + 6 + 10;
        console.log(`\n  ${'─'.repeat(lineW)}`);
        console.log(`  ${pad('编号', W_NO)} ${pad('日期', W_DATE)} ${pad('广告系列', W_CAMP)} ${pad('广告组', W_SET)} ${pad('广告', W_AD)} ${pad('注册期望/后端', W_CNT)} ${pad('首充期望/后端', W_CNT)} 本行`);
        console.log(`  ${'─'.repeat(lineW)}`);
        shownRows.forEach(({ no, g, hasBad }) => {
            const reg = `${g.localReg}/${g.hasBackend ? g.backendReg : '无'}`;
            const first = `${g.localFirst}/${g.hasBackend ? g.backendFirst : '无'}`;
            console.log(`  ${pad(no, W_NO)} ${pad(g.reportDate, W_DATE)} ${pad(g.campaignName, W_CAMP)} ${pad(g.adsetName, W_SET)} ${pad(g.adName, W_AD)} ${pad(reg, W_CNT)} ${pad(first, W_CNT)} ${hasBad ? 'NG' : 'OK'}`);
        });
    }

    // ---- 2) 新增付费表(人数/金额/率/ARPPU 四项判定) ----
    if (shownRows.length > 0) {
        console.log(`\n  新增付费(分母=注册数，当天注册的人当天就充值)：COUNT=人数 AMOUNT=金额 RATE=新增付费率 ARPPU`);
        console.log(`  ${pad('编号', W_NO)} ${padC('COUNT', 8)} ${padC('AMOUNT', 10)} ${padC('RATE', 8)} ${padC('ARPPU', 8)}`);
        shownRows.forEach(({ no, g }) => {
            const cell = metric => { const m = g.newpay[metric]; return m ? padC(m.status === 'MATCH' ? 'OK' : 'NG', metric === 'AMOUNT' ? 10 : 8) : padC('--', metric === 'AMOUNT' ? 10 : 8); };
            console.log(`  ${pad(no, W_NO)} ${cell('COUNT')} ${cell('AMOUNT')} ${cell('RATE')} ${cell('ARPPU')}`);
        });
    }

    // ---- 3) D0复充矩阵 + 累计复充矩阵(含历史首充基数列) ----
    const matrix = (title, pickList) => {
        console.log(`\n  ${title}（OK=一致 NG=不一致 --=这组没有首充数据，不适用）`);
        console.log(`  ${pad('编号', W_NO)} ${RECHARGE_REPEAT_TIER_MARKS.map(n => padC(`N${n}`, 6)).join(' ')}`);
        shownRows.forEach(({ no, g }) => {
            const list = pickList(g);
            const cells = RECHARGE_REPEAT_TIER_MARKS.map(n => {
                const r = list.find(x => x.n === n);
                return padC(r ? (r.status === 'MATCH' ? 'OK' : 'NG') : '--', 6);
            });
            console.log(`  ${pad(no, W_NO)} ${cells.join(' ')}`);
        });
    };
    if (shownRows.length > 0) {
        matrix('D0复充矩阵(分母=首充数，首充当天订单数)', g => g.d0);
        console.log(`\n  累计复充基数(该广告组合全部历史首充会员数，=cumRecharge1Count)：`);
        shownRows.forEach(({ no, g }) => {
            const cb = g.cumBase;
            console.log(`  ${pad(no, W_NO)} 期望=${fmtNum(cb && cb.local)}  后端=${fmtNum(cb && cb.b)}  ${cb ? (cb.status === 'MATCH' ? 'OK' : 'NG') : '--'}`);
        });
        matrix('累计复充矩阵(分母=历史首充会员基数，首充日~本行reportDate累计订单数)', g => g.cum);
    }

    // ---- 4) 首充率 + 当日ARPPU(判定) ----
    if (shownRows.length > 0) {
        console.log(`\n  首充率 + 当日ARPPU（2026-11-05 用k6-go独立交叉验证过公式，判定一致性）：`);
        console.log(`  ${pad('编号', W_NO)} ${pad('首充率期望/后端', 18)} ${pad('状态', 6)}  ${pad('当日ARPPU期望/后端', 20)} ${pad('状态', 6)}`);
        shownRows.forEach(({ no, g }) => {
            const fr = g.firstRate, da = g.dayArppu;
            const frCell = fr ? `${fmtNum(fr.exp)}/${fmtNum(fr.b)}` : '--';
            const daCell = da ? `${fmtNum(da.exp)}/${fmtNum(da.b)}` : '--';
            console.log(`  ${pad(no, W_NO)} ${pad(frCell, 18)} ${pad(fr ? (fr.status === 'MATCH' ? 'OK' : 'NG') : '--', 6)}  ${pad(daCell, 20)} ${pad(da ? (da.status === 'MATCH' ? 'OK' : 'NG') : '--', 6)}`);
        });
    }

    // ---- 5) 仅供参考，不判定 ----
    if (shownRows.length > 0) {
        console.log(`\n  仅供参考(首充ARPPU公式没独立验证过，不判定一致性，只看一眼)：`);
        console.log(`  ${pad('编号', W_NO)} ${pad('首充ARPPU', 12)}`);
        shownRows.forEach(({ no, g }) => {
            console.log(`  ${pad(no, W_NO)} ${pad(fmtNum(g.ref.firstRechargeArppu), 12)}`);
        });
    }

    // ---- 5) 合计行(sumTotal) ----
    console.log(`\n  ${'─'.repeat(98)}`);
    console.log('  合计行(sumTotal)：');
    console.log(`  ${pad('指标', 18)} ${pad('期望', 16)} ${pad('后端', 16)} 状态`);
    let sumBad = 0;
    const labelOf = s => {
        if (s.kind === 'REG') return '注册数合计';
        if (s.kind === 'FIRST') return '首充数合计';
        if (s.kind === 'NEWPAY_COUNT') return '新增付费人数合计';
        if (s.kind === 'NEWPAY_AMOUNT') return '新增付费金额合计';
        if (s.kind === 'NEWPAY_ARPPU') return '新增付费ARPPU合计';
        if (s.kind === 'D0') return `D0复充 N${s.n}`;
        if (s.kind === 'CUM') return `累计复充 N${s.n}`;
        return s.kind;
    };
    sums.forEach(s => {
        const label = labelOf(s);
        let status = s.status;
        let note = '';
        if (status === 'MISMATCH' && (s.kind === 'REG' || s.kind === 'FIRST')) {
            const diff = (s.expCount || 0) - (s.bCount || 0);
            const missed = s.kind === 'REG' ? missing.reg : missing.first;
            if (diff === missed && missed > 0) { status = 'MISMATCH(已由后端缺行解释)'; note = `差额${diff}=后端缺失的${missing.rows}行里的人数`; }
        }
        const bad = status === 'MISMATCH';
        const explained = status.startsWith('MISMATCH(');
        if (bad) { sumBad++; issues.push({ no: '合计行', date: '', group: '', kind: '合计', field: label, status: s.status, exp: fmt(s.expCount, s.expRate), act: fmt(s.bCount, s.bRate) }); }
        if (onlyBad && !bad && !explained) return;
        console.log(`  ${pad(label, 18)} ${pad(fmt(s.expCount, s.expRate), 16)} ${pad(fmt(s.bCount, s.bRate), 16)} ${bad ? 'NG' : explained ? '差额已知' : 'OK'} ${note}`);
    });
    console.log('  (新增付费/D0/累计复充合计率的分母=各自口径下有基数的行之和，和 Tab2 留存合计口径一致思路)');

    // ---- 6) 异常明细 ----
    const bad = stat.MISMATCH + stat.NO_BACKEND + stat.NO_LOCAL + stat.ROW_MISMATCH + sumBad;
    console.log(`\n  ${'─'.repeat(98)}`);
    if (issues.length === 0) {
        console.log('  异常明细：（无，全部一致）');
    } else {
        console.log(`  异常明细(共${issues.length}处，逐条列出字段+原因)：`);
        issues.forEach((it, i) => {
            const where = it.no === '合计行' ? '合计行' : `${it.date} ${it.group}(${it.no})`;
            console.log(`   ${i + 1}. [${where}] ${it.kind}/${it.field}：期望=${it.exp}  后端=${it.act}  状态=${it.status}`);
            console.log(`      原因：${REASON[it.status] || '未知状态，需要人工看一下'}`);
        });
    }

    // ---- 7) 总结 ----
    console.log(`\n${'═'.repeat(100)}`);
    if (bad === 0) {
        console.log(`  ✅ 验证总结：全部通过。共核对 ${sortedGroups.length} 个广告分组，新增付费+首充+D0复充+累计复充共 ${stat.MATCH} 项指标 + 合计行，期望值与后端报表完全一致，没有发现异常。`);
    } else {
        console.log(`  ❌ 验证总结：发现 ${issues.length} 处不一致，涉及 ${new Set(issues.map(i => i.status)).size} 种异常类型（${Array.from(new Set(issues.map(i => i.status))).join('、')}），详见上面"异常明细"逐条的字段和原因。`);
        console.log(`     分类计数：MISMATCH(数值对不上)=${stat.MISMATCH}  NO_BACKEND(后端缺行/缺指标)=${stat.NO_BACKEND}  NO_LOCAL(后端多出的行)=${stat.NO_LOCAL}  ROW_MISMATCH(基础人数不一致)=${stat.ROW_MISMATCH}  合计行异常=${sumBad}`);
    }
    console.log(`${'═'.repeat(100)}\n`);

    if (bad > 0) process.exitCode = 1;
});
