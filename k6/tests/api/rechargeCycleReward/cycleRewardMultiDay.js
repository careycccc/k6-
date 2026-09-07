/**
 * 充值循环奖励 —— 找「多天都有奖励记录」的会员（独立脚本）
 *
 * 用途：循环充值每天都对同一批会员充值，正常这些人每天都会生成奖励记录。
 *       本脚本在指定日期范围内拉取活动记录(GetRecordPageList)，按 userId 统计
 *       其出现的不同 rewardDate 天数，筛出「≥ MIN_DAYS 天都有记录」的会员。
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e START_DATE=2026-09-01 -e END_DATE=2026-09-03 cycleRewardMultiDay.js
 *
 * 参数（-e）：
 *   TENANT_ID   租户ID（默认 3004）
 *   START_DATE  起始奖励日 YYYY-MM-DD（必需）
 *   END_DATE    结束奖励日 YYYY-MM-DD（必需）
 *   MIN_DAYS    至少出现的天数（默认 2 = 2天及以上）
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { sendRequest } from '../common/request.js';

const TAG = 'CycleMultiDay';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const START_DATE = __ENV.START_DATE;
const END_DATE = __ENV.END_DATE;
const MIN_DAYS = parseInt(__ENV.MIN_DAYS || '2', 10);

export const options = {
    scenarios: {
        cycle_reward_multiday: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        }
    }
};

// ================= 数据拉取（翻页 + orderNo 去重） =================

function extractList(res) {
    if (!res) return [];
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.list)) return res.list;
    return [];
}
function extractTotalPage(res) {
    if (!res) return 1;
    if (res.totalPage) return res.totalPage;
    if (res.data && res.data.totalPage) return res.data.totalPage;
    return 1;
}
function extractTotalCount(res) {
    if (!res) return null;
    if (res.totalCount != null) return res.totalCount;
    if (res.data && res.data.totalCount != null) return res.data.totalCount;
    return null;
}

/** 拉取 [startDate, endDate] 范围内所有奖励记录（按 orderNo 去重，防翻页重叠/遗漏） */
function fetchRecordsRange(adminToken, startDate, endDate) {
    const api = '/api/RechargeCycleReward/GetRecordPageList';
    const byOrderNo = {};
    let pageNo = 1;
    let totalCount = null;
    while (true) {
        const payload = { startRewardDate: startDate, endRewardDate: endDate, pageNo, pageSize: 2000, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, adminToken);
        const list = extractList(res);
        for (const r of list) { if (r.orderNo) byOrderNo[r.orderNo] = r; }
        if (totalCount == null) totalCount = extractTotalCount(res);
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    const got = Object.keys(byOrderNo).length;
    if (totalCount != null && got !== totalCount) {
        console.warn(`[${TAG}] ⚠️ 去重后 ${got} 条 ≠ 后台 totalCount ${totalCount}，可能翻页遗漏，建议加大 pageSize`);
    }
    return Object.values(byOrderNo);
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[${TAG}] ========== 找多天有记录的会员 ${START_DATE} ~ ${END_DATE} 租户=${TENANT_ID} ==========`);

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!START_DATE || !END_DATE || !dateRe.test(START_DATE) || !dateRe.test(END_DATE)) {
        throw new Error(`[${TAG}] ❌ 必须提供 -e START_DATE=YYYY-MM-DD -e END_DATE=YYYY-MM-DD`);
    }

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);

    return { token: adminToken, envConfig };
}

export default function (data) {
    const { token: adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    // 1. 拉取日期范围内全部记录
    console.log(`[${TAG}] 拉取 ${START_DATE} ~ ${END_DATE} 奖励记录...`);
    const records = fetchRecordsRange(adminToken, START_DATE, END_DATE);
    console.log(`[${TAG}] 共 ${records.length} 条记录`);

    // 2. 按 userId 收集出现的不同 rewardDate
    const daysByUser = {}; // userId → Set(rewardDate)
    for (const r of records) {
        const uid = Number(r.userId);
        if (!daysByUser[uid]) daysByUser[uid] = {};
        daysByUser[uid][r.rewardDate] = true;
    }

    // 3. 筛出 ≥ MIN_DAYS 天的会员
    const multi = [];
    Object.keys(daysByUser).forEach(uid => {
        const dates = Object.keys(daysByUser[uid]);
        if (dates.length >= MIN_DAYS) {
            multi.push({ userId: Number(uid), dayCount: dates.length, dates: dates.sort() });
        }
    });
    multi.sort((a, b) => b.dayCount - a.dayCount || a.userId - b.userId);

    // 4. 报表
    printReport(records.length, Object.keys(daysByUser).length, multi);
}

// ================= 报表（逐行 console.log） =================

function printReport(totalRecords, totalMembers, multi) {
    const dline = '═'.repeat(60);
    const sline = '─'.repeat(60);
    console.log('');
    console.log(dline);
    console.log(`  📊 多天有记录的会员   ${START_DATE} ~ ${END_DATE}   租户=${TENANT_ID}`);
    console.log(dline);
    console.log(`  日期范围内记录总数 : ${totalRecords}`);
    console.log(`  涉及会员总数       : ${totalMembers}`);
    console.log(`  ≥${MIN_DAYS} 天有记录的会员  : ${multi.length}`);
    console.log(sline);
    if (multi.length > 0) {
        multi.forEach(m => {
            console.log(`  userId=${m.userId} : ${m.dayCount} 天  [${m.dates.join(', ')}]`);
        });
    } else {
        console.log(`  （没有会员达到 ≥${MIN_DAYS} 天）`);
    }
    console.log(dline);
    console.log('');
}
