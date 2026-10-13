/**
 * 超级大奖触发验证（只读：不触发、不领取，只核对后台记录表）
 *
 * 流程：
 *   1. GetJackpotConfig：总开关 IsOpenJackpotRewardSwitch 必须为 1；读取全局「单个会员每日限制」
 *   2. GetPageList：读取全部大奖配置；没有配置 / 全部关闭 → 报错退出；只用开启(state=1)的配置
 *   3. GetRecordPageList(timeType=1)：当天全部大奖记录
 *   4. GetBetRecordPageList：从「最早开启配置的最后更新时间」到现在的全站已结算注单
 *   5. 逐会员、按投注时间先后模拟后端应有结果，与记录表逐笔比对
 *
 * 判定规则（与产品确认）：
 *   - 配置生效：state=1，且注单投注时间 > 配置 lastUpdateTime（严格大于）
 *   - 范围：rangeType=1 电子游戏(categoryType=0)；rangeType=2 只认 effectiveRange 里的厂商；
 *           gameScope=1 只认 effectiveGameList 里的厂商+游戏
 *   - 倍率 = 注单 profit（中奖金额 / 投注金额，两位小数）；投注金额 = betAmount；区间两端都算
 *   - 单条配置每日次数 everyDayRewardLimitNum：每个会员该配置最多触发 N 次，0 = 不限
 *   - 全局每日限制：每个会员当天所有配置合计（含当天老配置已触发的）；超出的记录状态为「系统不发」(3)，
 *     系统不发不算触发、也不判定（只核对未领取/已领取等真正触发的记录）；超限按投注时间先后计
 *   - 一笔注单满足多条配置：某条配置次数用完就改用其它满足条件的配置
 *   - 记录快照不属于当前满足的配置，但投注之后有配置改动/关闭 → 视为旧版本配置触发，不判定（计入全局次数）
 *   - 只统计正式账号（userType=0）
 *   - 结算不足 GRACE_SEC 秒的注单若暂无记录，标「等待生成」而不是漏发（记录由定时任务约每分钟生成）
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 megaJackpotVerify.js
 *   可选：-e GRACE_SEC=120
 */

import { tenantRequest, tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { fetchAllPages, getDayRange, formatTs, getTzOffsetMs, toNum } from '../../../../libs/common/index.js';

const TENANT_ID = __ENV.TENANT_ID || __ENV.TENANT || '3004';
const GRACE_SEC = parseInt(__ENV.GRACE_SEC || '120', 10);
const TAG = 'MegaJackpotVerify';
const RECEIVE_STATE = { 0: '未领取', 1: '已领取', 2: '已过期', 3: '系统不发' };
const SYSTEM_NOT_SEND = 3;

export const options = {
    scenarios: { mega_jackpot_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '60m' } }
};

const adminReq = (api, payload, token) => tenantRequest(api, payload, { token, isDesk: false, tenantId: TENANT_ID });
const fmt = ms => formatTs(ms, getTzOffsetMs(TENANT_ID));
const near = (a, b) => Math.abs(toNum(a) - toNum(b)) < 1e-6;

function fail(msg) {
    console.error(`[${TAG}] ❌ ${msg}`);
    throw new Error(msg);
}

// ============================================================
// 1. 全局设置
// ============================================================
function loadGlobalSetting(token) {
    const res = adminReq('/api/BigJackpot/GetJackpotConfig', {}, token);
    if (!res || res.msgCode !== 0 || !res.data) fail(`读取超级大奖全局设置失败：${res && res.msg}`);
    const d = res.data;
    const isOpen = d.isOpenJackpotRewardSwitch && String(d.isOpenJackpotRewardSwitch.value1) === '1';
    if (!isOpen) fail('超级大奖活动未开启（是否启用超级大奖功能 = 否），请先在后台开启');
    const limit = parseInt((d.jackpotEveryDayRewardLimitNum && d.jackpotEveryDayRewardLimitNum.value1) || '0', 10) || 0;
    return { limit };
}

// ============================================================
// 2. 大奖配置
// ============================================================
function loadConfigs(token) {
    const list = fetchAllPages(p => adminReq('/api/BigJackpot/GetPageList', { pageNo: p, pageSize: 200, orderBy: 'Desc' }, token), { pause: 0.2 });
    if (list.length === 0) fail('超级大奖已开启，但后台没有任何活动配置，请先新建配置');
    const enabled = list.filter(c => c.state === 1);
    if (enabled.length === 0) fail(`后台共 ${list.length} 条活动配置，但全部是关闭状态，请至少开启一条`);
    return { all: list, enabled: enabled.map(normalizeConfig) };
}

export function normalizeConfig(c) {
    const vendors = String(c.effectiveRange || '').split(',').map(s => s.trim()).filter(Boolean);
    const games = {};
    (c.effectiveGameList || []).forEach(v => { games[v.vendorCode] = (v.gameList || []).map(g => String(g.code)); });
    return {
        id: c.id, state: c.state, rangeType: c.rangeType, rangeName: c.effectiveRangeName || '', vendors,
        gameScope: c.gameScope, games,
        minMultiple: toNum(c.minMultiple), maxMultiple: toNum(c.maxMultiple),
        minBet: toNum(c.minBetAmount), maxBet: toNum(c.maxBetAmount),
        award: toNum(c.awardAmount), limit: toNum(c.everyDayRewardLimitNum),
        lastUpdateTime: Number(c.lastUpdateTime) || 0, lastUpdateMan: c.lastUpdateMan
    };
}

function scopeText(c) {
    let s = c.rangeType === 1 ? '电子游戏' : `指定厂商(${c.vendors.join(',')})`;
    // 子游戏多时只显示厂商+个数，避免日志刷屏
    if (c.gameScope === 1) s += ' 指定子游戏:' + Object.keys(c.games).map(v => (c.games[v].length > 5 ? `${v}(${c.games[v].length}个)` : `${v}[${c.games[v].join(',')}]`)).join(' ');
    return s;
}

/** 配置本身永远不会触发的情况（区间起点大于终点） */
function configWarnings(c) {
    const w = [];
    if (c.minMultiple > c.maxMultiple) w.push(`倍率起点 ${c.minMultiple} > 终点 ${c.maxMultiple}`);
    if (c.minBet > c.maxBet) w.push(`投注金额起点 ${c.minBet} > 终点 ${c.maxBet}`);
    return w;
}

// ============================================================
// 3. 注单是否满足某条配置
// ============================================================
function betMultiple(b) {
    if (b.profit !== undefined && b.profit !== null && b.profit !== '') return toNum(b.profit);
    const bet = toNum(b.betAmount);
    return bet > 0 ? Math.round(toNum(b.winAmount) / bet * 100) / 100 : 0;
}

function inScope(c, b) {
    if (c.rangeType === 1 && Number(b.categoryType) !== 0) return false;
    if (c.rangeType === 2 && !c.vendors.includes(b.vendorCode)) return false;
    if (c.gameScope === 1) {
        const codes = c.games[b.vendorCode];
        if (!codes || !codes.includes(String(b.gameCode))) return false;
    }
    return true;
}

export function matchConfigs(enabled, b) {
    const m = betMultiple(b), amt = toNum(b.betAmount), t = Number(b.betTime);
    return enabled.filter(c => t > c.lastUpdateTime && inScope(c, b)
        && m >= c.minMultiple && m <= c.maxMultiple && amt >= c.minBet && amt <= c.maxBet);
}

/** 记录里带的是触发它的配置快照（区间 + 奖金），据此反查是哪条配置 */
function snapshotConfigs(configs, r) {
    return configs.filter(c => near(c.minMultiple, r.minMultiple) && near(c.maxMultiple, r.maxMultiple)
        && near(c.minBet, r.minBetAmount) && near(c.maxBet, r.maxBetAmount) && near(c.award, r.awardAmount));
}

// ============================================================
// 4. 数据拉取
// ============================================================
function loadRecords(token, day) {
    return fetchAllPages(p => adminReq('/api/BigJackpot/GetRecordPageList',
        { timeType: 1, startTime: day.startTime, endTime: day.endTime, pageNo: p, pageSize: 500, orderBy: 'Desc' }, token), { pause: 0.3 });
}

function loadBets(token, beginTs, endTs) {
    return fetchAllPages(p => adminReq('/api/ThirdGame/GetBetRecordPageList', {
        queryTimeType: 'BetTime', onlySearchFromLastWithdrawal: false, orderState: 1,
        beginTimeUnix: beginTs, endTimeUnix: endTs,
        pageNo: p, pageSize: 500, orderBy: 'Desc', sortField: 'BetTime'
    }, token), { pause: 0.3, maxPages: 5000 });
}

const userTypeCache = {};
function getUserType(token, userId) {
    if (userTypeCache[userId] !== undefined) return userTypeCache[userId];
    const res = adminReq('/api/Users/GetPageList', { userId, pageNo: 1, pageSize: 20, orderBy: 'Desc' }, token);
    const u = res && res.data && res.data.list ? res.data.list.find(x => Number(x.userId) === Number(userId)) : null;
    userTypeCache[userId] = u ? Number(u.userType) : -1;
    return userTypeCache[userId];
}

// ============================================================
// 5. 逐会员按投注时间模拟并比对
// ============================================================
export function verifyUser(userId, bets, records, ctx) {
    const { enabled, allConfigs, globalLimit, runStart } = ctx;
    const items = [];
    const recByOrder = {}, betByOrder = {};
    records.forEach(r => { recByOrder[r.orderNo] = r; });
    bets.forEach(b => { betByOrder[b.orderNo] = b; });
    // 「系统不发」不判定也不计次（只关心未领取/已领取等真正触发的记录）
    const notSendCount = records.filter(r => r.receiveState === SYSTEM_NOT_SEND).length;

    // 时间线：真正触发的记录 + 满足条件却完全没有记录的注单，按投注时间先后
    const events = records.filter(r => r.receiveState !== SYSTEM_NOT_SEND).map(r => ({ t: Number(r.betTime), kind: 'rec', r }));
    let qualifyingCount = 0;
    bets.forEach(b => {
        const configs = matchConfigs(enabled, b);
        if (configs.length === 0) return;
        qualifyingCount++;
        if (!recByOrder[b.orderNo]) events.push({ t: Number(b.betTime), kind: 'bet', b, configs });
    });
    events.sort((x, y) => x.t - y.t);

    let globalUsed = 0;
    const perConfig = {};
    const availableOf = configs => configs.filter(c => !c.limit || (perConfig[c.id] || 0) < c.limit);
    for (const ev of events) {
        const overGlobal = globalLimit > 0 && globalUsed >= globalLimit;

        if (ev.kind === 'bet') {
            const { b, configs } = ev;
            const available = availableOf(configs);
            const base = { orderNo: b.orderNo, b, configs, available };
            const settleAgo = (runStart - Number(b.settlementTime || b.betTime)) / 1000;
            if (overGlobal) items.push({ ...base, status: 'ok_none', note: `已达全局每日限制 ${globalLimit}，不触发` });
            else if (available.length === 0) items.push({ ...base, status: 'ok_none', note: `满足的配置 ${configs.map(c => c.id).join(',')} 当日次数已用完，不触发` });
            else if (settleAgo < GRACE_SEC) items.push({ ...base, status: 'pending', note: `结算 ${Math.round(settleAgo)} 秒，记录可能尚未生成` });
            else items.push({ ...base, status: 'missing', note: `满足配置 ${available.map(c => c.id).join(',')}，应触发但没有记录` });
            continue;
        }

        const r = ev.r, t = ev.t;
        const b = betByOrder[r.orderNo];
        const configs = b ? matchConfigs(enabled, b) : [];
        const snap = snapshotConfigs(configs, r);
        const base = { orderNo: r.orderNo, b, r, configs };
        globalUsed++;

        if (snap.length === 0) {
            // 快照不属于这笔注单满足的当前配置：投注之后有配置改动/关闭过 → 旧版本或已关闭配置当时触发，不判定
            const snapAll = snapshotConfigs(allConfigs, r);
            const validNow = snapAll.filter(c => c.state === 1 && c.lastUpdateTime < t);
            const changedAfter = allConfigs.some(c => c.lastUpdateTime >= t);
            validNow.slice(0, 1).forEach(c => { perConfig[c.id] = (perConfig[c.id] || 0) + 1; });
            if (changedAfter && validNow.length === 0) {
                items.push({ ...base, status: 'info_pre', note: `由配置改动/关闭前的版本触发（快照 倍率${toNum(r.minMultiple)}~${toNum(r.maxMultiple)} 投注${toNum(r.minBetAmount)}~${toNum(r.maxBetAmount)} 奖金${toNum(r.awardAmount)}${snapAll.length ? ' 对应 ' + snapAll.map(c => c.id).join(',') : ''}），不判定，计入全局次数` });
            } else {
                const why = validNow.length
                    ? `注单不满足配置 ${validNow.map(c => c.id).join(',')}（${scopeText(validNow[0])} 倍率${validNow[0].minMultiple}~${validNow[0].maxMultiple} 投注${validNow[0].minBet}~${validNow[0].maxBet}）`
                    : `快照(倍率${toNum(r.minMultiple)}~${toNum(r.maxMultiple)} 投注${toNum(r.minBetAmount)}~${toNum(r.maxBetAmount)} 奖金${toNum(r.awardAmount)})对应 ${snapAll.map(c => `${c.id}(${c.state === 1 ? '开启' : '已关闭'})`).join(',') || '无任何配置'}`;
                items.push({ ...base, status: 'extra', note: `不应触发：${why}；注单满足的配置：${configs.map(c => c.id).join(',') || '无'}` });
            }
            continue;
        }

        const available = availableOf(configs);
        const usedCfg = snap.find(c => available.includes(c));
        if (overGlobal) {
            items.push({ ...base, status: 'over_global', note: `触发前全局已用 ${globalUsed - 1}/${globalLimit}，超出每日限制仍触发（${RECEIVE_STATE[r.receiveState] || r.receiveState}）` });
        } else if (!usedCfg) {
            items.push({ ...base, status: 'over_config', note: `配置 ${snap.map(c => `${c.id} 已用${perConfig[c.id] || 0}/${c.limit}`).join(',')}，超出单配置每日次数仍触发` });
        } else {
            items.push({ ...base, status: 'ok_sent', note: `配置 ${usedCfg.id} 第 ${(perConfig[usedCfg.id] || 0) + 1} 次，全局第 ${globalUsed} 次` });
        }
        const c = usedCfg || snap[0];
        perConfig[c.id] = (perConfig[c.id] || 0) + 1;
    }
    return { userId, items, globalUsed, perConfig, qualifyingCount, notSendCount };
}

const STATUS_TEXT = {
    ok_sent: '✅ 正确触发', ok_none: '✅ 次数用完不触发', info_pre: 'ℹ️ 配置改动前触发',
    pending: '⏳ 等待生成', missing: '❌ 漏发', extra: '❌ 多发',
    over_global: '❌ 超全局限制仍发', over_config: '❌ 超单配置次数仍发'
};

// ============================================================
// main
// ============================================================
export default function () {
    const runStart = Date.now();
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) fail('后台登录失败');

    const { limit: globalLimit } = loadGlobalSetting(token);
    const { all, enabled } = loadConfigs(token);
    const allConfigs = all.map(normalizeConfig);
    const day = getDayRange(0, TENANT_ID);
    const windowStart = Math.max(day.startTime, Math.min(...enabled.map(c => c.lastUpdateTime)));
    const endTs = Math.min(day.endTime, runStart);

    console.log(`[${TAG}] 全局每日限制=${globalLimit || '不限'}；开启配置 ${enabled.length}/${all.length} 条；注单窗口 ${fmt(windowStart)} ~ ${fmt(endTs)}`);
    enabled.forEach(c => {
        const w = configWarnings(c);
        console.log(`[${TAG}]   配置 ${c.id}：${scopeText(c)} 倍率${c.minMultiple}~${c.maxMultiple} 投注${c.minBet}~${c.maxBet} 奖金${c.award} 每日${c.limit || '不限'}次 生效于 ${fmt(c.lastUpdateTime)}${w.length ? '  ⚠️ 永远不会触发：' + w.join('；') : ''}`);
    });

    const records = loadRecords(token, day);
    const bets = loadBets(token, windowStart, endTs);
    console.log(`[${TAG}] 当日大奖记录 ${records.length} 条；窗口内已结算注单 ${bets.length} 笔`);

    // 按会员分组，只保留正式账号
    const users = {};
    bets.forEach(b => {
        userTypeCache[b.userId] = Number(b.userType);
        (users[b.userId] = users[b.userId] || { bets: [], records: [] }).bets.push(b);
    });
    records.forEach(r => (users[r.userId] = users[r.userId] || { bets: [], records: [] }).records.push(r));
    const formal = Object.keys(users).filter(uid => getUserType(token, uid) === 0);
    const skipped = Object.keys(users).length - formal.length;

    const results = formal.map(uid => verifyUser(uid, users[uid].bets, users[uid].records,
        { enabled, allConfigs, globalLimit, windowStart, runStart }))
        .filter(u => u.items.length > 0 || u.qualifyingCount > 0 || u.notSendCount > 0);

    // ---------------- 报表 ----------------
    const lines = ['', '================ 超级大奖触发验证 ================'];
    lines.push(`租户 ${TENANT_ID} | 全局每日限制 ${globalLimit || '不限'} | 开启配置 ${enabled.map(c => c.id).join(',')} | 注单窗口 ${fmt(windowStart)} ~ ${fmt(endTs)}`);
    lines.push(`正式会员 ${formal.length} 人参与比对（跳过非正式账号 ${skipped} 人）`);
    const counter = {};
    for (const u of results) {
        const c = {};
        u.items.forEach(it => { c[it.status] = (c[it.status] || 0) + 1; counter[it.status] = (counter[it.status] || 0) + 1; });
        const bad = u.items.filter(it => STATUS_TEXT[it.status].startsWith('❌'));
        lines.push('--------------------------------------------------');
        lines.push(`会员 ${u.userId}：满足条件注单 ${u.qualifyingCount} 笔 | 有效触发 ${u.globalUsed} 次（全局限制 ${globalLimit || '不限'}）| 系统不发 ${u.notSendCount} 条(不判定) | 各配置 ${Object.keys(u.perConfig).map(k => `${k}:${u.perConfig[k]}`).join(' ') || '-'} | ${bad.length ? `❌ ${bad.length} 处问题` : '✅ 正常'}`);
        u.items.slice().sort((a, b) => Number((a.b || a.r).betTime) - Number((b.b || b.r).betTime)).forEach(it => {
            const src = it.b || it.r;
            lines.push(`  ${STATUS_TEXT[it.status]}  ${fmt(src.betTime)} ${src.vendorCode}-${src.gameName || src.gameCode} 投注${toNum(src.betAmount)} 倍率${it.b ? betMultiple(it.b) : toNum(src.multiple)}`
                + `${it.r ? ` 记录:${RECEIVE_STATE[it.r.receiveState] || it.r.receiveState} 奖金${toNum(it.r.awardAmount)}` : ''}  ${it.orderNo}`);
            lines.push(`      ${it.note}`);
        });
    }
    const badTotal = Object.keys(counter).filter(k => STATUS_TEXT[k].startsWith('❌')).reduce((s, k) => s + counter[k], 0);
    lines.push('==================================================');
    const notSendTotal = results.reduce((n, u) => n + u.notSendCount, 0);
    lines.push('汇总：' + (notSendTotal ? `系统不发 ${notSendTotal} 条(不判定) | ` : '') + (Object.keys(counter).map(k => `${STATUS_TEXT[k]} ${counter[k]}`).join(' | ') || '窗口内没有满足条件的注单，也没有大奖记录'));
    lines.push(`结论：${badTotal === 0 ? '✅ 全部符合规则' : `❌ 发现 ${badTotal} 处问题，见上方明细`}`);
    lines.push('==================================================');
    console.log(lines.join('\n'));
}
