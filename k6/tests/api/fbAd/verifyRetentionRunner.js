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
 * 退出码：有 MISMATCH/NO_BACKEND/NO_LOCAL/UNREACHED_HAS_VALUE 时为 1。
 */

const { spawn } = require('child_process');
const { parseArgs } = require('../../../libs/node/args.js');
const { extractTaggedLine } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const tenant = args.tenant || '3004';
const onlyBad = args['only-bad'] === true || args['only-bad'] === 'true' || args['only-bad'] === '1';

const scriptDir = __dirname;
const SCRIPT = 'verifyRetention.day.js';

const eArgs = ['-e', `TENANT_ID=${tenant}`];
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 FB广告留存分析核对(登录留存+复充留存)  租户=${tenant}`);
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
const fmt = (c, r) => (c === null ? '  --' : `${String(c).padStart(4)}(${r === null ? '--' : r.toFixed(2)}%)`);

child.on('close', (code) => {
    if (buf) handleLine(buf);

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}，不打印报表。`);
        process.exit(code);
    }

    const stat = { MATCH: 0, MISMATCH: 0, NO_BACKEND: 0, UNREACHED_HAS_VALUE: 0, NO_LOCAL: 0, ROW_MISMATCH: 0 };
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    console.log(`\n${'═'.repeat(92)}`);
    console.log(`  📊 FB广告留存分析核对(登录留存 + 复充留存) | 租户=${tenant}`);
    console.log(`${'═'.repeat(92)}`);
    infos.forEach(s => console.log(`  ℹ️  ${s}`));
    console.log(`  数据源：期望值从后端「广告归因记录表」出发，逐用户查登录日志/充值订单自算；被测=GetRetentionPageList`);

    sortedGroups.forEach(([key, g]) => {
        const items = [...g.login, ...g.recharge];
        const rowIssues = [];
        if (!g.hasBackend && g.hasLocal) {
            const range = (infos.find(s => s.startsWith('报表行日期范围=')) || '').replace('报表行日期范围=', '');
            rowIssues.push(`后端报表缺这一行(归因记录表里有这${g.localReg}个注册/${g.localFirst}个首充的人；报表最早行日期=${range.split('~')[0] || '?'}，本行${g.reportDate}${g.reportDate < range.split('~')[0] ? '早于它' : ''})`);
            stat.NO_BACKEND++;
        }
        if (g.hasBackend && !g.hasLocal && ((g.backendReg || 0) > 0 || (g.backendFirst || 0) > 0)) { rowIssues.push('后端有这一行但归因表里没有对应的人'); stat.NO_LOCAL++; }
        if (g.hasBackend && g.hasLocal && (g.backendReg !== g.localReg || g.backendFirst !== g.localFirst)) { rowIssues.push('注册数/首充数不一致'); stat.ROW_MISMATCH++; }

        // NO_BACKEND 已在上面按"整行缺失"计过一次，档位级的不再重复计
        items.forEach(r => { if (r.status !== 'NO_BACKEND') stat[r.status] = (stat[r.status] || 0) + 1; });
        const hasBad = rowIssues.length > 0 || items.some(r => BAD.has(r.status));
        if (onlyBad && !hasBad) return;

        console.log(`\n  ── ${g.reportDate}  ${g.campaignName} / ${g.adsetName} / ${g.adName}${g.channelInfo ? `   [渠道 ${g.channelInfo}]` : ''}`);
        console.log(`     注册数: 期望=${g.localReg} 后端=${g.hasBackend ? g.backendReg : '(无此行)'}    首充数: 期望=${g.localFirst} 后端=${g.hasBackend ? g.backendFirst : '(无此行)'}`);
        rowIssues.forEach(s => console.log(`     ❌ ${s}`));

        const show = (title, list) => {
            const shown = onlyBad ? list.filter(r => BAD.has(r.status)) : list;
            if (shown.length === 0) return;
            console.log(`     ${title}`);
            shown.forEach(r => {
                const mark = r.status === 'MATCH' ? '✅' : '❌';
                console.log(`       ${mark} N${String(r.n).padStart(3)}: 期望=${fmt(r.expCount, r.expRate)}  后端=${fmt(r.bCount, r.bRate)}  ${r.status}`);
            });
        };
        show('登录留存(分母=注册数):', g.login);
        show('复充留存(分母=首充数):', g.recharge);
        if (items.length === 0 && rowIssues.length === 0) console.log('     (还没有任何档位到期)');
    });

    // 合计行
    console.log(`\n${'─'.repeat(92)}`);
    console.log('  合计行(sumTotal)：');
    let sumBad = 0;
    sums.forEach(s => {
        const label = s.kind === 'REG' ? '注册数合计' : s.kind === 'FIRST' ? '首充数合计' : `${s.kind === 'LOGIN' ? '登录留存' : '复充留存'} N${s.n}`;
        let status = s.status;
        let note = '';
        // 注册数/首充数合计的差额若恰好等于后端缺行的人数，说明是"缺行"这一个根因造成的，已单独计过，不重复算异常
        if (status === 'MISMATCH' && (s.kind === 'REG' || s.kind === 'FIRST')) {
            const diff = (s.expCount || 0) - (s.bCount || 0);
            const missed = s.kind === 'REG' ? missing.reg : missing.first;
            if (diff === missed && missed > 0) { status = 'MISMATCH(已由后端缺行解释)'; note = `  差额${diff}=后端缺失的${missing.rows}行里的人数`; }
        }
        const bad = (status === 'MISMATCH' || status === 'UNREACHED_HAS_VALUE');
        const explained = status.startsWith('MISMATCH(');
        if (bad) sumBad++;
        if (onlyBad && !bad && !explained) return;
        console.log(`    ${bad ? '❌' : explained ? '⚠️ ' : '✅'} ${label.padEnd(12)} 期望=${fmt(s.expCount, s.expRate)}  后端=${fmt(s.bCount, s.bRate)}  ${status}${note}`);
    });
    console.log('    (留存合计率口径：分母=仅已到期且后端有行的基准人数之和，已用数据实证；缺行不计入合计)');

    const bad = stat.MISMATCH + stat.NO_BACKEND + stat.UNREACHED_HAS_VALUE + stat.NO_LOCAL + stat.ROW_MISMATCH + sumBad;
    console.log(`\n${'─'.repeat(92)}`);
    console.log(`  汇总(逐行档位): ✅ MATCH=${stat.MATCH}  ❌ MISMATCH=${stat.MISMATCH}  ⚠️ 未到期却有值=${stat.UNREACHED_HAS_VALUE}  后端缺行=${stat.NO_BACKEND}  后端多行=${stat.NO_LOCAL}  注册/首充数不一致=${stat.ROW_MISMATCH}  合计行异常=${sumBad}`);
    console.log(`${'═'.repeat(92)}\n`);

    if (bad > 0) process.exitCode = 1;
});
