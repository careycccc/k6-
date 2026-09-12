/**
 * 邀请转盘 多天留存造数 —— Node 包装器（负责写 txt）
 *
 * k6 沙箱无法写文件，故由本脚本 spawn k6：
 *   - 实时透传 k6 进度；
 *   - 从 stderr 提取 `##ALL##<账号>`（当天所有相关账号）、`##PART##<账号>`（参与过转盘的）；
 *   - k6 退出码为 0 时，写入 retention/all_dayNN.txt 与 retention/participants_dayNN.txt
 *     （读旧 + 本次去重合并，追加式）。
 *   - DAY>=2 由 k6 用 open() 读上一天 retention/all_day(NN-1).txt。
 *
 * 用法（在本目录内运行）：
 *   node inviteWheelRunner.js --day 1 --agents 3 --subs 3 --rounds 2 --tenant 3004
 *   node inviteWheelRunner.js --day 2 --tenant 3004     # 读 all_day01.txt
 *   node inviteWheelRunner.js --day 4 --tenant 3004
 * 
 *
 * 参数：
 *   --day     第几天 1~3（默认 1）
 *   --tenant  租户ID（默认 3004）
 *   --agents  D1 总代数（默认 3）
 *   --subs    每轮每总代邀请下级数（默认 3）
 *   --rounds  轮数（默认 2）
 *   --vus     D2/D3 并发 VU 数（默认 5）
 *   --country 手机号区号（可选）
 */

const { spawn } = require('child_process');
const fs = require('fs');
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

const DAY = parseInt(args.day || process.env.DAY || '1', 10);
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const agents = args.agents || '3';
const subs = args.subs || '3';
const rounds = args.rounds || '2';
const vus = args.vus || '5';
const country = args.country || process.env.COUNTRY_CODE || '';

const SCRIPT = 'inviteWheelRetention.day.js';
const scriptDir = __dirname;
const retentionDir = path.join(scriptDir, 'retention');
const dayStr = String(DAY).padStart(2, '0');
const allFile = path.join(retentionDir, `all_day${dayStr}.txt`);
const partFile = path.join(retentionDir, `participants_day${dayStr}.txt`);

// DAY>=2：校验上一天 all 文件存在
if (DAY >= 2) {
    const prev = path.join(retentionDir, `all_day${String(DAY - 1).padStart(2, '0')}.txt`);
    if (!fs.existsSync(prev)) {
        console.error(`\n❌ 上一天文件不存在：${prev}\n   请先成功跑完 DAY=${DAY - 1}。`);
        process.exit(1);
    }
}
if (!fs.existsSync(retentionDir)) fs.mkdirSync(retentionDir, { recursive: true });

// -------- 组装 k6 -e 参数 --------
const envs = { DAY: String(DAY), TENANT_ID: tenant, SUBS: subs, ROUNDS: rounds, VUS: vus, VIA_RUNNER: '1' };
if (DAY === 1) envs.AGENTS = agents;
if (country) envs.COUNTRY_CODE = country;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 邀请转盘留存造数  DAY=${DAY}  租户=${tenant}${DAY === 1 ? `  总代=${agents} 下级/轮=${subs} 轮=${rounds}` : `  并发VU=${vus}`}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const allAccts = [];
const partAccts = [];
let buf = '';

function handleLine(line) {
    // 账号无空格无引号，用 [^\s"]+ 避免吞掉 k6 日志 msg="..." 的闭合引号
    const am = line.match(/##ALL##([^\s"]+)/);
    if (am) { allAccts.push(am[1].trim()); return; }
    const pm = line.match(/##PART##([^\s"]+)/);
    if (pm) { partAccts.push(pm[1].trim()); return; }
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

child.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
child.stdout.on('data', (d) => { process.stdout.write(d); scan(d); });

child.on('error', (err) => {
    console.error(`\n❌ 无法启动 k6：${err.message}（请确认 k6 已在 PATH 中）`);
    process.exit(1);
});

child.on('close', (code) => {
    if (buf) handleLine(buf);

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；已提取 all=${new Set(allAccts).size}、part=${new Set(partAccts).size}，但不写盘（避免污染）。`);
        process.exit(code);
    }

    const allWritten = writeMerged(allFile, allAccts);
    const partWritten = writeMerged(partFile, partAccts);

    console.log(`\n✅ DAY=${DAY} 完成`);
    console.log(`   ${allFile}   → 累计 ${allWritten} 个账号（本次新增去重 ${new Set(allAccts).size}）`);
    console.log(`   ${partFile} → 累计 ${partWritten} 个参与账号（本次新增去重 ${new Set(partAccts).size}）`);
    if (DAY < 3) console.log(`\n   下一天： node inviteWheelRunner.js --day ${DAY + 1} --tenant ${tenant}`);
});

/** 读旧 + 本次去重合并写回；返回累计条数 */
function writeMerged(file, accts) {
    let existing = [];
    if (fs.existsSync(file)) {
        try { existing = fs.readFileSync(file, 'utf-8').split(/\r?\n/).map(s => s.trim()).filter(Boolean); } catch (e) { /* 读失败当空 */ }
    }
    const merged = Array.from(new Set(existing.concat(accts.map(s => s.trim()).filter(Boolean))));
    fs.writeFileSync(file, merged.join('\n') + (merged.length ? '\n' : ''), 'utf-8');
    return merged.length;
}
