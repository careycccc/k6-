/**
 * 全字段数据源认证 —— 入口
 * k6 run -e TENANT_ID=3004 -e DATE=2026-07-28 runAllMetrics.test.js
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { verifyAllMetrics } from './sourceMetrics.js';

export const options = { scenarios: { all_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } } };

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

    console.log(`\n${'='.repeat(78)}`);
    console.log(`  实时数据统计报表 · 全字段数据源认证   日期=${data.date}`);
    console.log(`${'='.repeat(78)}`);
    if (data.date === todayStr()) {
        console.log(`⚠️ 注意：正在认证「今天」。按天粒度的源接口(登录/活动/游戏/盈亏)会累计到当前时刻，`);
        console.log(`   而报表最新节点每5分钟才刷新，两者会有几分钟的漂移。建议认证已结束的日期(如昨天)。`);
    }

    const r = verifyAllMetrics(data.token, data.date, data.tenantId);
    if (!r) { console.error('❌ 报表或源数据获取失败'); return; }

    console.log(`对齐时间节点 = ${r.timeNode}（源数据累计到此刻）\n`);
    let pass = 0, fail = 0, info = 0;
    r.rows.forEach(row => {
        let icon;
        if (row.ok === null) { icon = 'ℹ️'; info++; }
        else if (row.ok) { icon = '✅'; pass++; }
        else { icon = '❌'; fail++; }
        const diff = (row.ok === false) ? `  ← 差 ${(row.src - row.rpt).toFixed(2)}` : '';
        console.log(`${icon} ${row.name.padEnd(9)} (${row.field.padEnd(23)}) | 源: ${String(row.src).padStart(12)} | 报表: ${String(row.rpt).padStart(12)}${diff}`);
        if (row.ok !== null) check(row, { [`${row.name} 源==报表`]: (x) => x.ok });
    });
    console.log(`\n汇总：✅ ${pass}  ❌ ${fail}  ℹ️ ${info}(仅展示)`);
    console.log(`${'='.repeat(78)}\n`);
}
