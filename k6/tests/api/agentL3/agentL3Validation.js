import { logger } from '../../../libs/utils/logger.js';
import { sendQueryRequest } from '../common/request.js';
import { GetConfig, GetListInviteTaskConfig, GetListRebateLevelRate } from './agentL3Api.js';
import { sleep } from 'k6';

export const agentL3Tag = 'agentL3Validation';

// ============================================================
// ============ 核心配置 ======================================
// ============================================================
// 灵活配置：计算团队总人数和团队总投注时，是否包含总代自身？
const INCLUDE_SELF = true;

// ============================================================
// ============ 日期时间工具 ==================================
// ============================================================

/**
 * 获取昨天和今天的精准时间戳和格式化时间
 */
function getTimeRanges() {
    const now = new Date();

    // 今日
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    // 昨日
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const ydStart = new Date(yesterday);
    ydStart.setHours(0, 0, 0, 0);
    const ydEnd = new Date(yesterday);
    ydEnd.setHours(23, 59, 59, 999);

    return {
        today: {
            startTs: todayStart.getTime(),
            endTs: todayEnd.getTime(),
            dateStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        },
        yesterday: {
            startTs: ydStart.getTime(),
            endTs: ydEnd.getTime(),
            dateStr: `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
        }
    };
}

// ============================================================
// ============ 辅助：构建树形映射与查询 ======================
// ============================================================

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

// ============================================================
// ============ API: 获取团队充值与投注 =======================
// ============================================================

function getRechargeAmount(data, userId, startTs, endTs) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const payload = { rechargeState: 'Payed', userId, startTime: startTs, endTime: endTs };
    let result = sendQueryRequest(payload, api, agentL3Tag, false, data.token);

    if (typeof result !== 'object') {
        try { result = JSON.parse(result); } catch (e) { return 0; }
    }

    let totalAmt = 0;
    if (result && result.list && result.list.length > 0) {
        result.list.forEach((item) => {
            const amt = Number(item.actualAmount || 0);
            if (!isNaN(amt)) {
                totalAmt += amt;
            }
        });
    }
    return totalAmt;
}

/**
 * 获取时间段内的投注记录，同时计算有效投注(validAmount)和总投注(betAmount)
 * @returns {Object} 包含总计和各类别的对象
 */
function getBetData(data, userId, startTs, endTs) {
    const api = '/api/ThirdGame/GetBetRecordPageList';
    const bets = {
        totalBetAmount: 0,
        totalValidAmount: 0,
        categories: {
            electronic: { bet: 0, valid: 0 }, // 0
            liveCasino: { bet: 0, valid: 0 }, // 1
            sports: { bet: 0, valid: 0 },     // 2
            lottery: { bet: 0, valid: 0 },    // 3
            chessCard: { bet: 0, valid: 0 }   // 4
        }
    };

    for (let type = 0; type < 5; type++) {
        const payload = {
            categoryType: type,
            queryTimeType: 'BetTime',
            userId: userId,
            beginTimeUnix: startTs,
            endTimeUnix: endTs,
            pageSize: 500,
            sortField: 'BetTime'
        };
        let result = sendQueryRequest(payload, api, agentL3Tag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { continue; }
        }

        if (result && result.sum) {
            let catBet = parseFloat(result.sum.betAmountSum) || 0;
            let catValid = parseFloat(result.sum.validAmountSum) || 0;

            bets.totalBetAmount += catBet;
            bets.totalValidAmount += catValid;

            if (type === 0) { bets.categories.electronic.bet = catBet; bets.categories.electronic.valid = catValid; }
            if (type === 1) { bets.categories.liveCasino.bet = catBet; bets.categories.liveCasino.valid = catValid; }
            if (type === 2) { bets.categories.sports.bet = catBet; bets.categories.sports.valid = catValid; }
            if (type === 3) { bets.categories.lottery.bet = catBet; bets.categories.lottery.valid = catValid; }
            if (type === 4) { bets.categories.chessCard.bet = catBet; bets.categories.chessCard.valid = catValid; }
        } else if (result && result.list && result.list.length > 0) {
            // 兼容性保留: 如果 API 没有 sum 对象，就累加 list 里的
            let catValid = 0;
            let catBet = 0;
            result.list.forEach(item => {
                catValid += (parseFloat(item.validAmount) || 0);
                catBet += (parseFloat(item.betAmount) || 0);
            });

            bets.totalBetAmount += catBet;
            bets.totalValidAmount += catValid;

            if (type === 0) { bets.categories.electronic.bet = catBet; bets.categories.electronic.valid = catValid; }
            if (type === 1) { bets.categories.liveCasino.bet = catBet; bets.categories.liveCasino.valid = catValid; }
            if (type === 2) { bets.categories.sports.bet = catBet; bets.categories.sports.valid = catValid; }
            if (type === 3) { bets.categories.lottery.bet = catBet; bets.categories.lottery.valid = catValid; }
            if (type === 4) { bets.categories.chessCard.bet = catBet; bets.categories.chessCard.valid = catValid; }
        }
    }
    return bets;
}

// ============================================================
// ============ 核心计算逻辑 ==================================
// ============================================================

export function runAgentL3Validation(data, targetUid) {
    if (!targetUid) {
        logger.error(`[${agentL3Tag}] 缺少参数: targetUid`);
        return;
    }
    const rootId = Number(targetUid);
    const timeRange = getTimeRanges();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 3级代理(AgentL3) 验证 - UID=${rootId}`);
    console.log(`   昨日时间: ${timeRange.yesterday.dateStr} | 今日时间: ${timeRange.today.dateStr}`);
    console.log(`${'='.repeat(70)}\n`);

    // 1. 获取所有配置
    console.log('【Step 1】获取 3 级代理相关配置...');
    const configData = GetConfig(data);
    const taskConfig = GetListInviteTaskConfig(data) || [];
    const rebateLevelRates = GetListRebateLevelRate(data) || [];

    if (!configData || !taskConfig.length || !rebateLevelRates.length) {
        logger.error(`[${agentL3Tag}] 配置获取失败，终止验证流程。`);
        return;
    }

    // 解析有效邀请门槛
    const validInviteRecharge = Number(configData.agentL3InviteRechargeAmount.value1) || 0;
    const validInviteBet = Number(configData.agentL3InviteBetAmount.value1) || 0;
    const inviterReward = Number(configData.agentL3InviteRewardAmount.value1) || 0;
    const invitedReward = Number(configData.agentL3InvitedRewardAmount.value1) || 0;
    const inviteDayLimitCount = configData.agentL3InviteDayLimitCount ? (Number(configData.agentL3InviteDayLimitCount.value1) || 999999) : 999999;

    console.log(`   ► 有效邀请门槛: 充值 >= ${validInviteRecharge}, 投注 >= ${validInviteBet}`);
    console.log(`   ► 每日有效邀请上限: ${inviteDayLimitCount === 999999 ? '无上限' : inviteDayLimitCount} 人`);
    console.log(`   ► 单人邀请奖金: 邀请人=${inviterReward}, 被邀请人=${invitedReward}`);
    console.log(`   ► 团队等级门槛共 ${rebateLevelRates.length} 档 | 任务奖励共 ${taskConfig.length} 档\n`);

    // 2. 获取团队成员
    console.log('【Step 2】获取团队成员列表...');
    const agentListApi = '/api/Agent/GetPageListAgentList';
    const agentPayload = { userId: rootId, isAll: true, isIncludeSelfAndParent: true, pageNo: 1, pageSize: 500 };
    let agentResult = sendQueryRequest(agentPayload, agentListApi, agentL3Tag, false, data.token);

    if (typeof agentResult !== 'object') {
        try { agentResult = JSON.parse(agentResult); } catch (e) {
            logger.error(`[${agentL3Tag}] 解析团队成员响应失败: ${e.message}`);
            return;
        }
    }

    let memberList = [];
    if (agentResult && Array.isArray(agentResult.list)) memberList = agentResult.list;
    else if (agentResult && agentResult.data && Array.isArray(agentResult.data.list)) memberList = agentResult.data.list;

    if (!memberList.length) {
        logger.error(`[${agentL3Tag}] 未获取到任何成员(或者团队为空)`);
        return;
    }
    console.log(`   ✅ 共获取团队成员 ${memberList.length} 人（含自身）\n`);

    // 找到 root 自身配置
    const rootRecord = memberList.find(m => m.userId === rootId);
    if (!rootRecord) {
        logger.error(`[${agentL3Tag}] 返回的成员列表中不包含总代本身!`);
        return;
    }

    // ==========================================
    // 新增：判断是否拥有被邀请奖励
    // ==========================================
    let myInvitedReward = 0;
    console.log('\n【Step 2.1】计算自身是否获得被邀请奖励...');
    if (rootRecord.parentId === 0) {
        console.log(`   ► 账号属性: 这是一个总代账号没有被邀请奖金`);
    } else if (rootRecord.parentId > 0) {
        const regYesterday = rootRecord.registerTime >= timeRange.yesterday.startTs && rootRecord.registerTime <= timeRange.yesterday.endTs;
        if (!regYesterday) {
            console.log(`   ► 账号非昨日注册 (注册时间戳: ${rootRecord.registerTime})，无被邀请奖金`);
        } else {
            // 是昨日注册的，检查是否达标有效邀请条件
            const selfYdRecharge = getRechargeAmount(data, rootId, timeRange.yesterday.startTs, timeRange.yesterday.endTs);
            const selfYdBet = getBetData(data, rootId, timeRange.yesterday.startTs, timeRange.yesterday.endTs);
            const selfIsValidYd = (selfYdRecharge >= validInviteRecharge) && (selfYdBet.totalValidAmount >= validInviteBet);
            
            if (selfIsValidYd) {
                myInvitedReward = invitedReward;
                console.log(`   ✅ 满足代理有效邀请条件 (昨日充值: ${selfYdRecharge}, 有效投注: ${selfYdBet.totalValidAmount.toFixed(2)})，被邀请奖金: ${myInvitedReward}`);
            } else {
                console.log(`   ❌ 未满足被邀请的达标条件 (昨日充值: ${selfYdRecharge}, 有效投注: ${selfYdBet.totalValidAmount.toFixed(2)})，无被邀请奖金`);
            }
        }
    }

    // 3. 筛选 L1~L3 成员并获取昨日和今日的数据
    console.log('【Step 3】获取成员(L1~L3及自身) 昨日+今日 的充值与投注数据...');
    const enrichedMembers = [];

    // 获取自上而下的绝对层级差，只保留 L1 ~ L3 和自己
    memberList.forEach(m => {
        const relHier = m.hierarchy - rootRecord.hierarchy;
        if (relHier >= 0 && relHier <= 3) {
            // 需要获取数据的名单
            enrichedMembers.push({
                ...m,
                relHier,
                yesterday: { recharge: 0, bet: null },
                today: { recharge: 0, bet: null },
                isValidYesterday: false,
                isValidToday: false
            });
        }
    });

    console.log(`   需要查询数据的核心成员: ${enrichedMembers.length} 人...`);

    // 挨个查询 (包含自身) 
    enrichedMembers.forEach((m, idx) => {
        sleep(0.5);
        if (idx % 5 === 0 && idx > 0) console.log(`   ...已查询 ${idx}/${enrichedMembers.length}人 ...`);

        // 昨日
        const ydRecharge = getRechargeAmount(data, m.userId, timeRange.yesterday.startTs, timeRange.yesterday.endTs);
        const ydBet = getBetData(data, m.userId, timeRange.yesterday.startTs, timeRange.yesterday.endTs);
        m.yesterday.recharge = ydRecharge;
        m.yesterday.bet = ydBet;
        m.isValidYesterday = (ydRecharge >= validInviteRecharge) && (ydBet.totalValidAmount >= validInviteBet);

        // 今日
        const tdRecharge = getRechargeAmount(data, m.userId, timeRange.today.startTs, timeRange.today.endTs);
        const tdBet = getBetData(data, m.userId, timeRange.today.startTs, timeRange.today.endTs);
        m.today.recharge = tdRecharge;
        m.today.bet = tdBet;
        m.isValidToday = (tdRecharge >= validInviteRecharge) && (tdBet.totalValidAmount >= validInviteBet);
    });
    console.log(`   ✅ 数据查询完毕\n`);

    // 4. 计算有效邀请 (只算直推 L1)
    console.log('【Step 4】计算有效邀请奖励...');
    const l1Members = enrichedMembers.filter(m => m.relHier === 1);

    const validYesterdayL1 = l1Members.filter(m => m.isValidYesterday);
    const validTodayL1 = l1Members.filter(m => m.isValidToday);

    const validYesterdayL1Count = Math.min(validYesterdayL1.length, inviteDayLimitCount);
    const validTodayL1Count = Math.min(validTodayL1.length, inviteDayLimitCount);

    console.log(`   ➤ 昨日达标有效邀请 ${validYesterdayL1.length} 人 ( L1总数=${l1Members.length} ), 每日上限=${inviteDayLimitCount} -> 实际计算: ${validYesterdayL1Count} 人`);
    console.log(`   ➤ 今日达标有效邀请 ${validTodayL1.length} 人 ( L1总数=${l1Members.length} ), 每日上限=${inviteDayLimitCount} -> 实际计算: ${validTodayL1Count} 人`);

    const inviteRewardYesterday = validYesterdayL1Count * inviterReward;
    const inviteRewardToday = validTodayL1Count * inviterReward;
    console.log(`   ► 邀请成功奖金: ${inviteRewardYesterday + inviteRewardToday} 元 (昨日: ${inviteRewardYesterday}, 今日: ${inviteRewardToday})`);

    // 5. 计算邀请任务阶梯奖励 (按日独立的达标人数匹配)
    console.log('\n【Step 5】计算邀请任务阶梯奖励...');
    let taskRewardYesterday = 0;
    let taskRewardToday = 0;

    // 匹配所有满足条件的档位并累加奖励
    const getTaskReward = (validCount) => {
        let totalReward = 0;
        // 把配置按 count 从小到大排
        const sortedTasks = [...taskConfig].sort((a, b) => a.inviteUserCount - b.inviteUserCount);
        for (const t of sortedTasks) {
            if (validCount >= t.inviteUserCount) {
                totalReward += t.rewardAmount;  // 累加所有满足条件的档位奖励
            } else {
                break;
            }
        }
        return totalReward;
    };

    taskRewardYesterday = getTaskReward(validYesterdayL1Count);
    taskRewardToday = getTaskReward(validTodayL1Count);
    console.log(`   ► 邀请任务奖金: ${taskRewardYesterday + taskRewardToday} 元 (昨日: ${taskRewardYesterday}, 今日: ${taskRewardToday})`);
    if (myInvitedReward > 0) {
        console.log(`   ► 被邀请奖金: ${myInvitedReward} 元`);
    }
    
    // 汇总并单独展示总任务奖励
    const totalTaskReward = inviteRewardYesterday + inviteRewardToday + taskRewardYesterday + taskRewardToday + myInvitedReward;
    if (myInvitedReward > 0) {
        console.log(`   ► 总任务奖励(邀请成功+邀请任务+被邀请): ${totalTaskReward} 元`);
    } else {
        console.log(`   ► 总任务奖励(邀请成功+邀请任务): ${totalTaskReward} 元`);
    }

    // 6. 计算团队返佣 (仅昨日数据)
    console.log('\n【Step 6】计算团队返佣 (定级+结算, 使用昨日数据)...');

    // 定级
    let teamPeoples = 0;
    let teamRechargeAmt = 0; // 为了对比配置？配置里没有要求，只要求 people和 betAmount
    let teamBetAmt = 0;

    enrichedMembers.forEach(m => {
        // 如果不包含自身，则跳过 root (relHier === 0)
        if (!INCLUDE_SELF && m.relHier === 0) return;

        teamPeoples++;
        teamRechargeAmt += m.yesterday.recharge;
        teamBetAmt += m.yesterday.bet.totalValidAmount; // 团队总有效投注金额
    });

    console.log(`   ➤ 团队结算基础 (INCLUDE_SELF=${INCLUDE_SELF}) :`);
    console.log(`      总人数: ${teamPeoples} 人 | 昨日团队总有效投注: ${teamBetAmt.toFixed(2)} | 昨日总充值: ${teamRechargeAmt.toFixed(2)}`);

    // 匹配团队等级 (找最大的能同时满足人数和投注门槛的等级)
    let finalLevelConfig = null;
    const sortedLevels = [...rebateLevelRates].sort((a, b) => b.teamLevel - a.teamLevel);
    for (const lvl of sortedLevels) {
        if (teamPeoples >= lvl.teamPeoples && teamBetAmt >= lvl.teamBetAmount) {
            finalLevelConfig = lvl;
            break;
        }
    }

    let finalRechargeRebate = 0;
    let finalBetRebateL1 = 0;
    let finalBetRebateL2 = 0;
    let finalBetRebateL3 = 0;
    let finalSumBet = 0;
    let calculatedTeamLevel = 0;

    if (!finalLevelConfig) {
        console.log(`   ► ⚠️ 未满足任何团队等级门槛，无法获得团队返佣。`);

        console.log(`\n   ► 团队成员明细 (昨日数据):`);
        let tSumRech = 0, tSumBet = 0, tSumValid = 0, tSumRechReb = 0, tSumBetReb = 0;
        console.log(`      ┌──────┬────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐`);
        console.log(`      │ 层级 │    UID     │  充值金额  │  投注金额  │  有效投注  │  充值返佣  │  投注返佣  │`);
        console.log(`      ├──────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤`);
        enrichedMembers.forEach(m => {
            if (m.relHier === 0) return;
            const hierStr = `L${m.relHier}`.padEnd(4);
            const uidStr = String(m.userId).padEnd(10);
            const rechAmtStr = m.yesterday.recharge.toFixed(2).padStart(10);
            const betAmtStr = m.yesterday.bet.totalBetAmount.toFixed(2).padStart(10);
            const validAmtStr = m.yesterday.bet.totalValidAmount.toFixed(2).padStart(10);
            const rechRebStr = "0.00".padStart(10);
            const betRebStr = "0.00".padStart(10);

            tSumRech += m.yesterday.recharge;
            tSumBet += m.yesterday.bet.totalBetAmount;
            tSumValid += m.yesterday.bet.totalValidAmount;

            console.log(`      │ ${hierStr} │ ${uidStr} │ ${rechAmtStr} │ ${betAmtStr} │ ${validAmtStr} │ ${rechRebStr} │ ${betRebStr} │`);
        });
        console.log(`      ├──────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤`);
        const countStr = String(enrichedMembers.length - 1) + '人';
        console.log(`      │ 总计 │ ${countStr.padStart(10)} │ ${tSumRech.toFixed(2).padStart(10)} │ ${tSumBet.toFixed(2).padStart(10)} │ ${tSumValid.toFixed(2).padStart(10)} │ ${"0.00".padStart(10)} │ ${"0.00".padStart(10)} │`);
        console.log(`      └──────┴────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘`);

        let totalBonusStr = myInvitedReward > 0 
            ? "邀请成功奖金+邀请任务奖金+被邀请奖金" 
            : "邀请成功奖金+邀请任务奖金";
        console.log(`\n   💰 今日最终可领取(${totalBonusStr}) 约: ${(inviteRewardYesterday + inviteRewardToday + taskRewardYesterday + taskRewardToday + myInvitedReward).toFixed(4)} 元`);
        console.log(`${'='.repeat(70)}\n`);
    } else {
        console.log(`   ► 匹配团队等级: Level ${finalLevelConfig.teamLevel}`);

        // 计算返佣
        const rateRecharge = Number(finalLevelConfig.teamRechargeRewardRate) / 100;
        const rateBet = finalLevelConfig.teamBetRewardRate;

        let totalRechargeRebate = 0;
        let totalBetRebate = { L1: 0, L2: 0, L3: 0, electronic: 0, video: 0, sports: 0, lottery: 0, chessCard: 0 };

        console.log(`\n   ► 团队成员明细 (昨日数据):`);
        let tSumRech = 0, tSumBet = 0, tSumValid = 0, tSumRechReb = 0, tSumBetReb = 0;
        console.log(`      ┌──────┬────────────┬────────────┬────────────┬────────────┬────────────┬────────────┐`);
        console.log(`      │ 层级 │    UID     │  充值金额  │  投注金额  │  有效投注  │  充值返佣  │  投注返佣  │`);
        console.log(`      ├──────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤`);

        enrichedMembers.forEach(m => {
            if (m.relHier === 0) return; // 自己不给自己返

            // ============== 充值返佣 (仅 L1) ============== 
            let myRechargeRebate = 0;
            if (m.relHier === 1) {
                myRechargeRebate = m.yesterday.recharge * rateRecharge;
                totalRechargeRebate += myRechargeRebate;
            }

            // 这里恢复按有效投注额计算（最新用户要求）
            const b = m.yesterday.bet.categories;
            const hl = `teamBetRewardRate_L${m.relHier}`;

            // 获取各分类对应层级的比率 / 100
            const rElec = (Number(rateBet.electronic[hl]) || 0) / 100;
            const rVid = (Number(rateBet.video[hl]) || 0) / 100;
            const rSpo = (Number(rateBet.sports[hl]) || 0) / 100;
            const rLot = (Number(rateBet.lottery[hl]) || 0) / 100;
            const rChe = (Number(rateBet.chessCard[hl]) || 0) / 100;

            const eRebate = b.electronic.valid * rElec;
            const vRebate = b.liveCasino.valid * rVid;
            const sRebate = b.sports.valid * rSpo;
            const lRebate = b.lottery.valid * rLot;
            const cRebate = b.chessCard.valid * rChe;

            const userBetRebateTotal = eRebate + vRebate + sRebate + lRebate + cRebate;

            if (m.relHier === 1) totalBetRebate.L1 += userBetRebateTotal;
            if (m.relHier === 2) totalBetRebate.L2 += userBetRebateTotal;
            if (m.relHier === 3) totalBetRebate.L3 += userBetRebateTotal;

            totalBetRebate.electronic += eRebate;
            totalBetRebate.video += vRebate;
            totalBetRebate.sports += sRebate;
            totalBetRebate.lottery += lRebate;
            totalBetRebate.chessCard += cRebate;

            const hierStr = `L${m.relHier}`.padEnd(4);
            const uidStr = String(m.userId).padEnd(10);
            const rechAmtStr = m.yesterday.recharge.toFixed(2).padStart(10);
            const betAmtStr = m.yesterday.bet.totalBetAmount.toFixed(2).padStart(10);
            const validAmtStr = m.yesterday.bet.totalValidAmount.toFixed(2).padStart(10);
            const rechRebStr = myRechargeRebate.toFixed(2).padStart(10);
            const betRebStr = userBetRebateTotal.toFixed(2).padStart(10);

            tSumRech += m.yesterday.recharge;
            tSumBet += m.yesterday.bet.totalBetAmount;
            tSumValid += m.yesterday.bet.totalValidAmount;
            tSumRechReb += myRechargeRebate;
            tSumBetReb += userBetRebateTotal;

            console.log(`      │ ${hierStr} │ ${uidStr} │ ${rechAmtStr} │ ${betAmtStr} │ ${validAmtStr} │ ${rechRebStr} │ ${betRebStr} │`);
        });
        console.log(`      ├──────┼────────────┼────────────┼────────────┼────────────┼────────────┼────────────┤`);
        const countStr = String(enrichedMembers.length - 1) + '人';
        console.log(`      │ 总计 │ ${countStr.padStart(10)} │ ${tSumRech.toFixed(2).padStart(10)} │ ${tSumBet.toFixed(2).padStart(10)} │ ${tSumValid.toFixed(2).padStart(10)} │ ${tSumRechReb.toFixed(2).padStart(10)} │ ${tSumBetReb.toFixed(2).padStart(10)} │`);
        console.log(`      └──────┴────────────┴────────────┴────────────┴────────────┴────────────┴────────────┘`);

        const sumBet = Object.values(totalBetRebate).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) / 2; // 因为我存在了分类和层级里，属于加了两次
        const realSumBet = totalBetRebate.L1 + totalBetRebate.L2 + totalBetRebate.L3;

        finalRechargeRebate = totalRechargeRebate;
        finalBetRebateL1 = totalBetRebate.L1;
        finalBetRebateL2 = totalBetRebate.L2;
        finalBetRebateL3 = totalBetRebate.L3;
        finalSumBet = realSumBet;
        calculatedTeamLevel = finalLevelConfig.teamLevel;

        console.log(`\n   ► 团队返佣合计: ${(totalRechargeRebate + realSumBet).toFixed(4)} 元`);
        console.log(`      └─ 首充返佣 (仅L1): ${totalRechargeRebate.toFixed(4)}`);
        console.log(`      └─ 投注返佣 : L1=${totalBetRebate.L1.toFixed(4)}, L2=${totalBetRebate.L2.toFixed(4)}, L3=${totalBetRebate.L3.toFixed(4)}`);

        let totalBonusStr = myInvitedReward > 0 
            ? "邀请成功奖金+邀请任务奖金+被邀请奖金+团队返佣" 
            : "邀请成功奖金+邀请任务奖金+团队返佣";
        console.log(`\n   💰 今日最终可领取(${totalBonusStr}) 约: ${(inviteRewardYesterday + inviteRewardToday + taskRewardYesterday + taskRewardToday + totalRechargeRebate + realSumBet + myInvitedReward).toFixed(4)} 元`);
        console.log(`${'='.repeat(70)}\n`);
    }

    // ============================================================
    // ============ V E R I F I C A T I O N  ======================
    // ============================================================
    console.log('\n【Step 7】后台接口自动化对比验证...');

    const checkTolerance = (name, actual, expected, tolerance = 5) => {
        const diff = Math.abs(actual - expected);
        if (diff <= tolerance) {
            console.log(`   ✅ [验证通过] ${name} | 计算值: ${expected.toFixed(4)} | 接口值: ${actual.toFixed(4)}`);
        } else {
            console.log(`   ❌ [验证失败] ${name} | 计算值: ${expected.toFixed(4)} | 接口值: ${actual.toFixed(4)} (误差: ${diff.toFixed(4)}，超出控制阈值5!)`);
        }
    };
    
    const checkExact = (name, actual, expected) => {
        const diff = Math.abs(actual - expected);
        if (diff === 0) {
            console.log(`   ✅ [验证通过] ${name} | 计算值: ${expected} | 接口值: ${actual}`);
        } else {
            console.log(`   ❌ [验证失败] ${name} | 计算值: ${expected} | 接口值: ${actual} (存在差异!)`);
        }
    };

    // 1. 验证 InviteList
    const inviteApi = '/api/AgentL3/GetPageListInviteList';
    const invitePayload = { userId: rootId, pageNo: 1, pageSize: 20, orderBy: 'Desc' };
    let inviteRes = sendQueryRequest(invitePayload, inviteApi, agentL3Tag, false, data.token);
    if (typeof inviteRes !== 'object') {
        try { inviteRes = JSON.parse(inviteRes); } catch(e) {}
    }
    
    if (inviteRes && inviteRes.list && inviteRes.list.length > 0) {
        console.log(`\n   ► 验证 InviteList (API 返回第 1 条，UID=${inviteRes.list[0].userId}):`);
        const item = inviteRes.list[0];
        checkExact('团队匹配等级(teamLevel)', item.teamLevel, calculatedTeamLevel);
        checkTolerance('总任务奖励金额', item.totalRewardAmount, totalTaskReward);
        checkTolerance('当月邀请成功奖金', item.inviteRewardAmount, inviteRewardYesterday + inviteRewardToday);
        checkExact('达标有效邀请人数', item.inviteRewardUserCount, validYesterdayL1Count + validTodayL1Count);
        checkTolerance('当月邀请任务奖金', item.inviteTaskRewardAmount, taskRewardYesterday + taskRewardToday);
    } else {
        console.log(`\n   ⚠️ 未能查到该用户的 InviteList 数据。`);
    }
    
    // 2. 验证 RebateList
    console.log(`\n   ► 验证昨日 RebateList (${timeRange.yesterday.dateStr} 记录):`);
    const rebateApi = '/api/AgentL3/GetPageListRebateList';
    const rebatePayload = { reportDate: timeRange.yesterday.dateStr, userId: rootId, pageNo: 1, pageSize: 20, orderBy: "Desc" };
    let rebateRes = sendQueryRequest(rebatePayload, rebateApi, agentL3Tag, false, data.token);
    if (typeof rebateRes !== 'object') {
        try { rebateRes = JSON.parse(rebateRes); } catch(e) {}
    }
    
    if (rebateRes && rebateRes.list && rebateRes.list.length > 0) {
        const item = rebateRes.list[0];
        checkTolerance('首充返佣 (L1)', item.rechargeCommission_L1, finalRechargeRebate);
        checkTolerance('一级投注返佣 (L1)', item.betCommission_L1, finalBetRebateL1);
        checkTolerance('二级投注返佣 (L2)', item.betCommission_L2, finalBetRebateL2);
        checkTolerance('三级投注返佣 (L3)', item.betCommission_L3, finalBetRebateL3);
        checkTolerance('团队总返佣合计', item.totalCommission, finalRechargeRebate + finalSumBet);
    } else {
        console.log(`   ⚠️ 未能查到昨日(${timeRange.yesterday.dateStr}) 的 RebateList 返佣明细记录！`);
    }

    console.log(`\n${'='.repeat(70)}\n`);
}
