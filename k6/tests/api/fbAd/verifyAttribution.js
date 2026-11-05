/**
 * FB广告分析 Tab1「广告归因记录」核对 —— 只读
 *
 * Tab1 的目的是校验"造数时指定的归因，后端是不是原样记录了"，所以这里本地造数状态
 * (state/accounts_<tenantId>.ndjson，是我们注册时指定的归因)是比对的一方，被测的是后端
 * /api/RptFbAd/GetAttributionPageList。照 k6-go pkg/fbad/verifyattribution.go 的思路，
 * 但覆盖面更宽：
 *
 *   对每个本地造数账号(只看注册日>=数据起点的)，按 userId 在后端归因表里找，逐项比对：
 *     · 归因6字段：campaignId/campaignName/adsetId/adsetName/adId/adName 与注册时指定的一致
 *       (同时也是"归因不可变"的被动检查——账号之后登录/充值多少次，归因都不该变)
 *     · 渠道来源：后端 packageName == 本地 fbChannel.channelName
 *       (老记录没有 fbChannel 字段，按 fb419 处理——那时只造过这一个渠道)
 *     · 注册时间：registerTime 落在本地 registerDate(租户时区自然日)
 *     · 首充时间：本地有首充(firstRechargeDate / d0RechargeCount>0)时后端 firstRechargeTime
 *       必须非 null 且落在首充日；本地没首充过时后端必须是 null
 *   后端有、本地没有的账号(共用环境里别人造的)不判定，只统计数量。
 *
 * 数据起点：fbAdConfig.FBAD_DATA_START_DATE(2026-11-03)，可 -e START_DATE= 覆盖；更早的不管。
 * 止点：默认到今天，可用 -e END_DATE= 收窄成和后台 UI「注册时间」筛选框一样的闭区间
 * [START_DATE, END_DATE]——比如只想核对 11-03 这一天，传 START_DATE=END_DATE=2026-11-03。
 * 判定结果用 k6 check + threshold 表达：有任何不一致则 k6 退出码非 0。全程只读。
 *
 * 用法（在本目录内运行）：
 *   k6p -e TENANT_ID=3004 verifyAttribution.js
 *   k6p -e TENANT_ID=3004 -e START_DATE=2026-11-03 verifyAttribution.js -q          # 11-03起到今天
 *   k6p -e TENANT_ID=3004 -e START_DATE=2026-11-04 -e END_DATE=2026-11-04 verifyAttribution.js -q  # 只看11-03一天
 */

/* global open */

import { check } from 'k6';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getDayRange, getTzOffsetMs } from '../../../libs/common/time.js';
import { FBAD_DATA_START_DATE } from './fbAdConfig.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const START_DATE = __ENV.START_DATE || FBAD_DATA_START_DATE;
const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

let ACCOUNTS = [];
try {
    ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.error(`[VerifyAttribution] 读取本地状态 ${STATE_FILE} 失败: ${e.message}`);
}

export const options = {
    scenarios: { v: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } },
    thresholds: { checks: ['rate==1'] }
};

export function setup() {
    const today = getDayRange(0, TENANT_ID).dateStr;
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[VerifyAttribution] 租户 ${TENANT_ID} 管理员登录失败`);
    return { today, adminToken };
}

function fetchAttribution(token, startTime, endTime) {
    const rows = [];
    for (let pageNo = 1; pageNo <= 200; pageNo++) {
        let d = null;
        for (let i = 0; i < 3 && !d; i++) {
            const r = tenantRequest('/api/RptFbAd/GetAttributionPageList', { startTime, endTime, pageNo, pageSize: 100 }, { token, isDesk: false });
            if (r && r.msgCode === 0 && r.data) d = r.data;
        }
        if (!d) throw new Error(`[VerifyAttribution] 查询归因记录失败(第${pageNo}页)`);
        const list = d.list || [];
        rows.push(...list);
        if (list.length === 0 || pageNo >= (d.totalPage || 1)) break;
    }
    return rows;
}

export default function (data) {
    const { today, adminToken } = data;
    const END_DATE = __ENV.END_DATE || today;
    const tzMs = getTzOffsetMs(TENANT_ID);
    const dayOf = ms => new Date(ms + tzMs).toISOString().slice(0, 10);

    const local = ACCOUNTS.filter(a => a.registerDate >= START_DATE && a.registerDate <= END_DATE);
    console.log(`\n${'═'.repeat(88)}`);
    console.log(`  📊 FB广告归因记录核对(Tab1) | 租户=${TENANT_ID} | 数据区间=${START_DATE}~${END_DATE} | 本地造数账号(区间内)=${local.length}个`);
    console.log(`${'═'.repeat(88)}`);
    if (local.length === 0) {
        console.log('  (本地没有这个区间内的造数记录，先跑 fbAdSeedRunner.js 造数据，或检查 START_DATE/END_DATE)');
        return;
    }

    // 归因表按注册时间过滤：查 [START_DATE, END_DATE] 即可覆盖这个区间内注册的本地账号
    const backendRows = fetchAttribution(adminToken, START_DATE, END_DATE);
    const byUser = new Map();
    for (const r of backendRows) byUser.set(Number(r.userId), r);
    const localIds = new Set(local.map(a => Number(a.userId)));
    const backendOnly = backendRows.filter(r => !localIds.has(Number(r.userId))).length;

    const stat = { ok: 0, bad: 0, missing: 0 };
    const chStat = {};
    for (const acc of local) {
        const row = byUser.get(Number(acc.userId));
        const combo = acc.adCombo || {};
        const wantChannel = (acc.fbChannel && acc.fbChannel.channelName) || 'fb419';
        chStat[wantChannel] = chStat[wantChannel] || { n: 0, ok: 0 };
        chStat[wantChannel].n++;

        if (!row) {
            stat.missing++;
            check(null, { '本地造数账号在后端归因表里都能找到': () => false });
            console.log(`  ❌ userId=${acc.userId} 账号=${acc.account} 注册日=${acc.registerDate}  后端归因表里没有这个人`);
            continue;
        }

        const problems = [];
        const cmpField = (name, want, got) => { if (String(want) !== String(got)) problems.push(`${name}: 期望=${want} 后端=${got}`); };
        cmpField('campaignId', combo.campaignId, row.campaignId);
        cmpField('campaignName', combo.campaignName, row.campaignName);
        cmpField('adsetId', combo.adSetId, row.adsetId);
        cmpField('adsetName', combo.adSetName, row.adsetName);
        cmpField('adId', combo.adId, row.adId);
        cmpField('adName', combo.adName, row.adName);
        cmpField('渠道来源(packageName)', wantChannel, row.packageName);

        const regDay = dayOf(row.registerTime);
        if (regDay !== acc.registerDate) problems.push(`注册日: 期望=${acc.registerDate} 后端=${regDay}`);

        const wantFirstDate = acc.firstRechargeDate || (acc.d0RechargeCount > 0 ? acc.registerDate : null);
        if (wantFirstDate) {
            if (!row.firstRechargeTime) problems.push(`首充时间: 本地首充日=${wantFirstDate} 但后端是 null`);
            else if (dayOf(row.firstRechargeTime) !== wantFirstDate) problems.push(`首充日: 期望=${wantFirstDate} 后端=${dayOf(row.firstRechargeTime)}`);
        } else if (row.firstRechargeTime) {
            // 本地没记录过首充，但后端有首充时间：可能是别人给这个账号充过值(共用环境)，不算归因错误，只提示
            console.log(`  ℹ️  userId=${acc.userId} 本地没有首充记录，后端 firstRechargeTime=${dayOf(row.firstRechargeTime)}(可能被别人充过值，不算归因错误)`);
        }

        const pass = problems.length === 0;
        check(null, { '归因记录与造数时指定的一致': () => pass });
        if (pass) { stat.ok++; chStat[wantChannel].ok++; } else {
            stat.bad++;
            console.log(`  ❌ userId=${acc.userId} 账号=${acc.account} 注册日=${acc.registerDate} 渠道=${wantChannel}`);
            problems.forEach(p => console.log(`       - ${p}`));
        }
    }

    console.log(`\n  各渠道一致情况：${Object.keys(chStat).map(c => `${c} ${chStat[c].ok}/${chStat[c].n}`).join('  ')}`);
    console.log(`  后端有、本地造数里没有的账号(别人造的，不判定)：${backendOnly} 个`);
    console.log(`  汇总：✅ 一致=${stat.ok}  ❌ 字段不一致=${stat.bad}  ❌ 后端缺失=${stat.missing}`);
    console.log(`${'═'.repeat(88)}\n`);
}
