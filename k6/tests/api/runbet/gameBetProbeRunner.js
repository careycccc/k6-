/**
 * 游戏投注能力探测 —— Node 包装器（负责落盘缓存）
 *
 * k6 沙箱无法写文件，故由本脚本 spawn k6：
 *   - 实时透传 k6 进度（真实注册+充值+逐游戏试投+回查后台落库，耗时2-3分钟，
 *     花测试站真实的钱，参照 gameBetProbe.js 自身的说明）；
 *   - 从 stdout/stderr 提取 `##GAMECAP##<完整JSON记录>`；
 *   - k6 退出码为 0 时，用 ndjsonStore 按 tenantId 覆盖合并写入
 *     state/gameCapability.ndjson（单文件多租户共用，一租户一行，重新探测
 *     会整条覆盖旧记录——最新探测结果为准）。
 *   - 运行前若状态文件不存在，先创建空文件，避免 k6 侧（gameCapability.js）
 *     的 open() 在首次运行时报错。
 *
 * 用法（在本目录内运行）：
 *   node gameBetProbeRunner.js --tenant 3006
 *   node gameBetProbeRunner.js --tenant 3006 --amount 200
 *   node gameBetProbeRunner.js --tenant 3006 --account 8807461005748 --recharge 0
 *   node gameBetProbeRunner.js --tenant 3006 --games WinGo_30S,K3_1M   # 调试用子集，不要用来刷新正式缓存
 *
 * 参数：
 *   --tenant     租户ID（默认 3004）
 *   --amount     每注金额（默认 100，建议固定传 200，与现有探测经验一致）
 *   --account    复用已有账号(不传则新注册，但部分租户注册要求必填邀请码会失败，
 *                遇到这种情况就手动传一个已有账号)
 *   --recharge   充值金额（默认 5000，复用已有余额账号时可传 0）
 *   --games      只测这几个游戏码(逗号分隔)——仅用于调试单个游戏，刷新正式缓存
 *                必须不传，走全量18个游戏，否则会用这次测的子集整体覆盖旧的
 *                failedGames
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('../../../libs/node/args.js');
const { loadStore, upsertRecord, saveStore, extractTaggedRecord } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);

const tenant = args.tenant || '3004';
const amount = args.amount || '';
const account = args.account || '';
const recharge = args.recharge !== undefined ? args.recharge : '';
const games = args.games || '';

const SCRIPT = 'gameBetProbe.js';
const scriptDir = __dirname;
const stateDir = path.join(scriptDir, 'state');
const stateFile = path.join(stateDir, 'gameCapability.ndjson');

// 首次运行前确保状态文件存在（哪怕是空文件），避免 k6 侧 open() 报错
if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
if (!fs.existsSync(stateFile)) fs.writeFileSync(stateFile, '', 'utf-8');

if (games) {
    console.log(`⚠️  传了 --games 子集探测，结果只会覆盖这几个游戏对应的 capableGames/failedGames 判定；`);
    console.log(`   刷新正式缓存请不传 --games 跑一次全量探测。`);
}

// -------- 组装 k6 -e 参数 --------
const envs = { TENANT_ID: tenant };
if (amount) envs.AMOUNT = amount;
if (account) envs.ACCOUNT = account;
if (recharge !== '') envs.RECHARGE = recharge;
if (games) envs.GAMES = games;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 游戏投注能力探测  租户=${tenant}  金额=${amount || '100(默认)'}${account ? `  复用账号=${account}` : '  新注册账号'}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const capRecords = [];
let buf = '';

function handleLine(line) {
    const record = extractTaggedRecord(line, 'GAMECAP');
    if (record) capRecords.push(record);
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
        console.error(`\n❌ k6 退出码 ${code}；已提取 ${capRecords.length} 条探测记录，但不写盘（避免污染）。`);
        process.exit(code);
    }

    if (capRecords.length === 0) {
        console.error(`\n❌ 没有提取到任何 ##GAMECAP## 标记行，缓存未更新（检查 gameBetProbe.js 是否正常跑到结尾）。`);
        process.exit(1);
    }

    const store = loadStore(stateFile, 'tenantId');
    for (const record of capRecords) {
        upsertRecord(store, record, 'tenantId');
    }
    saveStore(stateFile, store);

    const last = capRecords[capRecords.length - 1];
    console.log('\n✅ 探测完成，缓存已更新');
    console.log(`   ${stateFile}`);
    console.log(`   租户 ${last.tenantId} 真能投: ${last.capableGames.length ? last.capableGames.join(', ') : '无（全部失败，检查探测日志）'}`);
    console.log(`   累计已探测租户数: ${store.size}`);
});
