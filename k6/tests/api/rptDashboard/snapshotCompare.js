/**
 * 实时数据统计报表 一致性校验
 * 口径：同一时间节点，GetRecordSnapshotList[snapshotType] 应等于 GetRealTimeSnapshotReport[对应字段]。
 * 只做两接口交叉对比（不造数、不与底层业务数据核对）。
 */
import { check } from 'k6';
import { getRecordSnapshotList, getRealTimeSnapshotReport } from './rptDashboardApi.js';
import { SNAPSHOT_MAP, ALL_SNAPSHOT_TYPES } from './snapshotEnum.js';

const AMOUNT_TOL = parseFloat(__ENV.TOL || '0.01'); // 金额/比率容差；人数/次数恒精确

/** "2026-07-28 12:20:00" → "12:20" */
function hhmm(snapshotTime) {
    const m = String(snapshotTime || '').match(/(\d{2}):(\d{2}):\d{2}\s*$/);
    return m ? `${m[1]}:${m[2]}` : null;
}

export function runSnapshotCompare(token, date) {
    console.log(`\n${'='.repeat(74)}`);
    console.log(`  实时数据统计报表 一致性校验   日期 = ${date}`);
    console.log(`  口径：同一时间节点  快照列表[type] 应 = 实时报表[字段]（金额/比率容差 ${AMOUNT_TOL}）`);
    console.log(`${'='.repeat(74)}`);

    const snapList = getRecordSnapshotList(token, date, ALL_SNAPSHOT_TYPES);
    const report = getRealTimeSnapshotReport(token, date);
    if (!snapList) { console.error('❌ 第一步 GetRecordSnapshotList 获取失败，终止'); return; }
    if (!report) { console.error('❌ 第二步 GetRealTimeSnapshotReport 获取失败，终止'); return; }

    // 实时报表：按时间节点建索引（多日期时按 date 取对应 cell）
    const rtByTime = {};
    report.list.forEach(node => {
        const cells = node.cells || [];
        const cell = cells.find(c => c.date === date) || cells[0];
        if (cell) rtByTime[node.timeNode] = cell;
    });

    const snapByType = {};
    snapList.forEach(s => { snapByType[s.snapshotType] = s; });

    const results = [];
    const skipped = [];

    ALL_SNAPSHOT_TYPES.forEach(type => {
        const map = SNAPSHOT_MAP[type];
        if (!map.field) { skipped.push(`${type}(${map.name})`); return; }

        const s = snapByType[type];
        if (!s || !Array.isArray(s.snapshotData)) {
            results.push({ type, name: map.name, field: map.field, compared: 0, mismatches: [], note: '快照无该类型数据' });
            return;
        }

        const mismatches = [];
        let compared = 0;
        s.snapshotData.forEach(pt => {
            const t = hhmm(pt.snapshotTime);
            if (!t) return;
            const rt = rtByTime[t];
            if (!rt || !(map.field in rt)) return; // 只比两边都有的节点
            compared++;
            const sv = Number(pt.snapshotNum) || 0;
            const rv = Number(rt[map.field]) || 0;
            const diff = Math.abs(sv - rv);
            const ok = map.kind === 'count' ? (sv === rv) : (diff <= AMOUNT_TOL);
            if (!ok) mismatches.push({ t, sv, rv, diff });
        });
        results.push({ type, name: map.name, field: map.field, compared, mismatches });
    });

    // 打印结果
    console.log('');
    let badTypes = 0, totalMismatch = 0, comparedTypes = 0;
    results.forEach(r => {
        if (r.note) { console.log(`⚠️  [type ${String(r.type).padStart(2)} ${r.name}] ${r.note}`); return; }
        comparedTypes++;
        if (r.mismatches.length === 0) {
            console.log(`✅ [type ${String(r.type).padStart(2)} ${r.name}] 对比 ${r.compared} 点，全部一致`);
        } else {
            badTypes++; totalMismatch += r.mismatches.length;
            console.log(`❌ [type ${String(r.type).padStart(2)} ${r.name} → ${r.field}] 对比 ${r.compared} 点，${r.mismatches.length} 点不一致：`);
            r.mismatches.slice(0, 6).forEach(m => console.log(`      ${m.t}  快照=${m.sv}  实时=${m.rv}  (差 ${m.diff.toFixed(4)})`));
            if (r.mismatches.length > 6) console.log(`      ...还有 ${r.mismatches.length - 6} 个节点`);
        }
        check(r, { [`[type${r.type} ${r.name}] 两报表一致`]: (x) => x.mismatches.length === 0 });
    });

    if (skipped.length) console.log(`\n跳过(实时报表无对应字段)：${skipped.join('  ')}`);
    console.log(`\n汇总：交叉对比 ${comparedTypes} 类，其中 ${badTypes} 类有不一致，共 ${totalMismatch} 个时间节点对不上。`);
    console.log(`${'='.repeat(74)}\n`);

    return { comparedTypes, badTypes, totalMismatch, results };
}
