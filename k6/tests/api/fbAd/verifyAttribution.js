/**
 * FB广告分析 Tab1「广告归因记录」核对
 *
 * 读本地造数状态(state/accounts_<tenantId>.ndjson)，按 userId 逐行列出
 * campaignId/adSetId/adId。
 *
 * TODO(接口ready后): 后端归因记录查询接口（如 /api/RptFbAd/GetAttributionPageList，
 * 具体路径/字段以实际接口文档为准，不要在接口未定义前编造字段名）按 userId 翻页查询，
 * 填入 backendCombo 并和本地 adCombo 逐字段比对，输出判定（一致/不一致/后端查不到）。
 *
 * 运行（在本目录内）：
 *   k6 run -e TENANT_ID=3004 verifyAttribution.js
 */

/* global open */

const TENANT_ID = __ENV.TENANT_ID || '3004';
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

let ACCOUNTS = [];
try {
    ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.error(`[VerifyAttribution] ❌ 读取本地状态 ${STATE_FILE} 失败: ${e.message}`);
}

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' } }
};

export default function () {
    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  📊 FB广告归因记录核对 | 租户=${TENANT_ID} | 共 ${ACCOUNTS.length} 条本地记录`);
    console.log(`${'═'.repeat(75)}\n`);

    if (ACCOUNTS.length === 0) {
        console.log('  (本地没有造数记录，先跑 fbAdSeedRunner.js 造一些数据)');
        return;
    }

    ACCOUNTS.forEach(acc => {
        const combo = acc.adCombo || {};
        console.log(`  ── userId=${acc.userId}  账号=${acc.account}  注册日=${acc.registerDate} ──────────`);
        console.log(`     广告系列: ${combo.campaignId}(${combo.campaignName})`);
        console.log(`     广告组  : ${combo.adSetId}(${combo.adSetName})`);
        console.log(`     广告    : ${combo.adId}(${combo.adName})`);
        console.log(`     ℹ️  后端比对: TODO(接口ready后) — 暂无归因记录查询接口可核对`);
    });

    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  ✅ 共展示 ${ACCOUNTS.length} 条本地记录（尚无后端判定，接口ready后补）`);
    console.log(`${'═'.repeat(75)}\n`);
}
