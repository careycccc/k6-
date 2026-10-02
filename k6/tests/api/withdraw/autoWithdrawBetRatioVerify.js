/**
 * 自动出款 —— 注单比例三项检测验证（只读查询，不改任何数据）
 *
 * 流程：
 *   Step 1: /api/Users/GetPageList 按 userId 查会员 → packageId（渠道ID）
 *   Step 2: /api/AutoWithdrawConfig/Get 取全部自动出款规则，选规则：
 *           - allowPackageIds 含该渠道 且 configState=1 → 用该规则
 *           - 匹配到但 configState=0（关闭）→ 打印提示，回落默认规则
 *           - 没匹配到 → 默认规则（isDefaultConfig=true）
 *           - 默认规则也关闭 → 报错退出
 *   Step 3: 按规则里开启的三项检测，分别按「生效游戏」分组查近 N 天注单
 *           (/api/ThirdGame/GetBetRecordPageList)，合并后计算比例：
 *     ① 低赔率注单比例 (checkLowOddsOrderRatio)
 *          profit < lowOdds 的单数 / 总单数  >  lowOddsOrderRatio%  → 不能自动出款
 *     ② 小额注单比例 (checkSmallAmountOrderRatio)
 *          betAmount < smallOrderBetAmount 的单数 / 总单数  ≥  smallAmountOrderRatio%  → 不能
 *     ③ 低赔率注单金额比例 (checkLowOddsAmountRatio)
 *          低赔率(profit < lowOddsOfAmount)中奖注单 betAmount 之和 / 总中奖注单 betAmount 之和  ≥  lowOddsAmountRatio%  → 不能
 *          （中奖注单 = winAmount > 0）
 *     profit=0 的注单（输光）在①③中排除，不进分子也不进分母；②只看投注金额，全部注单都算。
 *     开关未开启的检测项不计算、不出结果。
 *     三项任意一项命中 → 不能自动出款；全部不命中 → 能。
 *
 * 注单查询不带 winLossAmountMin（带 0 会把输钱的单过滤掉，影响比例）。
 *
 * 生效游戏分组：
 *   limitGames 为空            → 全体游戏（categoryType 0~4 各查一遍）
 *   {vendorCode, gameCode:[]}  → 该厂商全部子游戏
 *   {vendorCode, gameCode:[a,b]} → 逐个子游戏查
 *   多组之间按 orderNo 去重后合并计算（同一组规则逻辑一致）
 *
 * 时间范围：租户时区，今天往前共 DAYS 天（默认 15，含今天）00:00:00 ~ 今天 23:59:59
 *
 * 运行：1002199769
 *   k6 run -e TENANT_ID=3004 -e USER_ID=137479 autoWithdrawBetRatioVerify.js
 *   k6 run -e TENANT_ID=3101 -e ACCOUNT=919028199762 autoWithdrawBetRatioVerify.js   （账号前台登录取 userId，密码默认 qwer1234）
 *   可选：-e DAYS=15  -e PASSWORD=xxx
 */

import { sleep } from 'k6';
import { tenantRequest, tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTzOffset } from '../retention/rechargeRetentionApi.js';
import { loginWithPassword, getFrontUserInfoWithLevel } from '../recharge/rechargeLevel.service.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const ACCOUNT = __ENV.ACCOUNT || '';
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
// USER_ID 直接传；或传 ACCOUNT 由前台登录解析
let USER_ID = parseInt(__ENV.USER_ID || '0', 10);
const DAYS = parseInt(__ENV.DAYS || '15', 10);
const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const TAG = 'BetRatioVerify';

export const options = {
    scenarios: {
        bet_ratio_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' }
    }
};

const adminReq = (api, payload, token) => tenantRequest(api, payload, { token, isDesk: false, tenantId: TENANT_ID });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);

// ============================================================
// 时间范围（租户时区）
// ============================================================
function getRange() {
    const tzMs = getTzOffset(TENANT_ID) * 3600 * 1000;
    const dayMs = 86400 * 1000;
    const localNow = Date.now() + tzMs;
    const todayStartUtc = Math.floor(localNow / dayMs) * dayMs - tzMs;
    return {
        begin: todayStartUtc - (DAYS - 1) * dayMs,
        end: todayStartUtc + dayMs - 1000
    };
}

function fmtTs(ts) {
    const tzMs = getTzOffset(TENANT_ID) * 3600 * 1000;
    return new Date(ts + tzMs).toISOString().replace('T', ' ').substring(0, 19);
}

// ============================================================
// Step 1: 会员渠道
// ============================================================
function getUserPackageId(token) {
    const res = adminReq('/api/Users/GetPageList', { userId: USER_ID, pageNo: 1, pageSize: 20, orderBy: 'Desc' }, token);
    const list = res && res.data && res.data.list ? res.data.list : [];
    const u = list.find(x => Number(x.userId) === USER_ID) || list[0];
    if (!u) throw new Error(`GetPageList 查不到会员 userId=${USER_ID}，msg=${res && res.msg}`);
    return Number(u.packageId);
}

// ============================================================
// Step 2: 选规则
// ============================================================
function pickConfig(token, packageId) {
    const res = adminReq('/api/AutoWithdrawConfig/Get', {}, token);
    const configs = res && Array.isArray(res.data) ? res.data : [];
    if (configs.length === 0) throw new Error(`AutoWithdrawConfig/Get 无数据，msg=${res && res.msg}`);

    const def = configs.find(c => c.isDefaultConfig === true);
    const matched = configs.find(c => !c.isDefaultConfig &&
        String(c.allowPackageIds || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).includes(packageId));

    if (matched && matched.configState === 1) {
        console.log(`[${TAG}] 渠道 ${packageId} 匹配到规则「${matched.configName}」(id=${matched.id})，已开启 → 使用该规则`);
        return matched;
    }
    if (matched) {
        console.warn(`[${TAG}] ⚠️ 渠道 ${packageId} 匹配到规则「${matched.configName}」(id=${matched.id})，但该规则已关闭(configState=0) → 改用默认规则`);
    } else {
        console.log(`[${TAG}] 渠道 ${packageId} 未匹配到任何规则的 allowPackageIds → 使用默认规则`);
    }
    if (!def) throw new Error('找不到默认规则(isDefaultConfig=true)');
    if (def.configState !== 1) throw new Error(`默认规则「${def.configName}」(id=${def.id}) 也是关闭状态(configState=0)，无可用规则`);
    console.log(`[${TAG}] 使用默认规则「${def.configName}」(id=${def.id})`);
    return def;
}

// ============================================================
// Step 3: 注单查询
// ============================================================
function fetchPaged(token, baseQuery, range) {
    const out = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const payload = Object.assign({
            queryTimeType: 'BetTime',
            onlySearchFromLastWithdrawal: false,
            beginTimeUnix: range.begin,
            endTimeUnix: range.end,
            userId: USER_ID,
            pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc', sortField: 'BetTime'
        }, baseQuery);
        const res = adminReq('/api/ThirdGame/GetBetRecordPageList', payload, token);
        if (!res || res.msgCode !== 0) throw new Error(`GetBetRecordPageList 失败 ${JSON.stringify(baseQuery)} msg=${res && res.msg}`);
        const list = res.data && res.data.list ? res.data.list : [];
        out.push(...list);
        const totalPage = res.data ? Number(res.data.totalPage) || 1 : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        sleep(0.3);
    }
    return out;
}

/** limitGames → 查询清单；每项 { label, query } */
function buildQueries(limitGames) {
    if (!limitGames || limitGames.length === 0) {
        return [0, 1, 2, 3, 4].map(t => ({ label: `全体游戏 categoryType=${t}`, query: { categoryType: t } }));
    }
    const qs = [];
    for (const g of limitGames) {
        const codes = Array.isArray(g.gameCode) ? g.gameCode : [];
        if (codes.length === 0) {
            qs.push({ label: `${g.vendorCode} 全部子游戏`, query: { vendorCode: g.vendorCode } });
        } else {
            for (const code of codes) {
                qs.push({ label: `${g.vendorCode}-${code}`, query: { vendorCode: g.vendorCode, gameCode: code, gameCodeArr: [code] } });
            }
        }
    }
    return qs;
}

const cache = {};
function fetchOrders(token, limitGames, range) {
    const seen = {};
    const orders = [];
    for (const q of buildQueries(limitGames)) {
        const key = JSON.stringify(q.query);
        if (!cache[key]) cache[key] = fetchPaged(token, q.query, range);
        let added = 0;
        for (const o of cache[key]) {
            if (seen[o.orderNo]) continue;
            seen[o.orderNo] = true;
            orders.push(o);
            added++;
        }
        console.log(`[${TAG}]   查询分组 ${q.label}：${cache[key].length} 单（去重后新增 ${added}）`);
    }
    return orders;
}

/** 盈利倍数：优先接口 profit 字段，缺失时用 winAmount/betAmount */
function profitOf(o) {
    if (o.profit !== undefined && o.profit !== null && o.profit !== '') return num(o.profit);
    const bet = num(o.betAmount);
    return bet > 0 ? num(o.winAmount) / bet : 0;
}

function gamesText(limitGames) {
    if (!limitGames || limitGames.length === 0) return '全体游戏';
    return limitGames.map(g => `${g.vendorCode}[${(g.gameCode || []).length ? g.gameCode.join(',') : '全部'}]`).join(' + ');
}

// ============================================================
// 三项检测
// ============================================================
/** ①③ 用：排除 profit=0（输光）的单，分子分母都不算 */
function excludeZeroProfit(orders) {
    const kept = orders.filter(o => profitOf(o) !== 0);
    console.log(`[${TAG}]     共 ${orders.length} 单，排除 profit=0 ${orders.length - kept.length} 单，计入 ${kept.length} 单`);
    return kept;
}

function checkLowOddsOrder(cfg, allOrders) {
    const orders = excludeZeroProfit(allOrders);
    const low = orders.filter(o => profitOf(o) < num(cfg.lowOdds));
    const ratio = pct(low.length, orders.length);
    const threshold = num(cfg.lowOddsOrderRatio);
    low.forEach(o => console.log(`[${TAG}]     低赔率单 ${o.orderNo} ${o.vendorCode}-${o.gameCode} profit=${o.profit} bet=${o.betAmount}`));
    return {
        name: '低赔率注单比例',
        games: gamesText(cfg.lowOddsOrderLimitGames),
        formula: `profit < ${num(cfg.lowOdds)} 的单数 ${low.length} / 总单数 ${orders.length}`,
        ratio, cmp: '>', threshold,
        blocked: ratio > threshold
    };
}

function checkSmallAmount(cfg, orders) {
    const small = orders.filter(o => num(o.betAmount) < num(cfg.smallOrderBetAmount));
    const ratio = pct(small.length, orders.length);
    const threshold = num(cfg.smallAmountOrderRatio);
    small.forEach(o => console.log(`[${TAG}]     小额单 ${o.orderNo} ${o.vendorCode}-${o.gameCode} bet=${o.betAmount}`));
    if (num(cfg.smallOrderBetAmount) === 0) console.warn(`[${TAG}]   ⚠️ 投注金额阈值配置为 0，按字面计算（0 单 / ≥0% 会判为命中），请结合实际确认`);
    return {
        name: '小额注单比例',
        games: gamesText(cfg.smallAmountOrderLimitGames),
        formula: `betAmount < ${num(cfg.smallOrderBetAmount)} 的单数 ${small.length} / 总单数 ${orders.length}`,
        ratio, cmp: '≥', threshold,
        blocked: orders.length > 0 && ratio >= threshold
    };
}

function checkLowOddsAmount(cfg, allOrders) {
    const orders = excludeZeroProfit(allOrders);
    const lowOdds = num(cfg.lowOddsOfAmount);
    const sumBet = arr => arr.reduce((s, o) => s + num(o.betAmount), 0);
    // orders 已排除 profit=0，剩下的即中奖单
    const win = orders.filter(o => num(o.winAmount) > 0);
    const lowWin = win.filter(o => profitOf(o) < lowOdds);
    lowWin.forEach(o => console.log(`[${TAG}]     低赔率中奖单 ${o.orderNo} ${o.vendorCode}-${o.gameCode} profit=${o.profit} bet=${o.betAmount} win=${o.winAmount}`));
    console.log(`[${TAG}]     中奖单 ${win.length}，其中低赔率(profit < ${lowOdds}) ${lowWin.length}`);
    const low = sumBet(lowWin);
    const total = sumBet(win);
    const ratio = pct(low, total);
    const threshold = num(cfg.lowOddsAmountRatio);
    return {
        name: '低赔率注单金额比例',
        games: gamesText(cfg.lowOddsAmountLimitGames),
        formula: `低赔率中奖单 betAmount ${f2(low)}（${lowWin.length}单） / 总中奖单 betAmount ${f2(total)}（${win.length}单）`,
        ratio, cmp: '≥', threshold,
        blocked: total > 0 && ratio >= threshold
    };
}

// ============================================================
// main
// ============================================================
export default function () {
    if (!USER_ID && ACCOUNT) {
        const userToken = loginWithPassword(ACCOUNT, PASSWORD);
        if (!userToken) throw new Error(`账号 ${ACCOUNT} 前台登录失败（密码 ${PASSWORD}）`);
        const info = getFrontUserInfoWithLevel(userToken);
        if (!info) throw new Error(`账号 ${ACCOUNT} 获取用户信息失败`);
        USER_ID = Number(info.userId);
        console.log(`[${TAG}] 账号 ${ACCOUNT} 登录成功 → userId=${USER_ID}`);
    }
    if (!USER_ID) throw new Error('请传 -e USER_ID=会员ID 或 -e ACCOUNT=会员账号');
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error('后台登录失败');

    const packageId = getUserPackageId(token);
    console.log(`[${TAG}] Step1 会员 ${USER_ID} 渠道 packageId=${packageId}`);

    const cfg = pickConfig(token, packageId);
    const range = getRange();
    console.log(`[${TAG}] Step2 规则「${cfg.configName}」(id=${cfg.id})；注单时间 ${fmtTs(range.begin)} ~ ${fmtTs(range.end)}（${DAYS}天）`);

    const checks = [
        { on: cfg.checkLowOddsOrderRatio === 1, games: cfg.lowOddsOrderLimitGames, run: checkLowOddsOrder, name: '低赔率注单比例' },
        { on: cfg.checkSmallAmountOrderRatio === 1, games: cfg.smallAmountOrderLimitGames, run: checkSmallAmount, name: '小额注单比例' },
        { on: cfg.checkLowOddsAmountRatio === 1, games: cfg.lowOddsAmountLimitGames, run: checkLowOddsAmount, name: '低赔率注单金额比例' }
    ];

    const results = [];
    for (const c of checks) {
        if (!c.on) {
            console.log(`[${TAG}] Step3 【${c.name}】开关未开启，跳过`);
            continue;
        }
        console.log(`[${TAG}] Step3 【${c.name}】生效游戏：${gamesText(c.games)}`);
        const orders = fetchOrders(token, c.games, range);
        results.push(c.run(cfg, orders));
    }

    const lines = [];
    lines.push('');
    lines.push('================ 注单比例检测结果 ================');
    lines.push(`会员 ${USER_ID} | 渠道 ${packageId} | 规则「${cfg.configName}」(id=${cfg.id}) | 近${DAYS}天`);
    if (results.length === 0) lines.push('三项注单比例检测开关均未开启，无结果');
    for (const r of results) {
        lines.push('--------------------------------------------------');
        lines.push(`【${r.name}】生效游戏：${r.games}`);
        lines.push(`  ${r.formula} = ${f2(r.ratio)}%  （条件：${r.cmp} ${f2(r.threshold)}%）`);
        lines.push(`  命中：${r.blocked ? '是' : '否'}  →  ${r.blocked ? '❌ 不能自动出款' : '✅ 能自动出款'}`);
    }
    if (results.length > 0) {
        const anyBlocked = results.some(r => r.blocked);
        lines.push('--------------------------------------------------');
        const hit = results.filter(r => r.blocked).map(r => r.name);
        lines.push(`综合：${anyBlocked ? `❌ 不能自动出款（命中：${hit.join('、')}）` : '✅ 能自动出款（已开启的检测项全部未命中）'}`);
    }
    lines.push('==================================================');
    console.log(lines.join('\n'));
}
