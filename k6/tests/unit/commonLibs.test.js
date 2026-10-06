/**
 * libs/common 公共工具自测（纯函数，不发请求）
 *   k6 run -e TENANT_ID=3004 k6/tests/unit/commonLibs.test.js
 */
import { randInt, randomPick, randomPickN, randomDigits, randomString, randomLetters,
    extractList, extractTotalPage, extractTotalCount, fetchAllPages,
    getTzOffset, getDayRange, dateStartTs, dateEndTs, formatTs, BEIJING_OFFSET_MS,
    extractToken, toNum } from '../../libs/common/index.js';

export const options = { vus: 1, iterations: 1 };
let fail = 0;
function eq(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}  got=${JSON.stringify(got)}${ok ? '' : ` want=${JSON.stringify(want)}`}`);
}

export default function () {
    // random
    let inRange = true, seenMin = false, seenMax = false;
    for (let i = 0; i < 2000; i++) { const v = randInt(3, 5); if (v < 3 || v > 5) inRange = false; if (v === 3) seenMin = true; if (v === 5) seenMax = true; }
    eq('randInt 闭区间', [inRange, seenMin, seenMax], [true, true, true]);
    eq('randomPick 空', randomPick([]), null);
    eq('randomPick 单元素', randomPick([7]), 7);
    const n = randomPickN([1, 2, 3, 4], 3); eq('randomPickN 不重复', [n.length, new Set(n).size], [3, 3]);
    let lead = true; for (let i = 0; i < 300; i++) if (randomDigits(10, true)[0] === '0') lead = false;
    eq('randomDigits 不0开头', [randomDigits(18).length, lead, /^\d+$/.test(randomDigits(12))], [18, true, true]);
    eq('randomString', /^[a-z0-9]{8}$/.test(randomString(8)), true);
    eq('randomLetters', /^[a-zA-Z]{6}$/.test(randomLetters(6)), true);

    // paging
    eq('extractList data.list', extractList({ data: { list: [1] } }), [1]);
    eq('extractList list', extractList({ list: [2] }), [2]);
    eq('extractList 数组', extractList([3]), [3]);
    eq('extractList null', extractList(null), []);
    eq('extractTotalPage', [extractTotalPage({ totalPage: 3 }), extractTotalPage({ data: { totalPage: 4 } }), extractTotalPage({})], [3, 4, 1]);
    eq('extractTotalCount', [extractTotalCount({ totalCount: 0 }), extractTotalCount({ data: { totalCount: 9 } }), extractTotalCount({})], [0, 9, null]);
    // 后端把 pageSize 截到 2，总 5 条 → 应翻 3 页收齐
    const all = [1, 2, 3, 4, 5]; let calls = 0;
    const got = fetchAllPages(p => { calls++; return { list: all.slice((p - 1) * 2, p * 2), totalCount: 5, totalPage: 99 }; }, { pause: 0 });
    eq('fetchAllPages 按 totalCount 收齐', [got, calls], [all, 3]);
    calls = 0;
    const got2 = fetchAllPages(p => { calls++; return { data: { list: p <= 2 ? [p] : [], totalPage: 2 } }; }, { pause: 0 });
    eq('fetchAllPages 无 totalCount 按 totalPage', [got2, calls], [[1, 2], 2]);

    // time（3004 区号 91 → 5.5）
    eq('getTzOffset 3004', getTzOffset('3004'), 5.5);
    const r = getDayRange(0, '3004');
    eq('getDayRange 跨度', [r.endTime - r.startTime, (r.startTime + 5.5 * 3600000) % 86400000], [86399999, 0]);
    eq('dateStartTs IST', dateStartTs('2026-10-02', 5.5 * 3600000), Date.UTC(2026, 9, 1, 18, 30));
    eq('dateStartTs UTC', dateStartTs('2026-10-02'), Date.UTC(2026, 9, 2));
    eq('dateEndTs', dateEndTs('2026-10-02') - dateStartTs('2026-10-02'), 86399999);
    eq('formatTs 北京', formatTs(Date.UTC(2026, 9, 2, 0, 0, 5), BEIJING_OFFSET_MS), '2026-10-02 08:00:05');
    eq('formatTs 空', formatTs(0), '-');

    // response
    eq('extractToken 字符串', extractToken('abcdefghijklmn'), 'abcdefghijklmn');
    eq('extractToken data.token', extractToken({ data: { token: 'T1' } }), 'T1');
    eq('extractToken header', extractToken({ headers: { authorization: 'Bearer XYZ' } }), 'XYZ');
    eq('extractToken 无', extractToken({}), null);
    eq('toNum', [toNum('1.50'), toNum('x'), toNum(null)], [1.5, 0, 0]);

    console.log(fail === 0 ? '全部通过' : `失败 ${fail} 项`);
    if (fail) throw new Error(`commonLibs 自测失败 ${fail} 项`);
}
