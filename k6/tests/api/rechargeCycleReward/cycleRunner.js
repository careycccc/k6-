/**
 * 充值循环奖励活动 —— Node 包装器（负责 txt 落盘）
 *
 * 为什么需要它：k6 沙箱无法写本地文件，且 VU 收集的数据传不到能写文件的 handleSummary。
 * 因此由本 Node 脚本 spawn k6：
 *   - 实时透传 k6 输出（能看到造数进度）；
 *   - 从 k6 的 stderr 中提取 `##ACCT##<账号>` 行（k6 的 console.log 全部走 stderr）；
 *   - k6 退出码为 0 时，把去重后的账号写入 dayNN.txt（与 k6 open() 读取的目录一致）。
 *
 * 用法（在本目录内运行）：
 *   node cycleRunner.js --day 1 --count 15 --levels 2 --root 7VA3VCN --tenant 3004
 *   node cycleRunner.js --day 2                 # 读 day01.txt → 产出 day02.txt
 *   node cycleRunner.js --day 3
 *   node cycleRunner.js --day 4
 *
 * 参数：
 *   --day     第几天 1~4（默认 1）
 *   --tenant  租户ID（默认 3004）
 *   --count   第一天注册人数（仅 DAY=1 用，默认 15）
 *   --levels  森林层级（默认 4）
 *   --root    森林根邀请码（默认 W5LU89N）
 *   --paid    每档冲 paid 比例（可选，默认脚本内 0.3）
 *   --gap     用户间隔秒（可选，默认脚本内 2）
 *   --country 手机号区号（可选）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// -------- 解析 --key value 形式参数 --------
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

const DAY = parseInt(args.day || process.env.DAY || '1', 10);
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const count = args.count || process.env.USER_COUNT || '15';
const levels = args.levels || process.env.LEVELS || '4';
const root = args.root || process.env.ROOT_INVITE_CODE || 'W5LU89N';
const paidRatio = args.paid || process.env.PAID_RATIO || '';
const userGap = args.gap || process.env.USER_GAP || '';
const country = args.country || process.env.COUNTRY_CODE || '';
const overwrite = args.overwrite !== undefined || process.env.OVERWRITE === '1'; // 默认追加，加 --overwrite 则覆盖

const SCRIPT = 'cycleRewardSeed.day.js';
const scriptDir = __dirname; // k6 cwd 与 txt 读写目录，保证 open() 与写盘一致
const outFile = path.join(scriptDir, `day${String(DAY).padStart(2, '0')}.txt`);

// -------- 组装 k6 -e 参数 --------
const envs = { DAY: String(DAY), TENANT_ID: tenant, LEVELS: levels, ROOT_INVITE_CODE: root, VIA_RUNNER: '1' };
if (DAY === 1) envs.USER_COUNT = count;
if (paidRatio) envs.PAID_RATIO = paidRatio;
if (userGap) envs.USER_GAP = userGap;
if (country) envs.COUNTRY_CODE = country;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 充值循环奖励造数  DAY=${DAY}  租户=${tenant}${DAY === 1 ? `  人数=${count}  层级=${levels}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})`);
if (DAY >= 2) {
    const prev = path.join(scriptDir, `day${String(DAY - 1).padStart(2, '0')}.txt`);
    if (!fs.existsSync(prev)) {
        console.error(`\n❌ 上一天文件不存在：${prev}\n   请先成功跑完 DAY=${DAY - 1}。`);
        process.exit(1);
    }
}
console.log('');

// -------- spawn k6，实时透传 + 提取账号 --------
const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const accounts = [];
const report = {};    // ##RPT##key=value 汇总项
const tierRows = [];  // ##RPT##tier_<id>=free,paid 档位命中
let buf = '';

function handleLine(line) {
    // 账号：用 [^\s"]+（非空白且非引号），避免把 k6 日志 msg="..." 的闭合引号一起吞进来
    const am = line.match(/##ACCT##([^\s"]+)/);
    if (am) { accounts.push(am[1].trim()); return; }
    const rm = line.match(/##RPT##(\w+)=([^\s"]+)/);
    if (rm) {
        if (rm[1].indexOf('tier_') === 0) tierRows.push({ id: rm[1].slice(5), val: rm[2] });
        else report[rm[1]] = rm[2];
    }
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

// k6 的 console.log 走 stderr；stdout 一并扫描做双保险
child.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
child.stdout.on('data', (d) => { process.stdout.write(d); scan(d); });

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf); // flush 末行（可能无换行）
    const uniq = Array.from(new Set(accounts));

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；已提取账号 ${uniq.length} 个，但不写入 ${path.basename(outFile)}（避免污染）。`);
        process.exit(code);
    }

    // 默认追加：读已有 txt 账号 + 本次新增 → 去重后写回（加 --overwrite 才覆盖）
    let existing = [];
    if (!overwrite && fs.existsSync(outFile)) {
        try {
            existing = fs.readFileSync(outFile, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        } catch (e) { /* 读失败当空 */ }
    }
    const merged = Array.from(new Set(existing.concat(uniq)));
    fs.writeFileSync(outFile, merged.join('\n') + (merged.length ? '\n' : ''), 'utf-8');
    printReport();
    console.log(`\n✅ ${outFile}：已有 ${existing.length} + 本次 ${uniq.length} → 去重累计 ${merged.length} 个账号（${overwrite ? '覆盖' : '追加'}）`);
});

// -------- 报表美化打印（Node 端：换行正常、无 k6 前缀） --------
function printReport() {
    const dline = '═'.repeat(54);
    const sline = '─'.repeat(54);
    const day = report.day || String(DAY);
    const isDay1 = Number(day) === 1;
    const L = [];
    L.push('');
    L.push(dline);
    L.push(`  📊 充值循环奖励造数据报表    DAY=${day}    租户=${report.tenant || tenant}`);
    L.push(dline);
    if (isDay1) {
        L.push(`  计划注册人数   : ${report.planned || 0}`);
        L.push(`  注册成功       : ${report.regSuccess || 0}      注册失败 : ${report.regFail || 0}`);
    } else {
        L.push(`  上一天账号数   : ${report.prevTotal || 0}`);
        L.push(`  参与充值       : ${report.participants || 0}      跳过(20%) : ${report.skipped || 0}`);
        L.push(`  登录失败       : ${report.loginFail || 0}      取信息失败 : ${report.infoFail || 0}`);
    }
    L.push(sline);
    L.push(`  充值成功人数   : ${report.rechargeUsers || 0}      充值失败 : ${report.rechargeFailUsers || 0}`);
    L.push(`  其中冲 paid    : ${report.paidUsers || 0}      只冲 free : ${report.freeUsers || 0}`);
    L.push(`  总充值金额     : ${report.totalAmount || '0.00'}`);
    L.push(sline);
    L.push('  各档位命中 (free / paid):');
    tierRows.sort((a, b) => Number(a.id) - Number(b.id)).forEach((t) => {
        const parts = String(t.val).split(',');
        L.push(`    档位 id=${String(t.id).padEnd(4)} free=${String(parts[0]).padEnd(4)} paid=${parts[1]}`);
    });
    L.push(dline);
    console.log(L.join('\n'));
}
