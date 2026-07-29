/**
 * 数据源认证（注册/充值/提现）—— 入口
 * k6 run -e TENANT_ID=3004 -e DATE=2026-07-28 runBaseMetrics.test.js
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { verifyBaseMetrics } from './sourceMetrics.js';

export const options = { scenarios: { base_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } } };

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

    console.log(`\n${'='.repeat(72)}`);
    console.log(`  数据源认证（注册/充值/提现）  日期=${data.date}`);
    console.log(`${'='.repeat(72)}`);

    const r = verifyBaseMetrics(data.token, data.date, data.tenantId);
    if (!r) { console.error('❌ 报表或源数据获取失败'); return; }

    console.log(`对齐时间节点 = ${r.timeNode}（源数据累计到此刻）\n`);
    r.rows.forEach(row => {
        const icon = row.ok ? '✅' : '❌';
        const diff = row.ok ? '' : `  ← 差 ${(row.src - row.rpt).toFixed(2)}`;
        console.log(`${icon} ${row.name.padEnd(6)} (${row.field.padEnd(18)}) | 源: ${String(row.src).padStart(12)} | 报表: ${String(row.rpt).padStart(12)}${diff}`);
        check(row, { [`${row.name} 源==报表`]: (x) => x.ok });
    });
    console.log(`${'='.repeat(72)}\n`);
}
