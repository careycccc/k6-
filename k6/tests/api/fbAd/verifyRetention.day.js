/**
 * FB广告分析 Tab2「留存分析」(登录留存) 核对 —— k6脚本（配合 verifyRetentionRunner.js 使用）
 *
 * 当前(接口ready前)实现：直接读本地造数状态(state/accounts_<tenantId>.ndjson)，
 * 按 --group-by 分组，用每个账号自己的 loginRetentionDone 数组回放"是否留存"——
 * 这只是本地自检(造数脚本自己触发的登录才会被记录)，不是后端权威数据源。
 *
 * TODO(接口ready后): 按天查 /api/RptUserInfo/GetUserLoginLogPageList 判定"某账号
 * 某天是否真的登录过"（单线程串行查询，不能用 http.batch 并发——后台查询接口高并发
 * 会软降级返空，这是已验证过的平台限制，照抄 retentionLoginVerify.js 的 fetchLoginUsers
 * 单线程翻页写法）。切换到这个数据源后，要按 targetDate 缓存结果供多个分组复用，不要
 * 让每个分组各自重复查询同一天。LTV 的 D0 窗口可用本地 d0RechargeTotalAmount 过渡，
 * D3及以上必须等接口。
 *
 * 用法（在本目录内运行，推荐走 Runner 拿汇总报表）：
 *   k6 run -e TENANT_ID=3004 -e GROUP_BY=campaign verifyRetention.day.js
 *   node verifyRetentionRunner.js --tenant 3004 --group-by campaign
 */

/* global open */

import { getDayRange } from '../../../libs/common/time.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const GROUP_BY = __ENV.GROUP_BY || 'all'; // campaign/adset/ad/all
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

const RETENTION_N_LIST = [1, 3, 5, 7, 15, 30, 60, 90];

let ACCOUNTS = [];
try {
    ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.warn(`[VerifyRetention] ⚠️ 读取本地状态 ${STATE_FILE} 失败: ${e.message}`);
}

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' } }
};

// ================= 分组 =================

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

/** YYYY-MM-DD 字符串加 n 天（纯 UTC 日期运算） */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    const pad2 = v => String(v).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export default function () {
    const today = getDayRange(0, TENANT_ID).dateStr;
    console.log(`##R## 租户=${TENANT_ID} 分组=${GROUP_BY} 本地账号数=${ACCOUNTS.length} 今天=${today}`);

    const groups = groupAccounts(ACCOUNTS);

    for (const [label, accounts] of groups) {
        console.log(`##GROUP##${label}|${accounts.length}`);
        for (const n of RETENTION_N_LIST) {
            // 到期 = registerDate+n < today（照抄 pkg/retention 的"昨天及更早才算到期"口径）
            const eligible = accounts.filter(acc => addDays(acc.registerDate, n) < today);
            if (eligible.length === 0) continue; // 这个N还没有任何账号到期，不输出(避免一堆"未到期"噪音行)
            const retained = eligible.filter(acc => (acc.loginRetentionDone || []).includes(n));
            const ratePct = eligible.length ? (100 * retained.length / eligible.length) : 0;
            console.log(`##N##${label}|${n}|${eligible.length}|${retained.length}|${ratePct.toFixed(2)}`);
        }
    }
}
