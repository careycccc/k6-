#!/usr/bin/env node
/**
 * libs/monitor/runWithPerf.js
 *
 * 一键跑k6测试 + 自动生成接口耗时排行榜——把
 *   k6 run --out json=xxx.json 你的脚本.js
 *   node analyzeApiPerf.js xxx.json
 * 这两步合并成一条命令：实时看着k6照常输出日志，跑完紧接着在终端看到排行榜，
 * 不用自己记临时文件路径、手动敲第二条命令、再去删这个临时文件。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 * 把平时 `k6 run` 后面的参数原样搬过来，不用再多打一遍"k6 run"：
 *
 *   node ../../../libs/monitor/runWithPerf.js -e TEAM_NAME=TeamA -e TENANT_ID=3007 step1_register.js
 *   node ../../../libs/monitor/runWithPerf.js --summary-mode=disabled -q -e TENANT_ID=3004 verifyLocalTenant.day.js
 *
 * 想保留原始的性能数据json(比如要跨多次运行自己再做别的分析)，加 --keep-json：
 *   node ../../../libs/monitor/runWithPerf.js --keep-json -e TENANT_ID=3004 verifyLocalTenant.day.js
 * (这个参数只给本脚本自己识别，会在转发给k6前被过滤掉，不会污染k6的参数列表)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { analyze, formatReport } = require('./analyzeApiPerf.js');

const rawArgs = process.argv.slice(2);
const keepJson = rawArgs.includes('--keep-json');
const k6Args = rawArgs.filter(a => a !== '--keep-json');

if (k6Args.length === 0) {
    console.error('用法: node runWithPerf.js [k6 run 的参数...] 你的脚本.js');
    console.error('示例: node runWithPerf.js -e TENANT_ID=3004 verifyLocalTenant.day.js');
    console.error('可选: --keep-json  跑完保留原始性能数据文件，不自动删除');
    process.exit(1);
}

// 临时文件落在当前工作目录(调用方所在目录)，用时间戳命名避免并发跑多个测试时撞名
const jsonPath = path.join(process.cwd(), `_perf_${Date.now()}.json`);
const fullArgs = ['run', '--out', `json=${jsonPath}`, ...k6Args];

console.log(`💻 k6 ${fullArgs.join(' ')}`);
const child = spawn('k6', fullArgs, { stdio: 'inherit', windowsHide: true });

child.on('close', async (code) => {
    if (!fs.existsSync(jsonPath)) {
        console.error(`\n❌ 没有找到性能数据文件 ${jsonPath}，k6可能没有正常跑起来(退出码${code})`);
        process.exit(code || 1);
        return;
    }

    try {
        const rows = await analyze(jsonPath);
        console.log('\n' + formatReport(rows));
    } catch (err) {
        console.error(`\n⚠️ 性能数据分析失败: ${err.message}`);
        // 分析失败不应该掩盖k6本身的执行结果，继续往下走，按k6的退出码退出
    } finally {
        if (keepJson) {
            console.log(`\n📁 原始性能数据已保留: ${jsonPath}`);
        } else if (fs.existsSync(jsonPath)) {
            fs.unlinkSync(jsonPath);
        }
    }

    // 退出码如实反映k6本身的执行结果——测试失败了就应该是非0退出码，不能因为
    // "性能分析"这个附加功能本身跑成功了就掩盖掉这个更重要的信号
    process.exit(code || 0);
});

child.on('error', (err) => {
    console.error(`❌ 无法启动k6: ${err.message}`);
    process.exit(1);
});
