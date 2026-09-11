/**
 * 充值转盘 - 数据统计报表验证脚本（独立，单 VU；按天验证）
 *
 * 思路：从原始记录自己算一遍，和后台官方统计报表逐字段对比，对不上就在报表里标出来。
 *
 * 三个数据源：
 *   ① 后台统计报表  /api/RechargeWheel/GetActivityStatisticPageList  （被验证对象，list 按天）
 *   ② 次数发放记录  /api/RechargeWheel/GetPageListSpinRecord         （分 4 盘查，算“获取”系列）
 *   ③ 转盘奖励记录  /api/RechargeWheel/GetPageListRewardRecord       （分 4 盘查，算“参与/旋转/发出金额”系列）
 *
 * 自算口径（按天，天 = createTime 落在站点时区的自然日）：
 *   转盘发出金额   = ③里 rewardType=1(金额) 的 rewardAmount 之和（不含送转盘次数）
 *   转盘参与人数   = ③全部记录的 userId 去重
 *   旋转次数       = ③记录条数
 *   获取旋转人数   = ②全部记录的 userId 去重
 *   获取旋转次数   = ②全部记录的 spinCount 之和
 *   X盘参与人数    = ③中 rechargeWheelType=X 的 userId 去重
 *   X盘旋转次数    = ③中 rechargeWheelType=X 的条数
 *   X盘发出金额    = ③中 rechargeWheelType=X 且 rewardType=1 的 rewardAmount 之和
 *   X盘获取人数    = ②中 rechargeWheelType=X 的 userId 去重
 *   X盘获取次数    = ②中 rechargeWheelType=X 的 spinCount 之和
 *   （不验证 rechargeAfterSpinUserCount / convertRate）
 *
 * 结果 base64 成 `##RWVERIFY## <base64>` 一行输出，由 runner 解码按天打印对比。
 *
 * 运行（推荐 runner）：
 *   node rechargeWheelVerifyRunner.js --start 2026-09-08 --end 2026-09-08 --tenant 3004
 * 直接跑：
 *   k6 run -e TENANT_ID=3004 -e START=2026-09-08 -e END=2026-09-08 rechargeWheelVerify.js
 *
 * 参数：
 *   TENANT_ID  租户ID（默认 3004）
 *   START      开始日期 YYYY-MM-DD（默认站点时区今天）
 *   END        结束日期 YYYY-MM-DD（默认 = START）
 */

import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { sendRequest } from '../../common/request.js';
import { getTzOffset } from '../../retention/rechargeRetentionApi.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

const TAG = 'RechargeWheelVerify';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const START = __ENV.START || '';
const END = __ENV.END || '';

// 盘：type ↔ 后台字段前缀 key ↔ 名称
const WHEELS = [
    { type: 1, key: 'silver', name: '白银' },
    { type: 2, key: 'gold', name: '黄金' },
    { type: 3, key: 'diamond', name: '钻石' },
    { type: 4, key: 'special', name: '特殊' }
];

export const options = {
    scenarios: {
        rw_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' }
    }
};

// ================= 日期工具 =================

function pad2(n) { return String(n).padStart(2, '0'); }

function todayStr(tz) {
    const d = new Date(Date.now() + tz * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** dateStr + n 天 */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 枚举 [start, end] 的每一天 */
function enumDays(start, end) {
    const out = [];
    let cur = start, guard = 0;
    while (cur <= end && guard < 400) { out.push(cur); cur = addDays(cur, 1); guard++; }
    return out.length ? out : [start];
}

/** 毫秒时间戳 → 站点时区自然日 YYYY-MM-DD */
function dayKeyOf(ms, tz) {
    const d = new Date(Number(ms) + tz * 3600 * 1000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 后台 reportDate 归一化为 YYYY-MM-DD。兼容 "2026/9/8 ..."(Y/M/D) 与 "9/08/2026 ..."(M/D/Y) */
function normReportDate(s) {
    const datePart = String(s).trim().split(/[\sT]/)[0];
    const p = datePart.split(/[/-]/).map(x => x.trim());
    if (p.length < 3) return datePart;
    let y, m, d;
    if (p[0].length === 4) { y = p[0]; m = p[1]; d = p[2]; }   // Y/M/D，如 2026/9/8
    else { y = p[2]; m = p[0]; d = p[1]; }                     // M/D/Y，如 9/08/2026（后台实际格式）
    return `${y}-${pad2(m)}-${pad2(d)}`;
}

// ================= 提取工具 =================

function extractList(res) {
    if (!res) return [];
    if (Array.isArray(res.list)) return res.list;
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    return [];
}
function extractTotalPage(res) {
    if (!res) return 1;
    if (res.totalPage) return res.totalPage;
    if (res.data && res.data.totalPage) return res.data.totalPage;
    return 1;
}

// ================= 数据拉取 =================

/** 后台统计报表（按天 list） */
function fetchBackendDays(token, start, end) {
    const api = '/api/RechargeWheel/GetActivityStatisticPageList';
    const payload = { startTime: start, endTime: end, pageNo: 1, pageSize: 100, orderBy: 'Desc' };
    const res = sendRequest(payload, api, TAG, false, token);
    const list = extractList(res);
    const byDate = {};
    for (const row of list) {
        byDate[normReportDate(row.reportDate)] = row;
    }
    console.log(`[${TAG}] 后台报表返回 ${list.length} 天`);
    return byDate;
}

/** 分盘翻页拉记录（api = 奖励记录 或 发放记录）；keyOf 用于翻页去重 */
function fetchByWheel(token, api, wheelType, start, end, keyOf) {
    const byKey = {};
    let pageNo = 1;
    while (true) {
        const payload = { rechargeWheelType: wheelType, start, end, pageNo, pageSize: 500, orderBy: 'Desc' };
        const res = sendRequest(payload, api, TAG, false, token);
        const list = extractList(res);
        for (const r of list) byKey[keyOf(r)] = r;
        const totalPage = extractTotalPage(res);
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.2);
    }
    return Object.values(byKey);
}

const rewardKey = (r) => `${r.userId}|${r.createTime}|${r.rechargeWheelType}|${r.rewardType}|${r.rewardAmount}`;
const spinKey = (r) => `${r.userId}|${r.createTime}|${r.rechargeWheelType}|${r.rechargeAmount}|${r.spinCount}`;

// ================= 聚合 + 对比 =================

function distinct(arr) { return new Set(arr).size; }

/** 计算某天的脚本值 + 与后台该天逐字段对比 */
function buildDayResult(D, rewardDay, spinDay, backendRow, tz) {
    // —— 脚本自算 ——
    const rewardMoney = rewardDay.filter(r => Number(r.rewardType) === 1);
    const payout = rewardMoney.reduce((s, r) => s + (parseFloat(r.rewardAmount) || 0), 0);
    const spinUsers = distinct(rewardDay.map(r => Number(r.userId)));
    const spins = rewardDay.length;
    const obtainUsers = distinct(spinDay.map(r => Number(r.userId)));
    const obtainSpins = spinDay.reduce((s, r) => s + (Number(r.spinCount) || 0), 0);

    const perWheel = {};
    for (const w of WHEELS) {
        const rw = rewardDay.filter(r => Number(r.rechargeWheelType) === w.type);
        const sp = spinDay.filter(r => Number(r.rechargeWheelType) === w.type);
        perWheel[w.type] = {
            users: distinct(rw.map(r => Number(r.userId))),
            spins: rw.length,
            payout: rw.filter(r => Number(r.rewardType) === 1).reduce((s, r) => s + (parseFloat(r.rewardAmount) || 0), 0),
            obtainUsers: distinct(sp.map(r => Number(r.userId))),
            obtainSpins: sp.reduce((s, r) => s + (Number(r.spinCount) || 0), 0)
        };
    }

    // —— 与后台逐字段对比 ——
    const b = backendRow || null;
    const rows = [];
    const bnum = (f) => (b && b[f] != null) ? Number(b[f]) : 0;
    const addRow = (label, field, script, money) => {
        const backend = bnum(field);
        const match = money ? Math.abs(script - backend) < 0.01 : Number(script) === backend;
        rows.push({ label, field, script: money ? Number(script.toFixed(4)) : script, backend, match, money: !!money });
    };

    addRow('转盘发出金额', 'totalRewardAmount', payout, true);
    addRow('转盘参与人数', 'spinUserCount', spinUsers, false);
    addRow('旋转次数', 'spinCount', spins, false);
    addRow('获取旋转人数', 'obtainUserCount', obtainUsers, false);
    addRow('获取旋转次数', 'obtainSpinCount', obtainSpins, false);
    for (const w of WHEELS) {
        const pw = perWheel[w.type];
        addRow(`${w.name}·参与人数`, `${w.key}SpinUserCount`, pw.users, false);
        addRow(`${w.name}·旋转次数`, `${w.key}SpinCount`, pw.spins, false);
        addRow(`${w.name}·发出金额`, `${w.key}RewardAmount`, pw.payout, true);
        addRow(`${w.name}·获取人数`, `${w.key}ObtainUserCount`, pw.obtainUsers, false);
        addRow(`${w.name}·获取次数`, `${w.key}ObtainSpinCount`, pw.obtainSpins, false);
    }

    const failCount = rows.filter(r => !r.match).length;
    return { date: D, hasBackend: !!b, rows, failCount };
}

// ================= Setup / VU =================

export function setup() {
    if (TENANT_ID !== '3004') {
        const t = getEnvByTenantId(TENANT_ID);
        if (t) Object.assign(ENV_CONFIG, t);
    }
    const token = AdminLogin();
    if (!token) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log(`[${TAG}] ✅ 管理员登录成功`);
    return { token, envConfig: getEnvByTenantId(TENANT_ID) };
}

export default function (data) {
    const token = data.token;
    if (TENANT_ID !== '3004' && data.envConfig) Object.assign(ENV_CONFIG, data.envConfig);

    const tz = getTzOffset(TENANT_ID);
    const start = START || todayStr(tz);
    const end = END || start;
    console.log(`[${TAG}] 时间段 ${start} ~ ${end} | 时区 ${tz}h`);

    // ① 后台报表（按天）
    console.log(`[${TAG}] 拉取后台统计报表...`);
    const backendByDate = fetchBackendDays(token, start, end);

    // ③ 奖励记录（分 4 盘）
    console.log(`[${TAG}] 拉取奖励记录（分4盘）...`);
    let rewardAll = [];
    for (const w of WHEELS) {
        const list = fetchByWheel(token, '/api/RechargeWheel/GetPageListRewardRecord', w.type, start, end, rewardKey);
        console.log(`[${TAG}]   ${w.name}奖励记录 ${list.length} 条`);
        rewardAll = rewardAll.concat(list);
        sleep(0.2);
    }

    // ② 发放记录（分 4 盘）
    console.log(`[${TAG}] 拉取次数发放记录（分4盘）...`);
    let spinAll = [];
    for (const w of WHEELS) {
        const list = fetchByWheel(token, '/api/RechargeWheel/GetPageListSpinRecord', w.type, start, end, spinKey);
        console.log(`[${TAG}]   ${w.name}发放记录 ${list.length} 条`);
        spinAll = spinAll.concat(list);
        sleep(0.2);
    }

    // 按天分组
    const rewardByDay = {};
    for (const r of rewardAll) {
        const d = dayKeyOf(r.createTime, tz);
        (rewardByDay[d] = rewardByDay[d] || []).push(r);
    }
    const spinByDay = {};
    for (const r of spinAll) {
        const d = dayKeyOf(r.createTime, tz);
        (spinByDay[d] = spinByDay[d] || []).push(r);
    }

    // 枚举每天对比（并入后台有、脚本有的所有日期）
    const dateSet = {};
    enumDays(start, end).forEach(d => dateSet[d] = true);
    Object.keys(backendByDate).forEach(d => dateSet[d] = true);
    Object.keys(rewardByDay).forEach(d => dateSet[d] = true);
    Object.keys(spinByDay).forEach(d => dateSet[d] = true);
    const dates = Object.keys(dateSet).sort();

    const days = dates.map(D =>
        buildDayResult(D, rewardByDay[D] || [], spinByDay[D] || [], backendByDate[D], tz)
    );

    const result = { tenant: TENANT_ID, start, end, days };
    console.log(`##RWVERIFY## ${encoding.b64encode(JSON.stringify(result))}`);
    console.log(`[${TAG}] ✅ 验证数据已输出（${start} ~ ${end}，共 ${days.length} 天）`);
}
