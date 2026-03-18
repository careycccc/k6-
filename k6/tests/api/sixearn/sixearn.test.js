import { sendQueryRequest } from '../common/request.js';
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
    console.log(`【Step 4】开始查询 ${nonMasterMembers.length} 个成员的昨日充值/投注数据（总代自身不查询）...\n`);
    const memberDataMap = {}; // userId → enriched member data

    nonMasterMembers.forEach((member, idx) => {
        sleep(0.5);
        console.log(
            `  [${String(idx + 1).padStart(3)}/${nonMasterMembers.length}] 查询 UID=${member.userId}  绝对层级=${member.hierarchy} ...`
        );
        const enriched = fetchMemberData(data, member, startTs, endTs, startDateStr, endDateStr);
        memberDataMap[member.userId] = enriched;
    });

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
        if (descendantIds.length === 0) {
            // 没有任何下级，无需计算返佣
            return;
        }

        // 显式排除总代自身（accountId）：总代的充值/投注不计入任何代理的团队统计
        const descendants = descendantIds
            .filter((id) => id !== accountId)
            .map((id) => memberDataMap[id])
            .filter(Boolean);

        // ---- 确定该代理的 earnLevel ----
        let earnLevel;
        let earnLevelReason;

        if (agent.rebateMode === 1) {
            // 锁定返佣：直接使用设定的 rebateLevel，不看团队数据
            earnLevel = agent.rebateLevel;
            earnLevelReason = `锁定返佣 rebateLevel=${agent.rebateLevel}`;
        } else {
            // 先根据团队数据计算正常返佣等级 - 仅统计最大返佣层级内的下级
            const validDescendantsForLevel = descendants.filter(d => (d.hierarchy - agent.hierarchy) <= MAX_REBATE_HIERARCHY);
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

        descendants.forEach(desc => {
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

        descendants.forEach((desc) => {
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
            descendantCount: descendants.length
        });
    }

    // ---- 最终汇总 ----
    printFinalSummary(agentRebateSummary, masterHierarchy, accountId, dateStr, noRebateUsers);
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
 * @returns {Object}        - enriched member 含 totalRechargeAmount, betAmountSum, 各类型投注数组
 */
function fetchMemberData(data, member, startTs, endTs, startDateStr, endDateStr) {
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
        isFirstCharge: false
    };

    // 1. 查询昨日充值
    const rechargeList = GetRechargeOrderPageList(data, member.userId, 'Payed', startTs, endTs);
    if (isNonEmptyArray(rechargeList)) {
        rechargeList.forEach((item) => {
            const amt = Number(item.actualAmount || 0);
            if (!isNaN(amt)) {
                enriched.totalRechargeAmount = (enriched.totalRechargeAmount * 100 + amt * 100) / 100;
            }
        });
    }

    // 2. 查询昨日投注（5 个类别）
    GetBetRecordPageList(data, enriched, startTs, endTs, 'BetTime', 'BetTime');

    // 3. 查询是否首充
    // 注意：/api/RptUserInfo/GetUserRptRechargePageList 接口要求的 startTime/endTime 是字符串格式的日期（如"2026-03-16 00:00:00"）而非时间戳
    const firstChargeList = GetUserRptRechargePageList(data, member.userId, 1, startDateStr, endDateStr);
    if (isNonEmptyArray(firstChargeList)) {
        const allR1 = firstChargeList.every((item) => item.rechargeType === 'R1');
        if (allR1) {
            enriched.isFirstCharge = true;
        }
    }

    return enriched;
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
        if (result && result.list && result.list.length > 0) {
            result.list.forEach((item) => {
                // 根据配置选择投注金额字段
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
