/**
 * FB广告分析 Tab3「充值分析」核对
 *
 * D0复充档位(当天首充的会员，窗口=当天)直接用本地 d0RechargeCount 统计——这是
 * 造数脚本自己产生的数据，本地记录即事实，不需要查后端。按 --group-by 分组
 * (campaign/adset/ad/all)展示：注册数/首充数(新增付费)/D0复充档位(≥2/≥3/≥4/≥5/≥10)人数。
 *
 * TODO(接口ready后): 当前累计复充档位(不只D0当天，窗口=注册至今全部历史) 需要查
 * 后端全部历史充值订单——本地状态没有"注册日之后新发生的充值"数据，必须查后端；
 * 新增付费率/ARPPU这几个字段涉及除法和四舍五入规则，口径未必和这里的算法完全一致，
 * 接口ready后只做数字并排展示、不判定一致性。
 *
 * 运行（在本目录内）：
 *   k6 run -e TENANT_ID=3004 -e GROUP_BY=campaign verifyRecharge.js
 */

/* global open */

const TENANT_ID = __ENV.TENANT_ID || '3004';
const GROUP_BY = __ENV.GROUP_BY || 'all'; // campaign/adset/ad/all
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

const REPEAT_TIER_THRESHOLDS = [2, 3, 4, 5, 10];

let ACCOUNTS = [];
try {
    ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.warn(`[VerifyRecharge] ⚠️ 读取本地状态 ${STATE_FILE} 失败: ${e.message}`);
}

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' } }
};

function groupLabel(acc) {
    const combo = acc.adCombo || {};
    if (GROUP_BY === 'campaign') return `${combo.campaignId}(${combo.campaignName})`;
    if (GROUP_BY === 'adset') return `${combo.adSetId}(${combo.adSetName})`;
    if (GROUP_BY === 'ad') return `${combo.adId}(${combo.adName})`;
    return '全部';
}

function groupAccounts(accounts) {
    const groups = new Map();
    for (const acc of accounts) {
        const label = groupLabel(acc);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(acc);
    }
    return groups;
}

/** 事后去重统计：≥3必然也计入≥2，累计口径不互斥 */
function computeRepeatTierCounts(accounts) {
    return REPEAT_TIER_THRESHOLDS.map(threshold => ({
        threshold,
        count: accounts.filter(acc => (acc.d0RechargeCount || 0) >= threshold).length
    }));
}

export default function () {
    console.log(`\n${'═'.repeat(75)}`);
    console.log(`  📊 FB广告充值分析核对 | 租户=${TENANT_ID} | 分组=${GROUP_BY}`);
    console.log(`${'═'.repeat(75)}`);
    console.log(`  ℹ️  D0复充档位=本地数据(即事实)；累计复充/新增付费率/ARPPU等待接口ready后补`);

    if (ACCOUNTS.length === 0) {
        console.log('\n  (本地没有造数记录，先跑 fbAdSeedRunner.js 造一些数据)\n');
        return;
    }

    const groups = groupAccounts(ACCOUNTS);

    for (const [label, accounts] of groups) {
        const registerCount = accounts.length;
        const firstPayCount = accounts.filter(acc => (acc.d0RechargeCount || 0) > 0).length;
        const totalRechargeAmount = accounts.reduce((s, acc) => s + (acc.d0RechargeTotalAmount || 0), 0);
        const newPayingRatePct = registerCount ? (100 * firstPayCount / registerCount) : 0;
        const d0Arppu = firstPayCount ? (totalRechargeAmount / firstPayCount) : 0;

        console.log(`\n  ── ${label} ──────────────────────────────────────────`);
        console.log(`     注册数        : ${registerCount}`);
        console.log(`     首充数(新增付费): ${firstPayCount}`);
        console.log(`     新增付费率     : ${newPayingRatePct.toFixed(2)}%`);
        console.log(`     D0 ARPPU       : ${d0Arppu.toFixed(2)}`);

        const tiers = computeRepeatTierCounts(accounts);
        const tierStr = tiers.map(t => `≥${t.threshold}充=${t.count}`).join('  ');
        console.log(`     D0复充档位     : ${tierStr}`);
        console.log(`     ℹ️  当前累计复充档位: TODO(接口ready后) — 需查后端全部历史订单`);
    }

    console.log(`\n${'═'.repeat(75)}\n`);
}
