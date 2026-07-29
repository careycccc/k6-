/**
 * 实时数据统计报表 —— 数据源认证（第二层）
 *
 * 口径：报表某字段在「当前最新时间节点」的值，应等于底层业务数据从当天 00:00
 *       累计到该节点时刻的真值。因此源查询的 endTime 必须绑定到报表最新节点时刻，
 *       而不是 now / 全天，否则会把节点之后那几分钟的新数据算进去。
 *
 * 已覆盖字段（聚合查询，不逐用户）：
 *   注册人数 registerCount   ← /api/Users/GetPageList (registerTime, 剔除 userType=1 测试账号)
 *   充值人数 rechargeUserCount / 充值金额 rechargeAmount ← /api/RechargeOrder(Payed)
 *   提现人数 withdrawUserCount / 提现金额 withdrawAmount ← /api/WithdrawOrder(Pass)
 */
import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { getTzOffset } from '../retention/rechargeRetentionApi.js';
import { getRealTimeSnapshotReport } from './rptDashboardApi.js';

const TAG = 'rptSource';
const MAX_PAGES = 200; // 安全上限，防止异常翻页

function tzMs(tenantId) { return getTzOffset(tenantId) * 3600 * 1000; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function nowHHMM() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

function dateToIstStartTs(dateStr, tenantId) {
    return new Date(dateStr + 'T00:00:00Z').getTime() - tzMs(tenantId);
}

/** 报表最新时间节点（今天以当前时刻为界；历史日期取全天最后节点），并算出该节点的 IST 时间戳 */
export function getReportLatestNode(token, date, tenantId) {
    const report = getRealTimeSnapshotReport(token, date);
    if (!report || !Array.isArray(report.list)) return null;

    const cutoff = (date === todayStr()) ? nowHHMM() : '23:59';
    let latest = null;
    report.list.forEach(n => {
        if (n.timeNode > cutoff) return;
        const cell = (n.cells || []).find(c => c.date === date) || (n.cells || [])[0];
        if (cell && (!latest || n.timeNode > latest.timeNode)) latest = { timeNode: n.timeNode, cell };
    });
    if (!latest) return null;

    const [H, M] = latest.timeNode.split(':').map(Number);
    latest.ts = dateToIstStartTs(date, tenantId) + (H * 60 + M) * 60000; // 节点时刻的 IST 时间戳
    return latest;
}

/** 注册人数：剔除 userType=1 测试账号，只留正式+游客 */
export function srcRegisterCount(token, startTs, endTs) {
    let page = 1, totalPage = 1, count = 0;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            registerBeginTime: startTs, registerEndTime: endTs,
            pageNo: page, pageSize: 500, orderBy: 'Desc'
        }, '/api/Users/GetPageList', TAG, false, token);
        if (!r) break;
        (r.list || []).forEach(u => { if (u.userType !== 1) count++; });
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return count;
}

/** 充值（Payed）：distinct 用户数 + actualAmount 求和 */
export function srcRecharge(token, startTs, endTs) {
    const users = new Set(); let amount = 0;
    let page = 1, totalPage = 1;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            rechargeState: 'Payed', startTime: startTs, endTime: endTs,
            pageNo: page, pageSize: 500, dateType: 0, orderBy: 'Desc'
        }, '/api/RechargeOrder/GetRechargeOrderPageList', TAG, false, token);
        if (!r) break;
        (r.list || []).forEach(o => { users.add(o.userId); amount += parseFloat(o.actualAmount || 0); });
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return { userCount: users.size, amount };
}

/** 提现（Pass）：distinct 用户数 + actualAmount 求和（报表口径=扣手续费后实际到账）*/
export function srcWithdraw(token, startTs, endTs) {
    const users = new Set(); let amount = 0;
    let page = 1, totalPage = 1;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            withdrawState: 'Pass', startTime: startTs, endTime: endTs,
            pageNo: page, pageSize: 500, dateType: 1, orderBy: 'Desc', sortField: ''
        }, '/api/WithdrawOrder/GetWithdrawOrderPageList', TAG, false, token);
        if (!r) break;
        (r.list || []).forEach(o => { users.add(o.userId); amount += parseFloat(o.actualAmount || 0); });
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return { userCount: users.size, amount };
}

// ── GetUserRpt* 系列（type 服务端过滤：R1/R2/W1）──────────────
// 返回 { count: totalCount, amount: summary.totalRechargeAmount }
// 注：首提接口 GetUserRptWithdrawPageList 也复用 totalRechargeAmount 字段名
function srcRptType(token, api, type, startStr, endStr) {
    const r = sendQueryRequest({ type, startTime: startStr, endTime: endStr, pageNo: 1, pageSize: 1 },
        api, TAG, false, token);
    if (!r) return { count: 0, amount: 0 };
    return {
        count: r.totalCount || 0,
        amount: r.summary ? parseFloat(r.summary.totalRechargeAmount || 0) : 0,
    };
}
const RPT_RECHARGE = '/api/RptUserInfo/GetUserRptRechargePageList';
const RPT_WITHDRAW = '/api/RptUserInfo/GetUserRptWithdrawPageList';

/** 登录人数：Users/GetPageList 按 loginBeginTime/loginEndTime，剔除 userType=1 测试账号后去重计数 */
function srcLoginCount(token, startTs, endTs) {
    let page = 1, totalPage = 1, count = 0;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            loginBeginTime: startTs, loginEndTime: endTs,
            pageNo: page, pageSize: 500, orderBy: 'Desc'
        }, '/api/Users/GetPageList', TAG, false, token);
        if (!r) break;
        (r.list || []).forEach(u => { if (u.userType !== 1) count++; });
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return count;
}

/** 游戏(投注)：ThirdGame/GetBetRecordPageList 按 betTime
 *  - 盈亏金额 winLose = data.sum.winLoseAmount（报表口径，按投注时间，时间戳精确）
 *  - 游戏人数 players = 去重 userId（剔除 userType=1）
 *  注意响应双层嵌套：外层 data 里有 list/totalPage/totalCount，data.data 里才是 sum */
function srcBetGame(token, startTs, endTs) {
    const users = new Set();
    let winLose = 0, gotSum = false;
    let page = 1, totalPage = 1;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            queryTimeType: 'BetTime', beginTimeUnix: startTs, endTimeUnix: endTs,
            pageNo: page, pageSize: 500, orderBy: 'Desc', sortField: 'BetTime'
        }, '/api/ThirdGame/GetBetRecordPageList', TAG, false, token);
        if (!r) break;
        if (!gotSum && r.data && r.data.sum) { winLose = parseFloat(r.data.sum.winLoseAmount || 0); gotSum = true; }
        (r.list || []).forEach(b => { if (b.userType !== 1) users.add(b.userId); });
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return { players: users.size, winLose };
}

// 活动账变类型（与后台一致，用于 Financial/GetPageList 精确按 createTime 统计活动）
const ACTIVITY_TYPES = [
    'RechargeGift', 'BonusRecharge', 'WithdrawBack', 'InvitedWheel', 'BonusReduce', 'RedBagReceived',
    'GiftCode', 'VIPReward', 'TurnableSpin', 'CodeWashing', 'Champion', 'RankUserReward', 'RankAgentReward',
    'SafeBoxTransIn', 'SafeBoxReward', 'SafeBoxTransOut', 'SendCommission', 'L3SendCommission', 'BigJackpotReward',
    'GiftPackReward', 'RechargeGiftPackReward', 'InmailReward', 'RechargeWheelSpin', 'ActivityGuideReward',
    'L3InviteOkReward', 'L3InvitedReward', 'L3InvitedTaskReward', 'CouponReward', 'SpecialBonus',
    'PackageTransferReward', 'MysteryReward', 'RechargeGoodsR1Reward', 'RechargeGoodsR2Reward', 'RechargeGoodsR3Reward',
    'PromotionShareReward', 'CashRainReward', 'WithdrawTimeoutCompensation', 'LossReliefReward', 'LuckyDoubleReward',
    'DayWeekTaskReward', 'DailyCheckInReward', 'CardPlanWeekReward', 'CardPlanMonthReward', 'L6InvitedTaskReward',
    'PartnerReward', 'ReserveFundClaim',
];

/** 活动：Financial/GetPageList 按 createTime(账变时间) 精确过滤（绑定报表节点时刻，无漂移）
 *  金额 = summary.totalAmount；人数 = 去重 userId */
function srcActivity(token, startTs, endTs) {
    const users = new Set();
    let amount = 0, gotSummary = false;
    let page = 1, totalPage = 1;
    while (page <= totalPage && page <= MAX_PAGES) {
        const r = sendRequest({
            searchUserIdType: 1, userTypeList: [0], financialTypeList: ACTIVITY_TYPES,
            startTime: startTs, endTime: endTs, pageNo: page, pageSize: 500, orderBy: 'Desc'
        }, '/api/Financial/GetPageList', TAG, false, token);
        if (!r) break;
        if (!gotSummary && r.summary) { amount = parseFloat(r.summary.totalAmount || 0); gotSummary = true; }
        (r.list || []).forEach(x => users.add(x.userId));
        if (r.totalPage && r.totalPage > totalPage) totalPage = r.totalPage;
        page++;
        if (page <= totalPage) sleep(0.2);
    }
    return { userCount: users.size, amount };
}

/**
 * 认证：源（累计到报表最新节点时刻）vs 报表最新节点各字段
 * @returns {object|null} { timeNode, rows:[{name,field,src,rpt,diff,ok,kind}] }
 */
export function verifyBaseMetrics(token, date, tenantId, tol = 0.01) {
    const node = getReportLatestNode(token, date, tenantId);
    if (!node) return null;

    const s = dateToIstStartTs(date, tenantId);
    const e = node.ts; // 绑定到报表节点时刻

    const reg = srcRegisterCount(token, s, e);
    const rc  = srcRecharge(token, s, e);
    const wd  = srcWithdraw(token, s, e);
    const c = node.cell;

    const mk = (name, field, src, rpt, kind) => {
        const diff = Math.abs(src - rpt);
        const ok = kind === 'count' ? (src === rpt) : (diff <= tol || (rpt !== 0 && diff / Math.abs(rpt) <= 0.001));
        return { name, field, src, rpt, diff, ok, kind };
    };

    const rows = [
        mk('注册人数', 'registerCount',     reg,         Number(c.registerCount)     || 0, 'count'),
        mk('充值人数', 'rechargeUserCount', rc.userCount, Number(c.rechargeUserCount) || 0, 'count'),
        mk('充值金额', 'rechargeAmount',    rc.amount,    Number(c.rechargeAmount)    || 0, 'amount'),
        mk('提现人数', 'withdrawUserCount', wd.userCount, Number(c.withdrawUserCount) || 0, 'count'),
        mk('提现金额', 'withdrawAmount',    wd.amount,    Number(c.withdrawAmount)    || 0, 'amount'),
    ];

    return { timeNode: node.timeNode, rows };
}

/**
 * 全字段认证：源（累计到报表最新节点时刻）vs 报表最新节点
 * kind: count 精确 / amount 带容差 / rate 带容差 / info 仅展示不判定
 */
export function verifyAllMetrics(token, date, tenantId, tol = 0.01) {
    const node = getReportLatestNode(token, date, tenantId);
    if (!node) return null;
    const c = node.cell;

    // 时间戳窗口（订单类）与 字符串窗口（GetUserRpt* 类），都绑定到节点时刻
    const sTs = dateToIstStartTs(date, tenantId);
    const eTs = node.ts;
    const sStr = `${date} 00:00:00`;
    const eStr = `${date} ${node.timeNode}:00`;

    // 源数据
    const reg = srcRegisterCount(token, sTs, eTs);
    const rc  = srcRecharge(token, sTs, eTs);
    const wd  = srcWithdraw(token, sTs, eTs);
    const r1  = srcRptType(token, RPT_RECHARGE, 'R1', sStr, eStr);
    const r2  = srcRptType(token, RPT_RECHARGE, 'R2', sStr, eStr);
    const w1  = srcRptType(token, RPT_WITHDRAW, 'W1', sStr, eStr);
    const act = srcActivity(token, sTs, eTs);           // 活动（Financial by createTime，时间精确）
    const bet = srcBetGame(token, sTs, eTs);            // 盈亏 + 游戏人数（BetRecord by betTime，时间精确）
    const login = srcLoginCount(token, sTs, eTs);       // 登录人数（Users/GetPageList by loginTime）
    const regRechargeRate = reg === 0 ? 0 : (r1.count / reg) * 100;   // 注册充值转化率(派生, 百分比，与报表同口径)

    const mk = (name, field, src, rpt, kind) => {
        const s = Number(src) || 0, r = Number(rpt) || 0;
        const diff = Math.abs(s - r);
        let ok;
        if (kind === 'count') ok = s === r;
        else if (kind === 'info') ok = null;                     // 不判定
        else ok = diff <= tol || (r !== 0 && diff / Math.abs(r) <= 0.001);
        return { name, field, src: s, rpt: r, diff, ok, kind };
    };

    const rows = [
        mk('注册人数',      'registerCount',           reg,               c.registerCount,           'count'),
        mk('登录人数',      'loginCount',              login,             c.loginCount,              'count'),
        mk('充值人数',      'rechargeUserCount',       rc.userCount,      c.rechargeUserCount,       'count'),
        mk('充值金额',      'rechargeAmount',          rc.amount,         c.rechargeAmount,          'amount'),
        mk('提现人数',      'withdrawUserCount',       wd.userCount,      c.withdrawUserCount,       'count'),
        mk('提现金额',      'withdrawAmount',          wd.amount,         c.withdrawAmount,          'amount'),
        mk('首充人数',      'firstRechargeUserCount',  r1.count,          c.firstRechargeUserCount,  'count'),
        mk('首充金额',      'firstRechargeAmount',     r1.amount,         c.firstRechargeAmount,     'amount'),
        mk('二充人数',      'secondRechargeUserCount', r2.count,          c.secondRechargeUserCount, 'count'),
        mk('首提人数',      'firstWithdrawUserCount',  w1.count,          c.firstWithdrawUserCount,  'count'),
        mk('首提金额',      'firstWithdrawAmount',     w1.amount,         c.firstWithdrawAmount,     'amount'),
        mk('活动参与人数',  'activityUserCount',       act.userCount,     c.activityUserCount,       'count'),
        mk('活动金额',      'activityAmount',          act.amount,        c.activityAmount,          'amount'),
        mk('盈亏金额',      'winLoseAmount',           bet.winLose,       c.winLoseAmount,           'amount'),
        mk('注册充值转化率', 'registerRechargeRate',   regRechargeRate,   c.registerRechargeRate,    'rate'),
        // gameCount/onlineCount 是实时瞬时值(gauge，"当前在玩/在线")，非累计投注人数，无法源认证，仅展示
        mk('游戏人数(gauge)', 'gameCount',             bet.players,       c.gameCount,               'info'),
    ];

    return { timeNode: node.timeNode, rows };
}
