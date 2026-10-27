/**
 * 集团充提报表核对 —— 多天衰减系列·每日调度器(Node/CommonJS)
 *
 * 每天手动(或定时任务)运行一次，自动判断"今天是第几天"、算出当天的新增/
 * 捶老会员目标人数，并行spawn 3个商户(3004/3006/3007)的k6进程(复用
 * accountSeedRunner.js已验证过的spawn+scan范式)，把每个商户收集到的
 * ##ACCT## 记录"合并"进累计状态表(⚠️不是像accountSeedRunner.js那样新建
 * Map覆盖写——这次必须合并，否则第2天运行会把第1天的账号记录和待审核
 * 订单信息全部冲掉)。
 *
 * "第几天"的推进是自动的：读 state/dailySchedule.json 的 lastCompletedDay，
 * todayIndex = lastCompletedDay + 1；全部商户都成功才会前进这个计数器，
 * 任一商户失败就不前进，报错退出——不需要人每次手动算、手动传对天数。
 *
 * 用法（在本目录内运行）：
 *   node dailyRunner.js                          # 跑下一天(自动判断)
 *   node dailyRunner.js --total-days 5           # 指定系列总天数(默认5，也可用TOTAL_DAYS环境变量)
 *   node dailyRunner.js --tenants 3004           # 只跑指定商户(比如某天其他商户已经失败需要单独重跑)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseArgs } = require('../../../libs/node/args.js');
const { loadStore, upsertRecord, saveStore, extractTaggedRecord } = require('../../../libs/common/ndjsonStore.js');
const { loadState, saveState } = require('./dailyScheduleState.js');

const args = parseArgs(process.argv);
const TOTAL_DAYS = parseInt(args['total-days'] || process.env.TOTAL_DAYS || '5', 10);
const tenants = (args.tenants ? args.tenants.split(',') : ['3004', '3006', '3007']).map(s => s.trim());

const NEW_COUNT_FLOOR = 1;
const FISH_COUNT_FLOOR = 2;
const DAY1_NEW_COUNT = 20;
const DAY1_FISH_MIN = 5, DAY1_FISH_MAX = 10;
const DAY2_FISH_COUNT = 5;

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function decayNewCount(prev) { return Math.max(NEW_COUNT_FLOOR, Math.round(prev / 2)); }
function decayFishCount(prev) { return Math.max(FISH_COUNT_FLOOR, Math.round(prev / 2)); }

const scriptDir = __dirname;
const stateDir = path.join(scriptDir, 'state');

/** 和 accountSeedRunner.js 的 runOneTenant 同款范式：spawn一个k6进程，收集##ACCT##标记行 */
function runOneTenantDay(tenantId, dayIndex, newCount, fishTarget) {
    return new Promise((resolve) => {
        const eArgs = ['-e', `TENANT_ID=${tenantId}`, '-e', `DAY_INDEX=${dayIndex}`, '-e', `NEW_COUNT=${newCount}`, '-e', `FISH_TARGET=${fishTarget}`, '-e', 'VIA_RUNNER=1'];
        const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, 'accountSeed.day.js'];
        console.log(`💻 [${tenantId}] k6 ${k6Args.join(' ')}`);
        const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

        const records = [];
        let buf = '';
        function scan(chunk) {
            buf += chunk.toString();
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
                const rec = extractTaggedRecord(line, 'ACCT');
                if (rec) records.push(rec);
            }
        }
        const prefix = `[${tenantId}] `;
        child.stderr.on('data', (d) => { process.stderr.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });
        child.stdout.on('data', (d) => { process.stdout.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });
        child.on('error', (err) => { console.error(`❌ [${tenantId}] 无法启动k6: ${err.message}`); resolve({ tenantId, code: -1, records: [] }); });
        child.on('close', (code) => { if (buf) { const rec = extractTaggedRecord(buf, 'ACCT'); if (rec) records.push(rec); } resolve({ tenantId, code, records }); });
    });
}

/** 确保每个商户的状态文件已存在(k6 init阶段的open()要求文件已存在，哪怕是空文件) */
function ensureStateFilesExist() {
    fs.mkdirSync(stateDir, { recursive: true });
    for (const t of tenants) {
        const p = path.join(stateDir, `accounts_${t}.ndjson`);
        if (!fs.existsSync(p)) fs.writeFileSync(p, '', 'utf-8');
    }
}

(async () => {
    const state = loadState();
    const todayIndex = state.lastCompletedDay + 1;
    if (todayIndex > TOTAL_DAYS) {
        console.log(`[DailyRunner] 系列已完成(${state.lastCompletedDay}/${TOTAL_DAYS}天)，如需继续请用更大的 --total-days 重跑`);
        process.exit(0);
    }

    let newCount, fishTarget;
    const prevDay = state.days && state.days[todayIndex - 1];
    if (todayIndex === 1) {
        newCount = DAY1_NEW_COUNT;
        fishTarget = randInt(DAY1_FISH_MIN, DAY1_FISH_MAX);
    } else if (todayIndex === 2) {
        newCount = decayNewCount((prevDay && prevDay.newCount) || DAY1_NEW_COUNT);
        fishTarget = DAY2_FISH_COUNT;
    } else {
        newCount = decayNewCount((prevDay && prevDay.newCount) || NEW_COUNT_FLOOR);
        fishTarget = decayFishCount((prevDay && prevDay.fishTarget) || FISH_COUNT_FLOOR);
    }

    // --new-count/--fish-target：不分天、直接覆盖这次算出来的值，仅供小规模
    // 测试用(验证调度/落盘/补单逻辑不需要真的按正式人数跑)，不传时就是上面
    // 算出的正常衰减值，不影响正式运行。
    if (args['new-count'] !== undefined) newCount = parseInt(args['new-count'], 10);
    if (args['fish-target'] !== undefined) fishTarget = parseInt(args['fish-target'], 10);

    console.log(`\n🚀 多天衰减系列  第${todayIndex}/${TOTAL_DAYS}天  商户=${tenants.join(',')}  新增=${newCount}  捶老会员目标=${fishTarget}`);
    ensureStateFilesExist();

    const results = await Promise.all(tenants.map(t => runOneTenantDay(t, todayIndex, newCount, fishTarget)));
    const allOk = results.every(r => r.code === 0);

    const tenantSummaries = {};
    for (const r of results) {
        if (r.code !== 0) { console.error(`❌ [${r.tenantId}] k6退出码${r.code}，这个商户今天的数据不落盘`); continue; }
        const filePath = path.join(stateDir, `accounts_${r.tenantId}.ndjson`);
        const store = loadStore(filePath); // ⚠️关键：必须先读旧表再合并，不能像accountSeedRunner.js那样new Map()重建
        for (const rec of r.records) upsertRecord(store, rec, 'account');
        saveStore(filePath, store);
        tenantSummaries[r.tenantId] = { k6ExitCode: r.code, recordsEmitted: r.records.length };
        console.log(`✅ [${r.tenantId}] 本次收到${r.records.length}条记录，已合并落盘到 ${filePath}`);
    }

    if (allOk) {
        state.lastCompletedDay = todayIndex;
        state.days = Object.assign({}, state.days, {
            [todayIndex]: { ranAt: new Date().toISOString(), newCount, fishTarget, tenants: tenantSummaries }
        });
        saveState(state);
        console.log(`\n✅ 第${todayIndex}天全部商户成功，lastCompletedDay → ${todayIndex}`);
    } else {
        console.error(`\n❌ 有商户失败，lastCompletedDay 保持 ${state.lastCompletedDay}(没有前进)。` +
            `成功的商户今天的新增已经落盘；重跑时建议加 --tenants 只重跑失败的商户，避免成功的商户被重复新增。`);
        process.exit(1);
    }
})();
