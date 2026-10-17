/**
 * 充值循环奖励活动 —— Node 包装器（负责 txt / 操作明细落盘 + 美化报表 + 自动算活动报表）
 *
 * 为什么需要它：k6 沙箱无法写本地文件，且 VU 收集的数据传不到能写文件的 handleSummary。
 * 因此由本 Node 脚本 spawn k6：
 *   - 实时透传 k6 输出（能看到造数进度）；
 *   - 从 k6 的 stderr 中提取 `##ACCT##<账号>`（当天操作过的账号）、`##RPT##k=v`（汇总）、`##ACT## <base64>`（每人操作明细）；
 *   - k6 退出码为 0 时，把去重后的账号写入 dayNN.txt（仅作记录：每天的人群来自当天奖励记录表，不再读 txt）；
 *   - 操作明细存 reports/seed_<站点日期>_D<day>_<时间>.json（k6 中途失败也会保存已收集的部分）；
 *   - 造数成功后自动跑 cycleReportRunner.js 计算活动报表。
 *
 * 用法（在本目录内运行）：
 *   node cycleRunner.js --day 1 --count 20 --levels 2 --root 7KRJ3WN --tenant 3004
 *   node cycleRunner.js --day 2 --tenant 3004        # 第 2 天起：今天的奖励记录全部人 + 随机补 3~5 个新注册
 *
 * 参数：
 *   --day        第几天（默认 1）。DAY=1 按 --count 补新注册；DAY≥2 每天随机补 --supMin~--supMax 人
 *   --tenant     租户ID（默认 3004）
 *   --count      第一天总人数 N（仅 DAY=1 用，默认 15）：N > 列表有效人数 M → 补 N−M 人；否则只用列表
 *   --levels     新注册森林层级（默认 4）
 *   --root       森林根邀请码（默认 W5LU89N）
 *   --noLogin    完全不登录比例（默认 0.10）
 *   --loginOnly  登录不充值比例（默认 0.05）
 *   --free       领免费比例（默认 0.85）
 *   --paid       冲付费比例（默认 0.75）
 *   --paidClaim  冲付费的人里领付费的比例（默认 0.60）
 *   --supMin / --supMax  DAY≥2 每天补充新注册人数范围（默认 3~5）
 *   --gap        用户间隔秒（可选，默认脚本内 2）
 *   --country    手机号区号（可选）
 *   --overwrite  覆盖 dayNN.txt（默认追加）
 *   --skip-time-guard  跳过站点 00:10~23:30 启动时间保护（仅调试）
 *   --dry-run    演练：只读查询 + 打印分组/领取/充值计划，不登录、不领取、不充值、不注册，不写 txt、不算报表
 *   --no-report  造数成功后不自动验证活动报表（默认会跑 cycleReportRunner.js --days 8：
 *                昨天往前 8 个奖励日期，按会员查后台数据与报表接口对比，覆盖次日/3日/7日留存的回填）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../libs/node/args.js');

// -------- 解析 --key value 形式参数 --------
const args = parseArgs(process.argv);

const DAY = parseInt(args.day || process.env.DAY || '1', 10);
const tenant = args.tenant || process.env.TENANT_ID || '3004';
const count = args.count || process.env.USER_COUNT || '15';
const levels = args.levels || process.env.LEVELS || '4';
const root = args.root || process.env.ROOT_INVITE_CODE || 'W5LU89N';
const userGap = args.gap || process.env.USER_GAP || '';
const country = args.country || process.env.COUNTRY_CODE || '';
const overwrite = args.overwrite !== undefined || process.env.OVERWRITE === '1'; // 默认追加，加 --overwrite 则覆盖
const noReport = args['no-report'] !== undefined;
const skipTimeGuard = args['skip-time-guard'] !== undefined;
const dryRun = args['dry-run'] !== undefined;
const REPORT_DAYS = '8'; // 昨天往前 8 天：最早一天的 7日留存目标日(D+6)已过完

// 可选比例 / 人数参数 → k6 环境变量
const OPTIONAL_ENVS = {
    noLogin: 'NO_LOGIN_RATIO', loginOnly: 'LOGIN_ONLY_RATIO', free: 'FREE_CLAIM_RATIO',
    paid: 'PAID_RATIO', paidClaim: 'PAID_CLAIM_RATIO', supMin: 'SUP_MIN', supMax: 'SUP_MAX'
};

const SCRIPT = 'cycleRewardSeed.day.js';
const scriptDir = __dirname;
const outFile = path.join(scriptDir, `day${String(DAY).padStart(2, '0')}.txt`);
const reportDir = path.join(scriptDir, 'reports');

// -------- 组装 k6 -e 参数 --------
const envs = { DAY: String(DAY), TENANT_ID: tenant, LEVELS: levels, ROOT_INVITE_CODE: root, VIA_RUNNER: '1' };
if (DAY === 1) envs.USER_COUNT = count;
if (userGap) envs.USER_GAP = userGap;
if (country) envs.COUNTRY_CODE = country;
if (skipTimeGuard) envs.SKIP_TIME_GUARD = '1';
if (dryRun) envs.DRY_RUN = '1';
Object.entries(OPTIONAL_ENVS).forEach(([arg, env]) => {
    const v = args[arg] || process.env[env];
    if (v) envs[env] = v;
});

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 充值循环奖励造数${dryRun ? '（🧪 演练）' : ''}  DAY=${DAY}  租户=${tenant}${DAY === 1 ? `  总人数N=${count}  层级=${levels}` : ''}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})`);
console.log('');

// -------- spawn k6，实时透传 + 提取标记行 --------
const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const accounts = [];
const actions = [];   // ##ACT## 每人操作明细
const report = {};    // ##RPT##key=value 汇总项
const tierRows = [];  // ##RPT##tier_<id>=不冲付费,冲付费  明天档位
let buf = '';

function handleLine(line) {
    // 账号：用 [^\s"]+（非空白且非引号），避免把 k6 日志 msg="..." 的闭合引号一起吞进来
    const am = line.match(/##ACCT##([^\s"]+)/);
    if (am) { accounts.push(am[1].trim()); return; }
    const xm = line.match(/##ACT## ([A-Za-z0-9+/=]+)/);
    if (xm) {
        try { actions.push(JSON.parse(Buffer.from(xm[1], 'base64').toString('utf-8'))); }
        catch (e) { console.error('⚠️ ACT 解析失败:', e.message); }
        return;
    }
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
    if (actions.length) saveActions();

    if (code !== 0) {
        console.error(`\n❌ k6 退出码 ${code}；已提取账号 ${uniq.length} 个，但不写入 ${path.basename(outFile)}（避免污染）。`);
        process.exit(code);
    }
    if (dryRun) {
        printReport();
        console.log(`\n🧪 演练结束：未写 ${path.basename(outFile)}，未计算活动报表。确认计划后去掉 --dry-run 正式跑。`);
        return;
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
    console.log(`\n✅ ${outFile}：已有 ${existing.length} + 本次 ${uniq.length} → 去重累计 ${merged.length} 个账号（${overwrite ? '覆盖' : '追加'}；仅作记录）`);
    if (!noReport) runActivityReport();
});

// -------- 操作明细落盘 --------
function tsStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveActions() {
    try {
        if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
        const file = path.join(reportDir, `seed_${report.siteDate || 'unknown'}_D${DAY}${dryRun ? '_dryrun' : ''}_${tsStr(new Date())}.json`);
        fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), day: DAY, tenant, report, actions }, null, 2), 'utf-8');
        console.log(`\n💾 操作明细 ${actions.length} 条已保存：${file}`);
    } catch (e) {
        console.error(`\n⚠️ 操作明细保存失败：${e.message}`);
    }
}

// -------- 报表美化打印（Node 端：换行正常、无 k6 前缀） --------
function printReport() {
    const R = (k) => report[k] || 0;
    const dline = '═'.repeat(60);
    const sline = '─'.repeat(60);
    const L = [];
    L.push('');
    L.push(dline);
    L.push(`  📊 充值循环奖励造数据报表    DAY=${report.day || DAY}    租户=${report.tenant || tenant}    站点日期=${report.siteDate || '-'}`);
    L.push(dline);
    L.push(`  今天奖励记录     : ${R('listTotal')} 人（全站）   取到账号 ${R('accountOk')}   取号失败跳过 ${R('accountFail')}`);
    if (Number(R('listAbandoned'))) L.push(`  ❗ 管理员对 GetUserAccount 没有权限 → 已放弃整个列表，全部改为新注册`);
    L.push(`  分组             : 不登录 ${R('roleNoLogin')}   登录不充值 ${R('roleLoginOnly')}   登录并充值 ${R('roleRecharge')}`);
    L.push(`  登录             : 密码 ${R('loginPwd')}   验证码 ${R('loginSms')}   失败跳过 ${R('loginFail')}   账号对不上 ${R('userMismatch')}`);
    L.push(sline);
    L.push(`  领免费           : 计划 ${R('freePlanned')}   成功 ${R('freeOk')}   失败 ${R('freeFail')}   已领/过期跳过 ${R('freeSkip')}`);
    L.push(`  冲付费           : 计划 ${R('payerPlanned')}   其中付费要求超出所有档位(明天无资格) ${R('payerNoTier')}`);
    L.push(`  领付费           : 计划 ${R('paidClaimPlanned')}   成功 ${R('paidClaimOk')}   失败 ${R('paidClaimFail')}   跳过 ${R('paidClaimSkip')}`);
    L.push(sline);
    L.push(`  新注册           : 计划 ${R('newPlanned')}   成功 ${R('regSuccess')}   失败 ${R('regFail')}`);
    L.push(`  充值             : 成功 ${R('rechargeUsers')} 人   失败 ${R('rechargeFailUsers')}   无需再充 ${R('rechargeSkip')}   总金额 ${report.totalAmount || '0.00'}`);
    L.push(`  今天已有充值的人 : ${R('existingTodayUsers')}（重复跑或别人充的，已计入付费进度和明天档位）`);
    if (Number(R('timeStopped'))) L.push(`  ⏰ 站点 23:50 后未处理 : ${R('timeStopped')} 人`);
    L.push(sline);
    L.push(`  明天档位 (不冲付费 / 冲付费):   落不进任何档位 ${R('noTierTomorrow')} 人`);
    tierRows.sort((a, b) => Number(a.id) - Number(b.id)).forEach((t) => {
        const parts = String(t.val).split(',');
        L.push(`    档位 id=${String(t.id).padEnd(4)} 不冲付费=${String(parts[0]).padEnd(4)} 冲付费=${parts[1]}`);
    });
    L.push(dline);
    console.log(L.join('\n'));
}

// -------- 造数成功后自动验证活动报表（失败只告警，不影响造数结果） --------
function runActivityReport() {
    console.log(`\n📊 自动验证活动报表（昨天往前 ${REPORT_DAYS} 个奖励日期；加 --no-report 可跳过）`);
    const rp = spawn(process.execPath, ['cycleReportRunner.js', '--days', REPORT_DAYS, '--tenant', tenant],
        { cwd: scriptDir, stdio: 'inherit', windowsHide: true });
    rp.on('error', (err) => console.error(`⚠️ 活动报表验证启动失败：${err.message}`));
    rp.on('close', (rc) => {
        if (rc !== 0) console.error(`⚠️ 活动报表验证退出码 ${rc}（造数结果不受影响，可单独重跑：node cycleReportRunner.js --days ${REPORT_DAYS} --tenant ${tenant}）`);
    });
}
