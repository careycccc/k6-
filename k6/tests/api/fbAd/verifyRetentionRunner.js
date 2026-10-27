/**
 * FB广告分析 Tab2「留存分析」核对 - Node 包装器（跑 verifyRetention.day.js，汇总打印报表）
 *
 * 当前(接口ready前)实现只需跑一次 k6（数据源是本地状态文件，不需要按天分别查询）。
 * TODO(接口ready后): 切到按天查后端登录日志时，这里要改成循环多次 spawn k6（每次查
 * 一天），参照 retentionLoginRunner.js 的"预取多天、Node侧汇总"思路扩展，k6脚本本身
 * 的单天查询逻辑不用大改。
 *
 * 用法（在本目录内运行）：
 *   node verifyRetentionRunner.js --tenant 3004
 *   node verifyRetentionRunner.js --tenant 3004 --group-by campaign
 */

const { spawn } = require('child_process');
const { parseArgs } = require('../../../libs/node/args.js');
const { extractTaggedLine } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const tenant = args.tenant || '3004';
const groupBy = args['group-by'] || 'all';

const scriptDir = __dirname;
const SCRIPT = 'verifyRetention.day.js';

const envs = { TENANT_ID: tenant, GROUP_BY: groupBy };
const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 FB广告留存分析核对  租户=${tenant}  分组=${groupBy}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const infos = [];
// groups: [{ label, total, rows: [{n, eligible, retained, ratePct}] }]
const groups = [];
let buf = '';

// ⚠️ 必须先用 extractTaggedLine 还原 k6 logfmt 包装(msg="..."内部转义+贪婪匹配
// 会连带吞掉尾部" source=xxx")，再在还原后的纯文本上做格式解析——不能直接对原始
// 行用 /##R##\s*(.+)/ 这类贪婪正则，否则结果里会混入日志尾部噪音。
function handleLine(line) {
    let text = extractTaggedLine(line, 'R');
    if (text !== null) { infos.push(text); return; }

    text = extractTaggedLine(line, 'GROUP');
    if (text !== null) {
        const m = text.match(/^([^|]*)\|(\d+)$/);
        if (m) groups.push({ label: m[1], total: parseInt(m[2], 10), rows: [] });
        return;
    }

    text = extractTaggedLine(line, 'N');
    if (text !== null) {
        const m = text.match(/^([^|]*)\|(\d+)\|(\d+)\|(\d+)\|([\d.]+)$/);
        if (m) {
            const label = m[1];
            const group = groups.find(g => g.label === label) || (groups.push({ label, total: 0, rows: [] }), groups[groups.length - 1]);
            group.rows.push({ n: parseInt(m[2], 10), eligible: parseInt(m[3], 10), retained: parseInt(m[4], 10), ratePct: parseFloat(m[5]) });
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

child.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
child.stdout.on('data', (d) => { process.stdout.write(d); scan(d); });

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf);

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}，不打印报表。`);
        process.exit(code);
    }

    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  📊 FB广告留存分析核对 | 租户=${tenant} | 分组=${groupBy}`);
    console.log(`${'═'.repeat(75)}`);
    infos.forEach(s => console.log(`  ℹ️  ${s}`));
    console.log(`  ⚠️  当前数据源=本地造数状态自检(loginRetentionDone)，不是后端权威数据——接口ready后切换`);

    if (groups.length === 0) {
        console.log('\n  (没有任何分组到期可统计留存，等账号注册久一点再跑)');
    }

    groups.forEach(g => {
        console.log(`\n  ── ${g.label} (共${g.total}人) ──────────────────────────────`);
        if (g.rows.length === 0) {
            console.log('     (还没有任何留存天数到期)');
            return;
        }
        g.rows.forEach(r => {
            console.log(`     N${String(r.n).padStart(2)}留存: ${String(r.retained).padStart(4)}/${String(r.eligible).padStart(4)}  留存率=${r.ratePct.toFixed(2)}%`);
        });
    });

    console.log(`\n${'═'.repeat(75)}\n`);
});
