/**
 * 自动出款 —— 新增两项规则验证（只读查询，不改任何数据）
 *
 * 对应后台「充提设置 → 自动出款」页面新增的两个独立开关：
 *   规则①「上次成功提现后获得邀请转盘奖金无法自动出款」
 *         → 字段 checkInvitedWheelAfterWithdraw（1=开启）
 *   规则②「参与以下游戏的无法进行自动出款」
 *         → 字段 noAutoWithdrawLimitGames（[{vendorCode, gameCode:[]}]，非空=开启）
 * 两个字段来自 /api/AutoWithdrawConfig/Get 实测抓取确认（见探测记录），
 * 字段 allowInvitedWheelAutoWithdraw 为历史遗留字段，跟 checkInvitedWheelAfterWithdraw
 * 实测呈反向联动（勾选规则①时 check=1 且 allow=0），本脚本只以 checkInvitedWheelAfterWithdraw
 * 作为规则①的开关判定依据。
 *
 * 流程：
 *   Step 1: /api/Users/GetPageList 按 userId 查会员 → packageId（渠道ID）
 *   Step 2: /api/AutoWithdrawConfig/Get 取全部自动出款规则，选规则：
 *           - allowPackageIds 含该渠道 且 configState=1 → 用该规则
 *           - 匹配到但 configState=0（关闭）→ 打印提示，回落默认规则
 *           - 没匹配到 → 默认规则（isDefaultConfig=true）
 *           - 默认规则也关闭 → 报错退出
 *   Step 3a: 规则②（游戏限制，存在性检查，非比例）
 *           按 noAutoWithdrawLimitGames 分组查近 N 天注单
 *           (/api/ThirdGame/GetBetRecordPageList)，只要命中任意一单 → 不能自动出款
 *   Step 3b: 规则①（邀请转盘奖金限制，相对时间检查）
 *           - 查「上次成功提现时间」：/api/WithdrawOrder/GetWithdrawOrderPageList
 *             (userId + withdrawState:'Pass')，取全部记录里 lastUpdateTime（变为
 *             Pass 的时间戳，与报表口径一致，见 sourceMetrics.js:322-323）最大值
 *           - 查该时间之后是否有邀请转盘奖金到账：/api/Financial/GetPageList
 *             (searchUserIdType:1, userId, financialTypeList:['InvitedWheel'],
 *             startTime=上次提现时间, endTime=now)，用法同 inviteCondition/api.js
 *             里已验证过的 getInviteOkRewardCount 写法；totalCount>0 即命中
 *           - 会员从无成功提现记录时，规则天然不适用（判定为不限制，非 bug）
 *
 * 运行：
 *   k6p -e TENANT_ID=3004 -e USER_ID=137479 autoWithdrawNewRulesVerify.js
 *   k6p -e TENANT_ID=3101 -e ACCOUNT=919028199762 autoWithdrawNewRulesVerify.js
 *   可选：-e DAYS=15  -e PASSWORD=xxx
 */

import { sleep } from 'k6';
import { tenantRequest, tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getTzOffset } from '../retention/rechargeRetentionApi.js';
import { loginWithPassword, getFrontUserInfoWithLevel } from '../recharge/rechargeLevel.service.js';
import { fetchAllPages } from '../../../libs/common/paging.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const ACCOUNT = __ENV.ACCOUNT || '';
const PASSWORD = __ENV.PASSWORD || 'qwer1234';
let USER_ID = parseInt(__ENV.USER_ID || '0', 10);
const DAYS = parseInt(__ENV.DAYS || '15', 10);
const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const TAG = 'NewRulesVerify';

export const options = {
    scenarios: {
        new_rules_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' }
    }
};

const adminReq = (api, payload, token) => tenantRequest(api, payload, { token, isDesk: false, tenantId: TENANT_ID });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

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
// 注单查询（复用自 autoWithdrawBetRatioVerify.js 同一套分页/分组逻辑）
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

function fetchOrders(token, limitGames, range) {
    const seen = {};
    const orders = [];
    for (const q of buildQueries(limitGames)) {
        const list = fetchPaged(token, q.query, range);
        let added = 0;
        for (const o of list) {
            if (seen[o.orderNo]) continue;
            seen[o.orderNo] = true;
            orders.push(o);
            added++;
        }
        console.log(`[${TAG}]   查询分组 ${q.label}：${list.length} 单（去重后新增 ${added}）`);
    }
    return orders;
}

function gamesText(limitGames) {
    if (!limitGames || limitGames.length === 0) return '（无）';
    return limitGames.map(g => `${g.vendorCode}[${(g.gameCode || []).length ? g.gameCode.join(',') : '全部'}]`).join(' + ');
}

// ============================================================
// 规则②：参与以下游戏的无法进行自动出款（存在性检查，非比例）
// ============================================================
function checkGameLimit(token, cfg, range) {
    const limitGames = cfg.noAutoWithdrawLimitGames;
    const on = Array.isArray(limitGames) && limitGames.length > 0;

    if (!on) {
        return { name: '参与指定游戏无法自动出款', on: false, games: '（规则未开启/未配置游戏）', blocked: false, detail: '' };
    }

    console.log(`[${TAG}] 规则②已开启，限制游戏：${gamesText(limitGames)}`);
    const orders = fetchOrders(token, limitGames, range);
    orders.forEach(o => console.log(`[${TAG}]     命中注单 ${o.orderNo} ${o.vendorCode}-${o.gameCode} betTime=${o.betTime || o.createTime || ''}`));

    return {
        name: '参与指定游戏无法自动出款',
        on: true,
        games: gamesText(limitGames),
        blocked: orders.length > 0,
        detail: `近${DAYS}天内命中 ${orders.length} 笔注单`
    };
}

// ============================================================
// 规则①：上次成功提现后获得邀请转盘奖金无法自动出款
// ============================================================
/** 查会员「上次成功提现」变为 Pass 的时间戳；无成功提现记录返回 null */
function getLastSuccessWithdrawTime(token) {
    const list = fetchAllPages(p => adminReq('/api/WithdrawOrder/GetWithdrawOrderPageList', {
        userId: USER_ID, withdrawState: 'Pass',
        startTime: 0, endTime: Date.now(),
        pageNo: p, pageSize: 200, dateType: 1, orderBy: 'Desc', sortField: ''
    }, token), { pause: 0.2, maxPages: 200 });

    if (list.length === 0) return null;
    let maxTs = 0;
    list.forEach(o => { const t = Number(o.lastUpdateTime) || 0; if (t > maxTs) maxTs = t; });
    return maxTs > 0 ? maxTs : null;
}

/** 查会员在 sinceMs 之后的邀请转盘奖金(InvitedWheel)账变流水 */
function getInvitedWheelRewardsSince(token, sinceMs) {
    return fetchAllPages(p => adminReq('/api/Financial/GetPageList', {
        searchUserIdType: 1, userId: USER_ID, financialTypeList: ['InvitedWheel'],
        startTime: sinceMs, endTime: Date.now(),
        pageNo: p, pageSize: 200, orderBy: 'Desc'
    }, token), { pause: 0.2, maxPages: 200 });
}

function checkInvitedWheelAfterWithdraw(token, cfg) {
    const name = '上次提现后获得邀请转盘奖金无法自动出款';
    const on = cfg.checkInvitedWheelAfterWithdraw === 1;

    if (!on) {
        return { name, on: false, blocked: false, detail: '（规则未开启）' };
    }

    const lastWithdrawTs = getLastSuccessWithdrawTime(token);
    if (lastWithdrawTs === null) {
        console.log(`[${TAG}] 规则①已开启，但会员 ${USER_ID} 无成功提现记录 → 规则天然不适用`);
        return { name, on: true, blocked: false, detail: '会员无成功提现记录，规则天然不适用（视为不限制）' };
    }
    console.log(`[${TAG}] 规则①已开启，上次成功提现时间 ${fmtTs(lastWithdrawTs)}，查该时间之后的邀请转盘奖金流水`);

    const rewards = getInvitedWheelRewardsSince(token, lastWithdrawTs);
    rewards.forEach(r => console.log(`[${TAG}]     命中流水 ${r.orderNo || r.id || ''} amount=${r.amount} createTime=${fmtTs(Number(r.createTime) || 0)}`));

    return {
        name, on: true,
        blocked: rewards.length > 0,
        detail: `上次成功提现时间 ${fmtTs(lastWithdrawTs)}，之后邀请转盘奖金(InvitedWheel)流水 ${rewards.length} 笔`
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
    console.log(`[${TAG}] Step2 规则「${cfg.configName}」(id=${cfg.id})；时间窗口 ${fmtTs(range.begin)} ~ ${fmtTs(range.end)}（近${DAYS}天）`);

    const r1 = checkInvitedWheelAfterWithdraw(token, cfg);
    const r2 = checkGameLimit(token, cfg, range);

    const lines = [];
    lines.push('');
    lines.push('================ 自动出款新增两项规则检测结果 ================');
    lines.push(`会员 ${USER_ID} | 渠道 ${packageId} | 规则「${cfg.configName}」(id=${cfg.id}) | 近${DAYS}天`);
    lines.push('--------------------------------------------------');
    lines.push(`【规则①】${r1.name}`);
    lines.push(`  开关：${r1.on ? '已开启' : '未开启'}`);
    lines.push(`  ${r1.detail}`);
    lines.push(`  结论：${r1.blocked ? '❌ 不能自动出款（命中）' : '✅ 能自动出款（未命中/未开启）'}`);
    lines.push('--------------------------------------------------');
    lines.push(`【规则②】${r2.name}`);
    lines.push(`  开关：${r2.on ? '已开启' : '未开启'}  生效游戏：${r2.games}`);
    lines.push(`  ${r2.detail}`);
    lines.push(`  结论：${r2.blocked ? '❌ 不能自动出款（命中限制游戏）' : '✅ 能自动出款（未命中限制游戏）'}`);
    lines.push('--------------------------------------------------');
    {
        const anyBlocked = r1.blocked || r2.blocked;
        const hit = [r1.blocked ? r1.name : null, r2.blocked ? r2.name : null].filter(Boolean);
        lines.push(`综合：${anyBlocked ? `❌ 不能自动出款（命中：${hit.join('、')}）` : '✅ 能自动出款（两项规则均未命中）'}`);
    }
    lines.push('==============================================================');
    console.log(lines.join('\n'));
}
