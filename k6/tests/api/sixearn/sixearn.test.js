import { sendQueryRequest, sendRequest } from '../common/request.js';
import { isNonEmptyArray } from '../../utils/utils.js';
import { logger } from '../../../libs/utils/logger.js';
import { RebateLevel, RebateLevelRate } from './RebateLevel.test.js';
import { sleep } from 'k6';

export const sixearnTag = 'sixearn';

// ============================================================
// ============ 可配置参数 =====================================
// ============================================================

/**
 * 最大返佣层级（相对层级）。
 * 例如：总代层级=0，则最多计算到绝对层级 0+MAX_REBATE_HIERARCHY 的下级。
 * 超过此相对层级的成员产生返佣给上级时，将发出 ⚠️ 警告。
 * 这里会通过项目的返佣利率配置表动态获取。
 */
let MAX_REBATE_HIERARCHY = 6;

/**
 * 投注金额字段选择：
 *   true  → 使用 validAmount（有效投注金额）
 *   false → 使用 betAmount（投注金额）
 */
const USE_VALID_AMOUNT = false;

// ============================================================
// ============ 辅助：计算昨日时间范围 ========================
// ============================================================

/**
 * 动态获取"昨日"的开始和结束时间戳（毫秒），相对于脚本运行当天。
 * @returns {{ startTs: number, endTs: number, dateStr: string }}
 */
function getYesterdayRange() {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const start = new Date(yesterday);
    start.setHours(0, 0, 0, 0);

    const end = new Date(yesterday);
    end.setHours(23, 59, 59, 999);

    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');

    return {
        startTs: start.getTime(),
        endTs: end.getTime(),
        startDateStr: `${y}-${m}-${d} 00:00:00`,
        endDateStr: `${y}-${m}-${d} 23:59:59`,
        dateStr: `${y}-${m}-${d}`
    };
}

// ============================================================
// ============ 辅助：构建树形映射 ============================
// ============================================================

/**
 * 将成员列表构建为 userId → [childUserId, ...] 的映射，方便快速查找直接子节点。
 * @param {Array} memberList
 * @returns {Object} childrenMap
 */
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

/**
 * 通过 DFS 获取 userId 的所有直接和间接下级 userId 列表（不含自身）。
 * @param {number} userId
 * @param {Object} childrenMap
 * @returns {number[]}
 */
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

// ============================================================
// ============ 主入口函数 =====================================
// ============================================================

/**
 * 主函数：查询某个 uid 在明日（即今天视角下的昨日）的预计返佣。
 *
 * 逻辑流程：
 *  Step 1  查询该 uid 下的所有下级（含自身）
 *  Step 2  获取返佣等级配置表
 *  Step 3  获取返佣利率配置表
 *  Step 4  为每个成员查询昨日充值 + 投注数据
 *  Step 5  为每个有下级的成员（代理）计算其收到的返佣金额
 *  Step 6  打印详细结果 & 最终汇总
 *
 * @param {Object} data      - 含有 token 的前置登录数据
 * @param {number} targetUid - 要查询的总代 uid（必填，不应使用硬编码）
 */
export function querySubAccounts(data, targetUid) {
    if (!targetUid) {
        logger.error('[入口] 请传入要查询的 uid，例如: querySubAccounts(data, 5945146)');
        return;
    }
    const accountId = Number(targetUid);

    // 昨日时间范围（动态）
    const { startTs, endTs, startDateStr, endDateStr, dateStr } = getYesterdayRange();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 返佣预查询 - UID=${accountId}  昨日=${dateStr}`);
    console.log(`   时间范围: ${new Date(startTs).toLocaleString()} ~ ${new Date(endTs).toLocaleString()}`);
    console.log(`   最大返佣层级: [将动态获取]  |  投注字段: ${USE_VALID_AMOUNT ? 'validAmount(有效投注)' : 'betAmount(投注金额)'}`);
    console.log(`${'='.repeat(70)}\n`);

    // -------------------------------------------------------
    // Step 1: 查询所有下级
    // -------------------------------------------------------
    console.log('【Step 1】查询团队成员列表...');
    const agentListApi = '/api/Agent/GetPageListAgentList';
    const agentPayload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: true,
        pageNo: 1,
        pageSize: 500,
    };

    let agentResult = sendQueryRequest(agentPayload, agentListApi, sixearnTag, false, data.token);
    // console.log('-----')
    // console.log("___", agentResult)
    // console.log('')
    if (typeof agentResult === 'string') {
        try {
            agentResult = JSON.parse(agentResult);
        } catch (e) {
            logger.error(`[Step 1] 解析响应失败: ${e.message}，终止`);
            return;
        }
    }

    // 调试输出：打印原始返回值结构，方便排查
    //console.log(`[Step 1] 原始响应类型: ${typeof agentResult}`);
    //console.log(`[Step 1] 原始响应内容(前500字符): ${JSON.stringify(agentResult).substring(0, 500)}`);

    // 兼容两种响应结构：
    //   形式A: { list: [...], pageNo, totalCount }       ← sendQueryRequest 正常返回 parsedBody.data
    //   形式B: { code:0, data:{ list:[...] }, msg }     ← sendQueryRequest 返回完整 parsedBody
    let memberList = null;
    if (agentResult && Array.isArray(agentResult.list)) {
        memberList = agentResult.list;
    } else if (agentResult && agentResult.data && Array.isArray(agentResult.data.list)) {
        memberList = agentResult.data.list;
        console.log('[Step 1] 使用兜底解析路径: agentResult.data.list');
    }

    if (!memberList || memberList.length === 0) {
        logger.error(
            `[Step 1] UID=${accountId} 没有任何下级成员（或接口报错），终止所有后续逻辑。` +
            `响应: code=${agentResult && agentResult.code}, msg=${agentResult && agentResult.msg}`
        );
        return;
    }

    const allMembers = memberList;
    console.log(`[Step 1] ✅ 共获取 ${allMembers.length} 个团队成员（含自身）\n`);

    // 找到自身记录，确定 masterHierarchy
    const masterRecord = allMembers.find((m) => m.userId === accountId);
    const masterHierarchy = masterRecord ? masterRecord.hierarchy : 0;

    // 标记 rebateState=0 的用户（返佣状态异常）
    const noRebateUsers = allMembers.filter((m) => m.rebateState === 0);
    if (noRebateUsers.length > 0) {
        console.log(`⚠️  [rebateState警告] 以下 ${noRebateUsers.length} 个用户 rebateState=0（不领取返佣），今日返佣应为0，若有返佣为异常：`);
        noRebateUsers.forEach((u) => {
            console.log(
                `   └─ UID=${u.userId}  绝对层级=${u.hierarchy}  rebateMode=${u.rebateMode}  rebateLevel=${u.rebateLevel}`
            );
        });
        console.log('');
    }

    // -------------------------------------------------------
    // Step 1.5: 查询昨日从本团队转出的成员
    // -------------------------------------------------------
    console.log('【Step 1.5】查询昨日从本团队转出的成员...');
    const teamMemberIdSet = new Set(allMembers.map(m => m.userId));
    const transferOutMap = fetchTransferOutMembers(data, teamMemberIdSet, startTs, endTs, sixearnTag);
    const transferOutIds = Object.keys(transferOutMap).map(Number);

    // 过滤掉已经在当前团队里的（极少数情况：转出后又转回来了）
    const newlyTransferOutIds = transferOutIds.filter(uid => !teamMemberIdSet.has(uid));

    if (newlyTransferOutIds.length > 0) {
        console.log(`[Step 1.5] ⬅️  发现 ${newlyTransferOutIds.length} 个昨日转出成员，将补充查询其转出前的数据：`);
        newlyTransferOutIds.forEach(uid => {
            const info = transferOutMap[uid];
            console.log(`   └─ UID=${uid}  原上级=${info.oldParentId}  原层级=${info.oldHierarchy}  转出时间=${new Date(info.transferBeginTime).toLocaleString()}`);
        });
    } else {
        console.log(`[Step 1.5] ✅ 昨日无成员从本团队转出\n`);
    }

    // -------------------------------------------------------
    // Step 2: 获取返佣等级配置表（一次查询，全局复用）
    // -------------------------------------------------------
    console.log('【Step 2】获取返佣等级配置表...');
    const rebateLevelList = RebateLevel(data);
    if (!isNonEmptyArray(rebateLevelList)) {
        logger.error('[Step 2] 返佣等级配置表查询失败或为空，终止');
        return;
    }
    console.log(`[Step 2] ✅ 共 ${rebateLevelList.length} 个返佣档位\n`);

    // -------------------------------------------------------
    // Step 3: 获取返佣利率配置表（一次查询，全局复用）
    // -------------------------------------------------------
    console.log('【Step 3】获取返佣利率配置表...');
    const rebateRateList = RebateLevelRate(data);
    if (!isNonEmptyArray(rebateRateList)) {
        logger.error('[Step 3] 返佣利率配置表查询失败或为空，终止');
        return;
    }
    
    // 动态计算最大返佣层级
    let maxRebateHier = 0;
    rebateRateList.forEach(entry => {
        if (entry.list && Array.isArray(entry.list)) {
            const h = Math.max(...entry.list.filter(item => item.hierarchy > 0).map(r => r.hierarchy));
            if (h > maxRebateHier) maxRebateHier = h;
        }
    });
    if (maxRebateHier > 0) {
        MAX_REBATE_HIERARCHY = maxRebateHier;
    }
    console.log(`[Step 3] ✅ 共 ${rebateRateList.length} 种利率配置 | 📌 当前项目最大返佣层级为: ${MAX_REBATE_HIERARCHY} 层\n`);

    // -------------------------------------------------------
    // Step 4: 构建树 + 为每个成员查询昨日充值/投注数据
    // -------------------------------------------------------
    console.log('【Step 4】构建团队树形结构...');
    const childrenMap = buildChildrenMap(allMembers);

    // 注意：总代自身（accountId）的充值/投注不计入任何人的团队统计，
    // 因此跳过对总代自身数据的API查询，节省请求次数。
    const nonMasterMembers = allMembers.filter((m) => m.userId !== accountId);

    console.log('\n【Step 3.5】查询成员昨日转线记录...');
    const transferMap = fetchTransferMap(data, nonMasterMembers, startTs, endTs, sixearnTag);

    console.log(`\n【Step 4】开始查询 ${nonMasterMembers.length} 个成员的昨日充值/投注数据（总代自身不查询）...\n`);
    const memberDataMap = {}; // userId → enriched member data

    nonMasterMembers.forEach((member, idx) => {
        sleep(0.5);
        console.log(
            `  [${String(idx + 1).padStart(3)}/${nonMasterMembers.length}] 查询 UID=${member.userId}  绝对层级=${member.hierarchy} ...`
        );
        const enriched = fetchMemberData(data, member, startTs, endTs, startDateStr, endDateStr,
            transferMap[member.userId] ? transferMap[member.userId].transferEndTime : null);
        memberDataMap[member.userId] = enriched;
    });

    // -------------------------------------------------------
    // Step 4.5: 查询转出成员在转出前的充值/投注数据
    // -------------------------------------------------------
    // transferOutMemberDataMap: userId → enriched（时间范围为 startTs ~ transferBeginTime）
    const transferOutMemberDataMap = {};

    if (newlyTransferOutIds.length > 0) {
        console.log(`\n【Step 4.5】查询 ${newlyTransferOutIds.length} 个转出成员的转出前数据...\n`);
        newlyTransferOutIds.forEach((uid, idx) => {
            sleep(0.5);
            const info = transferOutMap[uid];
            // 时间范围：昨日开始 ~ 转线开始时间（转线开始后数据归新团队）
            const effectiveEnd = Math.min(endTs, info.transferBeginTime);
            console.log(
                `  [${String(idx + 1).padStart(3)}/${newlyTransferOutIds.length}] 查询转出成员 UID=${uid}  原层级=${info.oldHierarchy}  有效时间范围: ${new Date(startTs).toLocaleString()} ~ ${new Date(effectiveEnd).toLocaleString()}`
            );
            // 构造一个虚拟 member 对象（转出成员已不在 allMembers 里）
            const virtualMember = {
                userId: uid,
                parentId: info.oldParentId,
                hierarchy: info.oldHierarchy,
                rebateState: 1,   // 默认正常，无法从团队列表获取
                rebateMode: 0,
                rebateLevel: 0,
                rebateSetTime: 0,
                registerTime: 0
            };
            const enriched = fetchMemberData(
                data, virtualMember,
                startTs, effectiveEnd,
                startDateStr, endDateStr,
                null  // 不再做转入方向的过滤，直接查 startTs ~ effectiveEnd
            );
            // 标记为转出成员，方便打印时区分
            enriched.isTransferOut = true;
            enriched.transferBeginTime = info.transferBeginTime;
            enriched.oldParentId = info.oldParentId;
            enriched.oldHierarchy = info.oldHierarchy;
            transferOutMemberDataMap[uid] = enriched;
        });
        console.log(`[Step 4.5] ✅ 转出成员数据查询完毕\n`);
    }

    // -------------------------------------------------------
    // Step 5 & 6: 为每个有下级的成员（代理）计算返佣
    // -------------------------------------------------------
    // -------------------------------------------------------
    // Step 5 & 6: 计算指定 UID (accountId) 的昨日预计返佣
    // -------------------------------------------------------
    console.log(`\n${'='.repeat(70)}`);
    console.log(`【Step 5】计算指定 UID=${accountId} 的昨日预计返佣`);
    console.log(`${'='.repeat(70)}\n`);

    const agentRebateSummary = []; // 最终汇总列表

    // 只计算指定的 accountId (masterRecord)
    const agent = masterRecord;
    if (agent) {
        // 找出该 agent 的所有下级 userId
        const descendantIds = getDescendants(agent.userId, childrenMap);
        if (descendantIds.length === 0 && newlyTransferOutIds.length === 0) {
            // 没有任何下级（含转出），无需计算返佣
            return;
        }

        // 显式排除总代自身（accountId）：总代的充值/投注不计入任何代理的团队统计
        const descendants = descendantIds
            .filter((id) => id !== accountId)
            .map((id) => memberDataMap[id])
            .filter(Boolean);

        // ---- 合并转出成员数据（转出成员的转出前数据也计入返佣计算）----
        // 转出成员的相对层级用其原层级（oldHierarchy）与总代层级的差值
        const transferOutDescendants = newlyTransferOutIds
            .map(uid => transferOutMemberDataMap[uid])
            .filter(Boolean);

        const allDescendants = [...descendants, ...transferOutDescendants];

        // ---- 确定该代理的 earnLevel ----
        let earnLevel;
        let earnLevelReason;

        if (agent.rebateMode === 1) {
            // 锁定返佣：直接使用设定的 rebateLevel，不看团队数据
            earnLevel = agent.rebateLevel;
            earnLevelReason = `锁定返佣 rebateLevel=${agent.rebateLevel}`;
        } else {
            // 先根据团队数据计算正常返佣等级 - 仅统计最大返佣层级内的下级
            const validDescendantsForLevel = allDescendants.filter(d => (d.hierarchy - agent.hierarchy) <= MAX_REBATE_HIERARCHY);
            const rechargePeopleCount = validDescendantsForLevel.filter((d) => d.totalRechargeAmount > 0).length;
            const totalRechargeAmt = validDescendantsForLevel.reduce((s, d) => s + (d.totalRechargeAmount || 0), 0);
            const totalBetAmt = validDescendantsForLevel.reduce((s, d) => s + (d.betAmountSum || 0), 0);
            const normalLevel = computeNormalEarnLevel(
                rechargePeopleCount,
                totalRechargeAmt,
                totalBetAmt,
                rebateLevelList
            );

            if (agent.rebateMode === 2) {
                // 特殊返佣：取 max(specialRebateLevel, normalLevel)
                const specialLevel = agent.rebateLevel;
                earnLevel = Math.max(specialLevel, normalLevel >= 0 ? normalLevel : 0);
                earnLevelReason = `特殊返佣，特殊LV=${specialLevel}，前${MAX_REBATE_HIERARCHY}层团队正常LV=${normalLevel}，取较大值LV=${earnLevel}`;
            } else {
                // 正常返佣
                earnLevel = normalLevel >= 0 ? normalLevel : 0;
                earnLevelReason = `正常返佣，前${MAX_REBATE_HIERARCHY}层团队(人数=${rechargePeopleCount}，充值金=${totalRechargeAmt.toFixed(2)}，投注金=${totalBetAmt.toFixed(2)})，等级LV=${earnLevel}`;
            }
        }

        // ---- 获取对应利率配置（去掉 hierarchy=-1 的合计行）----
        const rateConfig = getRateConfigForLevel(earnLevel, rebateRateList);

        // ---- 统计特殊的一级下级数据 ----
        const level1Stats = {
            count: 0,
            registerCount: 0,
            firstChargeCount: 0,
            rechargeAmount: 0
        };

        allDescendants.forEach(desc => {
            if (desc.hierarchy - agent.hierarchy === 1) {
                level1Stats.count++;
                if (desc.registeredYesterday) level1Stats.registerCount++;
                if (desc.isFirstCharge) level1Stats.firstChargeCount++;
                level1Stats.rechargeAmount += (desc.totalRechargeAmount || 0);
            }
        });

        // ---- 计算该代理从每个下级收到的返佣 ----
        let agentTotalRebate = 0;
        const perDescendantResults = [];

        allDescendants.forEach((desc) => {
            if (!desc) return;

            // 相对层级 = 下级绝对层级 - 代理绝对层级
            const relHier = desc.hierarchy - agent.hierarchy;

            if (relHier <= 0) return; // 跳过同级或更高层级（理论上不会出现）

            // ⚠️ 超出最大返佣层级警告
            if (relHier > MAX_REBATE_HIERARCHY) {
                console.log(
                    `  ⚠️  [层级溢出警告] UID=${desc.userId} 相对层级=${relHier} 超过最大返佣层级 ${MAX_REBATE_HIERARCHY}，` +
                    `此下级不应向 UID=${agent.userId} 产生返佣！请检查配置`
                );
                return;
            }

            // 找到对应相对层级的利率配置项
            const rateItem = rateConfig ? rateConfig.find((r) => r.hierarchy === relHier) : null;

            const contribution = calculateContribution(rateItem, desc, agent.userId, relHier);
            agentTotalRebate += contribution.total;
            perDescendantResults.push(contribution);
        });

        // ---- 打印该代理的详细返佣信息 ----
        printAgentRebateDetail(
            agent,
            earnLevel,
            earnLevelReason,
            agentTotalRebate,
            perDescendantResults,
            noRebateUsers,
            level1Stats
        );

        agentRebateSummary.push({
            userId: agent.userId,
            hierarchy: agent.hierarchy,
            rebateMode: agent.rebateMode,
            rebateState: agent.rebateState,
            earnLevel,
            totalRebate: agentTotalRebate,
            descendantCount: allDescendants.length
        });
    }

    // ---- 打印团队明细报表 ----
    printTeamDetailReport(nonMasterMembers, memberDataMap, accountId, masterHierarchy, startTs, endTs, transferMap, transferOutMemberDataMap, transferOutMap);

    // ---- 最终汇总 ----
    printFinalSummary(agentRebateSummary, masterHierarchy, accountId, dateStr, noRebateUsers);
}

/**
 * 打印团队下级成员的昨日投注、充值和转线状态报表
 */
function printTeamDetailReport(nonMasterMembers, memberDataMap, accountId, masterHierarchy, startTs, endTs, transferMap, transferOutMemberDataMap, transferOutMap) {
    if (nonMasterMembers.length === 0 && Object.keys(transferOutMemberDataMap || {}).length === 0) return;

    console.log(`\n${'─'.repeat(100)}`);
    console.log(`📋 团队下级成员明细报表（含所有层级）- UID=${accountId}`);
    console.log(`${'─'.repeat(100)}`);
    console.log(`  ${'userId'.padEnd(12)} ${'充值金额'.padEnd(12)} ${'是否首充'.padEnd(10)} ${'是否投注'.padEnd(10)} ${'投注金额'.padEnd(12)} ${'昨日注册'.padEnd(10)} ${'层级'.padEnd(6)} 转线状态`);
    console.log(`  ${'─'.repeat(90)}`);

    let tSumAmount = 0, tSumRecharge = 0, tSumFirst = 0, tSumReg = 0, tSumBet = 0, tSumBetCount = 0;

    // 打印现有团队成员
    nonMasterMembers.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        const amt      = d.totalRechargeAmount || 0;
        const betAmt   = d.betAmountSum || 0;
        const isFirst  = d.isFirstCharge ? '✅ 是' : '否';
        const isBet    = betAmt > 0 ? '✅ 是' : '否';
        const isReg    = (m.registerTime >= startTs && m.registerTime <= endTs) ? '✅ 是' : '否';
        const relHier  = m.hierarchy - masterHierarchy;

        const transfer = transferMap[m.userId];
        let transferStatus = '否';
        if (transfer && transfer.transferred) {
            if (d.isFirstCharge && d.firstChargeTime && transfer.transferEndTime) {
                transferStatus = d.firstChargeTime < transfer.transferEndTime
                    ? '⚠️ 转入(首充前)' : '✅ 转入(首充后)';
            } else {
                transferStatus = '✅ 转线';
            }
        }

        tSumAmount  += amt;
        tSumBet     += betAmt;
        if (amt > 0)   tSumRecharge++;
        if (d.isFirstCharge) {
            const t = transferMap[m.userId];
            if (!t || !t.transferred || !t.transferEndTime || !d.firstChargeTime || d.firstChargeTime >= t.transferEndTime) {
                tSumFirst++;
            }
        }
        if (betAmt > 0) tSumBetCount++;
        if (m.registerTime >= startTs && m.registerTime <= endTs) tSumReg++;
        console.log(`  ${String(m.userId).padEnd(12)} ${amt.toFixed(2).padEnd(12)} ${isFirst.padEnd(10)} ${isBet.padEnd(10)} ${betAmt.toFixed(2).padEnd(12)} ${isReg.padEnd(10)} ${('L'+String(relHier)).padEnd(6)} ${transferStatus}`);
    });

    // 打印转出成员（特殊标记）
    const toMap = transferOutMemberDataMap || {};
    const toInfoMap = transferOutMap || {};
    Object.keys(toMap).forEach(uidStr => {
        const uid = Number(uidStr);
        const d = toMap[uid];
        if (!d) return;
        const info     = toInfoMap[uid] || {};
        const amt      = d.totalRechargeAmount || 0;
        const betAmt   = d.betAmountSum || 0;
        const isFirst  = d.isFirstCharge ? '✅ 是' : '否';
        const isBet    = betAmt > 0 ? '✅ 是' : '否';
        const isReg    = '─';  // 转出成员 registerTime 未知，不统计
        const relHier  = (info.oldHierarchy || 0) - masterHierarchy;
        const transferStatus = `⬅️ 转出(${new Date(info.transferBeginTime || 0).toLocaleTimeString()})`;

        tSumAmount  += amt;
        tSumBet     += betAmt;
        if (amt > 0)   tSumRecharge++;
        if (d.isFirstCharge) tSumFirst++;
        if (betAmt > 0) tSumBetCount++;

        console.log(`  ${String(uid).padEnd(12)} ${amt.toFixed(2).padEnd(12)} ${isFirst.padEnd(10)} ${isBet.padEnd(10)} ${betAmt.toFixed(2).padEnd(12)} ${isReg.padEnd(10)} ${('L'+String(relHier)).padEnd(6)} ${transferStatus}`);
    });

    console.log(`  ${'─'.repeat(90)}`);
    const totalCount = nonMasterMembers.length + Object.keys(toMap).length;
    console.log(`  团队汇总: 共${totalCount}人(含${Object.keys(toMap).length}转出) | 充值${tSumRecharge}人 | 首充${tSumFirst}人(转线修正后) | 充值总额: ${tSumAmount.toFixed(2)} | 投注${tSumBetCount}人 | 投注总额: ${tSumBet.toFixed(2)} | 昨日注册: ${tSumReg}人`);
    console.log(`${'─'.repeat(100)}\n`);
}

// ============================================================
// ============ 数据获取：充值 + 投注 =========================
// ============================================================

/**
 * 为单个成员查询昨日的充值和投注数据，返回 enriched 对象。
 * @param {Object} data
 * @param {Object} member   - allMembers 中的原始成员记录
 * @param {number} startTs  - 昨日开始时间戳（毫秒）
 * @param {number} endTs    - 昨日结束时间戳（毫秒）
 * @param {string} startDateStr - 昨日开始时间字符串（如 "2026-03-16 00:00:00"）
 * @param {string} endDateStr   - 昨日结束时间字符串（如 "2026-03-16 23:59:59"）
 * @param {number} transferEndTime - 可选，转线完成时间戳（毫秒），如果有，则充值/投注统计从该时间起算
 * @returns {Object}        - enriched member 含 totalRechargeAmount, betAmountSum, 各类型投注数组
 */
function fetchMemberData(data, member, startTs, endTs, startDateStr, endDateStr, transferEndTime = null) {
    const enriched = {
        userId: member.userId,
        parentId: member.parentId,
        hierarchy: member.hierarchy,
        rebateState: member.rebateState,
        rebateMode: member.rebateMode,
        rebateLevel: member.rebateLevel,
        rebateSetTime: member.rebateSetTime,
        registerTime: member.registerTime,
        // 是否昨日加入团队（rebateSetTime 落在昨日范围内）
        joinedYesterday: member.rebateSetTime >= startTs && member.rebateSetTime <= endTs,
        // 是否昨日注册
        registeredYesterday: member.registerTime >= startTs && member.registerTime <= endTs,
        // 投注分类
        electronicGame: [],
        liveCasino: [],
        sports: [],
        lottery: [],
        chessCard: [],
        betAmountSum: 0,
        // 充值
        totalRechargeAmount: 0,
        isFirstCharge: false,
        firstChargeTime: null,  // R1 充值完成时间戳（毫秒），供转线判断使用
        firstChargeAmount: 0    // R1 充值金额
    };

    const effectiveStartTs = transferEndTime ? Math.max(startTs, transferEndTime) : startTs;

    // 1. 查询昨日充值 (如果转线，则排除转线前的充值)
    const rechargeList = GetRechargeOrderPageList(data, member.userId, 'Payed', effectiveStartTs, endTs);
    if (isNonEmptyArray(rechargeList)) {
        rechargeList.forEach((item) => {
            const amt = Number(item.actualAmount || 0);
            if (!isNaN(amt)) {
                enriched.totalRechargeAmount = (enriched.totalRechargeAmount * 100 + amt * 100) / 100;
            }
        });
    }

    // 2. 查询昨日投注（5 个类别），如果转线则排除转线前的投注
    GetBetRecordPageList(data, enriched, effectiveStartTs, endTs, 'BetTime', 'BetTime');

    // 3. 查询是否首充
    // 注意：/api/RptUserInfo/GetUserRptRechargePageList 接口要求的 startTime/endTime 是字符串格式的日期（如"2026-03-16 00:00:00"）而非时间戳
    const firstChargeList = GetUserRptRechargePageList(data, member.userId, 1, startDateStr, endDateStr);
    if (isNonEmptyArray(firstChargeList)) {
        // 只要有任意一条 R1 记录，就算首充（修复：原逻辑用 every 要求全部是 R1，导致有二充/三充时误判）
        const hasR1 = firstChargeList.some((item) => item.rechargeType === 'R1');
        if (hasR1) {
            enriched.isFirstCharge = true;
            // 保存 R1 的充值完成时间与金额，供转线判断与金额统计使用
            const r1Item = firstChargeList.find(item => item.rechargeType === 'R1');
            enriched.firstChargeTime = r1Item ? (r1Item.rechargeTime || null) : null;
            enriched.firstChargeAmount = r1Item ? (Number(r1Item.rechargeAmount || r1Item.actualAmount || 0)) : 0;
        }
    }

    return enriched;
}

/**
 * 批量获取团队成员的转线记录（转入方向，timeType=2）
 * 用于判断现有成员是否昨日从其他团队转入
 */
function fetchTransferMap(data, members, startTs, endTs, tag) {
    const transferMap = {}; 
    members.forEach((member) => {
        const api = '/api/Agent/GetPageListAgentTransfer';
        const payload = {
            timeType: 2, userId: member.userId, timeFrom: startTs, timeTo: endTs, pageNo: 1, pageSize: 20, orderBy: 'Desc'
        };
        let result = sendQueryRequest(payload, api, tag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { result = null; }
        }
        const list = result && result.list ? result.list : [];
        if (list.length >= 2) {
            const bindRecord = list.find(r => r.newParentId !== 0 && r.newParentId !== null);
            transferMap[member.userId] = { transferred: true, transferEndTime: bindRecord ? bindRecord.transferEndTime : null };
        } else {
            transferMap[member.userId] = { transferred: false, transferEndTime: null };
        }
    });
    return transferMap;
}

/**
 * 查询昨日从总代团队转出的成员（timeType=1，按转线时间查全局记录）
 *
 * 逻辑：
 *   - 用 timeType=1 查昨日所有转线记录（不限 userId）
 *   - 找出 oldParentId 在当前团队成员集合内、且 newParentId===0 的记录
 *     （newParentId=0 表示"脱离"中间态，即从原上级断开）
 *   - 这些 userId 就是昨日从本团队转出的成员
 *   - 返回 Map: userId → { transferBeginTime, oldParentId, oldHierarchy }
 *
 * @param {Object} data
 * @param {Set<number>} teamMemberIdSet - 当前团队所有成员 userId 的集合（含总代自身）
 * @param {number} startTs
 * @param {number} endTs
 * @param {string} tag
 * @returns {Object} transferOutMap: userId → { transferBeginTime, oldParentId, oldHierarchy }
 */
function fetchTransferOutMembers(data, teamMemberIdSet, startTs, endTs, tag) {
    const api = '/api/Agent/GetPageListAgentTransfer';
    const transferOutMap = {};

    // 必须用 sendRequest 而非 sendQueryRequest：
    // sendQueryRequest 会强制覆盖 payload 里的 pageNo/pageSize，导致分页失效，永远只查第 1 页
    const pageSize = 500;
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage && pageNo <= 10) {
        const payload = {
            timeType: 1,
            timeFrom: startTs,
            timeTo: endTs,
            pageNo: pageNo,
            pageSize: pageSize,
            orderBy: 'Desc'
        };

        let result = sendRequest(payload, api, tag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { break; }
        }
        if (!result) break;

        // sendRequest 返回 parsedBody.data，结构为 { list, totalPage, totalCount, pageNo }
        const list = result.list || [];
        if (result.totalPage && result.totalPage > totalPage) {
            totalPage = result.totalPage;
        }

        console.log(`   [转出查询] 第${pageNo}/${totalPage}页，本页 ${list.length} 条记录`);

        list.forEach(record => {
            // 条件：脱离中间态（newParentId=0）且原上级在本团队内
            if (record.newParentId === 0 && teamMemberIdSet.has(record.oldParentId)) {
                const uid = record.userId;
                // 同一个 userId 可能有多条转出记录，取最早的那次（transferBeginTime 最小）
                if (!transferOutMap[uid] || record.transferBeginTime < transferOutMap[uid].transferBeginTime) {
                    transferOutMap[uid] = {
                        transferBeginTime: record.transferBeginTime,
                        transferEndTime:   record.transferEndTime,
                        oldParentId:       record.oldParentId,
                        oldHierarchy:      record.oldHierarchy
                    };
                }
            }
        });

        pageNo++;
    }

    return transferOutMap;
}

// ============================================================
// ============ API 封装 ======================================
// ============================================================

/**
 * 查询账号的充值订单列表
 */
export function GetRechargeOrderPageList(data, userId, rechargeState, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const payload = { rechargeState, userId, startTime, endTime };
    let result = sendQueryRequest(payload, api, sixearnTag, false, data.token);
    if (typeof result !== 'object') {
        try { result = JSON.parse(result); } catch (e) { return null; }
    }
    if (result && result.list && result.list.length > 0) return result.list;
    return null;
}

/**
 * 查询账号的投注记录（5 个 categoryType：0电子 1真人 2体育 3彩票 4棋牌）
 * 直接在 enriched 对象上写入数据。
 * USE_VALID_AMOUNT 控制使用 validAmount 还是 betAmount。
 */
export function GetBetRecordPageList(data, enriched, startTime, endTime, queryTimeType, sortField) {
    const api = '/api/ThirdGame/GetBetRecordPageList';
    // categoryType 0电子 1真人 2体育 3彩票 4棋牌
    for (let j = 0; j < 5; j++) {
        const payload = {
            categoryType: j,
            queryTimeType,
            userId: enriched.userId,
            beginTimeUnix: startTime,
            endTimeUnix: endTime,
            pageSize: 200,
            sortField
        };
        let result = sendQueryRequest(payload, api, sixearnTag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { continue; }
        }

        // 优先从 sum 字段取汇总数据（更高效），兜底从 list 逐条累加
        if (result && result.sum) {
            const catBet = parseFloat(USE_VALID_AMOUNT ? result.sum.validAmountSum : result.sum.betAmountSum) || 0;
            if (j === 0) enriched.electronicGame.push(catBet);
            else if (j === 1) enriched.liveCasino.push(catBet);
            else if (j === 2) enriched.sports.push(catBet);
            else if (j === 3) enriched.lottery.push(catBet);
            else if (j === 4) enriched.chessCard.push(catBet);
        } else if (result && result.list && result.list.length > 0) {
            result.list.forEach((item) => {
                const rawAmt = USE_VALID_AMOUNT ? item.validAmount : item.betAmount;
                const amt = parseFloat(rawAmt) || 0;
                if (j === 0) enriched.electronicGame.push(amt);
                else if (j === 1) enriched.liveCasino.push(amt);
                else if (j === 2) enriched.sports.push(amt);
                else if (j === 3) enriched.lottery.push(amt);
                else if (j === 4) enriched.chessCard.push(amt);
            });
        }
    }
    // 计算总投注金额
    const sum = (arr) => arr.reduce((s, v) => s + v, 0);
    enriched.betAmountSum =
        sum(enriched.electronicGame) +
        sum(enriched.liveCasino) +
        sum(enriched.sports) +
        sum(enriched.lottery) +
        sum(enriched.chessCard);

    return enriched;
}

/**
 * 查询账号的首充/二充/三充记录
 * 注意：startTime 和 endTime 需要是字符串格式（"YYYY-MM-DD HH:mm:ss"）
 */
export function GetUserRptRechargePageList(data, userId, memberIdType, startTime, endTime) {
    const api = '/api/RptUserInfo/GetUserRptRechargePageList';
    const payload = { memberIdType, memberId: userId, startTime, endTime };
    let result = sendQueryRequest(payload, api, sixearnTag, false, data.token);
    if (typeof result !== 'object') {
        try { result = JSON.parse(result); } catch (e) { return null; }
    }
    if (result && result.list && result.list.length > 0) return result.list;
    return null;
}

// ============================================================
// ============ 返佣等级和利率计算 ============================
// ============================================================

/**
 * 根据团队数据确定正常返佣等级（从高档位往低档位匹配）。
 * 只要同时满足【充值人数 > 档位阈值 AND 充值金额 > 档位阈值 AND 投注金额 > 档位阈值】即取该档位。
 *
 * @param {number} rechargePeopleCount - 昨日充值人数
 * @param {number} totalRechargeAmt    - 昨日总充值金额
 * @param {number} totalBetAmt         - 昨日总投注金额
 * @param {Array}  rebateLevelList     - 服务端返回的返佣等级配置表
 * @returns {number} 匹配到的返佣等级（rebateLevel），匹配不到返回 0（默认最低档）
 */
function computeNormalEarnLevel(rechargePeopleCount, totalRechargeAmt, totalBetAmt, rebateLevelList) {
    if (rechargePeopleCount === 0 && totalRechargeAmt === 0 && totalBetAmt === 0) {
        return 0; // 团队没有充值/投注，默认0级
    }
    // 从最高档位往低档位扫描，找到第一个【三项全部超过阈值】的档位
    const sorted = [...rebateLevelList].sort((a, b) => b.rebateLevel - a.rebateLevel);
    for (const cfg of sorted) {
        if (
            rechargePeopleCount >= cfg.childrenRechargeCount &&
            totalRechargeAmt >= cfg.childrenRechargeAmount &&
            totalBetAmt >= cfg.childrenLotteryAmount
        ) {
            return cfg.rebateLevel;
        }
    }
    return 0; // 未达到任何档位，使用默认等级0
}

/**
 * 在利率配置列表中找出指定 rebateLevel 的利率配置，去除 hierarchy=-1 的合计行。
 * @param {number} rebateLevel
 * @param {Array}  rebateRateList  - RebateLevelRate 的结果
 * @returns {Array|null}           - 各层级利率项目组成的数组，或 null
 */
function getRateConfigForLevel(rebateLevel, rebateRateList) {
    const entry = rebateRateList.find((r) => r.rebateLevel === rebateLevel);
    if (!entry || !isNonEmptyArray(entry.list)) return null;
    // 过滤掉 hierarchy=-1 的合计行
    return entry.list.filter((item) => item.hierarchy > 0);
}

/**
 * 计算单个下级成员对上级代理的返佣贡献。
 * 利率字段：rateElectronic, rateVideo, rateSports, rateLottery, rateChessCard（均为百分比，即 x/100 的比率）
 *
 * @param {Object|null} rateItem  - 对应相对层级的利率配置项
 * @param {Object}      desc      - 下级成员 enriched 数据
 * @param {number}      agentId   - 代理 userId（用于日志）
 * @param {number}      relHier   - 相对层级
 * @returns {Object}              - 各游戏类型返佣分项及总额
 */
function calculateContribution(rateItem, desc, agentId, relHier) {
    const sum = (arr) => arr.reduce((s, v) => s + v, 0);

    if (!rateItem) {
        return {
            userId: desc.userId,
            relHier,
            electronearn: 0,
            liveCasinoearn: 0,
            sportsearn: 0,
            lotteryearn: 0,
            chessCardearn: 0,
            total: 0,
            rebateState: desc.rebateState
        };
    }

    // 利率字段除以 100 转换为实际比率
    const electronearn = (sum(desc.electronicGame) * rateItem.rateElectronic) / 100;
    const liveCasinoearn = (sum(desc.liveCasino) * rateItem.rateVideo) / 100;
    const sportsearn = (sum(desc.sports) * rateItem.rateSports) / 100;
    const lotteryearn = (sum(desc.lottery) * rateItem.rateLottery) / 100;
    const chessCardearn = (sum(desc.chessCard) * rateItem.rateChessCard) / 100;

    const total = electronearn + liveCasinoearn + sportsearn + lotteryearn + chessCardearn;

    return {
        userId: desc.userId,
        relHier,
        electronearn,
        liveCasinoearn,
        sportsearn,
        lotteryearn,
        chessCardearn,
        total,
        rebateState: desc.rebateState,
        // 用于调试
        betElectronic: sum(desc.electronicGame),
        betLive: sum(desc.liveCasino),
        betSports: sum(desc.sports),
        betLottery: sum(desc.lottery),
        betChess: sum(desc.chessCard),
        rateElectronic: rateItem.rateElectronic,
        rateVideo: rateItem.rateVideo,
        rateSports: rateItem.rateSports,
        rateLottery: rateItem.rateLottery,
        rateChessCard: rateItem.rateChessCard
    };
}

// ============================================================
// ============ 打印函数 ======================================
// ============================================================

/**
 * 打印单个代理的详细返佣信息。
 */
function printAgentRebateDetail(agent, earnLevel, earnLevelReason, agentTotalRebate, perDescendantResults, noRebateUsers, level1Stats) {
    const noRebateIds = new Set(noRebateUsers.map((u) => u.userId));

    const stateTag = noRebateIds.has(agent.userId) ? ' ⚠️ [rebateState=0]' : '';
    console.log(`\n${'─'.repeat(65)}`);
    console.log(
        `📌 代理 UID=${agent.userId}${stateTag}  绝对层级=${agent.hierarchy}  返佣模式=${['正常', '锁定', '特殊'][agent.rebateMode] || agent.rebateMode}  返佣等级LV=${earnLevel}`
    );
    console.log(`   等级依据: ${earnLevelReason}`);
    console.log(`   预计总返佣: ${agentTotalRebate.toFixed(6)}`);
    
    if (level1Stats) {
        console.log(`\n   📊 直推(1级)概览: 总人数=${level1Stats.count} | 新注册=${level1Stats.registerCount} | 首充人数=${level1Stats.firstChargeCount} | 充值总额=${level1Stats.rechargeAmount.toFixed(2)}`);
    }

    if (perDescendantResults.length === 0) {
        console.log('   (无有效下级投注数据)');
        return;
    }

    // 按相对层级分组打印
    const byRelHier = {};
    perDescendantResults.forEach((r) => {
        if (!byRelHier[r.relHier]) byRelHier[r.relHier] = [];
        byRelHier[r.relHier].push(r);
    });

    Object.keys(byRelHier)
        .sort((a, b) => Number(a) - Number(b))
        .forEach((relHierStr) => {
            const items = byRelHier[relHierStr];
            const relHier = Number(relHierStr);
            const levelTotal = items.reduce((s, r) => s + r.total, 0);
            console.log(`\n   ┌─ 相对层级 ${relHier} 级  (共 ${items.length} 人  小计: ${levelTotal.toFixed(6)})`);
            items.forEach((r) => {
                const stateWarn = noRebateIds.has(r.userId) ? ' ⚠️ rebateState=0' : '';
                console.log(
                    `   │  UID=${r.userId}${stateWarn}  返佣金额=${r.total.toFixed(6)}`
                );
                if (r.betElectronic > 0 || r.electronearn > 0) {
                    console.log(
                        `   │    电子:  投注=${r.betElectronic.toFixed(2)}  利率=${r.rateElectronic}%  返佣=${r.electronearn.toFixed(6)}`
                    );
                }
                if (r.betLive > 0 || r.liveCasinoearn > 0) {
                    console.log(
                        `   │    真人:  投注=${r.betLive.toFixed(2)}  利率=${r.rateVideo}%  返佣=${r.liveCasinoearn.toFixed(6)}`
                    );
                }
                if (r.betSports > 0 || r.sportsearn > 0) {
                    console.log(
                        `   │    体育:  投注=${r.betSports.toFixed(2)}  利率=${r.rateSports}%  返佣=${r.sportsearn.toFixed(6)}`
                    );
                }
                if (r.betLottery > 0 || r.lotteryearn > 0) {
                    console.log(
                        `   │    彩票:  投注=${r.betLottery.toFixed(2)}  利率=${r.rateLottery}%  返佣=${r.lotteryearn.toFixed(6)}`
                    );
                }
                if (r.betChess > 0 || r.chessCardearn > 0) {
                    console.log(
                        `   │    棋牌:  投注=${r.betChess.toFixed(2)}  利率=${r.rateChessCard}%  返佣=${r.chessCardearn.toFixed(6)}`
                    );
                }
            });
            console.log(`   └${'─'.repeat(58)}`);
        });
}

/**
 * 打印最终汇总表格。
 */
function printFinalSummary(agentRebateSummary, masterHierarchy, accountId, dateStr, noRebateUsers) {
    const noRebateIds = new Set(noRebateUsers.map((u) => u.userId));

    console.log(`\n${'='.repeat(70)}`);
    console.log(`📊 最终汇总 - UID=${accountId}  昨日(${dateStr})预计返佣`);
    console.log(`${'='.repeat(70)}`);

    let grandTotal = 0;

    agentRebateSummary.forEach((s) => {
        grandTotal += s.totalRebate;
        const stateWarn = noRebateIds.has(s.userId) ? ' ⚠️ rebateState=0' : '';
        const modeLabel = ['正常', '锁定', '特殊'][s.rebateMode] || s.rebateMode;
        console.log(
            `  ▶ UID=${s.userId}${stateWarn}  模式=${modeLabel}  等级LV=${s.earnLevel}  下级数=${s.descendantCount}  返佣合计=${s.totalRebate.toFixed(6)}`
        );
    });

    if (noRebateUsers.length > 0) {
        console.log(`\n  ⚠️  rebateState=0 异常用户（今日返佣应为0）:`);
        noRebateUsers.forEach((u) => {
            console.log(`      UID=${u.userId}  绝对层级=${u.hierarchy}`);
        });
    }
    console.log(`${'='.repeat(70)}\n`);
}

// ============================================================
// 前台接口自动化对比验证（新增，不改动上方任何现有逻辑）
// ============================================================

import { getUserAccount, detectAccountType, autoLoginByUserId } from '../user/userAccountApi.js';
import { tenantRequest } from '../../../libs/http/tenantRequest.js';

const frontVerifyTag = 'sixearnFrontVerify';

/**
 * 用前台 token 请求 /api/AgentRebate/GetPromotionData
 * @param {string} frontToken - 前台用户 token
 * @returns {object|null} 接口返回的 data 字段
 */
function getPromotionData(frontToken) {
    const api = '/api/AgentRebate/GetPromotionData';
    const result = tenantRequest(api, {}, { isDesk: true, token: frontToken });

    if (!result || result.msgCode !== 0) {
        console.error(`[FrontVerify] GetPromotionData 请求失败: ${result ? result.msg : '无响应'}`);
        return null;
    }

    if (result.data) {
        console.log(`[FrontVerify] GetPromotionData 接口返回字段: ${Object.keys(result.data).join(', ')}`);
    }
    return result.data || null;
}

/**
 * 根据 userId 获取前台 token（后台查账号 → 验证码登录）
 * @param {object} data       - 含 adminToken 的管理员数据
 * @param {number} userId
 * @returns {string|null} 前台 token
 */
function getFrontTokenByUserId(data, userId) {
    // Step 1: userId → 账号
    const account = getUserAccount(data.token, userId);
    if (!account) {
        console.error(`[FrontVerify] userId=${userId} 获取账号失败`);
        return null;
    }
    console.log(`[FrontVerify] userId=${userId} → 账号: ${account}`);

    // Step 2: 账号 → 前台 token（验证码登录）
    const accountType = detectAccountType(account);
    let frontToken = null;

    if (accountType === 'phone') {
        frontToken = mobileAutoLoginFlow(account, data);
    } else if (accountType === 'email') {
        frontToken = emailAutoLoginFlow(account, data);
    } else {
        console.error(`[FrontVerify] 未知账号类型: ${account}`);
        return null;
    }

    if (!frontToken) {
        console.error(`[FrontVerify] userId=${userId} 前台登录失败`);
        return null;
    }

    console.log(`[FrontVerify] userId=${userId} 前台登录成功`);
    return frontToken;
}

/**
 * 对比验证辅助：数值误差在 tolerance 内视为通过
 */
function checkTolerance(name, apiVal, calcVal, tolerance = 1) {
    const diff = Math.abs(apiVal - calcVal);
    if (diff <= tolerance) {
        console.log(`   ✅ [通过] ${name} | 计算值: ${calcVal} | 接口值: ${apiVal}`);
    } else {
        console.log(`   ❌ [失败] ${name} | 计算值: ${calcVal} | 接口值: ${apiVal} (误差: ${diff})`);
    }
}

function checkExact(name, apiVal, calcVal) {
    if (apiVal === calcVal) {
        console.log(`   ✅ [通过] ${name} | 计算值: ${calcVal} | 接口值: ${apiVal}`);
    } else {
        console.log(`   ❌ [失败] ${name} | 计算值: ${calcVal} | 接口值: ${apiVal}`);
    }
}

/**
 * 前台接口自动化对比验证主函数
 *
 * 流程：
 *   1. userId → 账号（后台接口）
 *   2. 账号 → 前台 token（验证码登录）
 *   3. 调用 /api/AgentRebate/GetPromotionData
 *   4. 本地重新计算直推/团队统计数据
 *   5. 与接口返回值逐字段对比
 *
 * @param {object} data      - 含 adminToken 的管理员数据
 * @param {number} targetUid - 要验证的账号 userId
 */
export function verifyPromotionDataByUserId(data, targetUid) {
    if (!targetUid) {
        console.error(`[FrontVerify] 缺少 targetUid`);
        return;
    }

    const accountId = Number(targetUid);
    const { startTs, endTs, dateStr } = getYesterdayRange();

    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔍 前台接口对比验证 - UID=${accountId}  昨日=${dateStr}`);
    console.log(`${'='.repeat(70)}\n`);

    // ── Step 1: 获取前台 token ──────────────────────────────
    console.log('【Step 1】获取前台 token...');
    const frontToken = autoLoginByUserId(data.token, accountId);
    if (!frontToken) {
        console.error(`[FrontVerify] 无法获取前台 token，终止验证`);
        return;
    }

    // ── Step 2: 调用前台接口 ────────────────────────────────
    console.log('\n【Step 2】调用 GetPromotionData...');
    const promotionData = getPromotionData(frontToken);
    if (!promotionData) {
        console.error(`[FrontVerify] GetPromotionData 返回空，终止验证`);
        return;
    }
    console.log(`   ✅ 接口返回成功`);
    console.log(`   接口数据: ${JSON.stringify(promotionData, null, 2)}`);

    // ── Step 3: 查询团队成员（复用现有逻辑）──────────────────
    console.log('\n【Step 3】查询团队成员列表...');
    const agentListApi = '/api/Agent/GetPageListAgentList';
    const agentPayload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: true,
        pageNo: 1,
        pageSize: 500
    };
    let agentResult = sendQueryRequest(agentPayload, agentListApi, frontVerifyTag, false, data.token);
    if (typeof agentResult === 'string') {
        try { agentResult = JSON.parse(agentResult); } catch (e) { return; }
    }

    let memberList = null;
    if (agentResult && Array.isArray(agentResult.list)) memberList = agentResult.list;
    else if (agentResult && agentResult.data && Array.isArray(agentResult.data.list)) memberList = agentResult.data.list;

    if (!memberList || memberList.length === 0) {
        console.error(`[FrontVerify] 未获取到团队成员，终止验证`);
        return;
    }

    const masterRecord = memberList.find(m => m.userId === accountId);
    if (!masterRecord) {
        console.error(`[FrontVerify] 成员列表中不包含目标账号本身`);
        return;
    }

    const masterHierarchy = masterRecord.hierarchy;
    // 直推 = 相对层级 1，即绝对层级 = masterHierarchy + 1
    const directSubHierarchy = masterHierarchy + 1;

    console.log(`   ✅ 共 ${memberList.length} 人 | 目标账号绝对层级=${masterHierarchy} | 直推层级=${directSubHierarchy}`);

    // ── Step 4: 查询每个成员的转线记录与昨日充值数据 ──────────────────
    console.log('\n【Step 4】查询成员昨日转线记录...');
    // 只统计 6 层以内的成员
    const nonMasterMembers = memberList.filter(m => 
        m.userId !== accountId && 
        (m.hierarchy - masterHierarchy) <= MAX_REBATE_HIERARCHY
    );
    
    const transferMap = fetchTransferMap(data, nonMasterMembers, startTs, endTs, frontVerifyTag);
    console.log(`   ✅ 转线查询完毕，共 ${Object.values(transferMap).filter(t => t.transferred).length} 人昨日发生转线`);

    console.log('\n【Step 4.5】查询成员昨日充值/投注数据...');
    const memberDataMap = {};

    nonMasterMembers.forEach((member, idx) => {
        sleep(0.3);
        if (idx % 10 === 0 && idx > 0) console.log(`   ...已查询 ${idx}/${nonMasterMembers.length} 人...`);
        const enriched = fetchMemberData(data, member, startTs, endTs,
            `${dateStr} 00:00:00`, `${dateStr} 23:59:59`,
            transferMap[member.userId] ? transferMap[member.userId].transferEndTime : null);
        memberDataMap[member.userId] = enriched;
    });
    console.log(`   ✅ 数据查询完毕`);

    // ── Step 5: 本地计算统计数据 ────────────────────────────
    console.log('\n【Step 5】本地计算统计数据...');

    const directSubs  = nonMasterMembers.filter(m => m.hierarchy === directSubHierarchy);
    const allTeam     = nonMasterMembers; // 全团队（不含自身）

    // 直推统计
    const directStats = {
        registerCount:      0,
        rechargeCount:      0,
        firstRechargeCount: 0,
        rechargeAmount:     0
    };

    directSubs.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        // 昨日注册：registerTime 落在昨日
        if (m.registerTime >= startTs && m.registerTime <= endTs) directStats.registerCount++;
        // 昨日充值
        if (d.totalRechargeAmount > 0) directStats.rechargeCount++;
        // 昨日首充（需考虑转线：首充时间 < 转线完成时间 → 首充在原团队，不计入）
        if (d.isFirstCharge) {
            const transfer = transferMap[m.userId];
            if (transfer && transfer.transferred && transfer.transferEndTime && d.firstChargeTime) {
                // 首充时间 < 转线完成时间 → 首充发生在原团队，不计入本团队
                if (d.firstChargeTime < transfer.transferEndTime) {
                    // 不计入
                } else {
                    directStats.firstRechargeCount++;
                }
            } else {
                directStats.firstRechargeCount++;
            }
        }
        // 充值金额
        directStats.rechargeAmount += (d.totalRechargeAmount || 0);
    });

    // 团队统计
    const teamStats = {
        registerCount:        0,
        rechargeCount:        0,
        firstRechargeCount:   0,
        rechargeAmount:       0,
        firstRechargeAmount:  0
    };

    allTeam.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        if (m.registerTime >= startTs && m.registerTime <= endTs) teamStats.registerCount++;
        if (d.totalRechargeAmount > 0) teamStats.rechargeCount++;
        // 首充计数同样考虑转线
        if (d.isFirstCharge) {
            const transfer = transferMap[m.userId];
            if (transfer && transfer.transferred && transfer.transferEndTime && d.firstChargeTime) {
                if (d.firstChargeTime >= transfer.transferEndTime) {
                    teamStats.firstRechargeCount++;
                    teamStats.firstRechargeAmount += (d.firstChargeAmount || 0);
                }
            } else {
                teamStats.firstRechargeCount++;
                teamStats.firstRechargeAmount += (d.firstChargeAmount || 0);
            }
        }
        teamStats.rechargeAmount += (d.totalRechargeAmount || 0);
    });

    console.log(`   直推(层级${directSubHierarchy}): 注册=${directStats.registerCount} 充值=${directStats.rechargeCount} 首充=${directStats.firstRechargeCount} 充值额=${directStats.rechargeAmount.toFixed(2)}`);
    console.log(`   全团队: 注册=${teamStats.registerCount} 充值=${teamStats.rechargeCount} 首充=${teamStats.firstRechargeCount} 首充额=${teamStats.firstRechargeAmount.toFixed(2)} 充值额=${teamStats.rechargeAmount.toFixed(2)}`);

    // ── 明细表格：直推成员 ──────────────────────────────────
    console.log(`\n${'─'.repeat(90)}`);
    console.log(`📋 直推成员明细（层级 L${directSubHierarchy}）`);
    console.log(`${'─'.repeat(90)}`);
    console.log(`  ${'userId'.padEnd(12)} ${'充值金额'.padEnd(12)} ${'是否首充'.padEnd(10)} ${'是否投注'.padEnd(10)} ${'投注金额'.padEnd(12)} ${'昨日注册'.padEnd(10)} 转线状态`);
    console.log(`  ${'─'.repeat(85)}`);

    let dSumAmount = 0, dSumRecharge = 0, dSumFirst = 0, dSumFirstAmount = 0, dSumReg = 0, dSumBet = 0, dSumBetCount = 0;
    directSubs.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        const amt      = d.totalRechargeAmount || 0;
        const betAmt   = d.betAmountSum || 0;
        const isFirst  = d.isFirstCharge ? `✅ ${d.firstChargeAmount.toFixed(0)}` : '否';
        const isBet    = betAmt > 0 ? '✅ 是' : '否';
        const isReg    = (m.registerTime >= startTs && m.registerTime <= endTs) ? '✅ 是' : '否';

        // 转线状态
        const transfer = transferMap[m.userId];
        let transferStatus = '否';
        if (transfer && transfer.transferred) {
            if (d.isFirstCharge && d.firstChargeTime && transfer.transferEndTime) {
                transferStatus = d.firstChargeTime < transfer.transferEndTime
                    ? '⚠️ 转入(首充前)' : '✅ 转入(首充后)';
            } else {
                transferStatus = '✅ 转线';
            }
        }

        dSumAmount  += amt;
        dSumBet     += betAmt;
        if (amt > 0)   dSumRecharge++;
        if (d.isFirstCharge) {
            const t = transferMap[m.userId];
            if (!t || !t.transferred || !t.transferEndTime || !d.firstChargeTime || d.firstChargeTime >= t.transferEndTime) {
                dSumFirst++;
                dSumFirstAmount += (d.firstChargeAmount || 0);
            }
        }
        if (betAmt > 0) dSumBetCount++;
        if (m.registerTime >= startTs && m.registerTime <= endTs) dSumReg++;
        console.log(`  ${String(m.userId).padEnd(12)} ${amt.toFixed(2).padEnd(12)} ${isFirst.padEnd(10)} ${isBet.padEnd(10)} ${betAmt.toFixed(2).padEnd(12)} ${isReg.padEnd(10)} ${transferStatus}`);
    });
    console.log(`  ${'─'.repeat(85)}`);
    console.log(`  直推汇总: 共${directSubs.length}人 | 充值${dSumRecharge}人 | 首充${dSumFirst}人(转线修正后) | 首充总额: ${dSumFirstAmount.toFixed(2)} | 充值总额: ${dSumAmount.toFixed(2)} | 投注${dSumBetCount}人 | 投注总额: ${dSumBet.toFixed(2)} | 昨日注册: ${dSumReg}人`);

    // ── 明细表格：全团队成员 ────────────────────────────────
    console.log(`\n${'─'.repeat(100)}`);
    console.log(`📋 全团队成员明细（含所有层级）`);
    console.log(`${'─'.repeat(100)}`);
    console.log(`  ${'userId'.padEnd(12)} ${'充值金额'.padEnd(12)} ${'是否首充'.padEnd(10)} ${'是否投注'.padEnd(10)} ${'投注金额'.padEnd(12)} ${'昨日注册'.padEnd(10)} ${'层级'.padEnd(6)} 转线状态`);
    console.log(`  ${'─'.repeat(90)}`);

    let tSumAmount = 0, tSumRecharge = 0, tSumFirst = 0, tSumFirstAmount = 0, tSumReg = 0, tSumBet = 0, tSumBetCount = 0;
    nonMasterMembers.forEach(m => {
        const d = memberDataMap[m.userId];
        if (!d) return;
        const amt      = d.totalRechargeAmount || 0;
        const betAmt   = d.betAmountSum || 0;
        const isFirst  = d.isFirstCharge ? `✅ ${d.firstChargeAmount.toFixed(0)}` : '否';
        const isBet    = betAmt > 0 ? '✅ 是' : '否';
        const isReg    = (m.registerTime >= startTs && m.registerTime <= endTs) ? '✅ 是' : '否';
        const relHier  = m.hierarchy - masterHierarchy;

        const transfer = transferMap[m.userId];
        let transferStatus = '否';
        if (transfer && transfer.transferred) {
            if (d.isFirstCharge && d.firstChargeTime && transfer.transferEndTime) {
                transferStatus = d.firstChargeTime < transfer.transferEndTime
                    ? '⚠️ 转入(首充前)' : '✅ 转入(首充后)';
            } else {
                transferStatus = '✅ 转线';
            }
        }

        tSumAmount  += amt;
        tSumBet     += betAmt;
        if (amt > 0)   tSumRecharge++;
        if (d.isFirstCharge) {
            const t = transferMap[m.userId];
            if (!t || !t.transferred || !t.transferEndTime || !d.firstChargeTime || d.firstChargeTime >= t.transferEndTime) {
                tSumFirst++;
                tSumFirstAmount += (d.firstChargeAmount || 0);
            }
        }
        if (betAmt > 0) tSumBetCount++;
        if (m.registerTime >= startTs && m.registerTime <= endTs) tSumReg++;
        console.log(`  ${String(m.userId).padEnd(12)} ${amt.toFixed(2).padEnd(12)} ${isFirst.padEnd(10)} ${isBet.padEnd(10)} ${betAmt.toFixed(2).padEnd(12)} ${isReg.padEnd(10)} ${'L'+String(relHier).padEnd(5)} ${transferStatus}`);
    });
    console.log(`  ${'─'.repeat(90)}`);
    console.log(`  团队汇总: 共${nonMasterMembers.length}人 | 充值${tSumRecharge}人 | 首充${tSumFirst}人(转线修正后) | 首充总额: ${tSumFirstAmount.toFixed(2)} | 充值总额: ${tSumAmount.toFixed(2)} | 投注${tSumBetCount}人 | 投注总额: ${tSumBet.toFixed(2)} | 昨日注册: ${tSumReg}人`);
    console.log(`${'─'.repeat(100)}\n`);

    // ── Step 6: 对比验证 ────────────────────────────────────
    console.log('\n【Step 6】逐字段对比验证...');

    checkExact('直推昨日注册人数 (yesterdayDirectSubRegisterCount)',
        promotionData.yesterdayDirectSubRegisterCount, directStats.registerCount);

    checkExact('直推昨日充值人数 (yesterdayDirectSubRechargeCount)',
        promotionData.yesterdayDirectSubRechargeCount, directStats.rechargeCount);

    checkExact('直推昨日首充人数 (yesterdayDirectSubFirstRechargeCount)',
        promotionData.yesterdayDirectSubFirstRechargeCount, directStats.firstRechargeCount);

    checkTolerance('直推昨日充值金额 (yesterdayDirectSubRechargeAmount)',
        promotionData.yesterdayDirectSubRechargeAmount, directStats.rechargeAmount);

    checkExact('团队昨日注册人数 (yesterdayTeamRegisterCount)',
        promotionData.yesterdayTeamRegisterCount, teamStats.registerCount);

    checkExact('团队昨日充值人数 (yesterdayTeamRechargeCount)',
        promotionData.yesterdayTeamRechargeCount, teamStats.rechargeCount);

    checkExact('团队昨日首充人数 (yesterdayTeamFirstRechargeCount)',
        promotionData.yesterdayTeamFirstRechargeCount, teamStats.firstRechargeCount);

    checkTolerance('团队昨日充值金额 (yesterdayTeamRechargeAmount)',
        promotionData.yesterdayTeamRechargeAmount, teamStats.rechargeAmount);

    // 兜底：如果接口不返回该字段（部分租户可能未配置），则使用计算值 0 进行对比（或者跳过）
    const apiFirstRechargeAmt = promotionData.yesterdayTeamFirstRechargeAmount !== undefined 
        ? promotionData.yesterdayTeamFirstRechargeAmount 
        : (promotionData.yesterdayTeamFirstRechargeAmt !== undefined ? promotionData.yesterdayTeamFirstRechargeAmt : undefined);

    if (apiFirstRechargeAmt !== undefined) {
        checkTolerance('团队昨日首充金额 (yesterdayTeamFirstRechargeAmount)',
            apiFirstRechargeAmt, teamStats.firstRechargeAmount);
    } else {
        console.warn(`   ⚠️  接口未返回 yesterdayTeamFirstRechargeAmount，跳过对比 (计算值: ${teamStats.firstRechargeAmount})`);
    }


    // ── Step 7: 计算昨日总返佣（复用 querySubAccounts 核心逻辑）──
    console.log('\n[Step 7] 计算昨日总返佣（返佣等级 + 利率）...');

    const rebateLevelList = RebateLevel(data);
    const rebateRateList  = RebateLevelRate(data);
    let calcTotalRebate   = null;

    if (isNonEmptyArray(rebateLevelList) && isNonEmptyArray(rebateRateList) && masterRecord) {
        // 动态获取最大返佣层级
        let maxHier = 6;
        rebateRateList.forEach(entry => {
            if (entry.list && Array.isArray(entry.list)) {
                const h = Math.max(...entry.list.filter(i => i.hierarchy > 0).map(r => r.hierarchy));
                if (h > maxHier) maxHier = h;
            }
        });

        // 构建树，获取所有下级
        const childrenMap   = buildChildrenMap(memberList);
        const descendantIds = getDescendants(accountId, childrenMap);
        const descendants   = descendantIds
            .filter(id => id !== accountId)
            .map(id => memberDataMap[id])
            .filter(Boolean);

        // 确定返佣等级
        let earnLevel;
        if (masterRecord.rebateMode === 1) {
            earnLevel = masterRecord.rebateLevel;
        } else {
            const validDesc = descendants.filter(d => (d.hierarchy - masterHierarchy) <= maxHier);
            const rechargePeopleCount = validDesc.filter(d => d.totalRechargeAmount > 0).length;
            const totalRechargeAmt    = validDesc.reduce((s, d) => s + (d.totalRechargeAmount || 0), 0);
            const totalBetAmt         = validDesc.reduce((s, d) => s + (d.betAmountSum || 0), 0);
            const normalLevel = computeNormalEarnLevel(rechargePeopleCount, totalRechargeAmt, totalBetAmt, rebateLevelList);
            earnLevel = masterRecord.rebateMode === 2
                ? Math.max(masterRecord.rebateLevel, normalLevel >= 0 ? normalLevel : 0)
                : (normalLevel >= 0 ? normalLevel : 0);
        }

        // 按层级计算返佣，同时收集明细用于展示
        const rateConfig = getRateConfigForLevel(earnLevel, rebateRateList);
        let agentTotalRebate = 0;
        const rebateDetails = []; // 收集每个下级的返佣明细

        descendants.forEach(desc => {
            if (!desc) return;
            const relHier = desc.hierarchy - masterHierarchy;
            if (relHier <= 0 || relHier > maxHier) return;
            const rateItem = rateConfig ? rateConfig.find(r => r.hierarchy === relHier) : null;
            const contrib  = calculateContribution(rateItem, desc, accountId, relHier);
            agentTotalRebate += contrib.total;
            if (contrib.total > 0 || (contrib.betElectronic + contrib.betLive + contrib.betSports + contrib.betLottery + contrib.betChess) > 0) {
                rebateDetails.push(contrib);
            }
        });

        calcTotalRebate = agentTotalRebate;

        // ── 返佣计算明细展示 ──────────────────────────────────
        console.log(`\n${'═'.repeat(90)}`);
        console.log(`💰 返佣计算明细  |  匹配等级: LV${earnLevel}  |  最大返佣层级: ${maxHier}层`);
        console.log(`${'═'.repeat(90)}`);

        // 打印利率配置
        if (rateConfig && rateConfig.length > 0) {
            console.log(`\n📐 LV${earnLevel} 利率配置:`);
            console.log(`   ${'层级'.padEnd(6)} ${'电子'.padEnd(8)} ${'真人'.padEnd(8)} ${'体育'.padEnd(8)} ${'彩票'.padEnd(8)} 棋牌`);
            console.log(`   ${'─'.repeat(50)}`);
            rateConfig.forEach(r => {
                console.log(`   L${String(r.hierarchy).padEnd(5)} ${String(r.rateElectronic+'%').padEnd(8)} ${String(r.rateVideo+'%').padEnd(8)} ${String(r.rateSports+'%').padEnd(8)} ${String(r.rateLottery+'%').padEnd(8)} ${r.rateChessCard}%`);
            });
        }

        // 打印每个下级的返佣明细
        if (rebateDetails.length > 0) {
            console.log(`\n📋 下级返佣明细（仅展示有投注或有返佣的成员）:`);
            console.log(`   ${'userId'.padEnd(10)} ${'层级'.padEnd(5)} ${'电子投注'.padEnd(10)} ${'真人投注'.padEnd(10)} ${'体育投注'.padEnd(10)} ${'彩票投注'.padEnd(10)} ${'棋牌投注'.padEnd(10)} ${'返佣合计'.padEnd(10)} 计算公式`);
            console.log(`   ${'─'.repeat(110)}`);

            rebateDetails.forEach(c => {
                const totalBet = c.betElectronic + c.betLive + c.betSports + c.betLottery + c.betChess;
                const formulaParts = [];
                if (c.betElectronic > 0) formulaParts.push(`电子${c.betElectronic.toFixed(2)}×${c.rateElectronic}%=${c.electronearn.toFixed(4)}`);
                if (c.betLive > 0)       formulaParts.push(`真人${c.betLive.toFixed(2)}×${c.rateVideo}%=${c.liveCasinoearn.toFixed(4)}`);
                if (c.betSports > 0)     formulaParts.push(`体育${c.betSports.toFixed(2)}×${c.rateSports}%=${c.sportsearn.toFixed(4)}`);
                if (c.betLottery > 0)    formulaParts.push(`彩票${c.betLottery.toFixed(2)}×${c.rateLottery}%=${c.lotteryearn.toFixed(4)}`);
                if (c.betChess > 0)      formulaParts.push(`棋牌${c.betChess.toFixed(2)}×${c.rateChessCard}%=${c.chessCardearn.toFixed(4)}`);
                const formula = formulaParts.length > 0 ? formulaParts.join(' + ') : '无投注';

                console.log(`   ${String(c.userId).padEnd(10)} L${String(c.relHier).padEnd(4)} ${c.betElectronic.toFixed(2).padEnd(10)} ${c.betLive.toFixed(2).padEnd(10)} ${c.betSports.toFixed(2).padEnd(10)} ${c.betLottery.toFixed(2).padEnd(10)} ${c.betChess.toFixed(2).padEnd(10)} ${c.total.toFixed(4).padEnd(10)} ${formula}`);
            });

            console.log(`   ${'─'.repeat(110)}`);
        } else {
            console.log(`\n   ℹ️  所有下级昨日均无投注，返佣为 0`);
        }

        // 按层级汇总
        const byLevel = {};
        rebateDetails.forEach(c => {
            if (!byLevel[c.relHier]) byLevel[c.relHier] = 0;
            byLevel[c.relHier] += c.total;
        });
        if (Object.keys(byLevel).length > 0) {
            console.log(`\n📊 按层级汇总:`);
            Object.keys(byLevel).sort((a,b) => a-b).forEach(lv => {
                console.log(`   L${lv}: ${byLevel[lv].toFixed(4)} 元`);
            });
        }

        console.log(`\n   💰 昨日总返佣: ${calcTotalRebate.toFixed(4)} 元`);
        console.log(`${'═'.repeat(90)}\n`);
    } else {
        console.warn('   [WARN] 返佣配置获取失败，跳过 yesterdayTotalCommission 对比');
    }

    // ── Step 8: 对比所有字段 ────────────────────────────────
    console.log('\n[Step 8] 逐字段对比验证...');

    checkExact('直推昨日注册人数 (yesterdayDirectSubRegisterCount)',
        promotionData.yesterdayDirectSubRegisterCount, directStats.registerCount);
    checkExact('直推昨日充值人数 (yesterdayDirectSubRechargeCount)',
        promotionData.yesterdayDirectSubRechargeCount, directStats.rechargeCount);
    checkExact('直推昨日首充人数 (yesterdayDirectSubFirstRechargeCount)',
        promotionData.yesterdayDirectSubFirstRechargeCount, directStats.firstRechargeCount);
    checkTolerance('直推昨日充值金额 (yesterdayDirectSubRechargeAmount)',
        promotionData.yesterdayDirectSubRechargeAmount, directStats.rechargeAmount);
    checkExact('团队昨日注册人数 (yesterdayTeamRegisterCount)',
        promotionData.yesterdayTeamRegisterCount, teamStats.registerCount);
    checkExact('团队昨日充值人数 (yesterdayTeamRechargeCount)',
        promotionData.yesterdayTeamRechargeCount, teamStats.rechargeCount);
    checkExact('团队昨日首充人数 (yesterdayTeamFirstRechargeCount)',
        promotionData.yesterdayTeamFirstRechargeCount, teamStats.firstRechargeCount);
    checkTolerance('团队昨日充值金额 (yesterdayTeamRechargeAmount)',
        promotionData.yesterdayTeamRechargeAmount, teamStats.rechargeAmount);

    if (apiFirstRechargeAmt !== undefined) {
        checkTolerance('团队昨日首充金额 (yesterdayTeamFirstRechargeAmount)',
            apiFirstRechargeAmt, teamStats.firstRechargeAmount);
    }

    if (calcTotalRebate !== null) {
        checkTolerance('昨日总返佣 (yesterdayTotalCommission)',
            promotionData.yesterdayTotalCommission, calcTotalRebate, 1);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 全量自动化对比验证完成 - UID=' + accountId);
    console.log('='.repeat(70) + '\n');
}
