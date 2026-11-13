/**
 * 探测工具：查看TEST(3004)环境「渠道来源分析」(GetPackageAnalysis)里
 * 当前实际存在哪些 packageId/packageName 组合——为"多渠道造数公共工具"
 * 摸清楚 packageId 和 官网/wheel/adjust/facebook/tiktok 这几个渠道名
 * 之间的对应关系，不发起任何造数动作，纯只读探测。
 *
 * 运行：k6p -e TENANT_ID=3004 probeChannelPackageMapping.js
 *       k6p -e TENANT_ID=3004 -e DATE=2026-11-12 probeChannelPackageMapping.js
 *       k6p -e TENANT_ID=3004 -e DAYS=30 probeChannelPackageMapping.js   查最近30天范围内出现过的全部包
 */
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest } from '../common/request.js';
import { getDayRange, dateStartTs, dateEndTs, getTzOffsetMs } from '../../../libs/common/time.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const TAG = 'ProbePackageMapping';

export const options = {
    scenarios: { probe: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '5m' } }
};

function resolveDates() {
    if (__ENV.DATE) return [__ENV.DATE];
    const days = __ENV.DAYS ? parseInt(__ENV.DAYS, 10) : 1;
    const tzOffsetMs = getTzOffsetMs(TENANT_ID);
    const dates = [];
    for (let i = 0; i < days; i++) {
        const r = getDayRange(i, TENANT_ID);
        dates.push(r.dateStr);
    }
    return dates;
}

export default function () {
    const adminToken = tenantAdminLogin(TENANT_ID, true);
    if (!adminToken) { console.error(`[${TAG}] 后台登录失败`); return; }

    const dates = resolveDates();
    console.log(`[${TAG}] 租户=${TENANT_ID} 探测日期范围: ${dates.join(', ')}`);

    const seen = new Map();
    const packageIdFilter = __ENV.PACKAGE_ID ? __ENV.PACKAGE_ID.split(',').map(s => parseInt(s.trim(), 10)) : null;
    for (const dateStr of dates) {
        const payload = { startTime: dateStr, endTime: dateStr, pageNo: 1, pageSize: 50, orderBy: 'Desc', sortField: 'reportDate' };
        if (packageIdFilter) payload.packageIds = packageIdFilter;
        const res = sendRequest(
            payload,
            '/api/RptDataAnalysis/GetPackageAnalysis', TAG, false, adminToken, true
        );
        const summary = (res && res.summary) || [];
        console.log(`[${TAG}] ${dateStr} summary共${summary.length}行`);
        for (const row of summary) {
            const key = `${row.packageId}::${row.packageName}`;
            if (!seen.has(key)) {
                seen.set(key, row);
                console.log(`[${TAG}]   packageId=${row.packageId} packageName="${row.packageName}" 原始行=${JSON.stringify(row)}`);
            }
        }
    }

    console.log(`\n${'='.repeat(70)}\n  汇总：共发现 ${seen.size} 个不同的 packageId/packageName 组合\n${'='.repeat(70)}`);
    for (const [key, row] of seen) {
        console.log(`[${TAG}] -> packageId=${row.packageId}  packageName="${row.packageName}"`);
    }
}
