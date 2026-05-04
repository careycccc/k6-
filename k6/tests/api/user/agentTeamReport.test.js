/**
 * 代理管理 - 代理绩效对比
 *
 * 统计多个总代在指定时间段内的团队核心指标：
 *   新增会员数、首充会员数、首充转化率、首充金额、人均首充、
 *   总充值、总提现、总打码量、代理佣金、佣金贡献比、活跃会员、活跃率
 *
 * 运行示例：
 *   k6 run -e TENANT_ID=3007 -e ROOT_UIDS=110599,110577，110716，110650，110874 -e DATE_RANGE=2026-04-25~2026-04-30  -e AGENT_TYPE=L6 -e REBATE_LEVEL=L0 agentTeamReport.test.js
 *
 * 
 * 
 * 
 * 参数说明：
 *   TENANT_ID    租户ID，默认 3004
 *   ROOT_UIDS    逗号分隔的总代 userId 列表
 *   DATE_RANGE   时间段，格式 YYYY-MM-DD~YYYY-MM-DD（含首尾两天）
 *   AGENT_TYPE   代理类型：L3 或 L6，默认 L6
 *   REBATE_LEVEL 佣金统计层级：L0（总代自身）~ L6，默认 L0
 */

import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import {
    GetRechargeOrderPageList,
    GetUserRptRechargePageList,
    GetBetRecordPageList
} from '../sixearn/sixearn.test.js';

// ============================================================
// 环境变量解析
// ============================================================
const TENANT_ID   = __ENV.TENANT_ID    || '3004';
const ROOT_UIDS   = (__ENV.ROOT_UIDS   || '').split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
const DATE_RANGE  = __ENV.DATE_RANGE   || '';
const AGENT_TYPE  = (__ENV.AGENT_TYPE  || 'L6').toUpperCase();   // L3 | L6
const REBATE_LEVEL = parseInt((__ENV.REBATE_LEVEL || 'L0').replace(/[Ll]/, ''), 10); // 0~6

const TAG = 'AgentTeamReport';

export const options = {
    scenarios: {
        agent_team_report: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '4h'
        }
    }
};

// ============================================================
// 日期工具
// ============================================================

/**
 * 解析 DATE_RANGE 字符串，返回 [startDate, endDate]（含首尾，格式 YYYY-MM-DD）
 */
function parseDateRange(rangeStr) {
    const parts = rangeStr.split('~');
    if (parts.length !== 2) throw new Error(`DATE_RANGE 格式错误，应为 YYYY-MM-DD~YYYY-MM-DD，实际: ${rangeStr}`);
    return [parts[0].trim(), parts[1].trim()];
}

/**
 * 枚举 [startDate, endDate] 之间所有日期（含首尾），返回 YYYY-MM-DD 数组
 */
function enumerateDates(startDate, endDate) {
    const dates = [];
    const cur = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate   + 'T00:00:00Z');
    while (cur <= end) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

/**
 * 将 YYYY-MM-DD 转为当天 00:00:00 的毫秒时间戳（UTC）
 */
function dateToStartTs(dateStr) {
    return new Date(dateStr + 'T00:00:00Z').getTime();
}

/**
 * 将 YYYY-MM-DD 转为当天 23:59:59.999 的毫秒时间戳（UTC）
 */
function dateToEndTs(dateStr) {
    return new Date(dateStr + 'T23:59:59.999Z').getTime();
}

// ============================================================
// API 封装（新增，不修改任何现有文件）
// ============================================================

/**
 * 分页查询提现订单，返回该用户在时间段内的总提现金额
 * @param {string} adminToken
 * @param {number} userId
 * @param {number} startTime  毫秒时间戳
 * @param {number} endTime    毫秒时间戳
 * @returns {number} 总提现金额（actualAmount 累加）
 */
function fetchTotalWithdraw(adminToken, userId, startTime, endTime) {
    const api = '/api/WithdrawOrder/GetWithdrawOrderPageList';
    let total = 0;
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage) {
        const payload = {
            userId,
            withdrawState: 'Pass',
            startTime,
            endTime,
            pageNo,
            pageSize: 200,
            dateType: 1,
            orderBy: 'Desc',
            sortField: ''
        };
        const result = sendRequest(payload, api, TAG, false, adminToken);
        if (!result) break;

        const list = result.list || [];
        if (result.totalPage && result.totalPage > totalPage) totalPage = result.totalPage;

        list.forEach(order => {
            total += parseFloat(order.actualAmount || 0);
        });

        pageNo++;
        if (pageNo <= totalPage) sleep(0.2);
    }
    return total;
}

/**
 * 查询 6级代理某一天的返佣列表（不传 userId，全量）
 * @param {string} adminToken
 * @param {string} reportDate  YYYY-MM-DD
 * @returns {Array} 返佣记录列表
 */
function fetchL6RebateListByDate(adminToken, reportDate) {
    const api = '/api/Agent/GetPageListAgentRebate';
    const allList = [];
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage) {
        const payload = {
            reportDate: `${reportDate} 00:00:00`,
            pageNo,
            pageSize: 200,
            orderBy: 'Desc',
            isAll: false
        };
        const result = sendRequest(payload, api, TAG, false, adminToken);
        if (!result) break;

        const list = result.list || [];
        if (result.totalPage && result.totalPage > totalPage) totalPage = result.totalPage;
        list.forEach(r => allList.push(r));

        pageNo++;
        if (pageNo <= totalPage) sleep(0.2);
    }
    return allList;
}

/**
 * 查询 3级代理某一天的返佣列表（不传 userId，全量）
 * @param {string} adminToken
 * @param {string} reportDate  YYYY-MM-DD
 * @returns {Array} 返佣记录列表
 */
function fetchL3RebateListByDate(adminToken, reportDate) {
    const api = '/api/AgentL3/GetPageListRebateList';
    const allList = [];
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage) {
        const payload = {
            reportDate,
            pageNo,
            pageSize: 200,
            orderBy: 'Desc'
        };
        const result = sendRequest(payload, api, TAG, false, adminToken);
        if (!result) break;

        const list = result.list || [];
        if (result.totalPage && result.totalPage > totalPage) totalPage = result.totalPage;
        list.forEach(r => allList.push(r));

        pageNo++;
        if (pageNo <= totalPage) sleep(0.2);
    }
    return allList;
}

/**
 * 计算指定总代在时间段内的代理佣金总额
 *
 * 逻辑：
 *   1. 从团队成员列表中找出目标层级（REBATE_LEVEL）的 userId 集合
 *      - REBATE_LEVEL=0：只含总代自身
 *      - REBATE_LEVEL=N：含所有绝对层级 = rootHierarchy + N 的成员
 *   2. 遍历每一天，查全量返佣列表，过滤出目标 userId 集合的记录
 *   3. 累加 totalCommissioned
 *
 * @param {string}   adminToken
 * @param {number}   rootUid
 * @param {Array}    memberList   GetPageListAgentList 返回的完整成员列表
 * @param {string[]} dates        YYYY-MM-DD 数组
 * @returns {number}
 */
function calcAgentCommission(adminToken, rootUid, memberList, dates) {
    // 确定目标 userId 集合
    const rootRecord = memberList.find(m => m.userId === rootUid);
    const rootHierarchy = rootRecord ? rootRecord.hierarchy : 0;

    let targetUidSet;
    if (REBATE_LEVEL === 0) {
        targetUidSet = new Set([rootUid]);
    } else {
        const targetAbsHierarchy = rootHierarchy + REBATE_LEVEL;
        targetUidSet = new Set(
            memberList
                .filter(m => m.hierarchy === targetAbsHierarchy)
                .map(m => m.userId)
        );
    }

    if (targetUidSet.size === 0) return 0;

    let totalCommission = 0;

    dates.forEach(date => {
        const list = AGENT_TYPE === 'L3'
            ? fetchL3RebateListByDate(adminToken, date)
            : fetchL6RebateListByDate(adminToken, date);

        list.forEach(record => {
            if (targetUidSet.has(record.userId)) {
                totalCommission += parseFloat(record.totalCommissioned || 0);
            }
        });

        sleep(0.3);
    });

    return totalCommission;
}

// ============================================================
// 单个总代的完整统计
// ============================================================

/**
 * 统计单个总代在时间段内的所有指标
 * @param {string}   adminToken
 * @param {number}   rootUid
 * @param {string}   startDate   YYYY-MM-DD
 * @param {string}   endDate     YYYY-MM-DD
 * @param {string[]} dates       枚举好的日期数组
 * @returns {object} 统计结果
 */
function calcRootAgentStats(adminToken, rootUid, startDate, endDate, dates) {
    const startTs = dateToStartTs(startDate);
    const endTs   = dateToEndTs(endDate);
    const startDateStr = `${startDate} 00:00:00`;
    const endDateStr   = `${endDate} 23:59:59`;

    // ── Step 1: 获取团队成员列表 ──────────────────────────────
    console.log(`\n  [${rootUid}] 查询团队成员列表...`);
    const memberList = getAgentHierarchyList(adminToken, rootUid, { isAll: true, isIncludeSelfAndParent: true, pageSize: 500 });
    const totalMembers = memberList.filter(m => m.userId !== rootUid).length; // 不含总代自身

    // 统计期内新增会员（registerTime 在范围内，排除总代自身）
    const newMembers = memberList.filter(m =>
        m.userId !== rootUid &&
        m.registerTime >= startTs &&
        m.registerTime <= endTs
    );
    const newMemberCount = newMembers.length;

    console.log(`  [${rootUid}] 团队总人数: ${totalMembers}，统计期新增: ${newMemberCount}`);

    // ── Step 2: 逐成员查充值、提现、投注、首充 ───────────────
    const nonRootMembers = memberList.filter(m => m.userId !== rootUid);

    let totalRecharge      = 0;
    let totalWithdraw      = 0;
    let totalBet           = 0;
    let firstRechargeCount = 0;
    let firstRechargeAmt   = 0;
    let activeMembers      = 0; // 有投注行为

    // 新增会员中首充的 userId 集合（用于首充金额统计）
    const newMemberIdSet = new Set(newMembers.map(m => m.userId));

    const dataObj = { token: adminToken }; // 兼容 sixearn.test.js 的接口签名

    console.log(`  [${rootUid}] 开始查询 ${nonRootMembers.length} 个成员数据...`);

    nonRootMembers.forEach((member, idx) => {
        if (idx > 0 && idx % 20 === 0) {
            console.log(`  [${rootUid}] 进度: ${idx}/${nonRootMembers.length}`);
        }
        sleep(0.2);

        // 充值
        const rechargeList = GetRechargeOrderPageList(dataObj, member.userId, 'Payed', startTs, endTs);
        let memberRecharge = 0;
        if (rechargeList) {
            rechargeList.forEach(r => { memberRecharge += parseFloat(r.actualAmount || 0); });
        }
        totalRecharge += memberRecharge;

        // 提现
        const memberWithdraw = fetchTotalWithdraw(adminToken, member.userId, startTs, endTs);
        totalWithdraw += memberWithdraw;

        // 投注（复用 GetBetRecordPageList，构造 enriched 对象）
        const enriched = {
            userId: member.userId,
            electronicGame: [], liveCasino: [], sports: [], lottery: [], chessCard: [],
            betAmountSum: 0
        };
        GetBetRecordPageList(dataObj, enriched, startTs, endTs, 'BetTime', 'BetTime');
        totalBet += enriched.betAmountSum;
        if (enriched.betAmountSum > 0) activeMembers++;

        // 首充（仅统计新增会员）
        if (newMemberIdSet.has(member.userId)) {
            const firstChargeList = GetUserRptRechargePageList(dataObj, member.userId, 1, startDateStr, endDateStr);
            if (firstChargeList) {
                const r1 = firstChargeList.find(r => r.rechargeType === 'R1');
                if (r1) {
                    firstRechargeCount++;
                    firstRechargeAmt += parseFloat(r1.actualAmount || r1.rechargeAmount || 0);
                }
            }
        }
    });

    // ── Step 3: 佣金 ─────────────────────────────────────────
    console.log(`  [${rootUid}] 查询代理佣金（${AGENT_TYPE} L${REBATE_LEVEL}）...`);
    const agentCommission = calcAgentCommission(adminToken, rootUid, memberList, dates);

    // ── Step 4: 计算派生指标 ──────────────────────────────────
    const firstRechargeRate    = newMemberCount > 0
        ? ((firstRechargeCount / newMemberCount) * 100).toFixed(2) + '%'
        : '0.00%';
    const avgFirstRecharge     = firstRechargeCount > 0
        ? (firstRechargeAmt / firstRechargeCount).toFixed(2)
        : '0.00';
    const commissionContribRate = totalRecharge > 0
        ? ((agentCommission / totalRecharge) * 100).toFixed(4) + '%'
        : '0.0000%';
    const activeRate           = totalMembers > 0
        ? ((activeMembers / totalMembers) * 100).toFixed(2) + '%'
        : '0.00%';

    return {
        rootUid,
        totalMembers,
        newMemberCount,
        firstRechargeCount,
        firstRechargeRate,
        firstRechargeAmt:       firstRechargeAmt.toFixed(2),
        avgFirstRecharge,
        totalRecharge:          totalRecharge.toFixed(2),
        totalWithdraw:          totalWithdraw.toFixed(2),
        totalBet:               totalBet.toFixed(2),
        agentCommission:        agentCommission.toFixed(4),
        commissionContribRate,
        activeMembers,
        activeRate
    };
}

// ============================================================
// 打印报表
// ============================================================

function printReport(statsArr, startDate, endDate) {
    // 按总充值降序排列
    statsArr.sort((a, b) => parseFloat(b.totalRecharge) - parseFloat(a.totalRecharge));

    // 列定义：label 是表头显示文字，key 是数据字段
    const cols = [
        { label: '名',      key: '_rank',                  },
        { label: 'UID',     key: 'rootUid',                },
        { label: '总人数',  key: 'totalMembers',           },
        { label: '新增',    key: 'newMemberCount',         },
        { label: '首充数',  key: 'firstRechargeCount',     },
        { label: '首充率',  key: 'firstRechargeRate',      },
        { label: '首充额',  key: 'firstRechargeAmt',       },
        { label: '人均首充',key: 'avgFirstRecharge',       },
        { label: '总充值',  key: 'totalRecharge',          },
        { label: '总提现',  key: 'totalWithdraw',          },
        { label: '打码量',  key: 'totalBet',               },
        { label: `佣金(${AGENT_TYPE}L${REBATE_LEVEL})`, key: 'agentCommission' },
        { label: '佣金占比',key: 'commissionContribRate',  },
        { label: '活跃数',  key: 'activeMembers',          },
        { label: '活跃率',  key: 'activeRate',             }
    ];

    // 给每列赋初始宽度 = max(表头长度, 各行数据长度) + 1
    statsArr.forEach((row, i) => { row._rank = String(i + 1); });

    cols.forEach(col => {
        // 表头宽度（中文字符按2计，英文按1计）
        const labelW = [...col.label].reduce((s, c) => s + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
        // 数据最大宽度
        let dataW = 0;
        statsArr.forEach(row => {
            const v = String(row[col.key] || '');
            const w = [...v].reduce((s, c) => s + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
            if (w > dataW) dataW = w;
        });
        // 列宽 = max(表头, 数据) + 1 的余量，数据宽度额外 +25%
        col.width = Math.max(labelW, Math.ceil(dataW * 1.25)) + 1;
    });

    // 辅助：按显示宽度 padEnd（中文占2位）
    function padW(str, targetW) {
        const s = String(str);
        const w = [...s].reduce((acc, c) => acc + (c.charCodeAt(0) > 127 ? 2 : 1), 0);
        return w >= targetW ? s : s + ' '.repeat(targetW - w);
    }

    const sep = '+' + cols.map(c => '-'.repeat(c.width + 2)).join('+') + '+';

    console.log(`\n${'═'.repeat(sep.length)}`);
    console.log(`  📊 代理团队报表 | 租户:${TENANT_ID} | ${startDate}~${endDate} | ${AGENT_TYPE} L${REBATE_LEVEL}`);
    console.log(`${'═'.repeat(sep.length)}`);
    console.log(sep);

    // 表头
    console.log('|' + cols.map(c => ' ' + padW(c.label, c.width) + ' ').join('|') + '|');
    console.log(sep);

    // 数据行
    statsArr.forEach(row => {
        console.log('|' + cols.map(c => ' ' + padW(row[c.key] || '', c.width) + ' ').join('|') + '|');
    });

    console.log(sep);

    // 汇总行
    const sumRecharge   = statsArr.reduce((s, r) => s + parseFloat(r.totalRecharge),  0).toFixed(2);
    const sumWithdraw   = statsArr.reduce((s, r) => s + parseFloat(r.totalWithdraw),  0).toFixed(2);
    const sumBet        = statsArr.reduce((s, r) => s + parseFloat(r.totalBet),        0).toFixed(2);
    const sumCommission = statsArr.reduce((s, r) => s + parseFloat(r.agentCommission), 0).toFixed(4);
    const sumNew        = statsArr.reduce((s, r) => s + r.newMemberCount,              0);
    const sumFirst      = statsArr.reduce((s, r) => s + r.firstRechargeCount,          0);
    const sumActive     = statsArr.reduce((s, r) => s + r.activeMembers,               0);

    console.log(`  汇总: ${statsArr.length}个总代 | 新增:${sumNew} | 首充:${sumFirst} | 充值:${sumRecharge} | 提现:${sumWithdraw} | 打码:${sumBet} | 佣金:${sumCommission} | 活跃:${sumActive}`);
    console.log(`${'═'.repeat(sep.length)}\n`);
}

// ============================================================
// Setup
// ============================================================

export function setup() {
    if (ROOT_UIDS.length === 0) throw new Error('请通过 -e ROOT_UIDS=uid1,uid2,... 传入总代 userId');
    if (!DATE_RANGE)            throw new Error('请通过 -e DATE_RANGE=YYYY-MM-DD~YYYY-MM-DD 传入时间段');

    console.log(`\n[Setup] 租户: ${TENANT_ID} | 总代: ${ROOT_UIDS.join(',')} | 时间段: ${DATE_RANGE} | 代理类型: ${AGENT_TYPE} | 佣金层级: L${REBATE_LEVEL}`);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error('[Setup] 管理员登录失败');
    console.log(`[Setup] ✅ 登录成功`);
    return { adminToken };
}

// ============================================================
// 主流程
// ============================================================

export default function (data) {
    const { adminToken } = data;
    const [startDate, endDate] = parseDateRange(DATE_RANGE);
    const dates = enumerateDates(startDate, endDate);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 代理团队报表开始  共 ${ROOT_UIDS.length} 个总代  ${dates.length} 天`);
    console.log(`${'='.repeat(70)}\n`);

    const statsArr = [];

    ROOT_UIDS.forEach((rootUid, idx) => {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[${idx + 1}/${ROOT_UIDS.length}] 统计总代 UID=${rootUid}`);
        console.log(`${'─'.repeat(60)}`);

        const stats = calcRootAgentStats(adminToken, rootUid, startDate, endDate, dates);
        statsArr.push(stats);

        console.log(`  ✅ UID=${rootUid} 统计完成: 总充值=${stats.totalRecharge}`);
        sleep(1);
    });

    printReport(statsArr, startDate, endDate);
}
