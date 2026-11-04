/**
 * 「有效邀请达标条件 + 生效游戏」验证的 Node 包装器 —— 负责落报告
 *
 * k6 沙箱不能写文件，所以由本脚本 spawn k6，实时透传输出，同时抓三类标记：
 *   ##CONFIG##  每次读到/改到的配置快照
 *   ##CASE##    一条用例结果（含 userId、期望、实际）
 *   ##SUMMARY## 汇总
 * 跑完写两个文件到 reports/：
 *   - .md    给人看的复盘报告（配置变更轨迹 + 用例明细 + 不一致清单）
 *   - .ndjson 原始记录，方便多轮汇总或二次分析
 *
 * 用法（在本目录内运行）：
 *   node runner.js --tenant 3004 --agents 169800
 *   node runner.js --tenant 3004 --agents 169800 --script baseline.js
 *
 * 参数：
 *   --tenant   租户ID（默认 3004）
 *   --agents   上级 userId，逗号分隔（baseline 必填）
 *   --script   要跑的 k6 脚本（默认 baseline.js）
 *   --indirect 连间推(L2/L3)一起核对（默认只核对直推 L1）
 *   --tag      报告文件名后缀，便于区分批次
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../../libs/node/args.js');
const { extractTaggedRecord } = require('../../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const agents = args.agents && args.agents !== 'true' ? args.agents : '';
const script = args.script && args.script !== 'true' ? args.script : 'baseline.js';
const flag = name => args[name] === 'true' || args[name] === '1';
const tag = args.tag && args.tag !== 'true' ? args.tag : '';

const scriptDir = __dirname;
const reportDir = path.join(scriptDir, 'reports');

const envs = { TENANT_ID: tenant, VIA_RUNNER: '1' };
if (agents) envs.AGENT_IDS = agents;
if (flag('indirect')) envs.INCLUDE_INDIRECT = '1';
// scenarios.js 用：--cases 选场景，--dry-run 只预览，--wait-config/--wait-check 调等待
const passthrough = { cases: 'CASES', 'wait-config': 'WAIT_CONFIG', 'wait-check': 'WAIT_CHECK', 'settle-max': 'SETTLE_MAX' };
for (const [arg, env] of Object.entries(passthrough)) {
    if (args[arg] && args[arg] !== 'true') envs[env] = args[arg];
}
if (flag('dry-run')) envs.DRY_RUN = '1';

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, script];

console.log(`\n🚀 有效邀请验证  租户=${tenant}  脚本=${script}${agents ? `  上级=${agents}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

// ---------------- 租户锁 ----------------
// 同一租户的配置是全局的，两轮改配置的验证并发跑会互相覆盖配置，而且后启动的那轮会把前一轮的
// 测试中间态当成"原始配置"拍快照，结束时"还原"成错的值。2026-11-04 就踩过：用 pgrep 排队等
// 上一轮结束，但 Git Bash 里没有 pgrep，等待条件直接为假，两轮并发，整轮结论作废。
// 锁里同时记 runner 和 k6 的 pid —— 外层进程被停掉时 k6 子进程可能还活着(实测会)，只看 runner 拦不住。
const mutating = script !== 'baseline.js' && !flag('dry-run');
const lockPath = path.join(reportDir, `.lock_${tenant}.json`);

function pidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function writeLock(k6Pid) {
    fs.writeFileSync(lockPath, JSON.stringify({
        tenant, runnerPid: process.pid, k6Pid: k6Pid || null, script,
        cases: envs.CASES || '', startedAt: new Date().toISOString()
    }));
}
function releaseLock() {
    if (!mutating) return;
    try {
        const l = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        if (l.runnerPid === process.pid) fs.unlinkSync(lockPath);
    } catch (e) { /* 锁不存在或不是自己的，不动 */ }
}

if (mutating) {
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    if (fs.existsSync(lockPath)) {
        let l = null;
        try { l = JSON.parse(fs.readFileSync(lockPath, 'utf-8')); } catch (e) { /* 坏锁当残留处理 */ }
        if (l && (pidAlive(l.runnerPid) || pidAlive(l.k6Pid))) {
            console.error(`\n❌ 租户 ${tenant} 已有一轮验证在跑，拒绝并发启动：`);
            console.error(`   runner pid=${l.runnerPid}${pidAlive(l.runnerPid) ? '(存活)' : '(已退出)'}  k6 pid=${l.k6Pid}${pidAlive(l.k6Pid) ? '(存活)' : '(已退出)'}`);
            console.error(`   脚本=${l.script} 场景=${l.cases} 开始于 ${l.startedAt}`);
            console.error(`   同一租户的配置是全局的，并发会互相覆盖配置、拍到错误的"原始配置"快照。`);
            console.error(`   请等它结束；若确认进程已不存在，删除 ${lockPath} 后重试。`);
            process.exit(2);
        }
        console.warn(`⚠️ 发现残留锁（对应进程都已不存在），覆盖：${lockPath}`);
    }
    writeLock(null);
}

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });
if (mutating) writeLock(child.pid);

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        // 先杀 k6 再退出，避免留下继续改配置的孤儿 k6
        try { child.kill(); } catch (e) { /* 已退出 */ }
        releaseLock();
        process.exit(130);
    });
}

const configs = [];
const cases = [];
const summaries = [];
const drifts = [];
let buf = '';

function handleLine(line) {
    const c = extractTaggedRecord(line, 'CONFIG');
    if (c) { configs.push(c); return; }
    const r = extractTaggedRecord(line, 'CASE');
    if (r) { cases.push(r); return; }
    const dr = extractTaggedRecord(line, 'DRIFT');
    if (dr) { drifts.push(dr); return; }
    const s = extractTaggedRecord(line, 'SUMMARY');
    if (s) { summaries.push(s); }
}

function scan(chunk) {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
    }
}

child.stdout.on('data', d => { process.stdout.write(d); scan(d); });
child.stderr.on('data', d => { process.stderr.write(d); scan(d); });

child.on('error', err => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    releaseLock();
    process.exit(1);
});

// ---------------- 报告渲染 ----------------

const yn = v => (v === true ? '是' : v === false ? '否' : String(v == null ? '' : v));
const md = v => String(v == null ? '' : v).replace(/\|/g, '\\|');

function renderConfigSection() {
    if (configs.length === 0) return '_本次没有读到配置_\n';
    const head = '| # | 时间 | 达标条件 | 充值门槛 | 投注门槛 | 生效游戏 | 每日上限 | 总上限 | 同设备不计 |\n'
        + '|---|---|---|---|---|---|---|---|---|\n';
    const rows = configs.map((c, i) =>
        `| ${i + 1} | ${md(c.readAt)} | ${c.mode === '1' ? '同时满足' : c.mode === '2' ? '满足任一' : c.mode}`
        + ` | ${md(c.rechargeThreshold)} | ${md(c.betThreshold)} | ${md(c.limitGamesText)}`
        + ` | ${md(c.dayLimit)} | ${md(c.totalLimit)} | ${yn(c.sameDeviceInvalid)} |`).join('\n');
    const raw = configs.map((c, i) => `${i + 1}. \`${md(c.limitGameRaw)}\``).join('\n');
    return head + rows + '\n\n生效游戏原始值（配置回滚时按这个还原）：\n\n' + raw + '\n';
}

function renderCaseSection() {
    if (cases.length === 0) return '_本次没有用例结果_\n';
    const byCase = {};
    for (const r of cases) (byCase[r.caseId] = byCase[r.caseId] || []).push(r);

    let out = '';
    for (const caseId of Object.keys(byCase).sort()) {
        const rows = byCase[caseId];
        const bad = rows.filter(r => !r.match).length;
        out += `### 用例 ${md(caseId)} ${md(rows[0].caseName || '')} —— ${rows.length} 人，不一致 ${bad}\n\n`;
        out += '| userId | 层级 | 注册时间 | 累计充值 | 范围内有效投注(全部) | 范围内有效投注(注册当日) | 注单 | 未结算 | 期望 | 实际 | 结果 | 判定依据 |\n';
        out += '|---|---|---|---|---|---|---|---|---|---|---|---|\n';
        for (const r of rows) {
            out += `| ${md(r.userId)} | ${md(r.hierarchy)} | ${md((r.registerTime || '').replace('T', ' ').slice(0, 19))}`
                + ` | ${md(r.totalRecharge)} | ${md(r.validBetAll)} | ${md(r.validBetDay)}`
                + ` | ${md(r.orderCount)} | ${md(r.unsettled)} | ${yn(r.expected)} | ${yn(r.actual)}`
                + ` | ${r.match ? '✅ 一致' : '❌ 不一致'} | ${md(r.reason)} |\n`;
        }
        out += '\n';
    }
    return out;
}

function renderMismatchSection() {
    const bad = cases.filter(r => !r.match);
    if (bad.length === 0) return '本次没有不一致项。\n';
    let out = `共 ${bad.length} 条不一致，逐条如下：\n\n`;
    for (const r of bad) {
        out += `- **userId ${md(r.userId)}**（用例 ${md(r.caseId)}，上级 ${md(r.agentId)}，${md(r.hierarchy)}）\n`;
        out += `  - 期望 \`${yn(r.expected)}\`，后台实际 \`${yn(r.actual)}\`\n`;
        out += `  - 累计充值 ${md(r.totalRecharge)}，范围内有效投注 全部历史=${md(r.validBetAll)} / 注册当日=${md(r.validBetDay)}\n`;
        out += `  - 判定依据：${md(r.reason)}\n`;
        out += `  - 口径分析：${md(r.caliber)}\n`;
        if (r.unsettled > 0) out += `  - ⚠️ 还有 ${r.unsettled} 单未结算，有效投注可能尚未计入，需结算后复查\n`;
        out += '\n';
    }
    return out;
}

child.on('close', code => {
    releaseLock();
    if (buf) handleLine(buf);

    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const base = `invite-condition_${tenant}_${stamp}${tag ? '_' + tag : ''}`;
    const mdPath = path.join(reportDir, base + '.md');
    const ndPath = path.join(reportDir, base + '.ndjson');

    const total = cases.length;
    const matched = cases.filter(r => r.match).length;
    const mismatched = total - matched;

    const doc = `# 有效邀请达标条件 + 生效游戏 —— 验证报告

- 租户：**${tenant}**
- 脚本：\`${script}\`${agents ? `　上级 userId：\`${agents}\`` : ''}
- 生成时间：${new Date().toISOString()}
- k6 退出码：${code}
- 结果：核对 **${total}** 人，一致 **${matched}**，不一致 **${mismatched}**
${drifts.length ? `\n> ## ⚠️ 本轮结论不可信\n>\n> 检测到配置在运行期间被**外部改动** ${drifts.length} 次，脚本设定的配置和核对时读到的不一致。\n> 受影响阶段：${[...new Set(drifts.map(d => d.caseId))].join('、')}。\n> 这种情况下期望值是按"被改后的配置"算的，即使显示一致也没有验证到设计意图，**需要重跑**。\n>\n${drifts.map(d => `> - 阶段 ${d.caseId}（${d.at}）：${(d.diffs || []).join('；')}`).join('\n')}\n` : ''}

## 一、配置快照

下表是本次运行期间读到/写入的每一次配置。涉及多次配置变更时按先后顺序排列，复盘时对照用例的执行时间定位当时生效的是哪一组配置。

${renderConfigSection()}

## 二、用例执行明细

每行一个被核对的下级，记录它在当时配置下的充值、范围内有效投注、期望结果和后台实际结果。

${renderCaseSection()}

## 三、不一致清单

${renderMismatchSection()}

## 四、说明

- **范围内有效投注**：只统计「生效游戏」配置范围内的注单，取注单的 \`validAmount\`（有效投注，ARLottery 为投注额扣 2% 税后的值）。
- **有效投注要结算后才有值**：未结算注单 \`orderState=0\`、\`validAmount=0\`。「未结算」列不为 0 时，该行结论不可靠，要等结算后复查。
- **两种口径**：投注统计区间同时按「全部历史」和「注册当日」算。两者结论不同时，"判定依据"旁的口径分析会指出哪种能解释后台结果。
- **期望值算法**：纯按需求公式 —— 同时满足 = 充值达标 且 投注达标；满足任一 = 二者其一。刻意不加「充值投注都为 0 就不算」这类额外过滤，以便暴露后端在门槛为 0 等边界下的真实行为。
`;

    fs.writeFileSync(mdPath, doc, 'utf-8');
    fs.writeFileSync(ndPath,
        [...configs.map(c => JSON.stringify({ kind: 'config', ...c })),
        ...cases.map(c => JSON.stringify({ kind: 'case', ...c })),
        ...drifts.map(d => JSON.stringify({ kind: 'drift', ...d })),
        ...summaries.map(s => JSON.stringify({ kind: 'summary', ...s }))].join('\n') + '\n', 'utf-8');

    if (drifts.length) console.error(`\n⚠️  配置在运行期间被外部改动 ${drifts.length} 次，本轮结论不可信，需要重跑。`);

    console.log(`\n📄 报告已生成：`);
    console.log(`   ${mdPath}`);
    console.log(`   ${ndPath}`);
    console.log(`   核对 ${total} 人，一致 ${matched}，不一致 ${mismatched}`);
    process.exit(code === 0 && mismatched === 0 && drifts.length === 0 ? 0 : 1);
});
