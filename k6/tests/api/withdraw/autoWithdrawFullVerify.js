/**
 * 自动出款 —— 全项核对（不短路，一次性跑完所有判定项）
 *
 * 跟 autoWithdrawBetRatioVerify.js 的关系：
 *   - 渠道匹配逻辑（getUserPackageId / pickConfig）和三项注单比例检测函数是从那个文件"整段复制"过来的
 *     （那边的函数没有 export，没法直接 import；这边改了之后不会影响原文件）。
 *   - 那个脚本只覆盖 3 个注单比例字段，查到就停；这个脚本覆盖 AutoWithdrawConfig 的全部字段，
 *     全部跑完再汇总，每一项都带上「阈值」和「用户实际值」。
 *
 * 字段 -> 数据源，在 D:\project\k6-\.claude\plans 里有调研记录，这里只列关键点：
 *   - riskControlRsp 在当前环境下恒为 null，风控类字段（同设备/同IP）改用
 *     GetPageList({registerDevice:...}) / GetPageList({registerIp:...}) 的 totalCount 直接查，已用真实数据验证。
 *   - 同银行账户关联数：/api/WithdrawalBinding/GetBankPageList 全量分页拉，按 cardNo 分组计数（用户提供的接口）。
 *   - 无充值连续提款次数（maxWithdrawTime）：totalRechargeCount===0 ? totalWithdrawCount : 0（用户确认的简化算法）。
 *   - autoWithdrawFailCount 没有数据源，固定标"无法核实"，不计入最终通过/拒绝判定。
 *   - totalRechargeAmountOpreationType 和 totalWinLoseAmount 的比较方向未经后台确认，按最常见的方向处理，
 *     并在输出里注明是假设。
 *
 * 运行：
 *   k6 run -e TENANT_ID=3004 -e USER_ID=168603 autoWithdrawFullVerify.js
 *   可选：-e WITHDRAW_AMOUNT=500   本次要提现的金额，用于核对"提款金额"这一项；不传则该项跳过
 *   可选：-e DAYS=15               注单比例检测的统计天数，默认 15
 */

import { sleep } from 'k6';
import { tenantRequest, tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTzOffset } from '../retention/rechargeRetentionApi.js';

const TENANT_ID = __ENV.TENANT_ID || __ENV.TENANT || '3004';
const USER_ID = parseInt(__ENV.USER_ID || '0', 10);
const WITHDRAW_AMOUNT = __ENV.WITHDRAW_AMOUNT !== undefined ? parseFloat(__ENV.WITHDRAW_AMOUNT) : null;
const DAYS = parseInt(__ENV.DAYS || '15', 10);
const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const TAG = 'AutoWithdrawFullVerify';

export const options = {
    scenarios: {
        full_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '10m' }
    }
};

const adminReq = (api, payload, token) => tenantRequest(api, payload, { token, isDesk: false, tenantId: TENANT_ID });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);

// ============================================================
// 渠道匹配（从 autoWithdrawBetRatioVerify.js 整段复制，未改动原文件）
// ============================================================
function getUserListItem(token) {
    const res = adminReq('/api/Users/GetPageList', { userId: USER_ID, pageNo: 1, pageSize: 20, orderBy: 'Desc' }, token);
    const list = res && res.data && res.data.list ? res.data.list : [];
    const u = list.find(x => Number(x.userId) === USER_ID) || list[0];
    if (!u) throw new Error(`GetPageList 查不到会员 userId=${USER_ID}，msg=${res && res.msg}`);
    return u;
}

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
// 用户数据：GetUserDetail + 风控计数 + 人工充值 + 银行卡关联
// ============================================================
function getUserDetail(token) {
    const res = adminReq('/api/Users/GetUserDetail', { userId: USER_ID }, token);
    if (!res || res.msgCode !== 0 || !res.data) throw new Error(`GetUserDetail 失败 msg=${res && res.msg}`);
    return res.data;
}

/** GetPageList 支持按 registerDevice/registerIp 直接筛选（已用真实数据验证），totalCount 即关联账号数（含自己） */
function countByField(token, field, value) {
    if (!value) return 0;
    const res = adminReq('/api/Users/GetPageList', { [field]: value, pageNo: 1, pageSize: 1, orderBy: 'Desc' }, token);
    return res && res.data ? Number(res.data.totalCount) || 0 : 0;
}

/** 近 N 天人工充值/彩金充值求和（已用真实数据验证 userId 过滤生效：带 userId 2 条 vs 不带 6613 条） */
function sumArtificialRecharge(token, artificialRechargeType, sinceMs) {
    let total = 0, count = 0;
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const res = adminReq('/api/ArtificialRechargeRecord/GetPageList', {
            userId: USER_ID, artificialRechargeType, createTime: sinceMs, endTime: Date.now(),
            pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc'
        }, token);
        const list = res && res.data && res.data.list ? res.data.list : [];
        for (const r of list) { total += num(r.rechargeAmount); count++; }
        const totalPage = res && res.data ? Number(res.data.totalPage) || 1 : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        sleep(0.2);
    }
    return { total, count };
}

/** 全量拉 WithdrawalBinding/GetBankPageList，按 cardNo 分组（用户提供的接口；1338条/pageSize500=3页，量很小） */
function fetchAllBankBindings(token) {
    const out = [];
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
        const res = adminReq('/api/WithdrawalBinding/GetBankPageList', { pageNo, pageSize: 500, orderBy: 'Desc' }, token);
        const list = res && res.data && res.data.list ? res.data.list : [];
        out.push(...list);
        const totalPage = res && res.data ? Number(res.data.totalPage) || 1 : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        sleep(0.2);
    }
    return out;
}

/**
 * 无充值连续提款次数：真实含义是"最后一次充值之后，连续发生了几次提现"，不是"总共有没有充值过"。
 * 用真实账号(168568，充值过16次)验证过：后台依然判定"无充值连续提款大于1次"命中拒绝，
 * 证明"从未充值过才算"的简化算法是错的。
 * GetUserDetail 没有完整充值/提现历史接口（试了几个猜测的后台路径都不存在），
 * 只能用 userDepositWithdrawInfo 里"最后充值时间"+"最近3笔提现时间"做近似：
 * 统计最近3笔提现里，发生在最后充值之后的笔数。如果3笔全部晚于最后充值，说明实际次数可能更多（下界）。
 */
function computeMaxWithdrawTimeActual(summary, depositWithdraw) {
    const lastRechargeTime = num(depositWithdraw.lastRechargeTime);
    if (lastRechargeTime === 0) {
        const v = num(summary.totalWithdrawCount);
        return { value: v, note: '该用户没有充值记录，取总提现次数', isLowerBound: false };
    }
    const recentWithdraws = [
        num(depositWithdraw.lastWithdrawTime),
        num(depositWithdraw.secondLastWithdrawTime),
        num(depositWithdraw.thirdLastWithdrawTime)
    ].filter(t => t > 0);
    const afterLastRecharge = recentWithdraws.filter(t => t > lastRechargeTime).length;
    const isLowerBound = afterLastRecharge === recentWithdraws.length && recentWithdraws.length >= 3;
    return {
        value: afterLastRecharge,
        note: `最后充值时间${new Date(lastRechargeTime).toISOString()}之后的提现笔数；GetUserDetail 只给最近3笔提现，没找到完整历史接口${isLowerBound ? '，这是下界估计，实际次数可能更多，仅供参考' : ''}`,
        isLowerBound
    };
}

function computeSameBankAccountCount(bankList) {
    const mine = bankList.filter(b => Number(b.userId) === USER_ID);
    if (mine.length === 0) return { count: 0, cardNos: [], note: '该用户未查到绑定的银行卡记录' };
    const cardToUsers = new Map();
    for (const b of bankList) {
        if (!cardToUsers.has(b.cardNo)) cardToUsers.set(b.cardNo, new Set());
        cardToUsers.get(b.cardNo).add(Number(b.userId));
    }
    let maxCount = 0;
    const cardNos = mine.map(b => b.cardNo);
    for (const cardNo of cardNos) {
        const n = cardToUsers.get(cardNo).size;
        if (n > maxCount) maxCount = n;
    }
    return { count: maxCount, cardNos, note: '' };
}

// ============================================================
// 三项注单比例检测（从 autoWithdrawBetRatioVerify.js 整段复制，未改动原文件）
// ============================================================
function getRange() {
    const tzMs = getTzOffset(TENANT_ID) * 3600 * 1000;
    const dayMs = 86400 * 1000;
    const localNow = Date.now() + tzMs;
    const todayStartUtc = Math.floor(localNow / dayMs) * dayMs - tzMs;
    return { begin: todayStartUtc - (DAYS - 1) * dayMs, end: todayStartUtc + dayMs - 1000 };
}

function fetchPaged(token, baseQuery, range) {
    const out = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const payload = Object.assign({
            queryTimeType: 'BetTime', onlySearchFromLastWithdrawal: false,
            beginTimeUnix: range.begin, endTimeUnix: range.end,
            userId: USER_ID, pageNo, pageSize: PAGE_SIZE, orderBy: 'Desc', sortField: 'BetTime'
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
            for (const code of codes) qs.push({ label: `${g.vendorCode}-${code}`, query: { vendorCode: g.vendorCode, gameCode: code, gameCodeArr: [code] } });
        }
    }
    return qs;
}

const betCache = {};
function fetchOrders(token, limitGames, range) {
    const seen = {};
    const orders = [];
    for (const q of buildQueries(limitGames)) {
        const key = JSON.stringify(q.query);
        if (!betCache[key]) betCache[key] = fetchPaged(token, q.query, range);
        for (const o of betCache[key]) {
            if (seen[o.orderNo]) continue;
            seen[o.orderNo] = true;
            orders.push(o);
        }
    }
    return orders;
}

function profitOf(o) {
    if (o.profit !== undefined && o.profit !== null && o.profit !== '') return num(o.profit);
    const bet = num(o.betAmount);
    return bet > 0 ? num(o.winAmount) / bet : 0;
}

function gamesText(limitGames) {
    if (!limitGames || limitGames.length === 0) return '全体游戏';
    return limitGames.map(g => `${g.vendorCode}[${(g.gameCode || []).length ? g.gameCode.join(',') : '全部'}]`).join(' + ');
}

function excludeZeroProfit(orders) { return orders.filter(o => profitOf(o) !== 0); }

function checkLowOddsOrder(cfg, allOrders) {
    const orders = excludeZeroProfit(allOrders);
    const low = orders.filter(o => profitOf(o) < num(cfg.lowOdds));
    const ratio = pct(low.length, orders.length);
    const threshold = num(cfg.lowOddsOrderRatio);
    return { name: '低赔率注单比例', games: gamesText(cfg.lowOddsOrderLimitGames),
        actual: ratio, unit: '%', cmp: '>', threshold, blocked: ratio > threshold,
        note: `profit<${num(cfg.lowOdds)}的单数${low.length}/总单数${orders.length}` };
}

function checkSmallAmount(cfg, orders) {
    const smallThresholdAmount = num(cfg.smallOrderBetAmount);
    // 投注金额阈值配置为0时，"betAmount<0"永远不可能成立，按字面公式会退化成"0单/总单数=0%，0%>=0%"误判为命中。
    // 用真实账号(userId=168568)对照后台真实拒绝原因列表验证过：后台在这种情况下根本不会把这条列入拒绝原因，
    // 说明真实逻辑是"阈值<=0时这项检查不生效"，不是机械按公式算。
    if (smallThresholdAmount <= 0) {
        return { name: '小额注单比例', games: gamesText(cfg.smallAmountOrderLimitGames),
            actual: 0, unit: '%', cmp: '≥', threshold: num(cfg.smallAmountOrderRatio), blocked: false,
            note: `投注金额阈值配置为${smallThresholdAmount}，该检查对任何注单都不可能触发，视为不生效（已用真实后台数据验证）` };
    }
    const small = orders.filter(o => num(o.betAmount) < smallThresholdAmount);
    const ratio = pct(small.length, orders.length);
    const threshold = num(cfg.smallAmountOrderRatio);
    return { name: '小额注单比例', games: gamesText(cfg.smallAmountOrderLimitGames),
        actual: ratio, unit: '%', cmp: '≥', threshold, blocked: orders.length > 0 && ratio >= threshold,
        note: `betAmount<${smallThresholdAmount}的单数${small.length}/总单数${orders.length}` };
}

function checkLowOddsAmount(cfg, allOrders) {
    const orders = excludeZeroProfit(allOrders);
    const lowOdds = num(cfg.lowOddsOfAmount);
    const sumBet = arr => arr.reduce((s, o) => s + num(o.betAmount), 0);
    const win = orders.filter(o => num(o.winAmount) > 0);
    const lowWin = win.filter(o => profitOf(o) < lowOdds);
    const low = sumBet(lowWin), total = sumBet(win);
    const ratio = pct(low, total);
    const threshold = num(cfg.lowOddsAmountRatio);
    return { name: '低赔率注单金额比例', games: gamesText(cfg.lowOddsAmountLimitGames),
        actual: ratio, unit: '%', cmp: '≥', threshold, blocked: total > 0 && ratio >= threshold,
        note: `低赔率中奖单betAmount ${f2(low)}(${lowWin.length}单)/总中奖单betAmount ${f2(total)}(${win.length}单)` };
}

// ============================================================
// 通用核对结果构造
// ============================================================
function compare(actual, cmp, threshold) {
    switch (cmp) {
        case '<': return actual < threshold;
        case '<=': case '≤': return actual <= threshold;
        case '>': return actual > threshold;
        case '>=': case '≥': return actual >= threshold;
        default: throw new Error('未知比较符 ' + cmp);
    }
}
function mkCheck(name, actual, cmp, threshold, unit, note) {
    const blocked = !compare(actual, cmp, threshold);
    return { name, actual, cmp, threshold, unit: unit || '', blocked, note: note || '', skip: false };
}
/** reason: 'disabled'=规则未启用该项，不适用；'no_data'=真的查不到数据源，无法核实 */
function mkSkip(name, note, reason = 'disabled') {
    return { name, actual: null, cmp: '', threshold: null, unit: '', blocked: false, note, skip: true, reason };
}

// ============================================================
// main
// ============================================================
export default function () {
    if (!USER_ID) throw new Error('请传 -e USER_ID=会员ID');
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error('后台登录失败');

    const listItem = getUserListItem(token);
    const packageId = Number(listItem.packageId);
    console.log(`[${TAG}] 会员 ${USER_ID} 渠道 packageId=${packageId}(${listItem.packageName})`);

    const cfg = pickConfig(token, packageId);
    const detail = getUserDetail(token);
    const base = detail.usersBaseRsp || {};
    const summary = detail.accountSummaryRsp || {};
    const funds = detail.accountFundsRsp || {};
    const today = detail.activeTodayRsp || {};
    const depositWithdraw = detail.userDepositWithdrawInfo || {};
    const registerSource = detail.registerSourceRsp || {};

    const sameDeviceCount = countByField(token, 'registerDevice', registerSource.registerDevice);
    const sameIpCount = countByField(token, 'registerIp', registerSource.registerIp);

    const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
    const manualRecharge3Day = sumArtificialRecharge(token, 3, threeDaysAgo);
    const bonusRecharge3Day = sumArtificialRecharge(token, 1, threeDaysAgo);

    const bankList = fetchAllBankBindings(token);
    const bankCheck = computeSameBankAccountCount(bankList);

    const dayProfit = num(today.prizeAmount) - num(today.betAmount);
    const winLose = num(summary.totalWinAmount) - num(summary.totalBetAmount);
    const withdrawRechargeRate = pct(num(summary.totalWithdrawAmount), num(summary.totalRechargeAmount));
    const maxWithdrawTime = computeMaxWithdrawTimeActual(summary, depositWithdraw);

    // ---------------- 逐项核对 ----------------
    const checks = [];

    // 渠道黑名单（逐项之一，不在匹配阶段静默处理）
    if (cfg.checkRejectPackage === 1) {
        const rejected = String(cfg.rejectPackageIds || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).includes(packageId);
        checks.push({ name: '渠道黑名单', actual: rejected ? '命中' : '未命中', cmp: '', threshold: '不应命中', unit: '', blocked: rejected, note: `rejectPackageIds=${cfg.rejectPackageIds}`, skip: false });
    } else {
        checks.push(mkSkip('渠道黑名单', '规则未启用该检查'));
    }

    if (WITHDRAW_AMOUNT !== null) checks.push(mkCheck('提款金额', WITHDRAW_AMOUNT, '<=', num(cfg.maxWithdrawAmount), ''));
    else checks.push(mkSkip('提款金额', '未传 -e WITHDRAW_AMOUNT=，跳过', 'need_param'));

    checks.push(mkCheck('当日盈利金额', dayProfit, '<=', num(cfg.dayProfitAmount), '', `今日prizeAmount${num(today.prizeAmount)}-betAmount${num(today.betAmount)}`));
    checks.push(mkCheck('三日内人工充值', manualRecharge3Day.total, '<=', num(cfg.manualRechargeOf3Day), '', `共${manualRecharge3Day.count}笔`));
    checks.push(mkCheck('三日内彩金充值', bonusRecharge3Day.total, '<=', num(cfg.bonusRechargeOf3Day), '', `共${bonusRecharge3Day.count}笔`));
    checks.push(mkCheck('账号余额', num(funds.walletBalance), '<', num(cfg.balance), ''));
    checks.push(mkCheck('首存金额', num(depositWithdraw.firstRechargeAmount), '<', num(cfg.firstDepositAmount), ''));
    checks.push(mkCheck('同设备数', sameDeviceCount, '<=', num(cfg.sameDeviceRegistCount), '', `registerDevice=${registerSource.registerDevice || '(空)'}`));
    checks.push(mkCheck('总提款/总充值', withdrawRechargeRate, '<=', num(cfg.maxWithdrawRechargeRate), '%'));
    checks.push(mkCheck('无充值连续提款次数', maxWithdrawTime.value, '<', num(cfg.maxWithdrawTime), '', maxWithdrawTime.note));
    checks.push(mkCheck('累计提款次数', num(summary.totalWithdrawCount), '>=', num(cfg.grandWithdrawTotal), ''));
    checks.push(mkCheck('同IP关联', sameIpCount, '<', num(cfg.sameIpRegistCount), '', `registerIp=${registerSource.registerIp || '(空)'}`));
    checks.push(mkCheck('同银行账户关联', bankCheck.count, '<', num(cfg.sameBankAccountCount), '', bankCheck.note || `cardNo=${bankCheck.cardNos.join(',')}`));
    checks.push(mkCheck('总充值金额', num(summary.totalRechargeAmount), '>', num(cfg.totalRechargeAmount), '', `totalRechargeAmountOpreationType=${cfg.totalRechargeAmountOpreationType}，运算符按">"假设，其它取值未确认`));
    checks.push(mkCheck('账号输赢', winLose, '<=', num(cfg.totalWinLoseAmount), '', '比较方向未经后台确认，按"≤"假设；= totalWinAmount - totalBetAmount'));
    checks.push(mkSkip('自动出款失败次数', '无数据源，无法核实，不计入综合结论', 'no_data'));
    // 注意：方向是 >=，不是 <=！后台真实拒绝文案是"用户总打码倍数0.1904小于配置15.0000，不允许自动出款"——
    // 打码倍数不够（流水没达标）才拒绝，已用真实账号(168568)验证过方向。
    checks.push(mkCheck('打码倍数(不含彩金)', num(summary.totalCodingMultiple), '>=', num(cfg.totalCodingAmountMultiple), '', '需达到最低打码倍数要求才允许出款（已用真实后台拒绝文案验证方向）'));
    checks.push(mkCheck('打码倍数(含彩金)', num(summary.totalCodingMultiple), '>=', num(cfg.totalCodingAmountMultipleWithBonus), '', '未找到含彩金的独立字段，暂用不含彩金的打码倍数代替，需确认；方向同上已验证'));

    if (cfg.needFirstRecharge === 1) {
        const hasRecharge = Number(summary.totalRechargeCount) > 0;
        checks.push({ name: '需要首次充值', actual: hasRecharge ? '已充值' : '未充值', cmp: '', threshold: '已充值', unit: '', blocked: !hasRecharge, note: `totalRechargeCount=${summary.totalRechargeCount}`, skip: false });
    } else checks.push(mkSkip('需要首次充值', '规则未启用该检查'));

    if (cfg.needUserNoRemark === 1) {
        const noRemark = !base.remark || base.remark === '';
        checks.push({ name: '需要用户不备注', actual: base.remark ? `备注:${base.remark}` : '(无备注)', cmp: '', threshold: '无备注', unit: '', blocked: !noRemark, note: '', skip: false });
    } else checks.push(mkSkip('需要用户不备注', '规则未启用该检查'));

    if (cfg.needLimitGroup === 1) {
        const allowGroups = String(cfg.limitGroup || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
        const inGroup = allowGroups.includes(Number(base.groupId));
        checks.push({ name: '是否限定分组', actual: `groupId=${base.groupId}(${base.groupName || '无分组名'})`, cmp: '', threshold: `属于分组[${cfg.limitGroup}]`, unit: '', blocked: !inGroup, note: '', skip: false });
    } else checks.push(mkSkip('是否限定分组', '规则未启用该检查'));

    if (cfg.checkRiskList === 1) {
        const risky = Array.isArray(listItem.riskReasons) && listItem.riskReasons.length > 0;
        checks.push({ name: '风险名单用户', actual: risky ? `命中:${listItem.riskReasons.join(',')}` : '未命中', cmp: '', threshold: '不应命中', unit: '', blocked: risky, note: '', skip: false });
    } else checks.push(mkSkip('风险名单用户', '规则未启用该检查'));

    if (cfg.checkBlackListUserIdAndIp === 1) {
        const blackIp = listItem.isBlackListIPTag === true;
        checks.push({ name: '黑名单用户/IP', actual: blackIp ? 'IP命中黑名单' : '未命中', cmp: '', threshold: '不应命中', unit: '', blocked: blackIp, note: '仅覆盖IP黑名单维度，用户ID黑名单未找到数据源，未覆盖', skip: false });
    } else checks.push(mkSkip('黑名单用户/IP', '规则未启用该检查'));

    const range = getRange();
    const betChecks = [
        { on: cfg.checkLowOddsOrderRatio === 1, games: cfg.lowOddsOrderLimitGames, run: checkLowOddsOrder, name: '低赔率注单比例' },
        { on: cfg.checkSmallAmountOrderRatio === 1, games: cfg.smallAmountOrderLimitGames, run: checkSmallAmount, name: '小额注单比例' },
        { on: cfg.checkLowOddsAmountRatio === 1, games: cfg.lowOddsAmountLimitGames, run: checkLowOddsAmount, name: '低赔率注单金额比例' }
    ];
    for (const c of betChecks) {
        if (!c.on) { checks.push(mkSkip(c.name, '规则未启用该检查')); continue; }
        const orders = fetchOrders(token, c.games, range);
        const r = c.run(cfg, orders);
        checks.push({ name: r.name, actual: r.actual, cmp: r.cmp, threshold: r.threshold, unit: r.unit, blocked: r.blocked, note: `生效游戏:${r.games}；${r.note}（近${DAYS}天）`, skip: false });
    }

    // ---------------- 输出 ----------------
    const lines = [];
    lines.push('');
    lines.push('================ 自动出款全项核对 ================');
    lines.push(`会员 ${USER_ID} | 渠道 ${packageId}(${listItem.packageName}) | 规则「${cfg.configName}」(id=${cfg.id})`);
    lines.push(`规则信息：允许虚拟出款=${cfg.allowVirtualWithdraw === 1 ? '是' : '否'}  允许转盘邀请自动出款=${cfg.allowInvitedWheelAutoWithdraw === 1 ? '是' : '否'}`);
    lines.push('--------------------------------------------------');
    for (const c of checks) {
        if (c.skip) { lines.push(`【${c.name}】${c.note}`); continue; }
        const actualStr = typeof c.actual === 'number' ? f2(c.actual) : c.actual;
        const thresholdStr = typeof c.threshold === 'number' ? `${c.cmp} ${f2(c.threshold)}${c.unit}` : c.threshold;
        lines.push(`【${c.name}】实际值 ${actualStr}${c.unit}  条件：${thresholdStr}  →  ${c.blocked ? '❌ 不满足' : '✅ 满足'}${c.note ? `（${c.note}）` : ''}`);
    }
    lines.push('--------------------------------------------------');
    const evaluated = checks.filter(c => !c.skip);
    const failed = evaluated.filter(c => c.blocked);
    const disabled = checks.filter(c => c.skip && c.reason === 'disabled');
    const needParam = checks.filter(c => c.skip && c.reason === 'need_param');
    const noData = checks.filter(c => c.skip && c.reason === 'no_data');
    lines.push(`综合结论：${failed.length === 0 ? '✅ 能自动出款（已核对项全部满足）' : `❌ 不能自动出款`}`);
    if (failed.length > 0) lines.push(`不满足的条件（共 ${failed.length} 项）：${failed.map(c => c.name).join('、')}`);
    if (noData.length > 0) lines.push(`⚠️ 无法核实的条件（真的没查到数据源，共 ${noData.length} 项）：${noData.map(c => c.name).join('、')}`);
    if (needParam.length > 0) lines.push(`⚠️ 缺参数未核对的条件（共 ${needParam.length} 项）：${needParam.map(c => c.name).join('、')}`);
    if (disabled.length > 0) lines.push(`规则未启用、不适用的条件（共 ${disabled.length} 项）：${disabled.map(c => c.name).join('、')}`);
    lines.push('==================================================');
    console.log(lines.join('\n'));
}
