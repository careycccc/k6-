/**
 * 三方成功率 数据源认证 —— 入口
 *
 * 口径：数据源平均通道率（state=1 且当天有充值的通道 day1Rate 求平均）
 *       == 报表当前最新时间节点的 thirdPartySuccessRate（同单位直接比，容差 RATE_TOL）
 *
 * 用法：
 *   k6 run -e TENANT_ID=3004 -e DATE=2026-07-28 runThirdPartyRate.test.js
 *   容差用 -e RATE_TOL=0.01 调整。
 */
import { check } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { verifyThirdPartyRate } from './thirdPartyRate.js';

export const options = {
    scenarios: { rate_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' } },
};

const RATE_TOL = parseFloat(__ENV.RATE_TOL || '0.01');

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    if (tenantId !== '3004') { const env = getEnvByTenantId(tenantId); if (env) Object.assign(ENV_CONFIG, env); }
    const token = AdminLogin();
    if (!token) throw new Error('[ThirdPartyRate] 管理员登录失败');
    return { token, date: __ENV.DATE || todayStr(), tenantId };
}

export default function (data) {
    if (data.tenantId !== '3004') { const env = getEnvByTenantId(data.tenantId); if (env) Object.assign(ENV_CONFIG, env); }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  三方成功率 数据源认证   日期=${data.date}   容差=${RATE_TOL}`);
    console.log(`${'='.repeat(70)}`);

    const r = verifyThirdPartyRate(data.token, data.date, RATE_TOL);
    if (!r) { console.error('❌ 认证失败：数据源或报表获取失败'); return; }

    console.log(`state=1 通道 ${r.src.totalChannels} 个，当天有充值(计入) ${r.src.activeCount} 个：`);
    r.src.rows.forEach(row => {
        const mark = row.day1Count > 0 ? '✅计入' : '  跳过';
        console.log(`  ${mark}  ${row.channelId}  ${row.name}  day1Rate=${row.day1Rate}  day1Count=${row.day1Count}`);
    });

    console.log(`\n数据源平均通道率 = ${r.avgRate}`);
    console.log(`报表 thirdPartySuccessRate（最新节点 ${r.reportTimeNode || '无'}）= ${r.reportRate}`);
    console.log(`差值 = ${r.diff.toFixed(6)}   ${r.ok ? '✅ 一致' : '❌ 不一致'}`);
    console.log(`${'='.repeat(70)}\n`);

    check(r, { '三方成功率: 数据源 == 报表最新节点': (x) => x.ok });
}
