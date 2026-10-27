/**
 * 集团充提报表核对 —— 造数 Node 包装器（并行 spawn 4 个商户进程，负责落盘）
 *
 * k6 沙箱无法写文件，且项目请求层在同进程内只能绑定一个商户(见
 * accountSeed.day.js 顶部注释)，所以这里不是"spawn一个k6、起多个VU"，而是
 * "并行spawn 4个独立k6进程，每个进程各自传 -e TENANT_ID=xxx"——4个商户天然
 * 互不干扰，比同进程多VU更简单可靠。
 *
 * 落盘：每个商户一份独立的 state/accounts_<tenantId>.ndjson，用
 * libs/common/ndjsonStore.js 的 saveStore/extractTaggedRecord。这次是一次性
 * 造数+紧接着验证，不需要 loadStore/upsertRecord 的跨运行合并语义——每个
 * 商户进程收集到的记录直接建一个新 Map 写出，不读取/合并历史文件。
 *
 * 用法（在本目录内运行）：
 *   node accountSeedRunner.js
 *   node accountSeedRunner.js --tenants 3004,3006          # 只跑指定商户
 *   node accountSeedRunner.js --account-count 5             # 每商户固定账号数(默认不传则15-25随机)
 */

const { spawn } = require('child_process');
const path = require('path');
const { parseArgs } = require('../../../libs/node/args.js');
const { saveStore, extractTaggedRecord } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
// 默认商户列表和 seedConfig.js 的 TARGET_TENANT_IDS 保持一致(此文件是Node/CommonJS，
// seedConfig.js 是给k6用的ESM，两种模块系统不能直接互相require/import，只能手动同步)。
// 3003已排除：添加提现钱包要验证码(msgCode=5029)且充值本身也走不通，详见 seedConfig.js 注释。
const tenants = (args.tenants ? args.tenants.split(',') : ['3004', '3006', '3007']).map(s => s.trim());
const accountCount = args['account-count'] || '';

const SCRIPT = 'accountSeed.day.js';
const scriptDir = __dirname;
const stateDir = path.join(scriptDir, 'state');

console.log(`\n🚀 集团充提报表造数  商户=${tenants.join(',')}${accountCount ? `  每商户账号数=${accountCount}` : '  每商户账号数=15-25随机'}`);

function runOneTenant(tenantId) {
    return new Promise((resolve) => {
        const envs = { TENANT_ID: tenantId, VIA_RUNNER: '1' };
        if (accountCount) envs.ACCOUNT_COUNT = accountCount;
        const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, SCRIPT];

        console.log(`💻 [${tenantId}] k6 ${k6Args.join(' ')}`);
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
                handleLine(buf.slice(0, idx));
                buf = buf.slice(idx + 1);
            }
        }
        // 多进程并行输出到同一个终端，加租户前缀避免交错看混
        const prefix = `[${tenantId}] `;
        child.stderr.on('data', (d) => { process.stderr.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });
        child.stdout.on('data', (d) => { process.stdout.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });

        child.on('error', (err) => {
            console.error(`\n❌ [${tenantId}] 无法启动 k6：${err.message}`);
            resolve({ tenantId, code: -1, records: [] });
        });
        child.on('close', (code) => {
            if (buf) handleLine(buf);
            resolve({ tenantId, code, records });
        });
    });
}

(async () => {
    const results = await Promise.all(tenants.map(runOneTenant));

    console.log(`\n${'='.repeat(60)}`);
    console.log('造数完成，各商户结果：');
    for (const { tenantId, code, records } of results) {
        if (code !== 0) {
            console.error(`❌ [${tenantId}] k6 退出码 ${code}；已提取 ${records.length} 条记录，但不落盘（避免污染）。`);
            continue;
        }
        const store = new Map();
        for (const record of records) {
            const key = String(record.account);
            store.set(key, record);
        }
        const stateFile = path.join(stateDir, `accounts_${tenantId}.ndjson`);
        saveStore(stateFile, store);
        const usdtCount = Array.from(store.values()).filter(r => r.isUsdt).length;
        console.log(`✅ [${tenantId}] ${stateFile} 共${store.size}个账号(其中USDT账号${usdtCount}个)`);
    }
    console.log('='.repeat(60));
})();
