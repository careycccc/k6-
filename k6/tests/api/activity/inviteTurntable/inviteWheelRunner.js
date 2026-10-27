/**
 * 邀请转盘 每日造数 —— Node 包装器（负责落盘状态）
 *
 * k6 沙箱无法写文件，故由本脚本 spawn k6：
 *   - 实时透传 k6 进度；
 *   - 从 stdout/stderr 提取 `##ACCT##<完整JSON记录>`；
 *   - k6 退出码为 0 时，用 ndjsonStore 按 account 覆盖合并写入
 *     state/accounts_<tenantId>.ndjson（累计全量表，不按天分文件）。
 *   - 运行前若状态文件不存在，先创建空文件，避免 k6 侧 open() 在首次运行时报错。
 *
 * ⚠️ Breaking change：旧版本按天分文件的 retention/*.txt（all_dayNN.txt 等）
 * 不再被写入，但保留在磁盘上不删除，避免影响 retentionLoginVerify.js /
 * retentionLoginRunner.js 等仍可能依赖旧文件的现有工具。旧数据不迁移，新逻辑
 * 从空状态表重新开始累积（旧格式没有 userId/真实注册日，没法套公式转换）。
 *
 * 用法（在本目录内运行）：
 *   node inviteWheelRunner.js --tenant 3004 --agents 2 --subs 3 --rounds 2
 *   node inviteWheelRunner.js --tenant 3004                          # agents 不传则 1~3 随机
 *   node inviteWheelRunner.js --tenant 3004 --skip-register          # 只做老账号留存检查
 *   node inviteWheelRunner.js --tenant 3004 --skip-retention         # 只做新总代造数
 *
 * 参数：
 *   --tenant               租户ID（默认 3004）
 *   --agents               新总代数（默认不传，1~3 随机；调试/压测场景可固定）
 *   --subs                 每轮每总代邀请下级数（默认 3）
 *   --rounds               轮数（默认 2）
 *   --retention-vus        老账号留存检查并发 VU 数（默认 5）
 *   --country              手机号区号（可选）
 *   --login-rate           老账号登录概率（默认 0.72）
 *   --reparticipate-rate   登录后重新走完整流程概率（默认 0.20）
 *   --fission-rate         下级裂变参与概率，只转一次轮盘不递归（默认 0.5）
 *   --skip-register        跳过新总代造数，只做老账号留存检查
 *   --skip-retention       跳过老账号留存检查，只做新总代造数
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../../libs/node/args.js');
const { loadStore, upsertRecord, saveStore, extractTaggedRecord } = require('../../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);

const tenant = args.tenant || process.env.TENANT_ID || '3004';
const agents = args.agents || process.env.AGENTS || '';
const subs = args.subs || '3';
const rounds = args.rounds || '2';
const retentionVus = args['retention-vus'] || '5';
const country = args.country || process.env.COUNTRY_CODE || '';
const loginRate = args['login-rate'] || '0.72';
const reparticipateRate = args['reparticipate-rate'] || '0.20';
const fissionRate = args['fission-rate'] || '0.5';
const skipRegister = !!args['skip-register'];
const skipRetention = !!args['skip-retention'];

const SCRIPT = 'inviteWheelRetention.day.js';
const scriptDir = __dirname;
const stateDir = path.join(scriptDir, 'state');
const stateFile = path.join(stateDir, `accounts_${tenant}.ndjson`);

// 首次运行前确保状态文件存在（哪怕是空文件），避免 k6 侧 open() 报错
if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, '', 'utf-8');

// -------- 组装 k6 -e 参数 --------
const envs = {
    TENANT_ID: tenant,
    SUBS: subs,
    ROUNDS: rounds,
    RETENTION_VUS: retentionVus,
    LOGIN_RATE: loginRate,
    REPARTICIPATE_RATE: reparticipateRate,
    FISSION_RATE: fissionRate,
    VIA_RUNNER: '1'
};
if (agents) envs.AGENTS = agents;
if (country) envs.COUNTRY_CODE = country;
if (skipRegister) envs.SKIP_REGISTER = '1';
if (skipRetention) envs.SKIP_RETENTION = '1';

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 邀请转盘每日造数  租户=${tenant}${agents ? `  总代=${agents}` : '  总代=1~3随机'}  下级/轮=${subs}  轮=${rounds}  留存VU=${retentionVus}`);
console.log(`🎲 LOGIN_RATE=${loginRate}  REPARTICIPATE_RATE=${reparticipateRate}  FISSION_RATE=${fissionRate}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const acctRecords = [];
let buf = '';

function handleLine(line) {
    const record = extractTaggedRecord(line, 'ACCT');
    if (record) acctRecords.push(record);
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
        console.error(`\n❌ k6 退出码 ${code}；已提取 ${acctRecords.length} 条账号记录，但不写盘（避免污染）。`);
        process.exit(code);
    }

    const store = loadStore(stateFile, 'account');
    const beforeCount = store.size;
    for (const record of acctRecords) {
        upsertRecord(store, record, 'account');
    }
    saveStore(stateFile, store);

    console.log('\n✅ 本次造数完成');
    console.log(`   ${stateFile}`);
    console.log(`   累计账号: ${store.size}（本次新增/更新: ${acctRecords.length} 条标记，新增账号: ${store.size - beforeCount}）`);
});
