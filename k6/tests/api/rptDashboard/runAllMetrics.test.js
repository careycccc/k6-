/**
 * 全字段数据源认证 —— 入口（最新节点汇总 + 逐节点检查）
 *
 *   k6 run -e TENANT_ID=3004 -e DATE=2026-07-29 runAllMetrics.test.js
 *
 * 输出两段：
 *   ① 最新节点汇总：源（累计到报表最新节点）vs 报表最新节点，逐字段 ✅/❌
 *   ② 逐节点检查：00:00~现在每个 5 分钟节点都比，列出不一致的节点
 *
 * 环境变量：
 *   DATE       认证日期（默认今天；建议认证已结束的日期如昨天，避免结算/漂移噪声）
 *   SHOW       逐节点每字段最多打印几个不一致节点（默认 8）
 *   NODES=off  只跑最新节点汇总，跳过逐节点检查
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { verifyAllMetrics, verifyAllNodes } from './sourceMetrics.js';

export const options = { scenarios: { all_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } } };

const SHOW = parseInt(__ENV.SHOW || '8', 10);
const RUN_NODES = (__ENV.NODES || '').toLowerCase() !== 'off';

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    if (tenantId !== '3004') { const e = getEnvByTenantId(tenantId); if (e) Object.assign(ENV_CONFIG, e); }
    const token = AdminLogin();
    if (!token) throw new Error('管理员登录失败');
    return { token, date: __ENV.DATE || todayStr(), tenantId };
}

export default function (data) {
    if (data.tenantId !== '3004') { const e = getEnvByTenantId(data.tenantId); if (e) Object.assign(ENV_CONFIG, e); }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`  实时数据统计报表 · 全字段数据源认证   日期=${data.date}`);
    console.log(`${'='.repeat(80)}`);
    if (data.date === todayStr()) {
        console.log(`⚠️ 注意：正在认证「今天」。按天粒度/结算类字段(登录/活动/盈亏)会累计到当前时刻，`);
        console.log(`   而报表最新节点每5分钟才刷新，两者会有几分钟的漂移。建议认证已结束的日期(如昨天)。`);
    }

    // ══════════════ ① 最新节点汇总 ══════════════
    console.log(`\n──── ① 最新节点汇总 ────`);
    const r = verifyAllMetrics(data.token, data.date, data.tenantId);
    if (!r) { console.error('❌ 报表或源数据获取失败'); return; }

    console.log(`对齐时间节点 = ${r.timeNode}（源数据累计到此刻）\n`);
    r.rows.forEach(row => {
        let icon;
        if (row.ok === null) icon = 'ℹ️';
        else icon = row.ok ? '✅' : '❌';
        const diff = (row.ok === false) ? `  ← 差 ${(row.src - row.rpt).toFixed(2)}` : '';
        console.log(`${icon} ${row.name.padEnd(9)} (${row.field.padEnd(23)}) | 源: ${String(row.src).padStart(12)} | 报表: ${String(row.rpt).padStart(12)}${diff}`);
        if (row.ok !== null) check(row, { [`[最新节点] ${row.name} 源==报表`]: (x) => x.ok });
    });

    if (!RUN_NODES) { console.log(`${'='.repeat(80)}\n`); return; }

    // ══════════════ ② 逐节点检查 ══════════════
    console.log(`\n──── ② 逐节点检查（每 5 分钟）────`);
    const n = verifyAllNodes(data.token, data.date, data.tenantId);
    if (!n) { console.error('❌ 逐节点：报表或源数据获取失败'); console.log(`${'='.repeat(80)}\n`); return; }

    console.log(`共 ${n.nodeCount} 个时间节点（${n.firstNode} ~ ${n.lastNode}）：\n`);
    const checks = n.fields.filter(f => f.mode !== 'info');
    const infos  = n.fields.filter(f => f.mode === 'info');

    let cleanFields = 0;
    checks.forEach(f => {
        if (f.bad === 0) {
            cleanFields++;
            console.log(`✅ ${f.name.padEnd(9)} (${f.field.padEnd(23)}) 全部 ${f.total} 个节点一致`);
        } else {
            console.log(`❌ ${f.name.padEnd(9)} (${f.field.padEnd(23)}) ${f.total - f.bad}/${f.total} 一致，${f.bad} 个节点不一致：`);
            f.mismatches.slice(0, SHOW).forEach(m => console.log(`      ${m.timeNode}  源=${m.src}  报表=${m.rpt}  (差 ${(m.src - m.rpt).toFixed(2)})`));
            if (f.bad > SHOW) console.log(`      ...还有 ${f.bad - SHOW} 个节点`);
        }
        check(f, { [`[逐节点] ${f.name} 全节点一致`]: (x) => x.bad === 0 });
    });

    if (infos.length) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`ℹ️ 以下字段仅展示，不判定（登录源仅有 lastLoginTime / 活动报表按特定节点结算）：`);
        infos.forEach(f => console.log(`ℹ️ ${f.name.padEnd(9)} (${f.field.padEnd(23)}) ${f.total - f.bad}/${f.total} 一致`));
    }

    console.log(`\n逐节点汇总：判定字段 ${checks.length} 个，其中 ${cleanFields} 个全节点一致，${checks.length - cleanFields} 个存在不一致节点；另有 ${infos.length} 个仅展示`);
    console.log(`${'='.repeat(80)}\n`);
}
