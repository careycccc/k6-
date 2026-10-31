/**
 * libs/monitor/analyzeApiPerf.js
 *
 * 读取 k6 `--out json=xxx.json` 产生的原始数据点文件，按接口(tags)分组统计
 * 耗时分布，生成一份清晰的"接口耗时排行榜"报告——解决复杂流程里"只看到一个
 * 笼统的 http_req_duration 整体均值/P95，看不出具体是哪个接口慢"的问题。
 *
 * ── 背景(2026-10-29) ─────────────────────────────────────────────────────
 * 项目里 signinApi.js/rechargeWheelExecution.js/rptDashboardApi.js 等20多处
 * 调用点，本来就在用 { params: { tags: {...} } } 这种写法给请求打标签，但
 * libs/http/client.js 的 request() 方法过去一直读取的是 config.tags(顶层)，
 * 不是 config.params.tags——路径不匹配导致这些tags从来没有真正传到k6底层，
 * 一直在空转。这个bug已经在 client.js 里修复(新增兼容读取)，现在这些已有的
 * tag标注会自动生效，不需要改动任何业务测试脚本。
 *
 * k6自定义指标(Trend/Counter等)必须在init context声明，实测验证过无法运行时
 * 动态按接口创建(k6直接报错"metrics must be declared in the init context")，
 * 所以这里不用自定义指标方案，改用k6官方支持的 --out json 导出原始数据点、
 * 事后在Node侧按tags分组统计——这条路不受"必须预先知道有哪些接口"的限制，
 * 任意新接口只要打了tag就能被自动纳入统计，不需要为每个新接口手动加代码。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────────
 *   1) 跑k6时加上 --out json=xxx.json：
 *        k6 run --out json=perf.json your_complex_flow.js
 *   2) 跑完后分析这个文件：
 *        node libs/monitor/analyzeApiPerf.js perf.json
 *   也可以当模块用（比如包进某个Node编排器里自动化这两步）：
 *        const { analyze, formatReport } = require('.../analyzeApiPerf.js');
 *        const rows = await analyze('perf.json');
 *        console.log(formatReport(rows));
 */
const fs = require('fs');
const readline = require('readline');

/**
 * 从完整URL提取path部分(去掉协议+域名+查询串)，作为没打tag时的兜底分组key。
 * 解析失败(比如传入的本来就不是合法URL)时原样返回输入，不让这个兜底逻辑本身
 * 变成新的报错源。
 * @param {string} url
 * @returns {string}
 */
function urlPathOf(url) {
    try {
        return new URL(url).pathname;
    } catch (e) {
        return url;
    }
}

/**
 * 计算分位数(线性插值法，和k6自身算法基本一致)。
 * @param {number[]} sortedValues - 必须是已经升序排好的数组
 * @param {number} p - 0~1之间，比如0.95代表P95
 */
function percentile(sortedValues, p) {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];
    const idx = p * (sortedValues.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedValues[lo];
    const frac = idx - lo;
    return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}

/**
 * 从k6 --out json 文件里读取所有 http_req_duration 数据点，按接口分组统计。
 * 文件是ndjson格式(每行一个JSON对象)，逐行流式读取而不是一次性JSON.parse整
 * 个文件——压测场景下这个文件可能有几十万行，一次性读入内存容易OOM。
 *
 * @param {string} jsonFilePath
 * @returns {Promise<Array<{name:string, count:number, avg:number, min:number, max:number, p50:number, p90:number, p95:number, p99:number}>>}
 *          按p95降序排列(最慢的排最前面)
 */
function analyze(jsonFilePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(jsonFilePath)) {
            reject(new Error(`文件不存在: ${jsonFilePath}`));
            return;
        }

        // 分组key -> 该组所有请求的duration数组
        const groups = new Map();

        function groupKeyOf(tags) {
            // 优先用业务代码打的type标签(纯净、不带_request后缀)，没有就退回name标签，
            // 两者都没有(完全没打tag的请求，比如走了monitoredPost等独立路径的)就用
            // URL的path部分兜底分组——不会漏掉任何请求，只是分组粒度退化成按接口路径
            // 区分。只取path(去掉协议+域名)是故意的：同一个/api/Home/Register这种接口，
            // 在不同商户域名(3004/3006/3007各自域名不同)下调用时应该被合并到一起统计，
            // 这样看的是"这个接口本身快不快"，不是"这个域名快不快"——如果两者差异很大
            // 需要分域名看，是另一个维度的分析，不是这里的目标。
            if (!tags) return '(未分类)';
            if (tags.type) return tags.type;
            if (tags.name) {
                // k6对没打自定义tag的请求，会自动把name设成完整URL(实测确认过，
                // 不是走url字段)——这种情况也要走path提取美化，不能当成业务代码
                // 主动传的、已经有意义的名字(比如"GetFrontUserInfo")直接展示。
                return /^https?:\/\//i.test(tags.name) ? urlPathOf(tags.name) : tags.name;
            }
            if (tags.url) return urlPathOf(tags.url);
            return '(未分类)';
        }

        const rl = readline.createInterface({
            input: fs.createReadStream(jsonFilePath, { encoding: 'utf8' }),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            if (!line.trim()) return;
            let point;
            try { point = JSON.parse(line); } catch (e) { return; } // 容错：跳过解析失败/不完整的行
            if (point.type !== 'Point' || point.metric !== 'http_req_duration') return;

            const key = groupKeyOf(point.data.tags);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(point.data.value);
        });

        rl.on('close', () => {
            const result = [];
            for (const [name, durations] of groups) {
                const sorted = durations.slice().sort((a, b) => a - b);
                const count = sorted.length;
                const sum = sorted.reduce((s, v) => s + v, 0);
                result.push({
                    name,
                    count,
                    avg: sum / count,
                    min: sorted[0],
                    max: sorted[count - 1],
                    p50: percentile(sorted, 0.50),
                    p90: percentile(sorted, 0.90),
                    p95: percentile(sorted, 0.95),
                    p99: percentile(sorted, 0.99)
                });
            }
            result.sort((a, b) => b.p95 - a.p95); // 按P95降序——最慢的排最前面，一眼看出瓶颈
            resolve(result);
        });

        rl.on('error', reject);
    });
}

/**
 * 把 analyze() 的结果格式化成一份清晰的文本报告。
 * @param {Array} rows - analyze() 的返回值
 * @returns {string}
 */
function formatReport(rows) {
    if (rows.length === 0) return '(没有采集到任何 http_req_duration 数据点——检查--out json参数是否写对了)';

    const fmt = (ms) => ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(0) + 'ms';
    const nameWidth = Math.min(42, Math.max(...rows.map(r => r.name.length), 10));
    const totalWidth = nameWidth + 56;

    const lines = [];
    lines.push('═'.repeat(totalWidth));
    lines.push('  接口耗时排行榜（按 P95 降序 —— 排在最前面的就是这次流程里的瓶颈）');
    lines.push('═'.repeat(totalWidth));
    lines.push(
        '  ' + '接口/标签'.padEnd(nameWidth, ' ') +
        '次数'.padEnd(7) +
        '平均'.padEnd(9) +
        'P50'.padEnd(9) +
        'P90'.padEnd(9) +
        'P95'.padEnd(9) +
        '最大'
    );
    lines.push('─'.repeat(totalWidth));
    for (const r of rows) {
        const displayName = r.name.length > nameWidth ? r.name.slice(0, nameWidth - 1) + '…' : r.name;
        lines.push(
            '  ' + displayName.padEnd(nameWidth, ' ') +
            String(r.count).padEnd(7) +
            fmt(r.avg).padEnd(9) +
            fmt(r.p50).padEnd(9) +
            fmt(r.p90).padEnd(9) +
            fmt(r.p95).padEnd(9) +
            fmt(r.max)
        );
    }
    lines.push('═'.repeat(totalWidth));
    lines.push('  提示：接口名显示为"(未分类)"或完整URL的，说明这次调用没打tag(走的是');
    lines.push('  monitoredPost等独立路径，或者本身就没传tag参数)，只是按URL兜底分组。');
    return lines.join('\n');
}

module.exports = { analyze, formatReport, percentile };

// 支持命令行直接调用：node analyzeApiPerf.js <k6--out json文件路径>
if (require.main === module) {
    const jsonPath = process.argv[2];
    if (!jsonPath) {
        console.error('用法: node analyzeApiPerf.js <k6 --out json文件路径>');
        process.exit(1);
    }
    analyze(jsonPath).then(rows => {
        console.log(formatReport(rows));
    }).catch(err => {
        console.error('分析失败:', err.message);
        process.exit(1);
    });
}
