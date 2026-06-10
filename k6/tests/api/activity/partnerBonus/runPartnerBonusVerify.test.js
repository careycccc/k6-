/**
 * 合伙人奖励 - 验证脚本（多租户多线程版）
 *
 * 验证流程：
 *   Step 1  读取后台活动配置（AAAA 占位，接口就绪后替换）
 *   Step 2  查询根节点的所有直属下级（仅第一层直属）
 *   Step 3  多线程并发查询每个下级在 N 天窗口内的
 *           充值订单 / 投注记录 / 提现记录
 *   Step 4  按配置规则本地计算每个邀请人应得的合伙人奖励
 *   Step 5  生成详细报表
 *
 * 使用方法：
 *   k6 run -e TENANT_ID=3007 -e ROOT_UID=111364 -e VUS=5 runPartnerBonusVerify.test.js
 *
 * 环境变量：
 *   TENANT_ID   租户ID（默认 3004）
 *   ROOT_UID    邀请人（总代）的用户ID（必填）
 *   VUS         验证并发线程数（默认 5）
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { sendQueryRequest, sendRequest } from '../../common/request.js';
import { isNonEmptyArray } from '../../../utils/utils.js';
import {
    GetRechargeOrderPageList,
} from '../../sixearn/sixearn.test.js';

const TAG = 'PartnerBonusVerify';

// ================================================================
// 并发参数
// ================================================================

const computedVus = parseInt(__ENV.VUS || '5', 10);

export const options = {
    scenarios: {
        partner_bonus_verify: {
            executor: 'per-vu-iterations',
            vus: computedVus,
            iterations: 1,
            maxDuration: '2h',
        },
    },
};

// ================================================================
// ★ AAAA 占位：活动配置接口
//   当后端接口就绪后，将此函数替换为真实接口调用即可。
//   调用: const config = fetchActivityConfig(adminToken);
// ================================================================

/**
 * 获取合伙人奖励活动配置
 *
 * 接口：POST /api/PartnerReward/GetConfig
 *
 * 后端响应字段说明：
 *   id                        - 活动 ID
 *   registerCompleteDays      - 注册后 N 天内有效（对应需求「N 天时间窗口」）
 *   requireBindWithdraw       - 1=下级需绑定提现信息，0=不需要
 *   firstEnabled              - 1=首充档已开启
 *   firstRechargeBonusConfig  - 首充多层门槛数组
 *   secondEnabled             - 1=二充档已开启
 *   secondRechargeBonusConfig - 二充多层门槛数组
 *   thirdEnabled              - 1=三充档已开启
 *   thirdRechargeBonusConfig  - 三充多层门槛数组
 *   每项门槛: { rechargeAmount, validBetAmount, bonusAmount }
 *
 * 内部统一格式（activityConfig）：
 *   activityId          - 活动 ID
 *   nDays               - 时间窗口天数
 *   requireWithdrawInfo - 是否需要绑定提现信息（boolean）
 *   tiers[]             - 充值档列表
 *     rechargeSlot      - 1=首充, 2=二充, 3=三充
 *     enabled           - 该档是否开启
 *     levels[]          - 多层门槛（按 rechargeMin 升序）
 *       rechargeMin     - 充值金额门槛
 *       turnoverMin     - 有效流水门槛
 *       bonusAmount     - 达标奖励金额
 *
 * @param {string} adminToken
 * @returns {object} activityConfig
 */
function fetchActivityConfig(adminToken) {
    const api = '/api/PartnerReward/GetConfig';
    console.log(`[${TAG}] 【Step 1】请求活动配置接口: ${api}`);

    const raw = sendRequest({}, api, TAG, false, adminToken);

    // sendRequest 返回 parsedBody.data（即响应 data 字段）
    // 兼容两种路径：直接 data 对象，或完整响应对象
    let cfg = null;
    if (raw && raw.id !== undefined) {
        cfg = raw;                          // 已经是 data 字段内容
    } else if (raw && raw.data && raw.data.id !== undefined) {
        cfg = raw.data;                     // 完整响应包裹
    }

    if (!cfg) {
        console.error(`[${TAG}] ❌ 活动配置接口返回异常，原始响应: ${JSON.stringify(raw)}`);
        throw new Error('获取合伙人奖励配置失败，请检查接口或网络');
    }

    console.log(`[${TAG}] ✅ 活动配置读取成功:`);
    console.log(`[${TAG}]   活动ID              : ${cfg.id}`);
    console.log(`[${TAG}]   时间窗口            : 注册后 ${cfg.registerCompleteDays} 天`);
    console.log(`[${TAG}]   需绑定提现信息      : ${cfg.requireBindWithdraw === 1 ? '是' : '否'}`);
    console.log(`[${TAG}]   首充档              : ${cfg.firstEnabled === 1 ? '开启' : '关闭'} (${(cfg.firstRechargeBonusConfig || []).length} 层)`);
    console.log(`[${TAG}]   二充档              : ${cfg.secondEnabled === 1 ? '开启' : '关闭'} (${(cfg.secondRechargeBonusConfig || []).length} 层)`);
    console.log(`[${TAG}]   三充档              : ${cfg.thirdEnabled === 1 ? '开启' : '关闭'} (${(cfg.thirdRechargeBonusConfig || []).length} 层)`);

    /**
     * 将后端门槛数组转换为内部标准格式
     * @param {Array} bonusArr - [{rechargeAmount, validBetAmount, bonusAmount}, ...]
     * @returns {Array} [{rechargeMin, turnoverMin, bonusAmount}, ...]
     */
    function mapLevels(bonusArr) {
        if (!bonusArr || bonusArr.length === 0) return [];
        return bonusArr
            .map(item => ({
                rechargeMin: Number(item.rechargeAmount || 0),
                turnoverMin: Number(item.validBetAmount || 0),
                bonusAmount: Number(item.bonusAmount || 0),
            }))
            .sort((a, b) => a.rechargeMin - b.rechargeMin); // 按充值金额升序，确保逻辑正确
    }

    // 构建内部统一格式
    const activityConfig = {
        activityId: cfg.id,
        nDays: cfg.registerCompleteDays || 7,
        requireWithdrawInfo: cfg.requireBindWithdraw === 1,
        state: cfg.state,   // 1=活动启用
        tiers: [
            {
                rechargeSlot: 1,
                enabled: cfg.firstEnabled === 1,
                levels: mapLevels(cfg.firstRechargeBonusConfig),
            },
            {
                rechargeSlot: 2,
                enabled: cfg.secondEnabled === 1,
                levels: mapLevels(cfg.secondRechargeBonusConfig),
            },
            {
                rechargeSlot: 3,
                enabled: cfg.thirdEnabled === 1,
                levels: mapLevels(cfg.thirdRechargeBonusConfig),
            },
        ],
    };

    // 活动状态检查
    if (activityConfig.state !== 1) {
        console.warn(`[${TAG}] ⚠️  活动当前状态不为启用（state=${cfg.state}），验证结果仅供参考`);
    }

    return activityConfig;
}

// ================================================================
// 后台系统报表查询
// ================================================================

/**
 * 查询后台合伙人奖励报表（按注册时间）
 * 接口：POST /api/PartnerReward/GetDataPageList
 *
 * 字段说明：
 *   parentId       - 上级 userId
 *   userId         - 直属下级 userId
 *   firstAmount    - 首充金额
 *   secondAmount   - 二充金额
 *   thirdAmount    - 三充金额
 *   validBet       - 有效投注（全局累计，不分档）
 *   totalBonus     - 系统已发放奖励总额
 *   registerTime   - 注册时间戳（毫秒）
 *   lastRechargeTime - 最后充值时间戳（毫秒）
 *
 * @param {string} adminToken
 * @param {string} startDate  - 格式 "YYYY-MM-DD"
 * @param {string} endDate    - 格式 "YYYY-MM-DD"
 * @returns {Map<number, object>}  userId → 系统报表行
 */
function fetchSystemReport(adminToken, startDate, endDate) {
    const api = '/api/PartnerReward/GetDataPageList';
    console.log(`[${TAG}] 【Step 3-System】查询系统报表 ${startDate} ~ ${endDate} ...`);

    const resultMap = new Map(); // userId → row
    let pageNo = 1;
    let totalPage = 1;

    while (pageNo <= totalPage && pageNo <= 20) {
        const payload = {
            timeType: 1,          // 1=按注册时间
            startDate: startDate,
            endDate: endDate,
            pageNo: pageNo,
            pageSize: 200,
        };

        let raw = sendRequest(payload, api, TAG, false, adminToken);
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { break; }
        }
        if (!raw) break;

        // sendRequest 返回 parsedBody.data，结构为 { list, totalPage, totalCount, ... }
        let listData = null;
        if (raw.list && Array.isArray(raw.list)) {
            listData = raw;
        } else if (raw.data && raw.data.list) {
            listData = raw.data;
        }

        if (!listData || !isNonEmptyArray(listData.list)) break;

        if (listData.totalPage && listData.totalPage > totalPage) {
            totalPage = listData.totalPage;
        }

        for (const row of listData.list) {
            resultMap.set(Number(row.userId), {
                parentId: Number(row.parentId || 0),
                userId: Number(row.userId || 0),
                firstAmount: Number(row.firstAmount || 0),
                secondAmount: Number(row.secondAmount || 0),
                thirdAmount: Number(row.thirdAmount || 0),
                validBet: Number(row.validBet || 0),
                totalBonus: Number(row.totalBonus || 0),
                registerTime: Number(row.registerTime || 0),
                lastRechargeTime: Number(row.lastRechargeTime || 0),
            });
        }

        console.log(`[${TAG}]   第 ${pageNo}/${totalPage} 页，已加载 ${resultMap.size} 条`);
        pageNo++;
    }

    console.log(`[${TAG}] ✅ 系统报表共 ${resultMap.size} 条记录\n`);
    return resultMap;
}

/**
 * 将毫秒时间戳转换为 "YYYY-MM-DD" 字符串（UTC+0，k6 运行环境使用 Date）
 * @param {number} ts
 * @returns {string}
 */
function tsToDateStr(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ================================================================
// 团队查询 API
// ================================================================

/**
 * 查询指定 userId 下的所有成员（含自身），支持分页，全量拉取
 * @param {string} adminToken
 * @param {number} userId
 * @returns {Array} memberList
 */
function fetchTeamMembers(adminToken, userId) {
    const api      = '/api/Agent/GetPageListAgentList';
    const pageSize = 500;
    let pageNo     = 1;
    let totalPage  = 1;
    const all      = [];

    while (pageNo <= totalPage && pageNo <= 50) { // 最多查50页（25000人）保险上限
        const payload = {
            userId:                 userId,
            isAll:                  true,
            isIncludeSelfAndParent: true,
            pageNo:                 pageNo,
            pageSize:               pageSize,
        };

        let result = sendRequest(payload, api, TAG, false, adminToken);
        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (e) { break; }
        }
        if (!result) break;

        let list     = null;
        let tp       = 1;
        if (result.list && Array.isArray(result.list)) {
            list = result.list;
            tp   = result.totalPage || result.totalPages || 1;
        } else if (result.data && Array.isArray(result.data.list)) {
            list = result.data.list;
            tp   = result.data.totalPage || result.data.totalPages || 1;
        }

        if (!list || list.length === 0) break;
        if (tp > totalPage) totalPage = tp;

        for (const m of list) all.push(m);
        console.log(`[${TAG}]   GetPageListAgentList 第 ${pageNo}/${totalPage} 页，本页 ${list.length} 条，累计 ${all.length} 条`);

        pageNo++;
    }

    return all;
}

/**
 * 查询有效投注（validAmount）总额
 *
 * 不复用 GetBetRecordPageList（该函数固定使用 betAmount），
 * 自行查询以匹配系统报表 validBet 字段（有效投注，经过打折过滤后的值）。
 * 接口: /api/ThirdGame/GetBetRecordPageList，取 result.sum.validAmountSum
 *
 * @param {object} data    - { token }
 * @param {number} userId
 * @param {number} startTs - 毫秒时间戳
 * @param {number} endTs   - 毫秒时间戳
 * @returns {number} 有效投注总额（validAmountSum）
 */
function fetchTotalBetAmount(data, userId, startTs, endTs) {
    const api       = '/api/ThirdGame/GetBetRecordPageList';
    // categoryType 0电子 1真人 2体育 3彩票 4棋牌
    let totalValid  = 0;

    for (let j = 0; j < 5; j++) {
        const payload = {
            categoryType:   j,
            queryTimeType:  'BetTime',
            userId:         userId,
            beginTimeUnix:  startTs,
            endTimeUnix:    endTs,
            pageSize:       200,
            sortField:      'BetTime',
        };
        let result = sendQueryRequest(payload, api, TAG, false, data.token);
        if (typeof result === 'string') {
            try { result = JSON.parse(result); } catch (e) { continue; }
        }
        if (!result) continue;

        // 优先取 sum.validAmountSum（汇总字段，与系统报表 validBet 一致）
        if (result.sum && result.sum.validAmountSum != null) {
            totalValid += parseFloat(result.sum.validAmountSum) || 0;
        } else if (result.list && result.list.length > 0) {
            // 兜底：逐条累加 validAmount
            for (const item of result.list) {
                totalValid += parseFloat(item.validAmount || 0);
            }
        }
    }

    return totalValid;
}

/**
 * 判断该用户是否已绑定提现信息
 *
 * 接口: POST /api/Users/GetWallet，payload: { userId }
 * 响应 data 里有五个钱包列表，任意一个非空即视为已绑定。
 *
 * @param {object} data   - { token }
 * @param {number} userId
 * @returns {boolean}
 */
function fetchHasWithdrawInfo(data, userId) {
    const api     = '/api/Users/GetWallet';
    const payload = { userId: userId };

    let result = sendRequest(payload, api, TAG, false, data.token);
    if (typeof result === 'string') {
        try { result = JSON.parse(result); } catch (e) { return false; }
    }
    if (!result) return false;

    // sendRequest 返回 parsedBody.data
    const wallet = result.data || result;
    if (!wallet) return false;

    const hasBank        = isNonEmptyArray(wallet.usersWalletbankList);
    const hasEWallet     = isNonEmptyArray(wallet.usersWalletElectronicWalletList);
    const hasPix         = isNonEmptyArray(wallet.userPixWalletList);
    const hasCrypto      = isNonEmptyArray(wallet.usersWalletVirtualCurrencyList);
    const hasUpi         = isNonEmptyArray(wallet.usersWalletUpiList);

    return hasBank || hasEWallet || hasPix || hasCrypto || hasUpi;
}

// ================================================================
// 奖励计算逻辑（方案 A：本地计算）
// ================================================================

/**
 * 将充值订单按充值次序（首充/二充/三充）归集
 *
 * 规则：
 *   - 按订单时间升序排列
 *   - 第 1 条 → 首充，第 2 条 → 二充，第 3 条 → 三充
 *   - 第 4 条及以上忽略（活动只计算前三档）
 *
 * @param {Array}  rechargeList - GetRechargeOrderPageList 返回的订单列表
 * @returns {Array<{slot:number, amount:number}>}  slot 1/2/3
 */
function groupRechargeBySlot(rechargeList) {
    if (!isNonEmptyArray(rechargeList)) return [];

    const sorted = rechargeList
        .filter(item => item.actualAmount > 0)
        .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

    const result = [];
    for (let i = 0; i < Math.min(sorted.length, 3); i++) {
        result.push({ slot: i + 1, amount: Number(sorted[i].actualAmount || 0) });
    }
    return result;
}

/**
 * 按多层门槛规则，计算单档（首/二/三充）应得奖励
 *
 * 规则（参照需求文档 2.3 节）：
 *   1. 按「充值金额」升序遍历各层，确定「充值达标的最高层」
 *      即：找到所有 slotAmount >= rechargeMin 的层中，rechargeMin 最大的那层
 *   2. 在该层上再判断「流水」是否达标（totalTurnover >= turnoverMin）
 *   3. 两个条件同时满足 → 发放该层奖励；否则返回 0
 *
 * 示例：
 *   层级配置: [{充值100, 流水200, 奖励50}, {充值500, 流水300, 奖励200}]
 *   下级充值600, 流水250 → 充值达标最高层是第2层(充值500)，但流水250<300不满足 → 奖励0
 *   下级充值600, 流水350 → 充值达标最高层是第2层，流水350>=300 → 奖励200
 *   下级充值200, 流水250 → 充值达标最高层是第1层(充值100)，流水250>=200 → 奖励50
 *
 * @param {object} tierConfig    - { rechargeSlot, levels: [{rechargeMin, turnoverMin, bonusAmount}] }
 * @param {number} slotAmount    - 该档实际充值金额
 * @param {number} totalTurnover - 窗口内累计有效流水（不分档，全局累计）
 * @returns {{ bonusAmount: number, reachedLevel: number, matchedRechargeLevel: number }}
 *   reachedLevel=0 表示未达标
 *   matchedRechargeLevel>0 但 reachedLevel=0 表示充值达标但流水不足
 */
function calcSlotBonus(tierConfig, slotAmount, totalTurnover) {
    if (!tierConfig || !isNonEmptyArray(tierConfig.levels)) {
        return { bonusAmount: 0, reachedLevel: 0, matchedRechargeLevel: 0 };
    }

    // 按充值金额升序排列（确保下标对应层号）
    const sortedByRecharge = tierConfig.levels
        .slice()
        .sort((a, b) => a.rechargeMin - b.rechargeMin);

    // Step1：找充值达标的最高层（充值金额 >= rechargeMin 的最大层）
    let rechargeMatchedIdx = -1;
    for (let i = 0; i < sortedByRecharge.length; i++) {
        if (slotAmount >= sortedByRecharge[i].rechargeMin) {
            rechargeMatchedIdx = i;
        }
    }

    if (rechargeMatchedIdx < 0) {
        // 连最低充值档都未达到
        return { bonusAmount: 0, reachedLevel: 0, matchedRechargeLevel: 0 };
    }

    const matchedTier     = sortedByRecharge[rechargeMatchedIdx];
    const matchedLevelNum = rechargeMatchedIdx + 1; // 1-based

    // Step2：该层的流水门槛
    if (totalTurnover >= matchedTier.turnoverMin) {
        return {
            bonusAmount:          matchedTier.bonusAmount,
            reachedLevel:         matchedLevelNum,
            matchedRechargeLevel: matchedLevelNum,
        };
    }

    // 充值达标但流水不足
    return {
        bonusAmount:          0,
        reachedLevel:         0,
        matchedRechargeLevel: matchedLevelNum, // 充值到了哪层（用于报表展示）
    };
}

/**
 * 判断某下级的充值档是否已过期
 *
 * @param {number} registerTime - 注册时间戳（毫秒）
 * @param {number} nDays        - 活动配置的天数窗口
 * @param {number} nowTs        - 当前时间戳（毫秒）
 * @returns {boolean}
 */
function isWindowExpired(registerTime, nDays, nowTs) {
    return (nowTs - registerTime) > nDays * 24 * 60 * 60 * 1000;
}

/**
 * 计算单个下级为邀请人带来的合伙人奖励
 *
 * @param {object} subordinate  - 下级成员信息
 * @param {object} activityCfg  - 活动配置
 * @param {object} memberData   - 该下级的充值/投注/提现数据
 * @returns {SubordinateBonus}
 */
function calcSubordinateBonus(subordinate, activityCfg, memberData) {
    const { nDays, requireWithdrawInfo, tiers } = activityCfg;
    const now = Date.now();

    const windowExpired = isWindowExpired(subordinate.registerTime, nDays, now);
    const hasWithdrawInfo = memberData.hasWithdrawInfo;

    /** @type {SubordinateBonus} */
    const bonus = {
        userId: subordinate.userId,
        account: memberData.account || String(subordinate.userId),
        registerTime: subordinate.registerTime,
        windowExpired: windowExpired,
        hasWithdrawInfo,
        totalRecharge: memberData.totalRechargeAmount,
        totalTurnover: memberData.totalBetAmount,
        slotResults: [],   // 每档结果
        totalBonus: 0,
    };

    if (!memberData.rechargeSlots || memberData.rechargeSlots.length === 0) {
        // 无充值记录 → 三档均未开始
        for (let s = 1; s <= 3; s++) {
            const tierCfg = tiers.find(t => t.rechargeSlot === s);
            bonus.slotResults.push({
                slot: s,
                slotLabel: s === 1 ? '首充' : s === 2 ? '二充' : '三充',
                status: tierCfg ? 'InProgress' : 'Unavailable',
                slotAmount: 0,
                bonusAmount: 0,
                reachedLevel: 0,
                reason: tierCfg ? '未充值' : '未配置',
            });
        }
        return bonus;
    }

    for (let slotIdx = 1; slotIdx <= 3; slotIdx++) {
        const tierCfg = tiers.find(t => t.rechargeSlot === slotIdx);
        const slotLabel = slotIdx === 1 ? '首充' : slotIdx === 2 ? '二充' : '三充';

        if (!tierCfg) {
            bonus.slotResults.push({
                slot: slotIdx, slotLabel,
                status: 'Unavailable', slotAmount: 0,
                bonusAmount: 0, reachedLevel: 0, reason: '未配置',
            });
            continue;
        }

        // 档位未开启 → Unavailable
        if (tierCfg.enabled === false) {
            bonus.slotResults.push({
                slot: slotIdx, slotLabel,
                status: 'Unavailable', slotAmount: 0,
                bonusAmount: 0, reachedLevel: 0, reason: '该充值档未开启',
            });
            continue;
        }

        const slotRecord = memberData.rechargeSlots.find(r => r.slot === slotIdx);

        if (!slotRecord) {
            // 没有该档充值记录
            if (windowExpired) {
                bonus.slotResults.push({
                    slot: slotIdx, slotLabel,
                    status: 'Expired', slotAmount: 0,
                    bonusAmount: 0, reachedLevel: 0, reason: `超过 ${nDays} 天窗口`,
                });
            } else {
                bonus.slotResults.push({
                    slot: slotIdx, slotLabel,
                    status: 'InProgress', slotAmount: 0,
                    bonusAmount: 0, reachedLevel: 0, reason: '未进行该档充值',
                });
            }
            continue;
        }

        const slotAmount = slotRecord.amount;

        // 提现信息前置检查
        if (requireWithdrawInfo && !hasWithdrawInfo) {
            bonus.slotResults.push({
                slot: slotIdx, slotLabel,
                status: 'InProgress', slotAmount,
                bonusAmount: 0, reachedLevel: 0,
                reason: '下级未绑定提现信息',
            });
            continue;
        }

        const { bonusAmount, reachedLevel, matchedRechargeLevel } = calcSlotBonus(
            tierCfg, slotAmount, memberData.totalBetAmount
        );

        if (bonusAmount > 0) {
            bonus.slotResults.push({
                slot: slotIdx, slotLabel,
                status: 'Received', slotAmount,
                bonusAmount, reachedLevel, matchedRechargeLevel,
                reason: `达标第 ${reachedLevel} 层，赠送 ${bonusAmount}`,
            });
            bonus.totalBonus += bonusAmount;
        } else {
            // matchedRechargeLevel > 0 表示充值达标但流水不足
            const turnoverShort = matchedRechargeLevel > 0;
            if (windowExpired) {
                bonus.slotResults.push({
                    slot: slotIdx, slotLabel,
                    status: 'Expired', slotAmount,
                    bonusAmount: 0, reachedLevel: 0, matchedRechargeLevel,
                    reason: turnoverShort
                        ? `超过 ${nDays} 天窗口且流水未达标（充值达第${matchedRechargeLevel}层）`
                        : `超过 ${nDays} 天窗口且充值未达最低门槛`,
                });
            } else {
                bonus.slotResults.push({
                    slot: slotIdx, slotLabel,
                    status: 'InProgress', slotAmount,
                    bonusAmount: 0, reachedLevel: 0, matchedRechargeLevel,
                    reason: turnoverShort
                        ? `充值达第${matchedRechargeLevel}层但有效流水不足`
                        : '充值未达最低门槛',
                });
            }
        }
    }

    return bonus;
}

// ================================================================
// Setup：登录 + 读取配置 + 拉取团队
// ================================================================

export function setup() {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[${TAG}] 合伙人奖励验证脚本 - Setup`);
    console.log(`${'='.repeat(70)}\n`);

    const tenantId = __ENV.TENANT_ID || '3004';
    const rootUid = parseInt(__ENV.ROOT_UID || '0', 10);

    if (!rootUid) throw new Error('必须通过环境变量 ROOT_UID 指定邀请人的用户ID，例如: -e ROOT_UID=123456');

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');

    const data = { token: adminToken, envConfig: ENV_CONFIG };

    // Step 1: 读取活动配置
    console.log(`\n【Step 1】读取合伙人奖励活动配置...`);
    const activityConfig = fetchActivityConfig(adminToken);
    console.log(`[${TAG}] 活动ID: ${activityConfig.activityId}`);
    console.log(`[${TAG}] 时间窗口: 注册后 ${activityConfig.nDays} 天`);
    console.log(`[${TAG}] 需绑定提现信息: ${activityConfig.requireWithdrawInfo}`);
    console.log(`[${TAG}] 配置充值档数: ${activityConfig.tiers.length}`);

    // Step 2: 查询团队成员（全量，含总代自身）
    console.log(`\n【Step 2】查询 UID=${rootUid} 的团队成员（全量分页）...`);
    const allMembers = fetchTeamMembers(adminToken, rootUid);
    if (!isNonEmptyArray(allMembers)) {
        throw new Error(`UID=${rootUid} 团队成员为空，请检查 ROOT_UID 是否正确`);
    }

    const masterRecord = allMembers.find(m => m.userId === rootUid);
    const masterHier   = masterRecord ? (masterRecord.hierarchy || 0) : 0;

    // 全团队所有成员（含总代自身），每个人都可能是其下级的上级，都纳入验证
    const allSubs = allMembers;

    console.log(`[${TAG}] 团队总成员: ${allMembers.length} 人（含总代自身，全部纳入验证）\n`);

    if (allSubs.length === 0) {
        throw new Error(`UID=${rootUid} 团队为空，无法验证合伙人奖励`);
    }

    // Step 3-System: 查询后台系统报表
    // 时间范围 = 全体成员最早注册日 ~ 最晚注册日（整天）
    console.log(`\n【Step 3-System】查询后台合伙人奖励报表...`);
    const nowTs = Date.now();

    let minRegisterTs = Infinity;
    let maxRegisterTs = 0;
    for (const m of allSubs) {
        const t = Number(m.registerTime || 0);
        if (t > 0 && t < minRegisterTs) minRegisterTs = t;
        if (t > maxRegisterTs) maxRegisterTs = t;
    }
    if (minRegisterTs === Infinity) minRegisterTs = nowTs;
    if (maxRegisterTs === 0)        maxRegisterTs = nowTs;

    const startDate = tsToDateStr(minRegisterTs);
    const endDate   = tsToDateStr(maxRegisterTs);

    console.log(`[${TAG}] 全团队注册时间范围: ${startDate} ~ ${endDate}（共 ${allSubs.length} 人）`);

    const systemReportMap = fetchSystemReport(adminToken, startDate, endDate);

    return {
        adminToken,
        envConfig:       ENV_CONFIG,
        tenantId,
        rootUid,
        masterHier,
        activityConfig,
        directSubs:      allSubs,   // 变量名保持不变，内容扩展为全团队
        systemReportMap: Array.from(systemReportMap.entries()),
    };
}

// ================================================================
// VU 主逻辑：并发查询直属下级数据
// ================================================================

/**
 * @typedef {Object} SubordinateBonus
 * @property {number}   userId
 * @property {string}   account
 * @property {number}   registerTime
 * @property {boolean}  windowExpired
 * @property {boolean}  hasWithdrawInfo
 * @property {number}   totalRecharge
 * @property {number}   totalTurnover
 * @property {Array}    slotResults
 * @property {number}   totalBonus
 */

// 全局结果收集（各 VU 写入不同索引，teardown 汇总）
// k6 不支持跨 VU 共享内存，故在 default 返回值通过 handleSummary 汇总
// 实际做法：每个 VU 打印自己的结果，teardown 不汇总（k6 特性限制）
// 若需汇总，请使用 k6 的 SharedArray 或在 setup 中串行处理

export default function (data) {
    const {
        adminToken, envConfig, tenantId,
        rootUid, activityConfig, directSubs,
        systemReportMap: systemReportEntries,
    } = data;

    const vuId = exec.vu.idInInstance;
    const vuCount = computedVus;

    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const queryData = { token: adminToken, envConfig };

    // 还原 Map（setup 序列化为 entries 数组，这里还原）
    const systemMap = new Map(systemReportEntries.map(([k, v]) => [Number(k), v]));

    // 本 VU 负责的直属下级切片
    const total = directSubs.length;
    const perVu = Math.floor(total / vuCount);
    const startIdx = (vuId - 1) * perVu;
    const endIdx = vuId === vuCount ? total : startIdx + perVu;
    const myChunk = directSubs.slice(startIdx, endIdx);

    if (myChunk.length === 0) {
        console.log(`[VU ${vuId}] 无分配任务，退出`);
        return;
    }

    console.log(`\n[VU ${vuId}] 负责查询直属下级 ${startIdx + 1}-${endIdx}，共 ${myChunk.length} 人`);

    const { nDays } = activityConfig;
    const nowTs = Date.now();

    /** @type {CompareResult[]} */
    const compareResults = [];

    for (let i = 0; i < myChunk.length; i++) {
        const sub = myChunk[i];
        sleep(0.3);

        console.log(`\n[VU ${vuId}] [${i + 1}/${myChunk.length}] 查询 UID=${sub.userId}...`);

        const registerTs = sub.registerTime || (nowTs - nDays * 86400000);
        const windowStart = registerTs;
        const windowEnd = Math.min(registerTs + nDays * 24 * 60 * 60 * 1000, nowTs);

        // ── 本地查询 ──────────────────────────────────────────────
        const rechargeList = GetRechargeOrderPageList(
            queryData, sub.userId, 'Payed', windowStart, windowEnd
        );
        const rechargeSlots = groupRechargeBySlot(rechargeList);
        const totalRechargeAmt = rechargeSlots.reduce((s, r) => s + r.amount, 0);
        const totalBetAmt = fetchTotalBetAmount(queryData, sub.userId, windowStart, windowEnd);
        const hasWithdrawInfo = fetchHasWithdrawInfo(queryData, sub.userId);

        const memberData = {
            account: String(sub.userId),
            totalRechargeAmount: totalRechargeAmt,
            totalBetAmount: totalBetAmt,
            rechargeSlots,
            hasWithdrawInfo,
        };

        console.log(`[VU ${vuId}] UID=${sub.userId} | 首充: ${(rechargeSlots[0] || {}).amount || 0} | 二充: ${(rechargeSlots[1] || {}).amount || 0} | 三充: ${(rechargeSlots[2] || {}).amount || 0} | 流水: ${totalBetAmt} | 已绑提现: ${hasWithdrawInfo}`);

        // ── Step 4: 本地计算奖励 ─────────────────────────────────
        const bonusResult = calcSubordinateBonus(sub, activityConfig, memberData);

        // ── Step 5: 与系统报表对比 ──────────────────────────────
        const sysRow = systemMap.get(sub.userId) || null;
        const diff = buildDiff(bonusResult, rechargeSlots, totalBetAmt, sysRow);

        compareResults.push({ bonusResult, rechargeSlots, totalBetAmt, sysRow, diff });
    }

    // Step 6: 打印对比报表
    printVerifyReport(compareResults, rootUid, activityConfig, vuId);
}

// ================================================================
// 差异对比
// ================================================================

/**
 * 对比本地计算结果与系统报表，生成差异说明
 *
 * 比对字段：
 *   首充金额   本地: rechargeSlots[0].amount      系统: sysRow.firstAmount
 *   二充金额   本地: rechargeSlots[1].amount      系统: sysRow.secondAmount
 *   三充金额   本地: rechargeSlots[2].amount      系统: sysRow.thirdAmount
 *   有效投注   本地: totalBetAmt（累计）           系统: sysRow.validBet
 *   奖励金额   本地: bonusResult.totalBonus        系统: sysRow.totalBonus
 *
 * @param {SubordinateBonus} bonusResult
 * @param {Array}  rechargeSlots  - [{slot, amount}, ...]
 * @param {number} totalBetAmt
 * @param {object|null} sysRow    - 系统报表行，null 表示系统无此记录
 * @returns {DiffResult}
 */
function buildDiff(bonusResult, rechargeSlots, totalBetAmt, sysRow) {
    /** @type {DiffResult} */
    const diff = {
        hasSysRecord: !!sysRow,
        diffs: [],      // 差异字段描述数组
        isMatch: false,   // 全部一致时为 true
    };

    if (!sysRow) {
        diff.diffs.push('系统报表无此记录');
        return diff;
    }

    // 容差：金额对比允许 ±0.01 的浮点误差
    const EPS = 0.01;

    const localFirst = Number((rechargeSlots[0] || {}).amount || 0);
    const localSecond = Number((rechargeSlots[1] || {}).amount || 0);
    const localThird = Number((rechargeSlots[2] || {}).amount || 0);
    const localBet = Number(totalBetAmt || 0);
    const localBonus = Number(bonusResult.totalBonus || 0);

    const sysFirst = Number(sysRow.firstAmount || 0);
    const sysSecond = Number(sysRow.secondAmount || 0);
    const sysThird = Number(sysRow.thirdAmount || 0);
    const sysBet = Number(sysRow.validBet || 0);
    const sysBonus = Number(sysRow.totalBonus || 0);

    if (Math.abs(localFirst - sysFirst) > EPS)
        diff.diffs.push(`首充金额 本地=${localFirst} 系统=${sysFirst}`);
    if (Math.abs(localSecond - sysSecond) > EPS)
        diff.diffs.push(`二充金额 本地=${localSecond} 系统=${sysSecond}`);
    if (Math.abs(localThird - sysThird) > EPS)
        diff.diffs.push(`三充金额 本地=${localThird} 系统=${sysThird}`);
    if (Math.abs(localBet - sysBet) > EPS)
        diff.diffs.push(`有效投注 本地=${localBet} 系统=${sysBet}`);
    if (Math.abs(localBonus - sysBonus) > EPS)
        diff.diffs.push(`奖励金额 本地=${localBonus} 系统=${sysBonus}`);

    diff.isMatch = diff.diffs.length === 0;
    return diff;
}

/**
 * @typedef {Object} CompareResult
 * @property {SubordinateBonus} bonusResult
 * @property {Array}            rechargeSlots
 * @property {number}           totalBetAmt
 * @property {object|null}      sysRow
 * @property {DiffResult}       diff
 */

/**
 * @typedef {Object} DiffResult
 * @property {boolean}  hasSysRecord
 * @property {string[]} diffs
 * @property {boolean}  isMatch
 */

// ================================================================
// 报表打印
// ================================================================

function getDisplayWidth(str) {
    let w = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? 2 : 1;
    return w;
}

function padStr(str, width) {
    const s = String(str);
    const w = getDisplayWidth(s);
    return w >= width ? s : s + ' '.repeat(width - w);
}

function printVerifyReport(compareResults, rootUid, activityConfig, vuId) {
    if (!compareResults || compareResults.length === 0) return;

    const { nDays, requireWithdrawInfo } = activityConfig;
    const SEP = '='.repeat(160);
    const LINE = '-'.repeat(160);

    console.log(`\n${SEP}`);
    console.log(`[VU ${vuId}] 📊 合伙人奖励验证报表（本地计算 vs 系统报表）| 邀请人 UID=${rootUid}`);
    console.log(`   活动规则: 注册后 ${nDays} 天窗口 | 需绑定提现信息: ${requireWithdrawInfo}`);
    console.log(`${SEP}`);

    // ── 明细对比表 ──────────────────────────────────────────────
    const headers = [
        '下级UID', '上级UID', '绑定提现',
        '首充(本地)', '二充(本地)', '三充(本地)', '有效投注(本地)',
        '首充奖励', '二充奖励', '三充奖励', '奖励合计(本地)',
        '对比结论',
    ];

    const rows = compareResults.map(({ bonusResult: b, rechargeSlots, totalBetAmt, sysRow, diff }) => {
        const s1 = b.slotResults.find(s => s.slot === 1);
        const s2 = b.slotResults.find(s => s.slot === 2);
        const s3 = b.slotResults.find(s => s.slot === 3);

        const localFirst  = (rechargeSlots[0] || {}).amount || 0;
        const localSecond = (rechargeSlots[1] || {}).amount || 0;
        const localThird  = (rechargeSlots[2] || {}).amount || 0;

        // 首充奖励列：已发放显示金额，未发放显示未达标原因（截短）
        const slotLabel = (slot) => {
            if (!slot) return '-';
            if (slot.bonusAmount > 0) return `+${slot.bonusAmount}`;
            if (slot.status === 'Unavailable') return '未开放';
            if (slot.status === 'Expired')    return '已过期';
            // InProgress：尽量给出简短原因
            return slot.reason ? slot.reason.substring(0, 12) : '-';
        };

        let diffLabel;
        if (!diff.hasSysRecord) {
            diffLabel = '⚠️ 系统无记录';
        } else if (diff.isMatch) {
            diffLabel = '✅ 完全一致';
        } else {
            diffLabel = '❌ ' + diff.diffs.join(' | ');
        }

        return [
            String(b.userId),
            sysRow ? String(sysRow.parentId) : '-',
            b.hasWithdrawInfo ? '✅是' : '❌否',
            String(localFirst),
            String(localSecond),
            String(localThird),
            String(totalBetAmt),
            slotLabel(s1),
            slotLabel(s2),
            slotLabel(s3),
            b.totalBonus > 0 ? String(b.totalBonus) : '0',
            diffLabel,
        ];
    });

    // 计算列宽
    const colW = headers.map(h => getDisplayWidth(h));
    for (const row of rows) {
        for (let c = 0; c < row.length; c++) {
            const w = getDisplayWidth(row[c]);
            if (w > colW[c]) colW[c] = w;
        }
    }
    for (let c = 0; c < colW.length; c++) colW[c] += 2;

    // 渲染表格
    let table = '';

    let hdr = '|';
    for (let c = 0; c < headers.length; c++) {
        hdr += ` ${padStr(headers[c], colW[c])} |`;
    }
    table += hdr + '\n';

    let divider = '|';
    for (let c = 0; c < colW.length; c++) divider += `${'-'.repeat(colW[c] + 2)}|`;
    table += divider + '\n';

    for (const row of rows) {
        let r = '|';
        for (let c = 0; c < row.length; c++) {
            r += ` ${padStr(row[c], colW[c])} |`;
        }
        table += r + '\n';
    }

    console.log(table);

    // ── 汇总统计 ──────────────────────────────────────────────────
    const totalSubs = compareResults.length;
    const matchCount = compareResults.filter(cr => cr.diff.isMatch).length;
    const mismatchCount = compareResults.filter(cr => cr.diff.hasSysRecord && !cr.diff.isMatch).length;
    const noSysCount = compareResults.filter(cr => !cr.diff.hasSysRecord).length;

    const localTotalFirst = compareResults.reduce((s, cr) => s + ((cr.rechargeSlots[0] || {}).amount || 0), 0);
    const localTotalSecond = compareResults.reduce((s, cr) => s + ((cr.rechargeSlots[1] || {}).amount || 0), 0);
    const localTotalThird = compareResults.reduce((s, cr) => s + ((cr.rechargeSlots[2] || {}).amount || 0), 0);
    const localTotalBet = compareResults.reduce((s, cr) => s + (cr.totalBetAmt || 0), 0);
    const localTotalBonus = compareResults.reduce((s, cr) => s + (cr.bonusResult.totalBonus || 0), 0);

    const sysTotalFirst = compareResults.reduce((s, cr) => s + (cr.sysRow ? cr.sysRow.firstAmount : 0), 0);
    const sysTotalSecond = compareResults.reduce((s, cr) => s + (cr.sysRow ? cr.sysRow.secondAmount : 0), 0);
    const sysTotalThird = compareResults.reduce((s, cr) => s + (cr.sysRow ? cr.sysRow.thirdAmount : 0), 0);
    const sysTotalBet = compareResults.reduce((s, cr) => s + (cr.sysRow ? cr.sysRow.validBet : 0), 0);
    const sysTotalBonus = compareResults.reduce((s, cr) => s + (cr.sysRow ? cr.sysRow.totalBonus : 0), 0);

    console.log(`${LINE}`);
    console.log(`📌 汇总 | VU ${vuId} | 邀请人 UID=${rootUid}`);
    console.log(`   直属下级总数     : ${totalSubs}`);
    console.log(`   ✅ 完全一致      : ${matchCount}`);
    console.log(`   ❌ 存在差异      : ${mismatchCount}`);
    console.log(`   ⚠️  系统无记录   : ${noSysCount}`);
    console.log(``);
    console.log(`   ${'字段'.padEnd(16)} ${'本地计算'.padEnd(14)} ${'系统报表'.padEnd(14)} ${'是否一致'}`);
    console.log(`   ${'─'.repeat(60)}`);
    const EPS = 0.01;
    console.log(`   ${'首充总额'.padEnd(16)} ${String(localTotalFirst).padEnd(14)} ${String(sysTotalFirst).padEnd(14)} ${Math.abs(localTotalFirst - sysTotalFirst) <= EPS ? '✅' : '❌'}`);
    console.log(`   ${'二充总额'.padEnd(16)} ${String(localTotalSecond).padEnd(14)} ${String(sysTotalSecond).padEnd(14)} ${Math.abs(localTotalSecond - sysTotalSecond) <= EPS ? '✅' : '❌'}`);
    console.log(`   ${'三充总额'.padEnd(16)} ${String(localTotalThird).padEnd(14)} ${String(sysTotalThird).padEnd(14)} ${Math.abs(localTotalThird - sysTotalThird) <= EPS ? '✅' : '❌'}`);
    console.log(`   ${'有效投注总额'.padEnd(16)} ${String(localTotalBet).padEnd(14)} ${String(sysTotalBet).padEnd(14)} ${Math.abs(localTotalBet - sysTotalBet) <= EPS ? '✅' : '❌'}`);
    console.log(`   ${'奖励总额'.padEnd(16)} ${String(localTotalBonus).padEnd(14)} ${String(sysTotalBonus).padEnd(14)} ${Math.abs(localTotalBonus - sysTotalBonus) <= EPS ? '✅' : '❌'}`);
    console.log(``);

    // ── 差异详情 ─────────────────────────────────────────────────
    const problemRows = compareResults.filter(cr => !cr.diff.isMatch);
    if (problemRows.length > 0) {
        console.log(`❌ 差异明细（${problemRows.length} 条）：`);
        for (const cr of problemRows) {
            const b = cr.bonusResult;
            if (!cr.diff.hasSysRecord) {
                console.log(`   └─ UID=${b.userId}  系统报表中无此记录，请确认该下级是否在活动范围内`);
            } else {
                console.log(`   └─ UID=${b.userId}  ${cr.diff.diffs.join(' | ')}`);
            }
        }
        console.log(``);
    }

    // ── 窗口/提现信息异常标注 ─────────────────────────────────────
    const anomalies = compareResults.filter(cr =>
        (!cr.bonusResult.hasWithdrawInfo && activityConfig.requireWithdrawInfo) ||
        cr.bonusResult.windowExpired
    );
    if (anomalies.length > 0) {
        console.log(`⚠️  注意事项（${anomalies.length} 条）：`);
        for (const cr of anomalies) {
            const b = cr.bonusResult;
            if (b.windowExpired)
                console.log(`   └─ UID=${b.userId} 时间窗口已过期`);
            if (!b.hasWithdrawInfo && activityConfig.requireWithdrawInfo)
                console.log(`   └─ UID=${b.userId} 未绑定提现信息，奖励未发放`);
        }
    }

    console.log(`${SEP}\n`);
}
