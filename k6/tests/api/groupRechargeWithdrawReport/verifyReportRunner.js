/**
 * 集团充提报表核对 —— 验证 Node 编排器
 *
 * 并行 spawn 4个 verifyLocalTenant.day.js(各自独立进程，各传一个TENANT_ID)
 * + 1个 verifyGroupAdmin.day.js，收集双方的统计数据，逐字段对比，打印清晰
 * 的diff报告。
 *
 * 报表刷新延迟处理：不做盲目轮询(刷新周期未知，可能按天刷新，瞎等会卡几
 * 小时)。本地聚合是一次性的较贵操作，集团查询是较便宜的、可重复的操作——
 * 对不上时只重新 spawn verifyGroupAdmin，不重跑本地聚合。
 *
 * 用法（在本目录内运行）：
 *   node verifyReportRunner.js --start 2026-10-26 --end 2026-10-26
 *   node verifyReportRunner.js --start 2026-10-01 --end 2026-10-26 --retry 2 --retry-wait-min 10
 *   node verifyReportRunner.js --start 2026-10-01 --end 2026-10-26 --tenants 3004,3006
 */

const { spawn } = require('child_process');
const { parseArgs } = require('../../../libs/node/args.js');
const { extractTaggedRecord } = require('../../../libs/common/ndjsonStore.js');

const args = parseArgs(process.argv);
const START = args.start;
const END = args.end;
if (!START || !END) {
    console.error('必须传 --start YYYY-MM-DD --end YYYY-MM-DD');
    process.exit(1);
}
// 默认商户列表和 seedConfig.js 的 TARGET_TENANT_IDS 保持一致(此文件是Node/CommonJS，
// seedConfig.js 是给k6用的ESM，两种模块系统不能直接互相require/import，只能手动同步)。
// 3003已排除：添加提现钱包要验证码(msgCode=5029)且充值本身也走不通，详见 seedConfig.js 注释。
const tenants = (args.tenants ? args.tenants.split(',') : ['3004', '3006', '3007']).map(s => s.trim());
const maxRetry = args.retry ? parseInt(args.retry, 10) : 1;
const retryWaitMin = args['retry-wait-min'] ? parseInt(args['retry-wait-min'], 10) : 20;

const scriptDir = __dirname;

// ============== 字段对比表：本地聚合字段名 <-> 集团报表字段名 ==============
// amount类字段用容差比较(绝对值0.01或相对0.1%，取较大的那个作为阈值)，
// 数量类字段精确相等。这部分是"商户明细"维度，按tenantId精确隔离，始终
// 可以强校验，不受币种共享影响。
const COMPARE_FIELDS = [
    { label: '充值发起人数', local: 'rechargeOrderUserCount', group: 'rechargeOrderUserCount', kind: 'count' },
    { label: '充值订单数', local: 'rechargeOrderCount', group: 'rechargeOrderCount', kind: 'count' },
    { label: '充值成功人数', local: 'rechargeSuccessUserCount', group: 'rechargeSuccessUserCount', kind: 'count' },
    { label: '充值成功订单数', local: 'rechargeSuccessCount', group: 'rechargeSuccessCount', kind: 'count' },
    { label: '充值失败订单数', local: 'rechargeFailCount', group: 'rechargeFailCount', kind: 'count' },
    { label: '充值成功金额', local: 'rechargeSuccessAmount', group: 'rechargeSuccessAmount', kind: 'amount' },
    { label: '充值USDT成功金额', local: 'rechargeUsdtSuccessAmount', group: 'rechargeUsdtSuccessAmount', kind: 'amount' },
    { label: '提现发起人数', local: 'withdrawOrderUserCount', group: 'withdrawOrderUserCount', kind: 'count' },
    { label: '提现订单数', local: 'withdrawOrderCount', group: 'withdrawOrderCount', kind: 'count' },
    { label: '提现成功人数', local: 'withdrawSuccessUserCount', group: 'withdrawSuccessUserCount', kind: 'count' },
    { label: '提现成功订单数', local: 'withdrawSuccessCount', group: 'withdrawSuccessCount', kind: 'count' },
    { label: '提现成功金额', local: 'withdrawSuccessAmount', group: 'withdrawSuccessAmount', kind: 'amount' },
    { label: '提现USDT成功金额', local: 'withdrawUsdtSuccessAmount', group: 'withdrawUsdtSuccessAmount', kind: 'amount' }
];

// ============== 通道汇总维度：按币种加总后与本地tenant总量对比 ==============
// 字段名来自 groupAdminApi.js 的 getRechargeChannelSummaryPageList/
// getWithdrawChannelSummaryPageList 实测JSDoc——充值比提现多orderUserCount/
// failCount两个字段(接口本身不对称设计，已用PRD文档确认过，不是漏看)。
// 只挑"数量/金额类"字段参与加总对比，"人数"类字段(orderUserCount/
// successUserCount)天然不可加总——同一账号跨渠道重试会被多个channelId行
// 各计一次，这不是币种共享才有的限制，是数学上的限制，所以人数类字段
// 不参与这里的强校验，只在per-tenant报告里展示供参考。
//
// 2026-10-27用户指出并实测确认根因：集团这两张"通道汇总"表只统计走第三方
// 渠道的订单——充值的LocalBankCard/LocalEWallet/LocalUSDT/LocalBankQR(本地
// 确认类型)、提现靠"人工确认"兜底完成的(withdrawChannelId=0)，即使本地有
// 自己的channelId，也天然不出现在这两张表里。之前直接拿rechargeOrderCount/
// withdrawOrderCount(全部类型都算)去跟"通道汇总"对比，比较的对象范围本来
// 就不对等，差异不代表数据错——所以这里改成只用verifyLocalTenant.day.js里
// 新增的"仅三方/仅归属渠道"口径字段(rechargeThird*/withdrawAttributed*)，
// 统计范围才和集团这两张表真正对齐，能做strict数字对比(哪怕两边都是0也算
// 一致，不需要为提现单独写"断言为空"的分支)。
const CHANNEL_ADDITIVE_FIELDS = {
    recharge: [
        { label: '充值通道-订单数', group: 'orderCount', local: 'rechargeThirdOrderCount', kind: 'count' },
        { label: '充值通道-成功订单数', group: 'successCount', local: 'rechargeThirdSuccessCount', kind: 'count' },
        { label: '充值通道-失败订单数', group: 'failCount', local: 'rechargeThirdFailCount', kind: 'count' },
        { label: '充值通道-成功金额', group: 'successAmount', local: 'rechargeThirdSuccessAmount', kind: 'amount' }
    ],
    withdraw: [
        { label: '提现通道-订单数', group: 'orderCount', local: 'withdrawAttributedOrderCount', kind: 'count' },
        { label: '提现通道-成功订单数', group: 'successCount', local: 'withdrawAttributedSuccessCount', kind: 'count' },
        { label: '提现通道-成功金额', group: 'successAmount', local: 'withdrawAttributedSuccessAmount', kind: 'amount' }
    ]
};

// 币种共享关系(2026-10-26用户确认)：3004=INR(和不在造数范围内的3001共享，
// 该币种的通道汇总会被3001的数据污染，只能展示仅供参考)；3006=BDT、
// 3007=PKR 在已知商户里独占，通道汇总可以强校验。
const CURRENCY_BY_TENANT = { '3004': 'INR', '3006': 'BDT', '3007': 'PKR' };
const STRICT_CURRENCY_TENANTS = new Set(['3006', '3007']);
const STRICT_CURRENCIES = new Set(['BDT', 'PKR']); // 和STRICT_CURRENCY_TENANTS对应的币种版本，概览对比按币种分组要用

function amountClose(a, b) {
    const diff = Math.abs(a - b);
    const tol = Math.max(0.01, Math.abs(a) * 0.001, Math.abs(b) * 0.001);
    return diff <= tol;
}

/** 把某币种下所有通道行的指定字段加总 */
function sumChannelByCurrency(channelRows, currency, fieldDefs) {
    const rows = (channelRows || []).filter(r => r.sysCurrency === currency);
    const sum = {};
    for (const f of fieldDefs) sum[f.group] = rows.reduce((s, r) => s + (parseFloat(r[f.group]) || 0), 0);
    return sum;
}

function spawnK6(script, envs, label) {
    return new Promise((resolve) => {
        const eArgs = Object.entries(envs).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
        const k6Args = ['run', '--summary-mode=disabled', '-q', ...eArgs, script];
        console.log(`💻 [${label}] k6 ${k6Args.join(' ')}`);
        const child = spawn('k6', k6Args, { cwd: scriptDir, windowsHide: true });

        const records = { LOCAL: [], TENANT: [], RCHANNEL: [], WCHANNEL: [], OVERVIEW: [] };
        let buf = '';
        function handleLine(line) {
            for (const tag of Object.keys(records)) {
                const rec = extractTaggedRecord(line, tag);
                if (rec) { records[tag].push(rec); return; }
            }
        }
        function scan(chunk) {
            buf += chunk.toString();
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) { handleLine(buf.slice(0, idx)); buf = buf.slice(idx + 1); }
        }
        const prefix = `[${label}] `;
        child.stderr.on('data', (d) => { process.stderr.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });
        child.stdout.on('data', (d) => { process.stdout.write(prefix + d.toString().replace(/\n(?!$)/g, `\n${prefix}`)); scan(d); });
        child.on('error', (err) => { console.error(`❌ [${label}] 无法启动k6: ${err.message}`); resolve({ code: -1, records }); });
        child.on('close', (code) => { if (buf) handleLine(buf); resolve({ code, records }); });
    });
}

async function fetchLocalData() {
    const results = await Promise.all(tenants.map(t => spawnK6('verifyLocalTenant.day.js', { TENANT_ID: t, START, END }, `本地-${t}`)));
    const byTenant = {};
    results.forEach((r, i) => {
        const tenantId = tenants[i];
        if (r.code !== 0) { console.error(`❌ [本地-${tenantId}] k6退出码${r.code}，这个商户没有可用的本地数据`); return; }
        if (r.records.LOCAL.length > 0) byTenant[tenantId] = r.records.LOCAL[0];
    });
    return byTenant;
}

async function fetchGroupData() {
    const r = await spawnK6('verifyGroupAdmin.day.js', { START, END }, '集团后台');
    if (r.code !== 0) { console.error(`❌ [集团后台] k6退出码${r.code}`); return null; }
    const byTenant = {};
    for (const row of r.records.TENANT) byTenant[String(row.tenantId)] = row;
    const overviewByCurrency = {};
    for (const row of r.records.OVERVIEW) overviewByCurrency[row.sysCurrency] = row;
    return { byTenant, rchannel: r.records.RCHANNEL, wchannel: r.records.WCHANNEL, overviewByCurrency };
}

function diff(localByTenant, groupData) {
    const groupByTenant = groupData ? groupData.byTenant : {};
    const rchannel = groupData ? groupData.rchannel : [];
    const wchannel = groupData ? groupData.wchannel : [];
    const mismatches = [];
    const referenceOnlyDeviations = [];
    const perTenantRows = {};

    for (const tenantId of tenants) {
        const local = localByTenant[tenantId];
        const group = groupByTenant[tenantId];
        const rows = [];
        if (!local) { rows.push({ ok: false, label: '(本商户没有本地数据，跳过)', localVal: null, groupVal: null }); perTenantRows[tenantId] = rows; continue; }
        if (!group) { rows.push({ ok: false, label: '(集团报表里没有这个商户，跳过)', localVal: null, groupVal: null }); perTenantRows[tenantId] = rows; continue; }

        // source标注这条差异具体是"本地统计"跟集团哪张表的哪一行在比——
        // 2026-10-27用户指出之前的摘要看不出是哪两个表对比的，必须明确标注。
        const SRC_TENANT = `本地聚合(verifyLocalTenant查该商户后台订单) vs 商户明细(GetTenantPageList第${tenantId}行)`;
        for (const f of COMPARE_FIELDS) {
            const lv = local[f.local];
            const gv = group[f.group];
            const ok = f.kind === 'amount' ? amountClose(lv, gv) : lv === gv;
            rows.push({ ok, label: f.label, field: f.local, localVal: lv, groupVal: gv });
            if (!ok) mismatches.push({ tenantId, source: SRC_TENANT, label: f.label, field: f.local, localVal: lv, groupVal: gv, diffVal: (typeof lv === 'number' && typeof gv === 'number') ? Math.abs(lv - gv) : null });
        }

        // 通道汇总维度：按币种加总后与本地tenant总量对比。3006/3007币种独占，
        // 计入强校验(mismatches)；3004(INR)和不受控的3001共享，结果无论对错
        // 都只进referenceOnlyDeviations，不影响失败判定。
        // 本地这边只用"仅三方/仅归属渠道"口径(见CHANNEL_ADDITIVE_FIELDS顶部注释)，
        // 不是该商户全部订单——两张表统计范围本来就只覆盖走第三方的那部分。
        const currency = CURRENCY_BY_TENANT[tenantId];
        const isStrict = STRICT_CURRENCY_TENANTS.has(tenantId);
        if (currency) {
            rows.push({ label: `── 通道汇总(币种=${currency}${isStrict ? '，独占可强校验' : '，与其他商户共享，仅供参考'}) ──` });
            const rSum = sumChannelByCurrency(rchannel, currency, CHANNEL_ADDITIVE_FIELDS.recharge);
            const wSum = sumChannelByCurrency(wchannel, currency, CHANNEL_ADDITIVE_FIELDS.withdraw);
            const SRC_RCHANNEL = `本地聚合(该商户后台订单里rechargeChannelType=ThirdRecharge的子集) vs 充值通道汇总(GetRechargeChannelSummaryPageList，币种=${currency}全部渠道行加总)`;
            const SRC_WCHANNEL = `本地聚合(该商户后台订单里withdrawChannelId!=0的子集) vs 提现通道汇总(GetWithdrawChannelSummaryPageList，币种=${currency}全部渠道行加总)`;
            for (const f of CHANNEL_ADDITIVE_FIELDS.recharge) {
                const lv = local[f.local]; const gv = rSum[f.group];
                const ok = f.kind === 'amount' ? amountClose(lv, gv) : lv === gv;
                rows.push({ ok, label: f.label, field: f.local, localVal: lv, groupVal: gv });
                if (!ok) {
                    const item = { tenantId, source: SRC_RCHANNEL, label: f.label, field: f.local, localVal: lv, groupVal: gv, diffVal: (typeof lv === 'number' && typeof gv === 'number') ? Math.abs(lv - gv) : null };
                    (isStrict ? mismatches : referenceOnlyDeviations).push(item);
                }
            }
            for (const f of CHANNEL_ADDITIVE_FIELDS.withdraw) {
                const lv = local[f.local]; const gv = wSum[f.group];
                const ok = f.kind === 'amount' ? amountClose(lv, gv) : lv === gv;
                rows.push({ ok, label: f.label, field: f.local, localVal: lv, groupVal: gv });
                if (!ok) {
                    const item = { tenantId, source: SRC_WCHANNEL, label: f.label, field: f.local, localVal: lv, groupVal: gv, diffVal: (typeof lv === 'number' && typeof gv === 'number') ? Math.abs(lv - gv) : null };
                    (isStrict ? mismatches : referenceOnlyDeviations).push(item);
                }
            }
        }
        perTenantRows[tenantId] = rows;
    }
    return { mismatches, referenceOnlyDeviations, perTenantRows };
}

/**
 * 集团充提概览(按币种分组)——把本地同币种商户数据累加，和Overview的对应
 * 币种行并排展示。2026-10-27用户明确：概览是"按天去重、多天累加"口径，
 * 本地/商户明细是"周期内一次性去重"口径——这两种口径本质不同，不能用精确
 * 容差去判定"一致/不一致"(哪怕单天查询下数学上该相等，也可能有其他未知
 * 的细微差异来源)，所以这层不产出mismatches/ok判定，只把数字摆出来，
 * "大概合理就行"，不触发失败判定、不触发重试。
 *
 * @returns {object} currency -> rows[]
 */
function buildOverviewRows(localByTenant, overviewByCurrency) {
    const rowsByCurrency = {};
    const tenantsByCurrency = {};
    for (const tenantId of tenants) {
        const currency = CURRENCY_BY_TENANT[tenantId];
        if (!currency || !localByTenant[tenantId]) continue;
        (tenantsByCurrency[currency] = tenantsByCurrency[currency] || []).push(localByTenant[tenantId]);
    }

    for (const currency of Object.keys(tenantsByCurrency)) {
        const localList = tenantsByCurrency[currency];
        const overview = (overviewByCurrency || {})[currency];
        const rows = [];
        const coveringTenants = tenants.filter(t => CURRENCY_BY_TENANT[t] === currency);
        const isFullyCovered = STRICT_CURRENCIES.has(currency);
        rows.push({ label: `覆盖商户: ${coveringTenants.join(',')}${isFullyCovered ? '(独占币种)' : '(与范围外商户共享，数值天然会偏小，仅供参考)'}` });

        if (!overview) {
            rows.push({ label: `(集团概览里没有${currency}这个币种)` });
            rowsByCurrency[currency] = rows;
            continue;
        }

        for (const f of COMPARE_FIELDS) {
            const lv = localList.reduce((s, l) => s + (parseFloat(l[f.local]) || 0), 0);
            const gv = overview[f.group];
            rows.push({ label: f.label, field: f.local, localVal: lv, groupVal: gv, infoOnly: true });
        }
        rowsByCurrency[currency] = rows;
    }
    return rowsByCurrency;
}

/**
 * 打印单轮diff的摘要(不等重试循环结束)——2026-10-27用户实测时指出：检测到
 * 不一致后直接进入20分钟等待，期间只能看到一堆原始##LOCAL##/##TENANT##
 * JSON，看不出具体哪里不一致、差多少，体验很差。现在每轮diff后立即调用，
 * 让用户当场就能看到"是否不一致、差在哪"，不用等完整报告或者自己翻JSON。
 */
/**
 * 按source(数据来源对比关系)分组打印差异列表——2026-10-27用户指出：不分组
 * 平铺列出时，看不出每条差异具体是"本地"跟集团哪张表在比(商户明细？充值
 * 通道汇总？提现通道汇总？)。每个来源只打印一次完整说明，下面列具体字段，
 * 不用每行都重复一遍来源文字。
 */
function printGroupedBySource(items, headerPrefix, headerSuffix) {
    if (items.length === 0) return;
    console.log(`${headerPrefix} ${items.length} ${headerSuffix}：`);
    const bySource = new Map();
    for (const m of items) {
        const key = m.source || '(未标注来源)';
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(m);
    }
    for (const [source, list] of bySource) {
        console.log(`  【${source}】`);
        for (const m of list) {
            const diffStr = m.diffVal != null ? `差=${m.diffVal.toFixed(2)}` : '';
            console.log(`    [${m.tenantId}] ${m.label}   本地=${m.localVal}  集团=${m.groupVal}  ${diffStr}`);
        }
    }
}

function printDiffSummary(mismatches, referenceOnlyDeviations, label) {
    if (mismatches.length === 0 && referenceOnlyDeviations.length === 0) {
        console.log(`\n✅ [${label}] 全部核对一致，没有发现不一致项。`);
        return;
    }
    console.log(`\n📊 [${label}] 本轮核对结果：`);
    if (mismatches.length > 0) {
        printGroupedBySource(mismatches, '⚠️ 发现', '处强校验不一致（计入失败判定）');
    } else {
        console.log('✅ 强校验维度全部一致。');
    }
    if (referenceOnlyDeviations.length > 0) {
        printGroupedBySource(referenceOnlyDeviations, '📋 另有', '处仅供参考的偏差（不计入失败判定）');
    }
}

function printReport(perTenantRows, mismatches, referenceOnlyDeviations, overviewRows, retryCount) {
    const line = '═'.repeat(60);
    console.log(`\n${line}`);
    console.log(`  集团后台充提报表核对   窗口=${START} ~ ${END}`);
    console.log(line);

    printDiffSummary(mismatches, referenceOnlyDeviations, '最终结果');

    for (const tenantId of tenants) {
        const rows = perTenantRows[tenantId];
        console.log(`\n──── 商户 ${tenantId} ${'─'.repeat(40)}`);
        for (const r of rows) {
            if (r.field === undefined) { console.log(`   ${r.label}`); continue; }
            const mark = r.ok ? '✅' : '❌';
            console.log(`${mark} ${r.label.padEnd(10, '　')} | 本地: ${r.localVal}  | 集团: ${r.groupVal}`);
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log('📊 集团充提概览(按币种，口径不同不做强校验，数字仅供参考判断"大概合理")');
    console.log('─'.repeat(60));
    for (const currency of Object.keys(overviewRows)) {
        console.log(`\n──── 币种 ${currency} ${'─'.repeat(40)}`);
        for (const r of overviewRows[currency]) {
            if (r.field === undefined) { console.log(`   ${r.label}`); continue; }
            console.log(`📊 ${r.label.padEnd(10, '　')} | 商户明细累加: ${r.localVal}  | 集团概览: ${r.groupVal}`);
        }
    }

    console.log(`\n${line}`);
    console.log(`⚠️ 提示：集团报表存在刷新延迟(非实时)，若不一致较多可能是报表尚未刷新，`);
    console.log(`   建议用 --retry 稍后重跑（本次已自动重试 ${retryCount}/${maxRetry} 次）。`);
    console.log(line);
}

(async () => {
    console.log(`\n🚀 集团充提报表核对  商户=${tenants.join(',')}  窗口=${START}~${END}`);
    const localByTenant = await fetchLocalData();

    let groupData = await fetchGroupData();
    let retryCount = 0;
    let result = diff(localByTenant, groupData);
    printDiffSummary(result.mismatches, result.referenceOnlyDeviations, '首次查询');

    while (result.mismatches.length > 0 && retryCount < maxRetry) {
        retryCount++;
        console.log(`\n⏳ 以上不一致，${retryWaitMin}分钟后重新查询集团报表(重试 ${retryCount}/${maxRetry})，判断是否只是报表刷新延迟...`);
        await new Promise(resolve => setTimeout(resolve, retryWaitMin * 60 * 1000));
        groupData = await fetchGroupData();
        result = diff(localByTenant, groupData);
        printDiffSummary(result.mismatches, result.referenceOnlyDeviations, `重试${retryCount}/${maxRetry}`);
    }

    const overviewRows = buildOverviewRows(localByTenant, groupData ? groupData.overviewByCurrency : {});
    printReport(result.perTenantRows, result.mismatches, result.referenceOnlyDeviations, overviewRows, retryCount);
    process.exit(result.mismatches.length > 0 ? 1 : 0);
})();
