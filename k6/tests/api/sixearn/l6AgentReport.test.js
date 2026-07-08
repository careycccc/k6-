import { sendQueryRequest } from '../common/request.js';
import { logger } from '../../../libs/utils/logger.js';
import { RebateLevel, RebateLevelRate } from './RebateLevel.test.js';
import { GetRechargeOrderPageList, sixearnTag } from './sixearn.test.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { sleep } from 'k6';

/***
 * k6 run -e TENANT_ID=3101 -e UID=112675 l6AgentReport.test.js
 */

// ============================================================
// 返佣计算 & 报表"有效投注/BetOrderAmount"所用金额基准。
// 系统三张返佣报表: 返佣(commission) = 有效投注(BetOrderAmount) × 费率, 二者同源。
//   'valid' = 有效投注(validAmountSum)   'bet' = 投注金额(betAmountSum)
// 依据系统报表③(GetListUserRebateLvReport): commission = 有效投注 × 费率, 故默认 'valid'。
// 若与系统对比时"有效投注/返佣"整列 ❌, 把此处改成 'bet' 即可。
// ============================================================
const REBATE_BASE = 'valid';

// 获取目标日期范围
function getTargetDateRange() {
    const envDate = __ENV.START_DATE; // e.g., "2026-07-03"   
    //const envDate = "2026-07-05";  // 这个是手动的指定日期，记住这里的日期，如果你要查询7.4的返佣就要输入7.5
    let targetDate;
    if (envDate) {
        const parts = envDate.split('-');
        targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
        targetDate.setDate(targetDate.getDate() - 1);
    } else {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 1);
    }

    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');

    // 派发日期 = 统计日期次日 (投注日的返佣在次日凌晨派发)
    const distribute = new Date(targetDate);
    distribute.setDate(distribute.getDate() + 1);
    const dy = distribute.getFullYear();
    const dm = String(distribute.getMonth() + 1).padStart(2, '0');
    const dd = String(distribute.getDate()).padStart(2, '0');

    return {
        startTs: start.getTime(),
        endTs: end.getTime(),
        startDateStr: `${y}-${m}-${d} 00:00:00`,
        endDateStr: `${y}-${m}-${d} 23:59:59`,
        dateStr: `${y}-${m}-${d}`,
        distributeDateStr: `${dy}-${dm}-${dd}`
    };
}

function buildChildrenMap(memberList) {
    const map = {};
    memberList.forEach((m) => {
        if (!map[m.userId]) map[m.userId] = [];
        if (m.parentId && m.parentId !== 0) {
            if (!map[m.parentId]) map[m.parentId] = [];
            map[m.parentId].push(m.userId);
        }
    });
    return map;
}

function getDescendants(userId, childrenMap) {
    const result = [];
    const stack = [...(childrenMap[userId] || [])];
    while (stack.length > 0) {
        const current = stack.pop();
        result.push(current);
        const children = childrenMap[current] || [];
        children.forEach((c) => stack.push(c));
    }
    return result;
}

// ---- 显示宽度对齐辅助 (中文全角字符按 2 个宽度计算) ----
function dispWidth(s) {
    s = String(s);
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
    return w;
}
function padEndW(s, width) {
    s = String(s);
    const pad = width - dispWidth(s);
    return pad > 0 ? s + ' '.repeat(pad) : s;
}
function padStartW(s, width) {
    s = String(s);
    const pad = width - dispWidth(s);
    return pad > 0 ? ' '.repeat(pad) + s : s;
}
const money = (v) => Number(v || 0).toFixed(2);
const money4 = (v) => Number(v || 0).toFixed(4);

// 各游戏类型映射: [展示名, 系统字段前缀, 本地(byLayer)字段前缀]
const GAMES = [
    { label: '彩票', sysK: 'lottery', myK: 'lottery' },
    { label: '电子', sysK: 'electronic', myK: 'elec' },
    { label: '视讯', sysK: 'video', myK: 'live' },
    { label: '体育', sysK: 'sports', myK: 'sports' },
    { label: '棋牌', sysK: 'chessCard', myK: 'chess' }
];

// 查询单个成员各游戏类型投注 (串行 5 次: categoryType 0电子 1真人 2体育 3彩票 4棋牌)。
//   投注金额(betAmount) 与 有效投注(validAmount) 一次取回;
//   按 REBATE_BASE 选定"基准金额"写入数组(供返佣计算 & 有效投注展示),
//   投注金额合计(betAmountSum) 仅用于"投注人数"判定(有投注即算, 即使有效投注为0)。
function fetchBetData(data, enriched, startTs, endTs) {
    const api = '/api/ThirdGame/GetBetRecordPageList';
    let betTotal = 0, validTotal = 0;
    for (let j = 0; j < 5; j++) {
        const payload = {
            categoryType: j, queryTimeType: 'BetTime', userId: enriched.userId,
            beginTimeUnix: startTs, endTimeUnix: endTs, pageSize: 200, sortField: 'BetTime'
        };
        let result = sendQueryRequest(payload, api, sixearnTag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { continue; }
        }

        let betAmt = 0, validAmt = 0;
        if (result && result.sum) {
            betAmt = parseFloat(result.sum.betAmountSum) || 0;
            validAmt = parseFloat(result.sum.validAmountSum) || 0;
        } else if (result && result.list && result.list.length > 0) {
            result.list.forEach((item) => {
                betAmt += parseFloat(item.betAmount) || 0;
                validAmt += parseFloat(item.validAmount) || 0;
            });
        }
        betTotal += betAmt;
        validTotal += validAmt;

        const orderAmt = REBATE_BASE === 'valid' ? validAmt : betAmt;
        if (j === 0) enriched.electronicGame.push(orderAmt);
        else if (j === 1) enriched.liveCasino.push(orderAmt);
        else if (j === 2) enriched.sports.push(orderAmt);
        else if (j === 3) enriched.lottery.push(orderAmt);
        else if (j === 4) enriched.chessCard.push(orderAmt);
    }

    const sum = (arr) => arr.reduce((s, v) => s + v, 0);
    enriched.orderAmountSum =
        sum(enriched.electronicGame) + sum(enriched.liveCasino) +
        sum(enriched.sports) + sum(enriched.lottery) + sum(enriched.chessCard);
    enriched.betAmountSum = betTotal;
    enriched.validAmountSum = validTotal;
    enriched.hasBet = betTotal > 0;
    return enriched;
}

// 查询单个成员的 充值 + 投注 数据并汇总。
function fetchMemberData(data, member, startTs, endTs) {
    const enriched = {
        userId: member.userId, parentId: member.parentId, hierarchy: member.hierarchy,
        rebateState: member.rebateState, rebateMode: member.rebateMode, rebateLevel: member.rebateLevel,
        electronicGame: [], liveCasino: [], sports: [], lottery: [], chessCard: [],
        orderAmountSum: 0, betAmountSum: 0, validAmountSum: 0, hasBet: false,
        totalRechargeAmount: 0
    };

    // 充值
    const rechargeList = GetRechargeOrderPageList(data, member.userId, 'Payed', startTs, endTs);
    if (rechargeList && rechargeList.length > 0) {
        rechargeList.forEach((item) => {
            const amt = Number(item.actualAmount || 0);
            if (!isNaN(amt)) enriched.totalRechargeAmount = (enriched.totalRechargeAmount * 100 + amt * 100) / 100;
        });
    }

    // 投注
    fetchBetData(data, enriched, startTs, endTs);

    return enriched;
}

// 匹配返佣等级: 从高到低扫描, 命中第一个"团队三项 + 直属三项"全部达标的等级。
function computeNormalEarnLevel(stats, rebateLevelList) {
    const sorted = [...rebateLevelList].sort((a, b) => b.rebateLevel - a.rebateLevel);
    for (const cfg of sorted) {
        if (
            stats.teamRechargeCount >= cfg.childrenRechargeCount &&
            stats.teamRechargeAmount >= cfg.childrenRechargeAmount &&
            stats.teamValidBet >= cfg.childrenLotteryAmount &&
            stats.directRechargeCount >= cfg.directChildrenRechargeCount &&
            stats.directRechargeAmount >= cfg.directChildrenRechargeAmount &&
            stats.directValidBet >= cfg.directChildrenValidAmount
        ) {
            return cfg.rebateLevel;
        }
    }
    return 0;
}

function getRateConfigForLevel(rebateLevel, rebateRateList) {
    const entry = rebateRateList.find((r) => r.rebateLevel === rebateLevel);
    if (!entry || !entry.list) return null;
    return entry.list.filter((item) => item.hierarchy > 0);
}

// 返佣 = 各游戏类型基准金额 × 费率 / 100
function calculateContribution(rateItem, desc, relHier) {
    const sum = (arr) => arr.reduce((s, v) => s + v, 0);
    const betElectronic = sum(desc.electronicGame), betLive = sum(desc.liveCasino),
        betSports = sum(desc.sports), betLottery = sum(desc.lottery), betChess = sum(desc.chessCard);

    const rE = rateItem ? rateItem.rateElectronic : 0;
    const rV = rateItem ? rateItem.rateVideo : 0;
    const rS = rateItem ? rateItem.rateSports : 0;
    const rL = rateItem ? rateItem.rateLottery : 0;
    const rC = rateItem ? rateItem.rateChessCard : 0;

    const electronearn = betElectronic * rE / 100;
    const liveCasinoearn = betLive * rV / 100;
    const sportsearn = betSports * rS / 100;
    const lotteryearn = betLottery * rL / 100;
    const chessCardearn = betChess * rC / 100;
    const total = electronearn + liveCasinoearn + sportsearn + lotteryearn + chessCardearn;

    return {
        userId: desc.userId, relHier,
        electronearn, liveCasinoearn, sportsearn, lotteryearn, chessCardearn, total,
        betElectronic, betLive, betSports, betLottery, betChess,
        rateElectronic: rE, rateVideo: rV, rateSports: rS, rateLottery: rL, rateChessCard: rC
    };
}

// 打印"投注/返佣贡献"明细表, 底部含合计行。showLevel=true 时额外显示"层级"列。
function printContribTable(title, list, showLevel) {
    const W = showLevel ? 142 : 136;
    const buildRow = (first, level, cells) => {
        const arr = [padEndW(first, 12)];
        if (showLevel) arr.push(padStartW(level, 6));
        for (let i = 0; i < cells.length; i++) arr.push(padStartW(cells[i], i === cells.length - 1 ? 12 : 11));
        return `  ${arr.join('')}`;
    };

    console.log(title);
    console.log(`${'─'.repeat(W)}`);
    console.log(buildRow('下级UID', '层级', ['电子有效投注', '电子返佣', '真人有效投注', '真人返佣', '体育有效投注', '体育返佣', '彩票有效投注', '彩票返佣', '棋牌有效投注', '棋牌返佣', '贡献合计']));
    console.log(`${'─'.repeat(W)}`);

    if (list.length === 0) {
        console.log(`  无数据`);
        console.log(`${'─'.repeat(W)}\n`);
        return;
    }

    const t = { betElectronic: 0, electronearn: 0, betLive: 0, liveCasinoearn: 0, betSports: 0, sportsearn: 0, betLottery: 0, lotteryearn: 0, betChess: 0, chessCardearn: 0, total: 0 };
    list.forEach(sub => {
        console.log(buildRow(String(sub.userId), 'L' + sub.relHier, [
            money(sub.betElectronic), money(sub.electronearn), money(sub.betLive), money(sub.liveCasinoearn),
            money(sub.betSports), money(sub.sportsearn), money(sub.betLottery), money(sub.lotteryearn),
            money(sub.betChess), money(sub.chessCardearn), money(sub.total)
        ]));
        Object.keys(t).forEach(k => { t[k] += (sub[k] || 0); });
    });
    console.log(`${'─'.repeat(W)}`);
    console.log(buildRow('合计', '-', [
        money(t.betElectronic), money(t.electronearn), money(t.betLive), money(t.liveCasinoearn),
        money(t.betSports), money(t.sportsearn), money(t.betLottery), money(t.lotteryearn),
        money(t.betChess), money(t.chessCardearn), money(t.total)
    ]));
    console.log(`${'─'.repeat(W)}\n`);
}

// 逐字段对比"系统值 vs 计算值", 不一致用 ❌ 标出, 末尾汇总不一致字段。返回不一致字段名数组。
// rows: [{ name, sys, calc, exact }]  exact=true 精确相等, 否则金额按 tol 容差
function printComparison(title, rows, tol) {
    console.log(`\n${'═'.repeat(74)}`);
    console.log(`🔍 ${title}`);
    console.log(`${'═'.repeat(74)}`);
    console.log(`  ${padEndW('字段', 16)}${padStartW('系统值', 16)}${padStartW('计算值', 16)}${padStartW('差异', 12)}  结果`);
    console.log(`${'─'.repeat(74)}`);

    const failed = [];
    rows.forEach(row => {
        const sysN = Number(row.sys || 0), calcN = Number(row.calc || 0), diff = sysN - calcN;
        const ok = row.exact ? (sysN === calcN) : (Math.abs(diff) <= tol);
        if (!ok) failed.push(row.name);
        const fmt = (v) => row.exact ? String(Number(v || 0)) : Number(v || 0).toFixed(2);
        const diffStr = row.exact ? String(diff) : diff.toFixed(2);
        console.log(`  ${padEndW(row.name, 16)}${padStartW(fmt(row.sys), 16)}${padStartW(fmt(row.calc), 16)}${padStartW(diffStr, 12)}  ${ok ? '✅' : '❌'}`);
    });

    console.log(`${'─'.repeat(74)}`);
    if (failed.length === 0) console.log(`  ✅ 全部 ${rows.length} 个字段一致`);
    else console.log(`  ❌ 存在 ${failed.length} 个不一致字段: ${failed.join('、')}`);
    console.log(`${'═'.repeat(74)}\n`);
    return failed;
}

// ---- 系统报表查询 ----
// 报表① 返佣数据报表 (团队/直属汇总)
function fetchSystemAgentRebate(data, userId, dateStr) {
    const payload = { reportDate: `${dateStr} 00:00:00`, userId, pageNo: 1, pageSize: 20, orderBy: 'Desc', isAll: false };
    let result = sendQueryRequest(payload, '/api/Agent/GetPageListAgentRebate', sixearnTag, false, data.token);
    if (typeof result !== 'object') { try { result = JSON.parse(result); } catch (e) { return null; } }
    const c = (result && result.data) ? result.data : result;
    if (c && Array.isArray(c.list) && c.list.length > 0) return c.list.find(x => Number(x.userId) === Number(userId)) || c.list[0];
    return null;
}
// 报表② 会员返佣明细 (指定层级的每个成员)
function fetchSystemUserRebate(data, userId, dateStr, hierarchy) {
    const payload = { userId, reportDate: `${dateStr} 00:00:00`, hierarchy, orderBy: 'Desc', pageNo: 1, pageSize: 500 };
    let result = sendQueryRequest(payload, '/api/Agent/GetPageListUserRebate', sixearnTag, false, data.token);
    if (typeof result !== 'object') { try { result = JSON.parse(result); } catch (e) { return null; } }
    const c = (result && result.data) ? result.data : result;
    return (c && Array.isArray(c.list)) ? c.list : null;
}
// 报表③ 分层级返佣报表 (sumTotal + list[layer 1..6])
function fetchSystemLvReport(data, userId, dateStr) {
    const payload = { userId, reportDate: `${dateStr} 00:00:00` };
    let result = sendQueryRequest(payload, '/api/Agent/GetListUserRebateLvReport', sixearnTag, false, data.token);
    if (typeof result !== 'object') { try { result = JSON.parse(result); } catch (e) { return null; } }
    return (result && result.data) ? result.data : result;
}

export function l6AgentReport(data, targetUid) {
    if (!targetUid) {
        logger.error('[l6AgentReport] 缺少必填参数: targetUid');
        return;
    }
    const accountId = Number(targetUid);
    const dateRange = getTargetDateRange();
    const { startTs, endTs, startDateStr, endDateStr, dateStr, distributeDateStr } = dateRange;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 会员团队统计及返佣明细报表 - UID: ${accountId}`);
    console.log(`   统计日期: ${dateStr}  |  返佣基准: ${REBATE_BASE === 'valid' ? '有效投注(validAmount)' : '投注金额(betAmount)'}`);
    console.log(`${'='.repeat(80)}\n`);

    // 1. 查询该用户及其下级
    const agentPayload = { userId: accountId, isAll: true, isIncludeSelfAndParent: true, pageNo: 1, pageSize: 1000 };
    let agentResult = sendQueryRequest(agentPayload, '/api/Agent/GetPageListAgentList', sixearnTag, false, data.token);
    if (typeof agentResult === 'string') { try { agentResult = JSON.parse(agentResult); } catch (e) { return; } }

    let memberList = [];
    if (agentResult && Array.isArray(agentResult.list)) memberList = agentResult.list;
    else if (agentResult && agentResult.data && Array.isArray(agentResult.data.list)) memberList = agentResult.data.list;

    if (!memberList || memberList.length === 0) {
        console.error(`[l6AgentReport] 未查询到 UID=${accountId} 及其下级数据。`);
        return;
    }
    const masterRecord = memberList.find(m => m.userId === accountId);
    if (!masterRecord) {
        console.error(`[l6AgentReport] 团队列表中找不到目标 UID=${accountId} 自身记录。`);
        return;
    }
    const masterHierarchy = masterRecord.hierarchy;

    // 2. 获取返佣配置
    const rebateLevelList = RebateLevel(data);
    const rebateRateList = RebateLevelRate(data);
    let maxRebateHier = 6;
    if (rebateRateList) {
        rebateRateList.forEach(entry => {
            if (entry.list && Array.isArray(entry.list)) {
                const h = Math.max(...entry.list.filter(item => item.hierarchy > 0).map(r => r.hierarchy));
                if (h > maxRebateHier) maxRebateHier = h;
            }
        });
    }

    // 3. 过滤需查询的下级 (相对层级 <= maxRebateHier)
    const childrenMap = buildChildrenMap(memberList);
    const descendantIds = getDescendants(accountId, childrenMap);
    const validMembers = [];
    descendantIds.forEach(id => {
        const m = memberList.find(x => x.userId === id);
        if (m && m.hierarchy - masterHierarchy <= maxRebateHier) validMembers.push(m);
    });

    console.log(`[l6AgentReport] 正在查询 ${validMembers.length} 名有效下级的充投数据...`);
    const memberDataMap = {};
    validMembers.forEach((member) => {
        sleep(0.3);
        memberDataMap[member.userId] = fetchMemberData(data, member, startTs, endTs);
    });

    // ============================================================
    // 4. 团队 / 直属 汇总 (人数按"有投注"计, 金额按"有效投注"计)
    // ============================================================
    const reportData = {
        teamRechargeCount: 0, teamRechargeAmount: 0, teamBetCount: 0, teamBetAmount: 0,
        directRechargeCount: 0, directRechargeAmount: 0, directBetCount: 0, directBetAmount: 0,
        validLottery: 0, validElec: 0, validLive: 0, validSports: 0, validChess: 0,
        rebateLottery: 0, rebateElec: 0, rebateLive: 0, rebateSports: 0, rebateChess: 0,
        totalRebate: 0
    };
    const zeroValidBetMembers = [];

    validMembers.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        const relHier = m.hierarchy - masterHierarchy;

        if (d.totalRechargeAmount > 0) reportData.teamRechargeCount++;
        reportData.teamRechargeAmount += d.totalRechargeAmount;
        if (d.hasBet) reportData.teamBetCount++;
        reportData.teamBetAmount += d.orderAmountSum;

        if (d.hasBet && d.validAmountSum <= 0) zeroValidBetMembers.push({ userId: m.userId, relHier, betAmount: d.betAmountSum });

        if (relHier === 1) {
            if (d.totalRechargeAmount > 0) { reportData.directRechargeCount++; reportData.directRechargeAmount += d.totalRechargeAmount; }
            if (d.hasBet) reportData.directBetCount++;
            reportData.directBetAmount += d.orderAmountSum;
        }
    });

    // ============================================================
    // 5. 确定返佣等级 (团队三项 + 直属三项 六门槛), 计算返佣与逐层明细
    // ============================================================
    let earnLevel = 0;
    if (masterRecord.rebateMode === 1) {
        earnLevel = masterRecord.rebateLevel;
    } else {
        const normalLevel = computeNormalEarnLevel({
            teamRechargeCount: reportData.teamRechargeCount,
            teamRechargeAmount: reportData.teamRechargeAmount,
            teamValidBet: reportData.teamBetAmount,
            directRechargeCount: reportData.directRechargeCount,
            directRechargeAmount: reportData.directRechargeAmount,
            directValidBet: reportData.directBetAmount
        }, rebateLevelList);
        earnLevel = masterRecord.rebateMode === 2 ? Math.max(masterRecord.rebateLevel, normalLevel) : normalLevel;
    }

    const rateConfig = getRateConfigForLevel(earnLevel, rebateRateList);
    const teamSubDetails = [];
    const directSubDetails = [];
    const byLayer = {};
    const ensureLayer = (h) => {
        if (!byLayer[h]) byLayer[h] = {
            layer: h, rechargePeoples: 0, rechargeAmount: 0,
            elecOrder: 0, elecRebate: 0, elecPeoples: 0,
            liveOrder: 0, liveRebate: 0, livePeoples: 0,
            sportsOrder: 0, sportsRebate: 0, sportsPeoples: 0,
            lotteryOrder: 0, lotteryRebate: 0, lotteryPeoples: 0,
            chessOrder: 0, chessRebate: 0, chessPeoples: 0,
            totalRebate: 0, members: []
        };
        return byLayer[h];
    };

    validMembers.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        const relHier = m.hierarchy - masterHierarchy;
        const rateItem = rateConfig ? rateConfig.find(x => x.hierarchy === relHier) : null;
        const c = calculateContribution(rateItem, d, relHier);

        reportData.validElec += c.betElectronic; reportData.rebateElec += c.electronearn;
        reportData.validLive += c.betLive; reportData.rebateLive += c.liveCasinoearn;
        reportData.validSports += c.betSports; reportData.rebateSports += c.sportsearn;
        reportData.validLottery += c.betLottery; reportData.rebateLottery += c.lotteryearn;
        reportData.validChess += c.betChess; reportData.rebateChess += c.chessCardearn;
        reportData.totalRebate += c.total;

        const L = ensureLayer(relHier);
        if (d.totalRechargeAmount > 0) L.rechargePeoples++;
        L.rechargeAmount += d.totalRechargeAmount;
        L.elecOrder += c.betElectronic; L.elecRebate += c.electronearn; if (c.betElectronic > 0) L.elecPeoples++;
        L.liveOrder += c.betLive; L.liveRebate += c.liveCasinoearn; if (c.betLive > 0) L.livePeoples++;
        L.sportsOrder += c.betSports; L.sportsRebate += c.sportsearn; if (c.betSports > 0) L.sportsPeoples++;
        L.lotteryOrder += c.betLottery; L.lotteryRebate += c.lotteryearn; if (c.betLottery > 0) L.lotteryPeoples++;
        L.chessOrder += c.betChess; L.chessRebate += c.chessCardearn; if (c.betChess > 0) L.chessPeoples++;
        L.totalRebate += c.total;
        L.members.push({ userId: d.userId, elec: c.betElectronic, live: c.betLive, sports: c.betSports, lottery: c.betLottery, chess: c.betChess, order: d.orderAmountSum, commission: c.total });

        teamSubDetails.push(c);
        if (relHier === 1) directSubDetails.push(c);
    });
    teamSubDetails.sort((a, b) => (a.relHier - b.relHier) || (a.userId - b.userId));

    // ============================================================
    // 6. 打印汇总报表 (对应网页派发记录; 已去掉"日期"和"会员ID")
    // ============================================================
    const r = reportData;
    const kv = (label, value) => `  ${padEndW(label, 14)}${padStartW(value, 14)}`;

    console.log(`\n${'═'.repeat(52)}`);
    console.log(`  📊 团队返佣派发预估   UID=${accountId}   返佣等级 L${earnLevel}`);
    console.log(`${'═'.repeat(52)}`);
    console.log(`  ── 团队 ──────────────────────────`);
    console.log(kv('团队充值人数', String(r.teamRechargeCount)));
    console.log(kv('团队充值金额', money(r.teamRechargeAmount)));
    console.log(kv('团队投注人数', String(r.teamBetCount)));
    console.log(kv('团队有效投注', money(r.teamBetAmount)));
    console.log(`  ── 直属 ──────────────────────────`);
    console.log(kv('直属充值人数', String(r.directRechargeCount)));
    console.log(kv('直属充值金额', money(r.directRechargeAmount)));
    console.log(kv('直属投注人数', String(r.directBetCount)));
    console.log(kv('直属有效投注', money(r.directBetAmount)));
    console.log(`  ── 各游戏类型 (有效投注 / 返佣金额) ──`);
    console.log(`  ${padEndW('类型', 8)}${padStartW('有效投注', 16)}${padStartW('返佣金额', 16)}`);
    const gameRow = (name, bet, rebate) => `  ${padEndW(name, 8)}${padStartW(money(bet), 16)}${padStartW(money(rebate), 16)}`;
    console.log(gameRow('彩票', r.validLottery, r.rebateLottery));
    console.log(gameRow('电子', r.validElec, r.rebateElec));
    console.log(gameRow('视讯', r.validLive, r.rebateLive));
    console.log(gameRow('体育', r.validSports, r.rebateSports));
    console.log(gameRow('棋牌', r.validChess, r.rebateChess));
    console.log(`  ${'─'.repeat(40)}`);
    console.log(kv('计算返佣金额', money(r.totalRebate)));
    console.log(kv('派发返佣金额', money(r.totalRebate)));
    console.log(kv('派发时间', distributeDateStr));
    console.log(`${'═'.repeat(52)}\n`);

    if (zeroValidBetMembers.length > 0) {
        console.log(`⚠️  有投注但有效投注为0的会员 (共 ${zeroValidBetMembers.length} 人, 已计入投注人数):`);
        zeroValidBetMembers.forEach(z => console.log(`   └─ 会员ID=${z.userId}  层级=L${z.relHier}  投注金额=${money(z.betAmount)}`));
        console.log('');
    }

    // ============================================================
    // 7. 明细报表: 直属下级(L1) + 整个团队, 各自底部含合计行
    // ============================================================
    printContribTable(`📋 直属下级 (L1) 投注与返佣贡献明细`, directSubDetails, false);
    printContribTable(`📋 整个团队 投注与返佣贡献明细 (共 ${teamSubDetails.length} 人)`, teamSubDetails, true);

    // ============================================================
    // 8. 返佣计算明细 (逐层 逐游戏: 有效投注 × 费率 = 返佣)
    // ============================================================
    console.log(`\n${'═'.repeat(72)}`);
    console.log(`🧮 返佣计算步骤明细   返佣等级 L${earnLevel}   (返佣 = 有效投注 × 费率)`);
    console.log(`${'═'.repeat(72)}`);
    let grandRebate = 0;
    for (let h = 1; h <= maxRebateHier; h++) {
        const L = byLayer[h];
        const rateItem = rateConfig ? rateConfig.find(x => x.hierarchy === h) : null;
        if (!L) continue;
        console.log(`  ── 层级 L${h} ──  充值 ${L.rechargePeoples}人 / ${money(L.rechargeAmount)}   本层返佣小计: ${money4(L.totalRebate)}`);
        const gameCalc = [
            ['彩票', L.lotteryOrder, rateItem ? rateItem.rateLottery : 0, L.lotteryRebate],
            ['电子', L.elecOrder, rateItem ? rateItem.rateElectronic : 0, L.elecRebate],
            ['视讯', L.liveOrder, rateItem ? rateItem.rateVideo : 0, L.liveRebate],
            ['体育', L.sportsOrder, rateItem ? rateItem.rateSports : 0, L.sportsRebate],
            ['棋牌', L.chessOrder, rateItem ? rateItem.rateChessCard : 0, L.chessRebate]
        ];
        let anyBet = false;
        gameCalc.forEach(([name, order, rate, rebate]) => {
            if (order > 0) {
                anyBet = true;
                console.log(`     ${name}: 有效投注 ${money(order)} × 费率 ${rate}% (=${(Number(rate) / 100).toFixed(6)}) = ${money4(rebate)}`);
            }
        });
        if (!anyBet) console.log(`     (本层无有效投注)`);
        grandRebate += L.totalRebate;
    }
    console.log(`  ${'─'.repeat(68)}`);
    console.log(`  合计返佣 = ${money4(grandRebate)}`);
    console.log(`${'═'.repeat(72)}\n`);

    // ============================================================
    // 9. 报表① 对比: /api/Agent/GetPageListAgentRebate (团队/直属汇总)
    // ============================================================
    const sysRebate = fetchSystemAgentRebate(data, accountId, dateStr);
    if (!sysRebate) {
        console.log(`⚠️  未获取到系统报表①(GetPageListAgentRebate), 跳过对比\n`);
    } else {
        printComparison(`报表① 返佣数据报表对比 (系统 vs 计算)  报表日=${dateStr}`, [
            { name: '返佣等级', sys: sysRebate.rebateLevel, calc: earnLevel, exact: true },
            { name: '团队充值人数', sys: sysRebate.rechargePeoples, calc: r.teamRechargeCount, exact: true },
            { name: '团队充值金额', sys: sysRebate.rechargeAmount, calc: r.teamRechargeAmount, exact: false },
            { name: '团队投注人数', sys: sysRebate.betPeoples, calc: r.teamBetCount, exact: true },
            { name: '团队有效投注', sys: sysRebate.betAmount, calc: r.teamBetAmount, exact: false },
            { name: '直属充值人数', sys: sysRebate.rechargePeoples_L1, calc: r.directRechargeCount, exact: true },
            { name: '直属充值金额', sys: sysRebate.rechargeAmount_L1, calc: r.directRechargeAmount, exact: false },
            { name: '直属投注人数', sys: sysRebate.betPeoples_L1, calc: r.directBetCount, exact: true },
            { name: '直属有效投注', sys: sysRebate.betAmount_L1, calc: r.directBetAmount, exact: false },
            { name: '电子有效投注', sys: sysRebate.electronicBetOrderAmount, calc: r.validElec, exact: false },
            { name: '电子返佣', sys: sysRebate.electronicCommission, calc: r.rebateElec, exact: false },
            { name: '视讯有效投注', sys: sysRebate.videoBetOrderAmount, calc: r.validLive, exact: false },
            { name: '视讯返佣', sys: sysRebate.videoCommission, calc: r.rebateLive, exact: false },
            { name: '体育有效投注', sys: sysRebate.sportsBetOrderAmount, calc: r.validSports, exact: false },
            { name: '体育返佣', sys: sysRebate.sportsCommission, calc: r.rebateSports, exact: false },
            { name: '彩票有效投注', sys: sysRebate.lotteryBetOrderAmount, calc: r.validLottery, exact: false },
            { name: '彩票返佣', sys: sysRebate.lotteryCommission, calc: r.rebateLottery, exact: false },
            { name: '棋牌有效投注', sys: sysRebate.chessCardBetOrderAmount, calc: r.validChess, exact: false },
            { name: '棋牌返佣', sys: sysRebate.chessCardCommission, calc: r.rebateChess, exact: false },
            { name: '计算返佣金额', sys: sysRebate.totalCommission, calc: r.totalRebate, exact: false },
            { name: '派发返佣金额', sys: sysRebate.totalCommissioned, calc: r.totalRebate, exact: false }
        ], 0.01);
    }

    // ============================================================
    // 10. 报表③ 对比: /api/Agent/GetListUserRebateLvReport (逐层)
    // ============================================================
    const sysLv = fetchSystemLvReport(data, accountId, dateStr);
    const sysByLayer = {}; // 报表③ 逐层 (供横向一致性对比)
    if (!sysLv) {
        console.log(`⚠️  未获取到系统报表③(GetListUserRebateLvReport), 跳过对比\n`);
    } else {
        // 逐层对比 (只列出双方非全零的游戏, 减少噪音)
        (sysLv.list || []).forEach(x => { sysByLayer[x.layer] = x; });
        for (let h = 1; h <= maxRebateHier; h++) {
            const s = sysByLayer[h];
            const L = byLayer[h];
            if (!s && !L) continue;
            const sObj = s || {};
            const rows = [
                { name: '充值人数', sys: sObj.rechargePeoples, calc: L ? L.rechargePeoples : 0, exact: true },
                { name: '充值金额', sys: sObj.rechargeAmount, calc: L ? L.rechargeAmount : 0, exact: false }
            ];
            GAMES.forEach(g => {
                const sO = Number(sObj[g.sysK + 'BetOrderAmount'] || 0), sC = Number(sObj[g.sysK + 'Commission'] || 0), sP = Number(sObj[g.sysK + 'BetPeoples'] || 0);
                const mO = L ? L[g.myK + 'Order'] : 0, mC = L ? L[g.myK + 'Rebate'] : 0, mP = L ? L[g.myK + 'Peoples'] : 0;
                if (sO || sC || sP || mO || mC || mP) {
                    rows.push({ name: g.label + '有效投注', sys: sO, calc: mO, exact: false });
                    rows.push({ name: g.label + '返佣', sys: sC, calc: mC, exact: false });
                    rows.push({ name: g.label + '投注人数', sys: sP, calc: mP, exact: true });
                }
            });
            printComparison(`报表③ 层级 L${h} 对比 (系统 vs 计算)`, rows, 0.01);
        }
        // sumTotal (整个团队): 系统 per-game 金额为0(系统汇总不填), 只对比充值 + 各游戏投注人数
        const sum = sysLv.sumTotal || {};
        const teamPeoples = { lottery: 0, elec: 0, live: 0, sports: 0, chess: 0 };
        Object.keys(byLayer).forEach(h => {
            const L = byLayer[h];
            teamPeoples.lottery += L.lotteryPeoples; teamPeoples.elec += L.elecPeoples;
            teamPeoples.live += L.livePeoples; teamPeoples.sports += L.sportsPeoples; teamPeoples.chess += L.chessPeoples;
        });
        printComparison(`报表③ 团队汇总(sumTotal) 对比`, [
            { name: '团队充值人数', sys: sum.rechargePeoples, calc: r.teamRechargeCount, exact: true },
            { name: '团队充值金额', sys: sum.rechargeAmount, calc: r.teamRechargeAmount, exact: false },
            { name: '彩票投注人数', sys: sum.lotteryBetPeoples, calc: teamPeoples.lottery, exact: true },
            { name: '电子投注人数', sys: sum.electronicBetPeoples, calc: teamPeoples.elec, exact: true },
            { name: '视讯投注人数', sys: sum.videoBetPeoples, calc: teamPeoples.live, exact: true },
            { name: '体育投注人数', sys: sum.sportsBetPeoples, calc: teamPeoples.sports, exact: true },
            { name: '棋牌投注人数', sys: sum.chessCardBetPeoples, calc: teamPeoples.chess, exact: true }
        ], 0.01);
    }

    // ============================================================
    // 11. 报表② 对比: /api/Agent/GetPageListUserRebate (逐层逐会员, hierarchy 1..6)
    // ============================================================
    console.log(`\n${'═'.repeat(74)}`);
    console.log(`🔍 报表② 会员返佣明细逐层逐人对比 (系统 vs 计算)`);
    console.log(`${'═'.repeat(74)}`);
    const r2ByLayer = {}; // 报表② 每层汇总(由成员明细累加), 供横向一致性对比
    for (let h = 1; h <= maxRebateHier; h++) {
        sleep(0.2);
        const sysList = fetchSystemUserRebate(data, accountId, dateStr, h);
        const myMembers = (byLayer[h] && byLayer[h].members) ? byLayer[h].members : [];
        if (sysList === null) { console.log(`  ⚠️  层级 L${h}: 未获取到系统报表②, 跳过`); continue; }

        let r2o = 0, r2c = 0;
        sysList.forEach(x => {
            r2o += Number(x.lotteryBetOrderAmount || 0) + Number(x.electronicBetOrderAmount || 0) + Number(x.videoBetOrderAmount || 0) + Number(x.sportsBetOrderAmount || 0) + Number(x.chessCardBetOrderAmount || 0);
            r2c += Number(x.commissionAmount || 0);
        });
        r2ByLayer[h] = { order: r2o, rebate: r2c };

        const sysMap = {}, myMap = {}, allIds = {};
        sysList.forEach(x => { sysMap[Number(x.userId)] = x; allIds[Number(x.userId)] = 1; });
        myMembers.forEach(x => { myMap[Number(x.userId)] = x; allIds[Number(x.userId)] = 1; });

        const problems = [];
        Object.keys(allIds).forEach(uidStr => {
            const uid = Number(uidStr);
            const s = sysMap[uid], m = myMap[uid];
            const sOrder = s ? (Number(s.lotteryBetOrderAmount || 0) + Number(s.electronicBetOrderAmount || 0) + Number(s.videoBetOrderAmount || 0) + Number(s.sportsBetOrderAmount || 0) + Number(s.chessCardBetOrderAmount || 0)) : 0;
            const sComm = s ? Number(s.commissionAmount || 0) : 0;
            const mOrder = m ? m.order : 0;
            const mComm = m ? m.commission : 0;

            if (!s) {
                // 系统只统计有数据的会员; 计算侧无数据被系统忽略属正常, 跳过。
                // 只有"计算侧有数据(有效投注/返佣>0)却被系统漏掉"才必须暴露。
                if (mOrder > 0.000001 || mComm > 0.000001) {
                    problems.push(`⚠️ 会员${uid}: 系统未统计, 但计算有数据 → 有效投注 ${money(mOrder)} / 返佣 ${money4(mComm)}`);
                }
                return;
            }
            if (!m) {
                problems.push(`会员${uid}: 计算侧缺失(系统有) → 有效投注 ${money(sOrder)} / 返佣 ${money4(sComm)}`);
                return;
            }
            if (Math.abs(sOrder - mOrder) > 0.01 || Math.abs(sComm - mComm) > 0.01) {
                problems.push(`会员${uid}: 有效投注 系统${money(sOrder)}/计算${money(mOrder)}  返佣 系统${money4(sComm)}/计算${money4(mComm)}`);
            }
        });

        if (problems.length === 0) console.log(`  ✅ 层级 L${h}: 系统 ${sysList.length} 人, 数据全部一致`);
        else {
            console.log(`  ❌ 层级 L${h}: 系统 ${sysList.length} 人, 发现 ${problems.length} 处异常:`);
            problems.forEach(p => console.log(`     └─ ${p}`));
        }
    }
    console.log(`${'═'.repeat(74)}\n`);

    // ============================================================
    // 12. 三表横向一致性: 逐层 [计算 / 报表② / 报表③], 团队 [计算 / 报表①]
    // ============================================================
    console.log(`\n${'═'.repeat(98)}`);
    console.log(`📊 三表横向一致性对比  (逐层: 计算 / 报表② / 报表③ 的 有效投注 与 返佣)`);
    console.log(`${'═'.repeat(98)}`);
    console.log(`  ${padEndW('层级', 6)}${padStartW('计算-投注', 13)}${padStartW('报表②-投注', 14)}${padStartW('报表③-投注', 14)}${padStartW('计算-返佣', 13)}${padStartW('报表②-返佣', 14)}${padStartW('报表③-返佣', 14)}  一致`);
    console.log(`${'─'.repeat(98)}`);
    let r3RebateSum = 0;
    for (let h = 1; h <= maxRebateHier; h++) {
        const L = byLayer[h];
        const s3 = sysByLayer[h];
        const s2 = r2ByLayer[h];
        const has3 = !!s3, has2 = !!s2;
        if (!L && !has3 && !has2) continue;
        const myO = L ? (L.elecOrder + L.liveOrder + L.sportsOrder + L.lotteryOrder + L.chessOrder) : 0;
        const myC = L ? L.totalRebate : 0;
        let o3 = 0, c3 = 0;
        if (has3) GAMES.forEach(g => { o3 += Number(s3[g.sysK + 'BetOrderAmount'] || 0); c3 += Number(s3[g.sysK + 'Commission'] || 0); });
        r3RebateSum += c3;
        const o2 = has2 ? s2.order : 0, c2 = has2 ? s2.rebate : 0;
        const oOk = (!has2 || Math.abs(myO - o2) <= 0.01) && (!has3 || Math.abs(myO - o3) <= 0.01);
        const cOk = (!has2 || Math.abs(myC - c2) <= 0.01) && (!has3 || Math.abs(myC - c3) <= 0.01);
        console.log(`  ${padEndW('L' + h, 6)}${padStartW(money(myO), 13)}${padStartW(has2 ? money(o2) : '-', 14)}${padStartW(has3 ? money(o3) : '-', 14)}${padStartW(money4(myC), 13)}${padStartW(has2 ? money4(c2) : '-', 14)}${padStartW(has3 ? money4(c3) : '-', 14)}  ${(oOk && cOk) ? '✅' : '❌'}`);
    }
    console.log(`${'─'.repeat(98)}`);
    const teamOk = !sysRebate || Math.abs(r.totalRebate - Number(sysRebate.totalCommission || 0)) <= 0.01;
    console.log(`  团队合计返佣:  计算=${money4(r.totalRebate)}   报表①=${sysRebate ? money4(sysRebate.totalCommission) : '-'}   报表③(Σ层)=${money4(r3RebateSum)}   ${teamOk ? '✅' : '❌'}`);
    console.log(`${'═'.repeat(98)}\n`);
}

// ============================================================
// K6 执行入口
// ============================================================
export const options = { vus: 1, iterations: 1 };

export function setup() {
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('[Setup] ❌ 管理员登录失败');
    return { token: adminToken };
}

export default function (data) {
    const targetUid = __ENV.UID || __ENV.USER_ID || __ENV.USERID;
    if (!targetUid) {
        console.error("❌ 缺少目标用户ID！请使用 -e UID=xxxx 指定，例如: k6 run -e UID=111922 l6AgentReport.test.js");
        return;
    }
    l6AgentReport(data, targetUid);
}
