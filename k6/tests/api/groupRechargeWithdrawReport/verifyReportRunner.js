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

// ============== 通道汇总维度：逐channelId精确对比 ==============
// 字段名来自 groupAdminApi.js 的 getRechargeChannelSummaryPageList/
// getWithdrawChannelSummaryPageList 实测JSDoc——充值比提现多orderUserCount/
// failCount两个字段(接口本身不对称设计，已用PRD文档确认过，不是漏看)。
// 只挑"数量/金额类"字段参与对比，"人数"类字段(orderUserCount/
// successUserCount)天然不可加总——同一账号跨渠道重试会被多个channelId行
// 各计一次，这不是币种共享才有的限制，是数学上的限制，所以人数类字段
// 不参与这里的强校验，只在per-tenant报告里展示供参考。
//
// 2026-10-27用户指出并实测确认根因：集团这两张"通道汇总"表只统计走第三方
// 渠道的订单——充值的LocalBankCard/LocalEWallet/LocalUSDT/LocalBankQR(本地
// 确认类型)、提现靠"人工确认"兜底完成的(withdrawChannelId=0)，即使本地有
// 自己的channelId，也天然不出现在这两张表里。之前直接拿rechargeOrderCount/
// withdrawOrderCount(全部类型都算)去跟"通道汇总"对比，比较的对象范围本来
// 就不对等，差异不代表数据错——所以本地只用verifyLocalTenant.day.js里的
// "仅三方/仅归属渠道"口径字段，统计范围才和集团这两张表真正对齐。
//
// 2026-10-27用户进一步要求：之前是把本地+集团各自的全部渠道行加总成一个
// 整体数字再比较，只能看出"差多少"看不出"差在哪个渠道"——改成逐channelId
// 比对，diff条目里标注[tenantId-channelId]，才能定位到具体哪个渠道的数据
// 对不上。local字段名对应verifyLocalTenant.day.js分桶对象(rechargeThirdByChannel/
// withdrawAttributedByChannel)内部的字段，不是之前那种聚合层字段名。
// label不带"充值通道-"/"提现通道-"前缀——2026-10-27第三轮用户反馈：打印
// 时每个渠道的组标题已经写明"充值通道"/"提现通道"，字段行再重复一遍前缀
// 纯属视觉噪音，拖慢阅读。
const CHANNEL_FIELD_DEFS = {
    recharge: [
        { label: '订单数', group: 'orderCount', local: 'orderCount', kind: 'count' },
        { label: '成功订单数', group: 'successCount', local: 'successCount', kind: 'count' },
        { label: '失败订单数', group: 'failCount', local: 'failCount', kind: 'count' },
        { label: '成功金额', group: 'successAmount', local: 'successAmount', kind: 'amount' }
    ],
    withdraw: [
        { label: '订单数', group: 'orderCount', local: 'orderCount', kind: 'count' },
        { label: '成功订单数', group: 'successCount', local: 'successCount', kind: 'count' },
        { label: '成功金额', group: 'successAmount', local: 'successAmount', kind: 'amount' }
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

/**
 * 2026-10-27用户用后台截图实测指出：channelId不是商户独占的——INR下的
 * 26001(ArUpi)同时被3004和范围外的3001使用，当天那笔差异其实是3001的
 * 真实订单，不是3004漏算。之前"[3004-26001] 本地=0 集团=6"这种标签容易
 * 让人误以为3004在这个渠道少算了6笔，必须补一句明确说明：共享币种下，
 * 如果本商户在这个渠道本来就是0笔，差异100%来自同币种下的其他商户，
 * 不是本商户数据遗漏；如果本商户有一部分，差额也可能包含别的商户的份额，
 * 不能直接断定是遗漏。strict(独占)币种不存在这个问题，不需要加说明。
 *
 * 2026-10-27第二轮用户反馈：之前只看localVal===0二选一文案，没管"差异
 * 方向"(local比group大还是小)、也没管集团是否压根没有这一行记录，结果
 * 两种真正异常的情况被误套上"可能来自其他商户"的说法——
 *   ①local>group：不可能是"其他商户叠加"造成的，叠加只会让集团数字
 *     更大，不会更小(集团汇总=本商户+其他商户，恒 >= 本商户自己的数)；
 *   ②集团该渠道完全没有记录(groupRowExists=false)：连"存在其他商户"
 *     这个前提都不成立，不是数字被占了，是压根没出现过。
 * 这两种情况都和"币种共享"无关，是真实需要排查的异常，由下面的
 * isChannelDiffReal()统一判定、提级进mismatches，不再被"仅供参考"掩盖。
 */
function channelDeviationNote(isStrict, lv, gv, groupRowExists) {
    if (!groupRowExists) return '集团压根没有这个渠道的记录(不是数字小，是完全没有)，不能用"其他商户"解释，需单独确认是否渠道归类/口径问题';
    if (lv > gv) return '本地反而比集团多，这种方向不可能是其他商户造成的(其他商户只会让集团数字更大)，是真实异常，需要排查';
    if (isStrict) return null;
    if (lv === 0) return '本商户在此渠道没有订单，这些数字全部来自同币种下的其他商户，不是数据遗漏';
    return '本商户在此渠道只有部分订单，差额可能来自同币种下的其他商户，不代表一定是遗漏';
}

/**
 * 决定一条渠道维度差异该计入mismatches(强校验失败/计入最终判定)还是
 * referenceOnlyDeviations(仅供参考)——不能只看商户币种是否独占(isStrict)：
 * 集团完全没这一行、或者local>group，这两种情况不管是否共享币种，都不是
 * "其他商户叠加"能解释的，一律当真异常处理；只有"local<group 且 币种
 * 共享"才是真正可以安心归因为噪音、放进"仅供参考"的场景。
 */
function isChannelDiffReal(isStrict, lv, gv, groupRowExists) {
    if (!groupRowExists) return true;
    if (lv > gv) return true;
    return isStrict;
}

/**
 * 把集团该币种下的渠道行，和本地按channelId分桶的数据逐一比较(取代旧的
 * sumChannelByCurrency整体加总对比)——双向收集channelId(集团有的∪本地
 * 有的)，这样"本地有统计但集团没这一行"或反过来，都能被发现，不会因为
 * 只遍历集团行而漏掉本地独有的渠道。返回值按channelId分组的明细行，供
 * printReport的per-tenant详细展示和diff摘要共用同一份数据，不会出现
 * "汇总对比"和"明细diff"两种粒度对不上号的问题。
 * @returns {Array<{channelId, channelName, fields: Array<{label, local, group, lv, gv, ok}>}>}
 */
function diffByChannel(currency, groupChannelRows, localByChannel, fieldDefs) {
    const rowsForCurrency = (groupChannelRows || []).filter(r => r.sysCurrency === currency);
    const groupByChannelId = new Map(rowsForCurrency.map(r => [String(r.channelId), r]));
    const allChannelIds = new Set([...groupByChannelId.keys(), ...Object.keys(localByChannel || {})]);

    const out = [];
    for (const channelId of Array.from(allChannelIds).sort()) {
        const groupRow = groupByChannelId.get(channelId);
        const localRow = (localByChannel || {})[channelId] || {};
        const fields = fieldDefs.map(f => {
            const lv = localRow[f.local] || 0;
            const gv = groupRow ? (parseFloat(groupRow[f.group]) || 0) : 0;
            const ok = f.kind === 'amount' ? amountClose(lv, gv) : lv === gv;
            return { label: f.label, local: f.local, lv, gv, ok };
        });
        // channelName不再塞"集团此渠道无记录"这种提示字符串占位(会导致
        // 展示层拼出"[3004-10474]((本地有订单，集团此渠道无记录))"这种
        // 双层括号)——groupRowExists单独带出"集团是否压根没有这一行"的
        // 事实，channelName为null时统一由展示层拼成"(集团无此渠道记录)"，
        // 详细原因交给note文案解释，不在名字字段里重复。
        out.push({ channelId, channelName: groupRow ? groupRow.channelName : null, groupRowExists: !!groupRow, fields });
    }
    return out;
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
        // 2026-10-27用户指出之前的摘要看不出是哪两个表对比的，必须明确标注；
        // 第三轮反馈：这句话不能带API名字/实现细节，要让非开发背景的人也看懂。
        const SRC_TENANT = '商户整体数据（本商户后台订单 vs 集团商户明细）';
        for (const f of COMPARE_FIELDS) {
            const lv = local[f.local];
            const gv = group[f.group];
            const ok = f.kind === 'amount' ? amountClose(lv, gv) : lv === gv;
            rows.push({ ok, label: f.label, field: f.local, localVal: lv, groupVal: gv });
            if (!ok) mismatches.push({ tenantId, source: SRC_TENANT, label: f.label, field: f.local, localVal: lv, groupVal: gv, diffVal: (typeof lv === 'number' && typeof gv === 'number') ? Math.abs(lv - gv) : null });
        }

        // 通道汇总维度：逐channelId精确对比(2026-10-27改为逐渠道，不再加总)。
        // 3006/3007币种独占，计入强校验(mismatches)；3004(INR)和不受控的3001
        // 共享，结果无论对错都只进referenceOnlyDeviations，不影响失败判定。
        // 本地这边只用"仅三方/仅归属渠道"按channelId分桶的数据(见
        // CHANNEL_FIELD_DEFS顶部注释)，不是该商户全部订单。
        const currency = CURRENCY_BY_TENANT[tenantId];
        const isStrict = STRICT_CURRENCY_TENANTS.has(tenantId);
        if (currency) {
            rows.push({ label: `── 通道明细（币种${currency}${isStrict ? '，独占可强校验' : '，与其他商户共享，仅供参考'}） ──` });
            const SRC_RCHANNEL = `充值通道对比（币种${currency}，本商户三方充值订单 vs 集团充值通道汇总）`;
            const SRC_WCHANNEL = `提现通道对比（币种${currency}，本商户三方提现订单 vs 集团提现通道汇总）`;

            const rByChannel = diffByChannel(currency, rchannel, local.rechargeThirdByChannel, CHANNEL_FIELD_DEFS.recharge);
            for (const ch of rByChannel) {
                rows.push({ label: `  充值渠道 ${ch.channelId} ${ch.channelName || '（集团无此渠道记录）'}` });
                for (const f of ch.fields) {
                    rows.push({ ok: f.ok, label: f.label, field: f.local, localVal: f.lv, groupVal: f.gv });
                    if (!f.ok) {
                        const real = isChannelDiffReal(isStrict, f.lv, f.gv, ch.groupRowExists);
                        const item = { tenantId, channelId: ch.channelId, channelName: ch.channelName, source: SRC_RCHANNEL, label: f.label, field: f.local, localVal: f.lv, groupVal: f.gv, diffVal: Math.abs(f.lv - f.gv), note: channelDeviationNote(isStrict, f.lv, f.gv, ch.groupRowExists) };
                        (real ? mismatches : referenceOnlyDeviations).push(item);
                    }
                }
            }

            const wByChannel = diffByChannel(currency, wchannel, local.withdrawAttributedByChannel, CHANNEL_FIELD_DEFS.withdraw);
            for (const ch of wByChannel) {
                rows.push({ label: `  提现渠道 ${ch.channelId} ${ch.channelName || '（集团无此渠道记录）'}` });
                for (const f of ch.fields) {
                    rows.push({ ok: f.ok, label: f.label, field: f.local, localVal: f.lv, groupVal: f.gv });
                    if (!f.ok) {
                        const real = isChannelDiffReal(isStrict, f.lv, f.gv, ch.groupRowExists);
                        const item = { tenantId, channelId: ch.channelId, channelName: ch.channelName, source: SRC_WCHANNEL, label: f.label, field: f.local, localVal: f.lv, groupVal: f.gv, diffVal: Math.abs(f.lv - f.gv), note: channelDeviationNote(isStrict, f.lv, f.gv, ch.groupRowExists) };
                        (real ? mismatches : referenceOnlyDeviations).push(item);
                    }
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
 * 数字格式化——整数不带小数点("差=1.00"这种对订单数/人数字段很不自然)，
 * 只有真的带小数的金额才保留2位。2026-10-27第三轮用户反馈专门针对
 * 可读性，".00"这类多余视觉噪音一并清理掉。
 */
function fmtNum(n) {
    if (n == null) return '';
    if (typeof n !== 'number') return String(n);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * 按source(数据来源对比关系)分组打印差异列表——2026-10-27用户指出：不分组
 * 平铺列出时，看不出每条差异具体是"本地"跟集团哪张表在比(商户明细？充值
 * 通道汇总？提现通道汇总？)。每个来源只打印一次完整说明，下面列具体字段，
 * 不用每行都重复一遍来源文字。
 *
 * 2026-10-27第三轮用户反馈("这种打印的结果，我能看懂？？")：纯文字堆叠、
 * 每行重复一遍完整的渠道标签、"差=1.00"这种格式，读起来很吃力。重写成：
 * 渠道名只在组标题出现一次，note紧跟标题换行展示一次，字段名对齐，数字
 * 用"本地X → 集团Y"代替生硬的"本地=X 集团=Y"，更符合阅读习惯。
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
        console.log(`\n  ▸ ${source}`);
        // 按渠道/商户二级分组——同一渠道下好几个字段有差异时，渠道名和
        // channelDeviationNote的说明只在该组第一行打印一次，不每个字段都重复。
        const byChannel = new Map();
        for (const m of list) {
            const key = m.channelId != null ? `${m.tenantId}-${m.channelId}` : m.tenantId;
            if (!byChannel.has(key)) byChannel.set(key, []);
            byChannel.get(key).push(m);
        }
        for (const groupItems of byChannel.values()) {
            const first = groupItems[0];
            const name = first.channelId != null
                ? `商户${first.tenantId} 渠道${first.channelId} ${first.channelName || '（集团无此渠道记录）'}`
                : `商户${first.tenantId}`;
            console.log(`    ${name}`);
            if (first.note) console.log(`      ⚠️ ${first.note}`);
            for (const m of groupItems) {
                const diffStr = m.diffVal != null ? `　(差 ${fmtNum(m.diffVal)})` : '';
                // 2026-10-27：这里混用了两种label来源——渠道维度的短名字(3~5字，
                // 如"订单数")和商户整体维度的长名字(6~9字，如"充值USDT成功金额")，
                // 固定padEnd宽度对短label够用、对长label不够(超过宽度就不填充，
                // 导致"充值成功人数"和后面的"本地"直接贴在一起)——改用冒号分隔，
                // 不管label多长都有明确间隔，不追求视觉对齐。
                console.log(`      ${m.label}：本地 ${fmtNum(m.localVal)}　→　集团 ${fmtNum(m.groupVal)}${diffStr}`);
            }
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
            console.log(`${mark} ${r.label.padEnd(10, '　')} | 本地: ${fmtNum(r.localVal)}  | 集团: ${fmtNum(r.groupVal)}`);
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log('📊 集团充提概览(按币种，口径不同不做强校验，数字仅供参考判断"大概合理")');
    console.log('─'.repeat(60));
    for (const currency of Object.keys(overviewRows)) {
        console.log(`\n──── 币种 ${currency} ${'─'.repeat(40)}`);
        for (const r of overviewRows[currency]) {
            if (r.field === undefined) { console.log(`   ${r.label}`); continue; }
            console.log(`📊 ${r.label.padEnd(10, '　')} | 商户明细累加: ${fmtNum(r.localVal)}  | 集团概览: ${fmtNum(r.groupVal)}`);
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
