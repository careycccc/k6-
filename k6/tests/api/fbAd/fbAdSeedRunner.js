/**
 * FB广告分析 - 每日造数 Node 包装器（负责落盘）
 *
 * k6 沙箱无法写文件，故由本脚本 spawn k6：
 *   - 实时透传 k6 进度；
 *   - 从 stdout 提取 `##ACCT##<json>`（完整账号记录）；
 *   - k6 退出码为 0 时，用 libs/common/ndjsonStore.js 按 account 覆盖合并写入
 *     state/accounts_<tenantId>.ndjson（整表原子重写）。
 *
 * 用法（在本目录内运行）：
 *   node fbAdSeedRunner.js --tenant 3004 --user-count 10
 *   node fbAdSeedRunner.js --tenant 3004 --user-count 5 --country-code 1
 *
 * 参数：
 *   --tenant        租户ID（默认 3004）
 *   --user-count    本次新注册账号数（默认 10）
 *   --country-code  手机号区号（默认 91）
 *   --pixel-id      FB Pixel ID（可选，不传用脚本内默认值）
 *   --event-config-id  事件配置ID（可选）
 *   --package-name  包名（可选）
 */

const { spawn } = require('child_process');
const path = require('path');
const { parseArgs } = require('../../../libs/node/args.js');
const { loadStore, upsertRecord, saveStore, extractTaggedRecord } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);

const tenant = args.tenant || process.env.TENANT_ID || '3004';
const userCount = args['user-count'] || '10';
const countryCode = args['country-code'] || '';
const pixelId = args['pixel-id'] || '';
const eventConfigId = args['event-config-id'] || '';
const packageName = args['package-name'] || '';

const SCRIPT = 'fbAdSeed.day.js';
const scriptDir = __dirname;
const stateDir = path.join(scriptDir, 'state');
const stateFile = path.join(stateDir, `accounts_${tenant}.ndjson`);

// -------- 组装 k6 -e 参数 --------
const envs = { TENANT_ID: tenant, USER_COUNT: userCount, VIA_RUNNER: '1' };
if (countryCode) envs.COUNTRY_CODE = countryCode;
if (pixelId) envs.PIXEL_ID = pixelId;
if (eventConfigId) envs.EVENT_CONFIG_ID = eventConfigId;
if (packageName) envs.PACKAGE_NAME = packageName;

const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

console.log(`\n🚀 FB广告分析每日造数  租户=${tenant}  新增账号数=${userCount}`);
console.log(`💻 k6 ${k6Args.join(' ')}   (cwd=${scriptDir})\n`);

const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

const records = [];
let buf = '';

function handleLine(line) {
    const record = extractTaggedRecord(line, 'ACCT');
    if (record) records.push(record);
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
        console.error(`\n❌ k6 退出码 ${code}；已提取 ${records.length} 条账号记录，但不落盘（避免污染）。`);
        process.exit(code);
    }

    const store = loadStore(stateFile);
    const beforeCount = store.size;
    for (const record of records) {
        upsertRecord(store, record);
    }
    saveStore(stateFile, store);

    console.log(`\n✅ 造数完成`);
    console.log(`   ${stateFile}`);
    console.log(`   累计账号数: ${store.size}（本次新增/更新: ${records.length}，之前: ${beforeCount}）`);
});
