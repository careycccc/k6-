/**
 * FB广告分析 Tab2「留存分析」核对 - Node 包装器（跑 verifyRetention.day.js，汇总打印报表）
 *
 * k6 脚本从"广告归因记录表"出发，逐用户查后端登录日志/充值订单自算期望值，再和被测报表
 * /api/RptFbAd/GetRetentionPageList 逐行 + 合计行比对。后端取数在 k6 里一次跑完，这里只
 * 解析 ##GROUP##/##LOGIN##/##RECHARGE##/##SUM## 标记行并汇总打印。
 *
 * 判定状态：
 *   MATCH                期望=后端
 *   MISMATCH             期望≠后端(人数或率)
 *   NO_BACKEND           归因表里有这组人，但后端报表没有这一行
 *   NO_LOCAL(整行)       后端有这一行，归因表里却没有对应的人
 *   UNREACHED_HAS_VALUE  还没到期，后端却已经给了数值(应为 null)
 *
 * 合计行(sumTotal)：留存合计率的分母=仅"已到期且后端有行"的基准人数之和(已用数据实证，文档没写)；
 * 注册数/首充数合计的差额若恰好等于后端缺行的人数，标"已由后端缺行解释"，不重复计异常。
 *
 * 用法（在本目录内运行）：
 *   node verifyRetentionRunner.js --tenant 3004
 *   node verifyRetentionRunner.js --tenant 3004 --only-bad    # 只打印有问题的行
 *   node verifyRetentionRunner.js --tenant 3004 --start-date 2026-11-03 --end-date 2026-11-03  # 只看11-03一天
 * 退出码：有 MISMATCH/NO_BACKEND/NO_LOCAL/UNREACHED_HAS_VALUE 时为 1。
 */

const { spawn } = require('child_process');
const { parseArgs } = require('../../../libs/node/args.js');
const { extractTaggedLine } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const tenant = args.tenant || '3004';
const onlyBad = args['only-bad'] === true || args['only-bad'] === 'true' || args['only-bad'] === '1';
const startDate = args['start-date'] && args['start-date'] !== 'true' ? args['start-date'] : '';
const endDate = args['end-date'] && args['end-date'] !== 'true' ? args['end-date'] : '';

const scriptDir = __dirname;
const SCRIPT = 'verifyRetention.day.js';

const eArgs = ['-e', `TENANT_ID=${tenant}`];
if (startDate) eArgs.push('-e', `START_DATE=${startDate}`);
if (endDate) eArgs.push('-e', `END_DATE=${endDate}`);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 FB广告留存分析核对(登录留存+复充留存)  租户=${tenant}${startDate ? `  区间=${startDate}~${endDate || '今天'}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const infos = [];
const groups = new Map();
const sums = [];
let missing = { rows: 0, reg: 0, first: 0 };
let buf = '';

function ensureGroup(key) {
    if (!groups.has(key)) groups.set(key, { login: [], recharge: [] });
    return groups.get(key);
}

const num = s => (s === '' || s === undefined ? null : parseFloat(s));

// ⚠️ 必须先用 extractTaggedLine 还原 k6 logfmt 包装，再在还原后的纯文本上做格式解析
// （不能直接对原始行用贪婪正则，否则会混入日志尾部噪音）。
function handleLine(line) {
    let text = extractTaggedLine(line, 'R');
    if (text !== null) { infos.push(text); return; }

    text = extractTaggedLine(line, 'GROUP');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 13) {
            // key=date|campaignId|adsetId|adId 占前4段，其余字段紧随其后(channelInfo 为空时末尾是空串)
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

    for (const kind of ['LOGIN', 'RECHARGE']) {
        text = extractTaggedLine(line, kind);
        if (text !== null) {
            const p = text.split('|');
            if (p.length >= 10) {
                const key = p.slice(0, 4).join('|');
                const [n, expCount, expRate, bCount, bRate, status] = p.slice(4);
                ensureGroup(key)[kind === 'LOGIN' ? 'login' : 'recharge'].push({
                    n: parseInt(n, 10), expCount: num(expCount), expRate: num(expRate),
                    bCount: num(bCount), bRate: num(bRate), status
                });
            }
            return;
        }
    }

    text = extractTaggedLine(line, 'SUM');
    if (text !== null) {
        const p = text.split('|');
        if (p.length >= 7) {
            if (p[0] === 'MISSING') {
                // n=缺行数，expCount=缺行注册数之和，bCount=缺行首充数之和
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

// k6 的 console.log 全走 stderr，原样透传会被 TenantRequest 的大量请求日志刷屏；
// 这里只透传 ##R## 总览行和错误/警告，其余只用来解析
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

const BAD = new Set(['MISMATCH', 'NO_BACKEND', 'UNREACHED_HAS_VALUE']);
const fmt = (c, r) => (c === null ? '--' : `${c}(${r === null ? '--' : r.toFixed(2)}%)`);

// 档位常量照抄 fbAdConfig.js(k6/ESM，这里是纯 Node/CommonJS，不能直接 import，手动保持同步)
const LOGIN_MARKS = [2, 3, 5, 7, 15, 30, 60, 90];
const RECHARGE_MARKS = [1, 2, 3, 4, 5, 6, 7, 10, 15, 20, 25, 30, 60, 90, 120, 180];

// 每种异常状态对应的大白话原因，失败时直接告诉人"为什么"而不是只甩一个状态码
const REASON = {
    MISMATCH: '期望值(按归因表+登录日志/订单自算)和后端报表给出的人数或比率对不上，是真实的数据/口径差异',
    NO_BACKEND: '归因表里有这组符合条件的人，但被测报表里找不到这一行，像是报表漏算了这个日期/广告组合',
    NO_LOCAL: '被测报表里有这一行数据，但归因表里找不到对应的人，像是报表统计了归因表之外的数据',
    UNREACHED_HAS_VALUE: '这个档位对应的目标日期理论上还没到(到期条件"目标日<今天"不成立)，后端应返回空值，却已经给出了数值',
    ROW_MISMATCH: '这一行的注册人数或首充人数本身就和期望对不上(留存率的分母口径有问题)，要先查这个，再看留存率准不准',
    MISSING_ROW: '后端缺了这一行，含在上面"后端缺行"里，不单独算一次'
};

const pad = (s, w) => { s = String(s); return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length); };
const padL = (s, w) => { s = String(s); return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s; };
const padC = (s, w) => { s = String(s); const t = Math.max(0, w - s.length); const l = Math.floor(t / 2); return ' '.repeat(l) + s + ' '.repeat(t - l); };

child.on('close', (code) => {
    if (buf) handleLine(buf);

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}，不打印报表。`);
        process.exit(code);
    }

    const stat = { MATCH: 0, MISMATCH: 0, NO_BACKEND: 0, UNREACHED_HAS_VALUE: 0, NO_LOCAL: 0, ROW_MISMATCH: 0 };
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const issues = []; // 汇总所有不一致，最后统一打一份"异常明细"+写总结用

    console.log(`\n${'═'.repeat(100)}`);
    console.log(`  📊 FB广告留存分析核对(登录留存 + 复充留存) | 租户=${tenant}`);
    console.log(`${'═'.repeat(100)}`);
    infos.forEach(s => console.log(`  ℹ️  ${s}`));
    console.log(`  数据源：期望值从后端「广告归因记录表」出发，逐用户查登录日志/充值订单自算；被测=GetRetentionPageList`);

    // ---- 1) 分组图例表：一行一个"日期+广告组合"，编号(G1/G2..)在后面两张矩阵表里复用 ----
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

        const items = [...g.login, ...g.recharge];
        items.forEach(r => { if (r.status !== 'NO_BACKEND') stat[r.status] = (stat[r.status] || 0) + 1; });
        [['登录留存', g.login], ['复充留存', g.recharge]].forEach(([kind, list]) => {
            list.filter(r => BAD.has(r.status)).forEach(r => issues.push({
                no, date: g.reportDate, group: `${g.campaignName}/${g.adsetName}/${g.adName}`, kind,
                field: `N${r.n}`, status: r.status, exp: fmt(r.expCount, r.expRate), act: fmt(r.bCount, r.bRate)
            }));
        });

        const hasBad = rowIssues.length > 0 || items.some(r => BAD.has(r.status));
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

    // ---- 2) 登录留存矩阵：行=分组编号，列=各档位，单元格 OK/NG/--(未到期) ----
    const matrix = (title, marks, pickList) => {
        console.log(`\n  ${title}（OK=一致 NG=不一致 --=这个档位还没到期）`);
        console.log(`  ${'─'.repeat(6 + marks.length * 6)}`);
        console.log(`  ${pad('编号', 4)} ${marks.map(n => padC(`N${n}`, 5)).join(' ')}`);
        shownRows.forEach(({ no, g }) => {
            const list = pickList(g);
            const cells = marks.map(n => {
                const r = list.find(x => x.n === n);
                return padC(r ? (r.status === 'MATCH' ? 'OK' : 'NG') : '--', 5);
            });
            console.log(`  ${pad(no, 4)} ${cells.join(' ')}`);
        });
    };
    if (shownRows.length > 0) {
        matrix('登录留存矩阵(分母=注册数)', LOGIN_MARKS, g => g.login);
        matrix('复充留存矩阵(分母=首充数)', RECHARGE_MARKS, g => g.recharge);
    }

    // ---- 3) 合计行(sumTotal) ----
    console.log(`\n  ${'─'.repeat(98)}`);
    console.log('  合计行(sumTotal)：');
    console.log(`  ${pad('指标', 14)} ${pad('期望', 16)} ${pad('后端', 16)} ${pad('状态', 6)} 备注`);
    let sumBad = 0;
    sums.forEach(s => {
        const label = s.kind === 'REG' ? '注册数合计' : s.kind === 'FIRST' ? '首充数合计' : `${s.kind === 'LOGIN' ? '登录留存' : '复充留存'} N${s.n}`;
        let status = s.status;
        let note = '';
        // 注册数/首充数合计的差额若恰好等于后端缺行的人数，说明是"缺行"这一个根因造成的，已单独计过，不重复算异常
        if (status === 'MISMATCH' && (s.kind === 'REG' || s.kind === 'FIRST')) {
            const diff = (s.expCount || 0) - (s.bCount || 0);
            const missed = s.kind === 'REG' ? missing.reg : missing.first;
            if (diff === missed && missed > 0) { status = 'MISMATCH(已由后端缺行解释)'; note = `差额${diff}=后端缺失的${missing.rows}行里的人数`; }
        }
        const bad = (status === 'MISMATCH' || status === 'UNREACHED_HAS_VALUE');
        const explained = status.startsWith('MISMATCH(');
        if (bad) { sumBad++; issues.push({ no: '合计行', date: '', group: '', kind: '合计', field: label, status: s.status, exp: fmt(s.expCount, s.expRate), act: fmt(s.bCount, s.bRate) }); }
        if (onlyBad && !bad && !explained) return;
        console.log(`  ${pad(label, 14)} ${pad(fmt(s.expCount, s.expRate), 16)} ${pad(fmt(s.bCount, s.bRate), 16)} ${pad(bad ? 'NG' : explained ? '差额已知' : 'OK', 6)} ${note}`);
    });
    console.log('  (留存合计率口径：分母=仅已到期且后端有行的基准人数之和，已用数据实证；缺行不计入合计)');

    // ---- 4) 异常明细：不管上面是不是 --only-bad，这里永远把所有不一致摊开列清楚 ----
    const bad = stat.MISMATCH + stat.NO_BACKEND + stat.UNREACHED_HAS_VALUE + stat.NO_LOCAL + stat.ROW_MISMATCH + sumBad;
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

    // ---- 5) 总结：不管通不通过都打印 ----
    console.log(`\n${'═'.repeat(100)}`);
    if (bad === 0) {
        console.log(`  ✅ 验证总结：全部通过。共核对 ${sortedGroups.length} 个广告分组、登录留存+复充留存共 ${stat.MATCH} 个已到期档位 + 合计行，期望值与后端报表完全一致，没有发现异常。`);
    } else {
        console.log(`  ❌ 验证总结：发现 ${issues.length} 处不一致，涉及 ${new Set(issues.map(i => i.status)).size} 种异常类型（${Array.from(new Set(issues.map(i => i.status))).join('、')}），详见上面"异常明细"逐条的字段和原因。`);
        console.log(`     分类计数：MISMATCH(数值对不上)=${stat.MISMATCH}  NO_BACKEND(后端缺行)=${stat.NO_BACKEND}  NO_LOCAL(后端多出的行)=${stat.NO_LOCAL}  UNREACHED_HAS_VALUE(未到期却有值)=${stat.UNREACHED_HAS_VALUE}  ROW_MISMATCH(基础人数不一致)=${stat.ROW_MISMATCH}  合计行异常=${sumBad}`);
    }
    console.log(`${'═'.repeat(100)}\n`);

    if (bad > 0) process.exitCode = 1;
});
