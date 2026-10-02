/**
 * 邀请转盘 · 出款自动审核「通过规则 条件组三(新增)」验证 —— 按配置批次跑，一用例一账号并发
 *
 * 判定：拒绝规则优先 → 按「渠道+轮次」匹配唯一通过规则(优先指定渠道，不降级) →
 *       组一(本轮) 或 组二(累计) 或 组三(新增)，任一命中即通过，否则拒绝；组三是组一/组二的补充。
 *
 * 口径（已与产品/开发确认）：
 *   - 组一「本轮」= 本轮点礼物盒 ~ 点提现；点礼物盒之前(含上次点提现后~下次点礼物盒前)的充值/邀请不算组一本轮
 *   - 组三起点 = 上一次成功领取(auditState=2)的 completionTime；从未成功领取 = 注册时间；被拒不重置
 *   - 组三终点 = 本次申请时间；一笔充值「下单时间」和「到账时间」都落在 [起点, 终点] 内才计入
 *   - 新增下级 = 起点之后通过邀请注册的下级（转盘码W / 普通码N 都算，普通码也给抽奖次数）
 *   - 所有充值走前台商品充值(固定面额，最小100) + 后台补单到账；不用后台人工充值/彩金
 *   - 转盘自动旋转：首转 98%~99%，每邀请1人1次(4~5)，转满 invitedWheelTotalPrizeAmount(500) 才能提现 → 基本要邀请3人
 *
 * 批次(每批改一次规则 → 等 CONFIG_WAIT(30s) → 并发跑该批用例)：
 *   CH 渠道×轮次     MATCH 轮次0/轮次>0 规则匹配   DISABLE 指定渠道规则停用后的匹配
 *   AND 组三「且」   OFF 组三不勾(+本轮定义)        ALL 三组全开(+组一重置/组三延续)
 *   RESET 靠组一/组二通过后组三起点重置            EDGE 阈值 2001/5001 验差1
 *   OR 组三「或」核心 + 统计准确性 + 拒绝优先      ORX 跨轮累计 + 到账时间口径 + 本轮定义
 *   RESTORE 把 3 条通过规则恢复成原始配置
 *
 * 用法：node auditG3Runner.js --tenant 3004        （runner 逐批调用本脚本并汇总报表）
 *       k6 run -e BATCH=OR -e CASES=OR_sub_eq auditG3Verify.js
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import encoding from 'k6/encoding';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { sendRequest } from '../../common/request.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { goodsDepositRecharge } from '../../recharge/frontendRechargeApi.js';
import { getRechargeOrderPageListFull, getLocalRechargeOrderPageList, manualAuditRechargeOrder, manualAuditLocalRechargeOrder } from '../../recharge/backendRechargeApi.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';

const TAG = 'AuditG3';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const BATCH = (__ENV.BATCH || 'OR').toUpperCase();
const PWD = 'qwer1234';
const CONFIG_WAIT = parseInt(__ENV.CONFIG_WAIT || '30', 10);   // 改规则后等生效
const AUDIT_WAIT = parseInt(__ENV.AUDIT_WAIT || '120', 10);    // 提现后最多等自动审核秒数(轮询)
const WHEEL_WAIT = parseInt(__ENV.WHEEL_WAIT || '60', 10);     // 提现前等自动旋转转满的秒数
const ARRIVE_WAIT = parseInt(__ENV.ARRIVE_WAIT || '60', 10);   // 补单后等累计充值反映的秒数
const SUB_BASE = parseInt(__ENV.SUB_BASE || '100', 10);        // 每个下级的基础充值(避开拒绝规则1)
const HIST_START = __ENV.HIST_START || '2026-01-01';           // 核实账号时查提现历史的起始日
const SCAN_START = __ENV.SCAN_START || monthStart();           // 找「只有拒绝」老号：扫提现记录的起始日(默认本月)
const POOL_PAGES = parseInt(__ENV.POOL_PAGES || '10', 10);     // 会员列表最多翻几页(每页20)
const EXCLUDE_IDS = new Set((__ENV.EXCLUDE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
// 指定账号：ACCOUNTS=用例名:手机号[,用例名:手机号]；指定了就只用这个号(不符合则报原因，不再自动找)
const GIVEN = {};
(__ENV.ACCOUNTS || '').split(',').map(s => s.trim()).filter(Boolean).forEach(kv => {
    const i = kv.indexOf(':');
    if (i > 0) GIVEN[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
});

// 组三阈值：X=邀请人新增充值  Y=新增下级充值合计（前台面额最小100 → 边界做「正好=阈值」和「阈值-100」）
const X = parseInt(__ENV.G3_X || '2000', 10);
const Y = parseInt(__ENV.G3_Y || '5000', 10);
const EX = X + 1, EY = Y + 1;                                   // EDGE 批次：阈值+1，充正好 X/Y 验「差1」
const CH_X = parseInt(__ENV.CH_X || '3000', 10);               // 渠道类批次只用「本人新增≥CH_X」判定
const HUGE = 99999999;

// ================= 渠道 =================
const PKG = { official: 0, agent: 1, wheel: 2, carey: 100051 };
const SPECIFIC_PKGS = [PKG.carey, PKG.agent, PKG.wheel]; // 生产配置里有指定渠道规则的渠道

// ================= 规则原始配置(恢复用，来自后台) =================
const REASON_48 = { zh: '0', ru: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.', es: '-', hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.1', pt: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.1', ur: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.' };
const REASON_49 = { hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.2', ur: '8', es: '8', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.2', pt: '8', ru: '8', zh: '8' };
const REASON_50 = { pt: '9', hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.3', zh: '9', es: '9', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.3', ur: '9', ru: '9' };
const REASONS = { 300048: REASON_48, 300049: REASON_49, 300050: REASON_50 };

// op: 'and' | 'or'；on: 是否勾选
function G(agent, op, sub, on = true) { return { agent, op, sub, on }; }
const ORIGINAL = {
    300048: { round: ['=', 0], pkgs: [], g1: G(300, 'and', 2000), g2: G(600, 'and', 1000), g3: G(2000, 'or', 5000) },
    300049: { round: ['>', 0], pkgs: [PKG.carey], g1: G(300, 'or', 2000), g2: G(1000, 'and', 1000), g3: G(2000, 'and', 3000) },
    300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: G(300, 'and', 2000), g2: G(2000, 'or', 3000, false), g3: G(5000, 'or', 10000) },
};

// ================= 拒绝规则(只配 1/2/3，保持开启) =================
const REJECT_RULES = [
    { id: 300020, state: 1, autoAuditState: 0, packageIds: [], packageNames: [],
      detailDescription: '开启时，邀请人未曾首充且最近被邀请人未首充次数（最近的n个人）>=配置值时，自动审核拒绝',
      auditCondition: [
          { invitedWheelAuditType: 1, operatorType: 0, value: '', conditionLogic: 0, isGroupEnable: true },
          { invitedWheelAuditType: 3, operatorType: 1, value: 1, conditionLogic: 0, isGroupEnable: true }],
      rejectReason: { en: 'If the referrer has never made a first-time deposit and the number of times the most recent person they referred has not made a first-time deposit is greater than or equal to the configured value, the application will be automatically rejected.', es: '1', ru: '1', zh: 'If the referrer has never made a first-time deposit and the number of times the most recent person they referred has not made a first-time deposit is greater than or equal to the configured value, the application will be automatically rejected.', bn: '1', ur: '1', pt: '1', hi: '1' } },
    { id: 300021, state: 1, autoAuditState: 0, packageIds: [], packageNames: [],
      detailDescription: '开启时，邀请人不是充值用户，且所有下级用户都不是充值用户，且下级人数>=配置值时，自动审核拒绝',
      auditCondition: [
          { invitedWheelAuditType: 1, operatorType: 0, value: '', conditionLogic: 0, isGroupEnable: true },
          { invitedWheelAuditType: 4, operatorType: 0, value: '', conditionLogic: 0, isGroupEnable: true },
          { invitedWheelAuditType: 6, operatorType: 1, value: 5, conditionLogic: 0, isGroupEnable: true }],
      rejectReason: { ur: '2', en: 'If the referrer is not a paying user, none of their downline users are paying users, and the number of downline users is greater than or equal to the configured value, the application will be automatically rejected.', ru: '2', pt: '2', bn: '1', es: '2', zh: '2', hi: '2' } },
    { id: 300022, state: 1, autoAuditState: 0, packageIds: [], packageNames: [],
      detailDescription: '开启时，邀请人充值金额<配置值且总邀请人数<配置值，自动审核拒绝',
      auditCondition: [
          { invitedWheelAuditType: 2, operatorType: 2, value: 100, conditionLogic: 0, isGroupEnable: true },
          { invitedWheelAuditType: 5, operatorType: 2, value: 3, conditionLogic: 0, isGroupEnable: true }],
      rejectReason: { ru: '3', pt: '3', es: '3', hi: '3', en: 'If the amount recharged by the referrer is less than the configured value and the total number of referrals is less than the configured value, the application will be automatically rejected.', bn: '2', zh: '3', ur: '3' } },
];

// ================= 各批次通过规则配置 =================
// 组三核心批次：新号(官网)需要连续多轮都有规则可匹配 → 48=全部/轮次0，49=全部/轮次>0
function g3Batch(g1, g2, g3) {
    return {
        300048: { round: ['=', 0], pkgs: [], g1, g2, g3 },
        300049: { round: ['>', 0], pkgs: [], g1, g2, g3 },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1, g2, g3 },
    };
}
const OFF1 = G(999999, 'and', 999999, false);
const OFF2 = G(999999, 'and', 999999, false);
const G1 = G(300, 'and', 2000);   // 组一：本轮本人≥300 且 本轮下级≥2000
const G2 = G(1000, 'and', 1000);  // 组二：本人累计≥1000 且 下级累计≥1000
const BATCH_CONFIG = {
    // 渠道×轮次：保持生产结构(48全部=0 / 49 carey>0 / 50 agent+wheel>1)，只开组三，只靠「本人新增≥CH_X」判定
    CH: {
        300048: { round: ['=', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
        300049: { round: ['>', 0], pkgs: [PKG.carey], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
    },
    // 轮次匹配：48(轮次=0)可达、49(轮次>0)不可达 → 轮次0 应通过、轮次1 应拒绝
    MATCH: {
        300048: { round: ['=', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(X, 'or', HUGE) },
        300049: { round: ['>', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(HUGE, 'or', HUGE) },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: OFF1, g2: OFF2, g3: G(HUGE, 'or', HUGE) },
    },
    // 指定渠道规则停用：49(carey)停用且不可达，48 改成 全部/轮次>0 可达 → carey 轮次≥1 应落到 48 通过
    DISABLE: {
        300048: { round: ['>', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
        300049: { round: ['>', 0], pkgs: [PKG.carey], g1: OFF1, g2: OFF2, g3: G(HUGE, 'or', HUGE), state: 0 },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
    },
    AND: g3Batch(OFF1, OFF2, G(X, 'and', Y)),
    OFF: g3Batch(G1, OFF2, G(X, 'or', Y, false)),
    ALL: g3Batch(G1, G2, G(X, 'or', Y)),
    // 组三起点重置：轮次0(48)只开组一/组二，轮次>0(49)只开组三 → 第1次靠组一/组二通过，第2次只看组三
    RESET: {
        300048: { round: ['=', 0], pkgs: [], g1: G1, g2: G2, g3: G(X, 'or', Y, false) },
        300049: { round: ['>', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(X, 'or', Y) },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: OFF1, g2: OFF2, g3: G(X, 'or', Y) },
    },
    EDGE: g3Batch(OFF1, OFF2, G(EX, 'or', EY)),
    OR: g3Batch(OFF1, OFF2, G(X, 'or', Y)),
    ORX: g3Batch(OFF1, OFF2, G(X, 'or', Y)),
    RESTORE: ORIGINAL,
};

// ================= 用例 =================
// acct: {type:'new'} 新注册官网总代 | {type:'pool', pool, pass:{eq|min}, rejOnly, cum:{gt|lt|gte|mod}}
// steps(所有充值均为前台商品充值+后台补单到账)：
//   ['round']                 点4个礼物盒开转盘(首转98%~99%，之后自动旋转)，并取邀请码
//   ['code']                  只取邀请码(不开转盘)
//   ['invite', n, each, tag, {code:'N', unpaid}]  邀请n个下级(默认转盘码W)，每人充each(0=不充)；unpaid=第1人另下单不支付
//   ['self', amt]             总代充值
//   ['selfNewTo', t]          把「本人新增」补到正好 t
//   ['subsTo', t]             把「新增下级合计(上次通过后注册的)」补到正好 t（补在最后一个新增下级上）
//   ['roundSubsTo', t]        把「本轮下级合计(本轮邀请的)」补到正好 t
//   ['topTag', tag, amt]      给该批(tag)第一个下级充值
//   ['order', who, amt, key]  who=self|tag：只下单不到账(待支付)，记为 key
//   ['arrive', key]           后台补单让 key 的订单到账，记录服务端到账时间
//   ['wheelFull']             等转盘自动旋转转满
//   ['apply', expect|fn, {after, by, now, mayNotFull}]  申请提现并核对；after=申请后审核前的动作；by='rule'=须被拒绝规则拦；now=到账后立即申请
const base3 = (tag) => ['invite', 3, SUB_BASE, tag];
const A = (expect, opts) => ['apply', expect, opts || {}];

/**
 * 动态预期(下单/到账时间类)：取该笔订单的服务端下单时间(最早一张)与到账时间(最晚一张)，
 * 本次窗口 = [上次成功领取的审核完成时间(没有则=注册), 本次申请时间]；两者都在窗口内才计入。
 * 这类用例里只有这一笔能让组三达标，所以 计入→通过、不计入→拒绝。
 */
function inWindowExpect(key, label) {
    return (st, ph) => {
        const arr = st.arrivals[key], p = st.pending[key];
        const prevPass = st.phases.filter(x => x.actual === 'pass').slice(-1)[0];
        const start = prevPass ? prevPass.completionMs : 0;
        const end = ph.applyMs;
        if (!p || !p.orders.length || !end) return { expect: 'reject', note: `缺少${key}的订单或本次申请时间，按不计入处理` };
        const orderAt = Math.min(...p.orders.map(o => { const v = Number(o.createTime) || 0; return v && v < 1e12 ? v * 1000 : v; }));
        const arriveAt = arr && arr.payTime ? arr.payTime : 0;
        const win = `本次窗口=[${start ? fmtTs(start) + '(上次审核完成)' : '注册'} ~ ${fmtTs(end)}(本次申请)]`;
        const t = `${label}${p.amount} 下单=${fmtTs(orderAt)} 到账=${arriveAt ? fmtTs(arriveAt) : '申请时未到账'}，${win}`;
        if (!arriveAt || arriveAt > end) return { expect: 'reject', note: `${t}：到账晚于终点 → 不计入` };
        if (orderAt < start) return { expect: 'reject', note: `${t}：下单早于起点 → 不计入` };
        return { expect: 'pass', note: `${t}：下单和到账都在窗口内 → 计入` };
    };
}

const CASES = {
    // ---------- 批次 CH：渠道×轮次(老账号，核实提现历史后使用) ----------
    CH_new_r0:       { batch: 'CH', acct: { type: 'new' }, desc: '新注册官网总代首次申请(成功轮次0)，本人新增≥X → 应匹配规则48(全部/轮次=0) → 通过',
                       steps: [['round'], base3('r'), ['self', CH_X + 100], A('pass')] },
    CH_carey_r0:     { batch: 'CH', acct: { type: 'pool', pool: 'carey', pass: { eq: 0 } }, desc: 'carey 轮次0(从未成功)，本人新增≥X → 渠道锁定规则49(轮次>0)不降级 → 拒绝',
                       steps: [['self', CH_X + 100], ['round'], base3('r'), A('reject')] },
    CH_carey_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'carey', pass: { min: 1 } }, desc: 'carey 轮次≥1 命中规则49，本人新增≥X → 通过',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('pass')] },
    CH_agent_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'agent', pass: { eq: 1 } }, desc: 'agent 轮次=1，规则50要>1 → 拒绝(不降级)',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('reject')] },
    CH_agent_r2:     { batch: 'CH', acct: { type: 'pool', pool: 'agent', pass: { min: 2 } }, desc: 'agent 轮次≥2 命中规则50，本人新增≥X → 通过',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('pass')] },
    CH_wheel_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'wheel', pass: { eq: 1 } }, desc: 'wheel 轮次=1，规则50要>1 → 拒绝',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('reject')] },
    CH_wheel_r2:     { batch: 'CH', acct: { type: 'pool', pool: 'wheel', pass: { min: 2 } }, desc: 'wheel 轮次≥2 命中规则50 → 通过',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('pass')] },
    CH_official_r1:  { batch: 'CH', acct: { type: 'pool', pool: 'official', pass: { min: 1 } }, desc: 'official 轮次≥1 无匹配规则(48只管轮次0) → 拒绝',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('reject')] },
    CH_rejOnly_eq:   { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gt: 0, lt: CH_X - 100, mod: 100 } }, desc: '只有拒绝的老号(起点=注册)：历史充值+补充=正好X → 通过(历史充值算新增)',
                       steps: [['round'], base3('r'), ['selfNewTo', CH_X], A('pass')] },
    CH_rejOnly_lt:   { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gt: 0, lt: CH_X - 100, mod: 100 } }, desc: '只有拒绝的老号：历史充值+补充=X-100 → 拒绝',
                       steps: [['round'], base3('r'), ['selfNewTo', CH_X - 100], A('reject')] },
    CH_rejOnly_hist: { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gte: CH_X } }, desc: '只有拒绝的老号：历史累计已≥X，本轮本人不充 → 通过(全部历史都算新增)',
                       steps: [['round'], base3('r'), A('pass')] },

    // ---------- 批次 MATCH：轮次0/轮次>0 两条「全部渠道」规则各管各的 ----------
    MATCH_r0:        { batch: 'MATCH', acct: { type: 'new' }, desc: '轮次0 应匹配48(可达：本人新增≥X)，不能用49(不可达) → 通过',
                       steps: [['round'], base3('r1'), ['selfNewTo', X], A('pass')] },
    MATCH_r1:        { batch: 'MATCH', acct: { type: 'new' }, desc: '第1次(轮次0)走48通过；第2次(轮次1)应匹配49(不可达) → 拒绝',
                       steps: [['round'], base3('r1'), ['selfNewTo', X], A('pass'), ['round'], base3('r2'), ['selfNewTo', X], A('reject')] },

    // ---------- 批次 DISABLE：指定渠道规则停用 ----------
    DIS_carey_r1:    { batch: 'DISABLE', acct: { type: 'pool', pool: 'carey', pass: { min: 1 } }, desc: 'carey 专属规则49已停用 → 应落到「全部渠道」规则48(轮次>0，本人新增≥X) → 通过',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('pass')] },
    DIS_official_ctrl: { batch: 'DISABLE', acct: { type: 'pool', pool: 'official', pass: { min: 1 } }, desc: '对照：官网轮次≥1 走48(全部/轮次>0) → 通过',
                       steps: [['round'], ['self', CH_X + 100], base3('r'), A('pass')] },

    // ---------- 批次 AND：组三「且」(组一组二不勾) ----------
    AND_both:      { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X 且 新增下级=Y → 通过',
                     steps: [['round'], base3('r1'), ['selfNewTo', X], ['subsTo', Y], A('pass')] },
    AND_self_only: { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X，下级<Y → 拒绝',
                     steps: [['round'], base3('r1'), ['selfNewTo', X], A('reject')] },
    AND_sub_only:  { batch: 'AND', acct: { type: 'new' }, desc: '下级=Y，本人新增100<X → 拒绝',
                     steps: [['round'], base3('r1'), ['self', 100], ['subsTo', Y], A('reject')] },
    AND_sub_lt:    { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X，下级=Y-100 → 拒绝',
                     steps: [['round'], base3('r1'), ['selfNewTo', X], ['subsTo', Y - 100], A('reject')] },
    AND_self_lt:   { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X-100，下级=Y → 拒绝',
                     steps: [['round'], base3('r1'), ['selfNewTo', X - 100], ['subsTo', Y], A('reject')] },

    // ---------- 批次 OFF：组三不勾(组一 300且2000，组二不可达) + 本轮定义 ----------
    OFF_g3data:    { batch: 'OFF', acct: { type: 'new' }, desc: '组三不勾，数据只满足组三(下级≥Y，本人不充) → 拒绝',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('reject')] },
    OFF_g1_ctrl:   { batch: 'OFF', acct: { type: 'new' }, desc: '对照：满足组一(点礼物盒后本人300 且 本轮下级2100) → 通过',
                     steps: [['round'], ['self', 300], base3('r1'), ['roundSubsTo', 2100], A('pass')] },
    G1_pre_giftbox_first: { batch: 'OFF', acct: { type: 'new' }, desc: '【组一本轮=点礼物盒起】新号点礼物盒前本人充300，点礼物盒后本人不充 → 组一本轮本人=0 → 拒绝',
                     steps: [['self', 300], ['round'], base3('r1'), ['roundSubsTo', 2100], A('reject')] },
    G1_between_click_and_giftbox: { batch: 'OFF', acct: { type: 'new' }, desc: '【组一本轮=点礼物盒起】第1次被拒后、下次点礼物盒前本人充300 → 不算第2轮组一 → 拒绝',
                     steps: [['round'], base3('r1'), A('reject'), ['self', 300], ['round'], base3('r2'), ['roundSubsTo', 2100], A('reject')] },

    // ---------- 批次 ALL：三组全开，组三为补充(组一300且2000 / 组二1000且1000 / 组三 X或Y) ----------
    ALL_only_g1:   { batch: 'ALL', acct: { type: 'new' }, desc: '只命中组一(本轮本人300 且 本轮下级2100；累计人300<1000) → 通过',
                     steps: [['round'], ['self', 300], base3('r1'), ['roundSubsTo', 2100], A('pass')] },
    ALL_only_g2:   { batch: 'ALL', acct: { type: 'new' }, desc: '只命中组二(本人累计1000 且 下级累计1100；组一下级<2000) → 通过',
                     steps: [['self', 1000], ['round'], base3('r1'), ['subsTo', 1100], A('pass')] },
    ALL_only_g3:   { batch: 'ALL', acct: { type: 'new' }, desc: '组一组二都不中(本人0)，组三下级≥Y → 通过(组三补充)',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass')] },
    ALL_none:      { batch: 'ALL', acct: { type: 'new' }, desc: '三组都不中(本人100，下级基础充值) → 拒绝',
                     steps: [['round'], ['self', 100], base3('r1'), A('reject')] },
    R_g1_reset_g3_carry: { batch: 'ALL', acct: { type: 'new' }, desc: '【本轮定义】第1轮下级2100被拒 → 第2轮本人300+本轮下级300：组一不带上轮(拒)；组三继续累计 → 第3轮新增补到Y → 通过',
                     steps: [['round'], base3('r1'), ['roundSubsTo', 2100], A('reject'),
                             ['round'], ['self', 300], base3('r2'), A('reject'),
                             ['round'], base3('r3'), ['subsTo', Y], A('pass')] },

    // ---------- 批次 RESET：靠组一/组二通过后，组三起点也要重置 ----------
    RESET_after_g1: { batch: 'RESET', acct: { type: 'new' }, desc: '第1次靠组一通过 → 老下级再充≥Y、新下级只有基础充值 → 第2次(只看组三)拒绝',
                     steps: [['round'], ['self', 300], base3('r1'), ['roundSubsTo', 2100], A('pass'),
                             ['topTag', 'r1', Y + 100], ['round'], base3('r2'), A('reject')] },
    RESET_after_g2: { batch: 'RESET', acct: { type: 'new' }, desc: '第1次靠组二通过 → 老下级再充≥Y、新下级只有基础充值 → 第2次(只看组三)拒绝',
                     steps: [['self', 1000], ['round'], base3('r1'), ['subsTo', 1100], A('pass'),
                             ['topTag', 'r1', Y + 100], ['round'], base3('r2'), A('reject')] },
    RESET_ctrl:    { batch: 'RESET', acct: { type: 'new' }, desc: '对照：第1次靠组一通过 → 新下级合计=Y → 第2次组三通过',
                     steps: [['round'], ['self', 300], base3('r1'), ['roundSubsTo', 2100], A('pass'),
                             ['round'], base3('r2'), ['subsTo', Y], A('pass')] },

    // ---------- 批次 EDGE：阈值 X+1 / Y+1，充正好 X / Y → 差1 ----------
    EDGE_sub_eq_minus1:  { batch: 'EDGE', acct: { type: 'new' }, desc: `新增下级=${Y}，阈值${EY}(差1) → 拒绝`,
                     steps: [['round'], base3('r1'), ['subsTo', Y], A('reject')] },
    EDGE_self_eq_minus1: { batch: 'EDGE', acct: { type: 'new' }, desc: `本人新增=${X}，阈值${EX}(差1) → 拒绝`,
                     steps: [['round'], base3('r1'), ['selfNewTo', X], A('reject')] },
    EDGE_sub_over:  { batch: 'EDGE', acct: { type: 'new' }, desc: `对照：新增下级=${Y + 100}≥${EY} → 通过`,
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass')] },

    // ---------- 批次 OR：组三「或」核心 + 统计准确性 + 拒绝优先 ----------
    OR_sub_eq:     { batch: 'OR', acct: { type: 'new' }, desc: '新增下级合计=Y(边界) → 通过',
                     steps: [['round'], base3('r1'), ['subsTo', Y], A('pass')] },
    OR_sub_lt:     { batch: 'OR', acct: { type: 'new' }, desc: '新增下级合计=Y-100 → 拒绝',
                     steps: [['round'], base3('r1'), ['subsTo', Y - 100], A('reject')] },
    OR_self_eq:    { batch: 'OR', acct: { type: 'new' }, desc: '本人新增=X(边界) → 通过',
                     steps: [['round'], base3('r1'), ['selfNewTo', X], A('pass')] },
    OR_self_lt:    { batch: 'OR', acct: { type: 'new' }, desc: '本人新增=X-100，下级基础充值 → 拒绝',
                     steps: [['round'], base3('r1'), ['selfNewTo', X - 100], A('reject')] },
    OR_none:       { batch: 'OR', acct: { type: 'new' }, desc: '两项都不达标(本人100，下级300) → 拒绝',
                     steps: [['round'], ['self', 100], base3('r1'), A('reject')] },
    OR_pre_round_self: { batch: 'OR', acct: { type: 'new' }, desc: '新号点礼物盒前本人充X+100(起点=注册，开发已修) → 通过',
                     steps: [['self', X + 100], ['round'], base3('r1'), A('pass')] },
    OR_unpaid:     { batch: 'OR', acct: { type: 'new' }, desc: '新下级另下单≥Y但不支付 → 不算成功充值 → 拒绝',
                     steps: [['round'], ['invite', 3, SUB_BASE, 'r1', { unpaid: Y + 100 }], A('reject')] },
    OR_after_apply: { batch: 'OR', acct: { type: 'new' }, desc: '申请后(审核前)下级到账≥Y → 终点是申请时间，不算 → 拒绝',
                     steps: [['round'], base3('r1'), A('reject', { after: [['topTag', 'r1', Y + 100]] })] },
    N_code_counts: { batch: 'OR', acct: { type: 'new' }, desc: '普通码(N)邀请的下级也算新增下级：3个W码下级300 + 1个N码下级4700 = Y → 通过',
                     steps: [['round'], base3('r1'), ['invite', 1, Y - 3 * SUB_BASE, 'n', { code: 'N' }], A('pass')] },
    D_many_subs:   { batch: 'OR', acct: { type: 'new' }, desc: '11个新增下级每人充300，最后一人补到合计正好=Y → 11人必须全部算上(少算任何1人都<Y) → 通过',
                     steps: [['round'], ['invite', 11, 300, 'm'], ['subsTo', Y], A('pass')] },
    D_same_sub_multi: { batch: 'OR', acct: { type: 'new' }, desc: '同一个新下级分3次到账(2000+2000+700)，加上基础300=Y → 多次充值要累加 → 通过',
                     steps: [['round'], base3('r1'), ['topTag', 'r1', 2000], ['topTag', 'r1', 2000], ['topTag', 'r1', Y - 4000 - 3 * SUB_BASE], A('pass')] },
    D_apply_now:   { batch: 'OR', acct: { type: 'new' }, desc: '新增下级补到Y-100后，最后100到账立刻申请(不等待统计) → 通过',
                     steps: [['round'], base3('r1'), ['subsTo', Y - 100], ['topTag', 'r1', 100], A('pass', { now: true })] },
    REJ1_priority: { batch: 'OR', acct: { type: 'new' }, desc: '组三满足，但本人未首充 且 最近被邀请人未首充 → 命中拒绝1 → 拒绝',
                     steps: [['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['invite', 1, 0, 'last'], A('reject', { by: 'rule' })] },
    REJ3_priority: { batch: 'OR', acct: { type: 'new' }, desc: '组三满足(下级≥Y)，但本人累计0<100 且 总邀请2<3 → 命中拒绝3 → 拒绝',
                     steps: [['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], A('reject', { by: 'rule', mayNotFull: true })] },
    REJ3_cum100:   { batch: 'OR', acct: { type: 'new' }, desc: '本人累计正好100(不<100)、只邀请2人、组三满足 → 拒绝3不命中 → 通过',
                     steps: [['self', 100], ['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], A('pass', { mayNotFull: true })] },

    // ---------- 批次 ORX：跨轮累计 + 到账时间口径 + 本轮定义 ----------
    OR_old_sub_excl: { batch: 'ORX', acct: { type: 'new' }, desc: '通过后老下级再充≥Y，新下级只有基础充值 → 老下级不算 → 拒绝(起点已重置)',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass'),
                             ['topTag', 'r1', Y + 100], ['round'], base3('r2'), A('reject')] },
    OR_old_new_mix: { batch: 'ORX', acct: { type: 'new' }, desc: '通过后老下级再充≥Y，新下级合计正好=Y → 只算新下级 → 通过',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass'),
                             ['topTag', 'r1', Y + 100], ['round'], base3('r2'), ['subsTo', Y], A('pass')] },
    OR_old_self_excl: { batch: 'ORX', acct: { type: 'new' }, desc: '通过后本人新增=X-100(总累计远超X) → 通过前的本人充值不算 → 拒绝',
                     steps: [['round'], base3('r1'), ['selfNewTo', X + 100], A('pass'),
                             ['round'], base3('r2'), ['selfNewTo', X - 100], A('reject')] },
    OR_pre_round_sub: { batch: 'ORX', acct: { type: 'new' }, desc: '通过后、下一轮点礼物盒前邀请的下级也算新增(充≥Y) → 通过',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass'),
                             ['code'], ['invite', 1, Y + 100, 'pre'], ['round'], base3('r2'), A('pass')] },
    X_before_next: { batch: 'ORX', acct: { type: 'new' }, desc: '被拒后、下一轮点礼物盒前，上轮下级到账Y → 累计 → 通过',
                     steps: [['round'], base3('r1'), A('reject'), ['topTag', 'r1', Y], ['round'], base3('r2'), A('pass')] },
    X_after_next:  { batch: 'ORX', acct: { type: 'new' }, desc: '被拒后、下一轮点礼物盒后，上轮下级到账Y → 累计 → 通过',
                     steps: [['round'], base3('r1'), A('reject'), ['round'], ['topTag', 'r1', Y], base3('r2'), A('pass')] },
    X_both:        { batch: 'ORX', acct: { type: 'new' }, desc: '下一轮点礼物盒前/后各到账Y/2(单独不够) → 两段都算 → 通过',
                     steps: [['round'], base3('r1'), A('reject'),
                             ['topTag', 'r1', Y / 2], ['round'], ['topTag', 'r1', Y / 2], base3('r2'), A('pass')] },
    X_multi:       { batch: 'ORX', acct: { type: 'new' }, desc: '连续被拒2轮，第3轮把全部新增补到正好Y(第3轮单独<Y) → 通过',
                     steps: [['round'], base3('r1'), A('reject'), ['round'], base3('r2'), A('reject'),
                             ['round'], base3('r3'), ['subsTo', Y], A('pass')] },
    X_reject_new_multi: { batch: 'ORX', acct: { type: 'new' }, desc: '被拒后下一轮只新增基础充值(累计仍<Y) → 仍拒绝',
                     steps: [['round'], base3('r1'), A('reject'), ['round'], base3('r2'), A('reject')] },
    REJ_rule_keep_start: { batch: 'ORX', acct: { type: 'new' }, desc: '第1次被拒绝规则1拦(组三其实满足) → 起点不重置 → 解除拒绝条件后第2次，第1轮下级的充值仍算 → 通过',
                     steps: [['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['invite', 1, 0, 'last'], A('reject', { by: 'rule' }),
                             ['self', 100], ['topTag', 'last', 100], ['round'], base3('r2'), A('pass')] },
    A1_sub_arrive_after_apply: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账】新下级申请前下单Y、第1次被拒后才到账 → 第1次不算(未到账)；被拒不重置起点，第2次下单和到账都在窗口内 → 通过',
                     steps: [['round'], base3('r1'), ['order', 'r1', Y, 'k1'], A('reject'),
                             ['arrive', 'k1'], ['round'], base3('r2'), A(inWindowExpect('k1', '下级'))] },
    A2_self_order_before_pass: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账】本人在上次成功领取前下单X、审核完成后才到账 → 下单早于新窗口起点 → 第2次不计入 → 拒绝',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], ['order', 'self', X, 'k2'], A('pass'),
                             ['arrive', 'k2'], ['round'], base3('r2'), A(inWindowExpect('k2', '本人'))] },
    A2b_self_arrive_after_round: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账】本人在上次成功领取前下单X、下一轮点礼物盒后才到账 → 下单早于起点 → 不计入 → 拒绝',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], ['order', 'self', X, 'k2b'], A('pass'),
                             ['round'], ['arrive', 'k2b'], base3('r2'), A(inWindowExpect('k2b', '本人'))] },
    A3_self_gap:   { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账】本人申请前下单X、提交申请后立刻到账(审核完成前后) → 第1次到账晚于终点、第2次下单早于起点 → 两次都不计入 → 拒绝',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], ['order', 'self', X, 'gap'], A('pass', { after: [['arrive', 'gap']] }),
                             ['round'], base3('r2'), A(inWindowExpect('gap', '本人'))] },
    A6_sub_arrive_right_after_apply: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账·终点】新下级申请前下单Y(在窗口内)、提交申请后立刻到账(自动审核约1s，抢在审核前) → 到账晚于终点 → 不计入 → 拒绝',
                     steps: [['round'], base3('r1'), ['order', 'r1', Y, 'k6'], A(inWindowExpect('k6', '下级'), { after: [['arrive', 'k6']] })] },
    A6_self_arrive_right_after_apply: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账·终点】本人申请前下单X、提交申请后立刻到账 → 到账晚于终点 → 不计入 → 拒绝',
                     steps: [['round'], base3('r1'), ['order', 'self', X, 'k6s'], A(inWindowExpect('k6s', '本人'), { after: [['arrive', 'k6s']] })] },
    A7_self_order_before_reject: { batch: 'ORX', acct: { type: 'new' }, desc: '【下单/到账】本人在第1次(被拒)申请前下单X、被拒后才到账 → 被拒不重置起点，第2次下单和到账都在窗口内 → 通过（对照A2：同样的时序，前一次是通过就不计入）',
                     steps: [['round'], base3('r1'), ['order', 'self', X, 'k7'], A('reject'),
                             ['arrive', 'k7'], ['round'], base3('r2'), A(inWindowExpect('k7', '本人'))] },
    A4_self_after_pass_before_round: { batch: 'ORX', acct: { type: 'new' }, desc: '【起点】通过后、下一轮点礼物盒前本人充X(下单+到账都在审核完成之后) → 算新增 → 第2次通过',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass'),
                             ['self', X], ['round'], base3('r2'), A('pass')] },
    A5_self_after_round_ctrl: { batch: 'ORX', acct: { type: 'new' }, desc: '【对照】通过后、下一轮点礼物盒后本人新增补到正好X → 第2次通过（验证通过后本人新增确实会被统计）',
                     steps: [['round'], base3('r1'), ['subsTo', Y + 100], A('pass'),
                             ['round'], base3('r2'), ['selfNewTo', X], A('pass')] },
    R_full_more:   { batch: 'ORX', acct: { type: 'new' }, desc: '【本轮定义】转盘已转满500但没点提现，继续邀请3人并充值 → 仍是本轮/新增 → 6人合计=Y → 通过',
                     steps: [['round'], base3('r1'), ['wheelFull'], base3('more'), ['subsTo', Y], A('pass')] },
};

const BATCH_CASES = Object.keys(CASES).filter(k => CASES[k].batch === BATCH);
const CASE_LIST = (__ENV.CASES ? __ENV.CASES.split(',').map(s => s.trim()).filter(k => CASES[k] && CASES[k].batch === BATCH) : BATCH_CASES);

export const options = {
    setupTimeout: '30m',
    scenarios: { g3: { executor: 'per-vu-iterations', vus: Math.max(CASE_LIST.length, 1), iterations: 1, maxDuration: '120m' } },
};

// ================= 输出 =================
function emit(kind, obj) { console.log(`##${kind}##${encoding.b64encode(JSON.stringify(obj))}##`); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(off) { const d = new Date(Date.now() + off * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function monthStart() { const d = new Date(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`; }
function fmtTs(ms) { if (!ms) return '-'; const d = new Date(Number(ms) + 8 * 3600000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; }
function stateName(s) { return s === 2 ? 'pass' : s === 3 ? 'reject' : s === 1 ? '审核中' : s === 0 ? '待审核' : `?${s}`; }
function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    return null;
}
function listOf(res) {
    if (res && res.list && Array.isArray(res.list)) return res.list;
    if (res && res.data && Array.isArray(res.data.list)) return res.data.list;
    return [];
}

// ================= 后台：规则配置 =================
const OP = { '>=': 1, '<': 2, '=': 3, '>': 4 };
function groupItems(tA, tB, g) {
    return [
        { invitedWheelAuditType: tA, operatorType: 1, value: String(g.agent) },
        { invitedWheelAuditType: tB, operatorType: 1, value: String(g.sub), conditionLogic: g.op === 'or' ? 1 : 0, isGroupEnable: !!g.on },
    ];
}
function passRulePayload(id, r) {
    return {
        auditCondition: [
            { invitedWheelAuditType: 10, operatorType: OP[r.round[0]], value: String(r.round[1]) },
            ...groupItems(11, 12, r.g1), ...groupItems(13, 14, r.g2), ...groupItems(15, 16, r.g3),
        ],
        packageIds: r.pkgs, id, rejectReason: REASONS[id],
    };
}
/** 规则启用/停用（页面上的状态开关）：UpdateAutoAuditConfigState {id, state}；UpdateAutoAuditConfig 里带 state 不生效 */
function setRuleState(adminToken, id, state) {
    for (let a = 1; a <= 3; a++) {
        const res = sendRequest({ id, state }, '/api/InvitedWheel/UpdateAutoAuditConfigState', TAG, false, adminToken);
        if (res === true || (res && res.msgCode === 0)) return true;
        console.error(`[${TAG}] 规则 ${id} 开关设为 ${state} 失败(第${a}次): ${JSON.stringify(res)}`);
        sleep(3);
    }
    return false;
}
function updateRule(adminToken, payload) {
    for (let a = 1; a <= 3; a++) {
        const res = sendRequest(payload, '/api/InvitedWheel/UpdateAutoAuditConfig', TAG, false, adminToken);
        if (res === true || (res && res.msgCode === 0)) return true;
        console.error(`[${TAG}] 更新规则 ${payload.id} 失败(第${a}次): ${JSON.stringify(res)}`);
        sleep(3);
    }
    return false;
}
function ruleText(id, r) {
    const g = (n, x) => `${x.on ? '☑' : '☐'}组${n}(${x.agent} ${x.op === 'or' ? '或' : '且'} ${x.sub})`;
    const ch = r.pkgs.length ? r.pkgs.join('/') : '全部';
    return `${id}${r.state === 0 ? '【停用】' : ''} 轮次${r.round[0]}${r.round[1]} 渠道=${ch} ${g('一', r.g1)} ${g('二', r.g2)} ${g('三', r.g3)}`;
}
/** 按「渠道+轮次」算本次应匹配的规则(停用的不参与；优先指定渠道，锁定后不降级)；返回规则文本 */
function expectedRule(pkg, round) {
    const cfg = BATCH_CONFIG[BATCH] || {};
    const roundOk = (r) => r.round[0] === '=' ? round === r.round[1] : r.round[0] === '>' ? round > r.round[1] : r.round[0] === '>=' ? round >= r.round[1] : round < r.round[1];
    const ids = Object.keys(cfg).filter(id => cfg[id].state !== 0);
    const specific = ids.find(id => cfg[id].pkgs.includes(Number(pkg)));
    if (specific) return `${ruleText(specific, cfg[specific])}${roundOk(cfg[specific]) ? '' : `（渠道锁定此规则，但轮次${round}不满足→应拒绝）`}`;
    const all = ids.find(id => !cfg[id].pkgs.length && roundOk(cfg[id]));
    return all ? ruleText(all, cfg[all]) : `无匹配规则(渠道${pkg} 轮次${round})→应拒绝`;
}
function applyBatchConfig(adminToken, batch) {
    const cfg = BATCH_CONFIG[batch];
    if (!cfg) throw new Error(`[${TAG}] 未知批次 ${batch}`);
    let ok = true;
    if (batch !== 'RESTORE') for (const rr of REJECT_RULES) { ok = updateRule(adminToken, rr) && ok; ok = setRuleState(adminToken, rr.id, 1) && ok; }
    const lines = [];
    for (const id of Object.keys(cfg)) {
        ok = updateRule(adminToken, passRulePayload(Number(id), cfg[id])) && ok;
        ok = setRuleState(adminToken, Number(id), cfg[id].state === 0 ? 0 : 1) && ok;   // 恢复/其他批次一律打开
        lines.push(ruleText(id, cfg[id]));
    }
    emit('C', { batch, ok, rules: lines });
    if (!ok) throw new Error(`[${TAG}] 批次 ${batch} 规则配置失败，终止`);
    console.log(`[${TAG}] 批次 ${batch} 规则已更新，等待 ${CONFIG_WAIT}s 生效...`);
    sleep(CONFIG_WAIT);
}

// ================= 后台：会员 / 提现历史 / 充值订单 =================
function getUserDetail(adminToken, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, adminToken);
    const d = (res && res.usersBaseRsp) ? res : (res && res.data ? res.data : res);
    if (!d || !d.usersBaseRsp) return null;
    return {
        account: d.usersBaseRsp.account,
        cum: d.accountSummaryRsp ? Number(d.accountSummaryRsp.totalRechargeAmount) || 0 : 0,
        packageName: d.registerSourceRsp ? d.registerSourceRsp.packageName : '',
    };
}
function cumOf(adminToken, userId) { const d = getUserDetail(adminToken, userId); return d ? d.cum : 0; }
/** 明文账号：GetUserDetail 的 account 是脱敏的，登录要用 GetPageList(按 userId) 的 account */
function plainAccount(adminToken, userId) {
    const res = sendRequest({ userId: Number(userId), userType: [0], pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken);
    const u = listOf(res).find(x => Number(x.userId) === Number(userId));
    return u && u.account && !String(u.account).includes('*') ? String(u.account) : null;
}
/** 该会员近24小时的充值订单(三方+本地)，_local 标记来源 */
function listOrders(adminToken, userId) {
    const now = Date.now();
    const third = listOf(getRechargeOrderPageListFull(adminToken, { userId, startTime: now - 86400000, endTime: now + 600000, pageSize: 100, dateType: 0 }));
    const local = getLocalRechargeOrderPageList(adminToken, userId, now - 86400000, now + 600000) || [];
    return [...third.map(o => Object.assign({}, o, { _local: false })), ...local.map(o => Object.assign({}, o, { _local: true }))];
}
function payTimeOf(o) { return Number(o.payTime || o.auditTime || o.lastUpdateTime || o.updateTime || 0); }

/** 某会员全部转盘提现记录（按 userId 过滤 + 客户端再过滤一次） */
function fetchHistory(adminToken, userId) {
    const res = sendRequest({ userId, startDay: HIST_START, endDay: dateStr(1), pageNo: 1, pageSize: 500, orderBy: 'Desc' },
        '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken);
    return listOf(res).filter(r => Number(r.userId) === Number(userId));
}
function summarize(recs) {
    const pass = recs.filter(r => Number(r.auditState) === 2);
    const rej = recs.filter(r => Number(r.auditState) === 3);
    const pending = recs.filter(r => [0, 1].includes(Number(r.auditState)));
    const lastPass = pass.reduce((m, r) => Math.max(m, Number(r.completionTime) || 0), 0);
    const pkgs = [...new Set(recs.map(r => Number(r.packageId)))];
    return { total: recs.length, pass: pass.length, rej: rej.length, pending: pending.length, lastPass, pkgs };
}

// ================= 账号池：按渠道取会员 → 核实提现历史 =================
function poolMatch(need, s, pid) {
    if (s.pending > 0) return '有待审核/审核中记录';
    if (s.pkgs.length && !s.pkgs.every(p => p === pid)) return `提现记录渠道${s.pkgs.join('/')}≠${pid}`;
    if (need.pass && need.pass.eq !== undefined && s.pass !== need.pass.eq) return `成功轮次${s.pass}≠${need.pass.eq}`;
    if (need.pass && need.pass.min !== undefined && s.pass < need.pass.min) return `成功轮次${s.pass}<${need.pass.min}`;
    return '';
}
function cumMatch(need, cum) {
    if (!need.cum) return '';
    if (need.cum.gt !== undefined && !(cum > need.cum.gt)) return `累计${cum}≤${need.cum.gt}`;
    if (need.cum.lt !== undefined && !(cum < need.cum.lt)) return `累计${cum}≥${need.cum.lt}`;
    if (need.cum.gte !== undefined && !(cum >= need.cum.gte)) return `累计${cum}<${need.cum.gte}`;
    if (need.cum.mod && cum % need.cum.mod !== 0) return `累计${cum}不是${need.cum.mod}的整数倍(前台面额凑不出精确值)`;
    return '';
}
function verifiedCandidate(adminToken, userId, need, pid, used) {
    const key = String(userId);
    if (used.has(key) || EXCLUDE_IDS.has(key)) return null;
    const s = summarize(fetchHistory(adminToken, userId));
    let why = poolMatch(need, s, pid);
    if (!why && need.rejOnly && !(s.rej > 0 && s.pass === 0)) why = `非只有拒绝(通过${s.pass}/拒绝${s.rej})`;
    let d = null;
    let account = null;
    if (!why) { d = getUserDetail(adminToken, userId); if (!d) why = '取会员详情失败'; }
    if (!why) why = cumMatch(need, d.cum);
    if (!why) { account = plainAccount(adminToken, userId); if (!account) why = '取明文账号失败'; }
    if (why) { console.log(`[${TAG}] 候选 ${userId} 不符：${why}`); return null; }
    return { userId: Number(userId), account, cum: d.cum, pkg: pid, hist: s };
}
/** 扫提现记录(start~明天)并按 userId 分组；同一 setup 内缓存 */
const scanCache = {};
function scanRecordsByUser(adminToken, start) {
    if (scanCache[start]) return scanCache[start];
    const byUser = {};
    for (let page = 1; page <= 20; page++) {
        const res = sendRequest({ startDay: start, endDay: dateStr(1), pageNo: page, pageSize: 500, orderBy: 'Desc' },
            '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken);
        const list = listOf(res);
        for (const r of list) (byUser[r.userId] = byUser[r.userId] || []).push(r);
        if (list.length < 500) break;
    }
    scanCache[start] = byUser;
    return byUser;
}
/** 按渠道挑账号：要求有成功轮次的先从「有通过记录的提现记录」里找，再用会员列表(按渠道 packageId)兜底；都按全量历史核实 */
function pickFromMemberList(adminToken, need, used) {
    const pid = PKG[need.pool];
    const wantPass = need.pass && ((need.pass.min || 0) > 0 || (need.pass.eq || 0) > 0);
    if (wantPass) {
        const byUser = scanRecordsByUser(adminToken, HIST_START);
        const minPass = need.pass.eq !== undefined ? need.pass.eq : need.pass.min;
        for (const uid of Object.keys(byUser)) {
            const recs = byUser[uid];
            if (Number(recs[0].packageId) !== pid) continue;
            if (recs.filter(r => Number(r.auditState) === 2).length < minPass) continue;
            const c = verifiedCandidate(adminToken, uid, need, pid, used);
            if (c) return c;
        }
    }
    for (let page = 1; page <= POOL_PAGES; page++) {
        const res = sendRequest({ userType: [0], packageId: [String(pid)], pageNo: page, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken);
        const list = listOf(res);
        if (!list.length) break;
        for (const u of list) {
            const c = verifiedCandidate(adminToken, u.userId, need, pid, used);
            if (c) return c;
        }
    }
    return null;
}
/** 只有拒绝的老号：扫本月提现记录 → 按 userId 分组 → 全是拒绝且渠道无指定规则 → 再按全量历史核实 */
function pickRejectOnly(adminToken, need, used) {
    const byUser = scanRecordsByUser(adminToken, SCAN_START);
    for (const uid of Object.keys(byUser)) {
        const recs = byUser[uid];
        if (!recs.every(r => Number(r.auditState) === 3)) continue;
        const pid = Number(recs[0].packageId);
        if (SPECIFIC_PKGS.includes(pid)) continue; // 指定渠道会被锁到别的规则，不适合验「轮次0 起点=注册」
        const c = verifiedCandidate(adminToken, uid, need, pid, used);
        if (c) { c.packageName = recs[0].packageName; return c; }
    }
    return null;
}

/** 核实用户指定的账号是否满足用例条件（渠道 / 成功轮次 / 无审核中 / 累计充值）；不满足返回原因 */
function givenAccount(adminToken, account, need) {
    const res = sendRequest({ userName: account, userType: [0], pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken);
    let u = listOf(res).find(x => String(x.account) === String(account));
    if (!u) {   // 按账号查不到 → 登录拿 userId 再按 userId 查
        const t = login(account);
        const info = t ? getFrontUserInfo(t) : null;
        if (info && info.userId) {
            const r2 = sendRequest({ userId: Number(info.userId), userType: [0], pageNo: 1, pageSize: 20, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken);
            u = listOf(r2).find(x => Number(x.userId) === Number(info.userId));
        }
    }
    if (!u) return { why: `会员列表查不到账号 ${account}` };
    const pid = Number(u.packageId);
    const want = need.pool && PKG[need.pool] !== undefined ? PKG[need.pool] : pid;
    const s = summarize(fetchHistory(adminToken, u.userId));
    const d = getUserDetail(adminToken, u.userId);
    let why = pid !== want ? `渠道=${u.packageName}(packageId ${pid})，需要 packageId ${want}` : poolMatch(need, s, pid);
    if (!why && need.rejOnly && !(s.rej > 0 && s.pass === 0)) why = `不是只有拒绝记录(通过${s.pass}/拒绝${s.rej})`;
    if (!why) why = cumMatch(need, d ? d.cum : 0);
    if (why) return { why: `你提供的账号 ${account}(userId=${u.userId}) 不符合：${why}` };
    return { cand: { userId: Number(u.userId), account: String(account), cum: d ? d.cum : 0, pkg: pid, hist: s } };
}

// ================= Setup =================
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(adminToken);

    // 先挑账号再改配置（挑号不依赖配置；改完配置立即等 30s 后开跑）
    const assigned = {};
    const assignErr = {};
    const used = new Set();
    for (const name of CASE_LIST) {
        const need = CASES[name].acct;
        if (need.type !== 'pool') continue;
        if (GIVEN[name]) {
            const g = givenAccount(adminToken, GIVEN[name], need);
            if (g.cand) { used.add(String(g.cand.userId)); assigned[name] = g.cand; console.log(`[${TAG}] ${name} ← 指定账号 ${g.cand.account} userId=${g.cand.userId} 渠道=${g.cand.pkg} 成功轮次=${g.cand.hist.pass} 累计=${g.cand.cum}`); }
            else { assignErr[name] = g.why; console.error(`[${TAG}] ${name} ${g.why}`); }
            continue;
        }
        const c = need.rejOnly ? pickRejectOnly(adminToken, need, used) : pickFromMemberList(adminToken, need, used);
        if (c) { used.add(String(c.userId)); assigned[name] = c; console.log(`[${TAG}] ${name} ← userId=${c.userId} 渠道=${c.pkg} 成功轮次=${c.hist.pass} 拒绝=${c.hist.rej} 累计=${c.cum}`); }
        else console.error(`[${TAG}] ${name} 找不到符合条件的账号`);
    }
    applyBatchConfig(adminToken, BATCH);
    return { adminToken, envConfig, assigned, assignErr };
}

function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) return false;
    const up = [];
    if (!cfg.isOpen) up.push(['IsOpenInvitedWheel', '1']);
    if (!cfg.cashToMainWallet) up.push(['IsInvitedWheelCashToMainWallet', '1']);
    if (!cfg.autoRotate) up.push(['InviteAutoRotate', '1']);
    for (const [k, v] of up) updateInvitedWheelConfig(adminToken, k, v);
    if (up.length) sleep(10);
    return true;
}

// ================= VU =================
export default function (data) {
    const { adminToken, envConfig, assigned, assignErr } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    if (BATCH === 'RESTORE' || !CASE_LIST.length) return;
    const name = CASE_LIST[(exec.vu.idInInstance - 1) % CASE_LIST.length];
    const cfg = CASES[name];
    const customUrls = {
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
    };
    const ctx = { adminToken, countryCode: __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91', adminData: { token: adminToken, envConfig }, customUrls };
    sleep((exec.vu.idInInstance - 1) * 2); // 错峰，避免并发注册/登录撞防重
    if (assignErr && assignErr[name]) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '-', ok: false, error: assignErr[name], phases: [] }); return; }
    try { runCase(name, cfg, ctx, assigned[name]); }
    catch (e) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '?', account: '', ok: false, error: `异常: ${e.message}`, phases: [] }); }
}

// ================= 用例执行引擎 =================
/** 复现轨迹：带北京时间的每一步操作 */
function T(st, text) { st.trail.push(`[${fmtTs(Date.now())}] ${text}`); }
function login(account) {
    for (let a = 1; a <= 3; a++) { const t = loginWithPassword(account, PWD); if (t) return t; sleep(2 + a * 2); }
    return null;
}
/** 老号登录：失败则后台改密码为 qwer1234 → 等 5s → 再登 */
function loginOrReset(adminToken, account, userId) {
    let t = login(account);
    if (t) return { token: t, reset: false };
    const r = sendRequest({ userId, password: PWD }, '/api/Users/UpdatePassword', TAG, false, adminToken);
    console.log(`[${TAG}] userId=${userId} 登录失败 → 改密码 ${JSON.stringify(r)}，等 5s`);
    sleep(5);
    t = login(account);
    return { token: t, reset: true };
}
/** 前台 token 约 55s 失效：超过 40s 就重登（总代 / 下级各自维护） */
function agentToken(st) {
    if (!st.token || Date.now() - st.loginAt > 40000) { st.token = login(st.account); st.loginAt = Date.now(); }
    return st.token;
}
function subToken(sub) {
    if (!sub.token || Date.now() - sub.loginAt > 40000) { sub.token = login(sub.phone); sub.loginAt = Date.now(); }
    return sub.token;
}
function registerSub(ctx, code) {
    for (let a = 1; a <= 5; a++) {
        const phone = generateRandomPhone(ctx.countryCode);
        const res = phoneRegisterByInvite(phone, code, ctx.adminData, PWD, '', ctx.customUrls, generateCryptoRandomString(16), '');
        const token = extractToken(res);
        if (token) { const info = getFrontUserInfo(token); if (info && info.userId) return { phone, token, loginAt: Date.now(), userId: info.userId }; }
        sleep(3 + a * 3 + Math.random() * 3); // Too frequent access：拉开退避
    }
    return null;
}

// ---------- 前台商品充值：固定面额凑精确金额 → 下单 → 后台补单到账 ----------
let GOODS = null;
function goodsBoard(token) {
    if (GOODS) return GOODS;
    const resp = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', TAG, true, token);
    const basic = resp && resp.goodsList !== undefined ? resp : (resp && resp.data) || null;
    const list = (basic && Array.isArray(basic.goodsList) ? basic.goodsList : [])
        .map(g => ({ id: g.id, amt: Number(g.rechargeAmount), cats: (g.supportCategories || []).filter(c => !['ArUpi', 'ARPay'].includes(c.rechargeType)) }))
        .filter(g => g.amt > 0 && g.cats.length);
    if (list.length) GOODS = list;
    return list;
}
function composeExact(target, goods) {
    const desc = [...goods].sort((a, b) => b.amt - a.amt);
    const out = [];
    let remain = target;
    for (const g of desc) while (remain >= g.amt) { out.push(g); remain -= g.amt; }
    return remain === 0 ? out : null;
}
/**
 * 只下单不到账(待支付)：凑精确面额逐笔下单，每笔都以「订单列表里新出现的该面额订单」为准认领一张。
 * 测试环境下单接口常返回 Order failed 但订单照样生成、偶发一次生成两张，被限流(Too frequent)则不生成：
 * 所以不看接口返回，只看订单列表；没出现新单就退避重下，多出来的重复单只记为已知、永不补单。
 * @returns {Array} 认领到的订单(补单时只补这些)
 */
function placeOrders(token, amount, st, whoText, uid, ctx) {
    const goods = goodsBoard(token);
    if (!goods.length) { st.dataErr.push(`${whoText} 取商品盘面失败`); return []; }
    const parts = composeExact(amount, goods);
    if (!parts) { st.dataErr.push(`${whoText} 前台商品面额凑不出 ${amount}`); return []; }
    const known = st.known[uid] || (st.known[uid] = new Set(listOrders(ctx.adminToken, uid).map(o => o.orderNo)));
    const picked = [];
    let dup = 0;
    for (const g of parts) {
        let claimed = null, lastMsg = '';
        for (let a = 1; a <= 5 && !claimed; a++) {
            const r = goodsDepositRecharge(token, g.id, g.cats[0].id);
            lastMsg = (r && r.msg) || '无响应';
            for (let q = 1; q <= 3 && !claimed; q++) {
                sleep(2);
                const fresh = listOrders(ctx.adminToken, uid).filter(o => !known.has(o.orderNo) && o.rechargeState !== 'Payed' && Number(o.amount) === g.amt);
                if (fresh.length) { claimed = fresh[0]; fresh.forEach(o => known.add(o.orderNo)); dup += fresh.length - 1; }
            }
            if (!claimed) sleep(3 * a);
        }
        if (claimed) picked.push(claimed);
        else st.dataErr.push(`${whoText} 面额${g.amt}下单5次都没生成订单(最后返回：${lastMsg})`);
        sleep(2);
    }
    if (dup) { st.dupOrders += dup; st.dupAccts.add(uid); }
    const got = picked.reduce((sum, o) => sum + Number(o.amount), 0);
    if (got !== amount) st.dataErr.push(`${whoText} 下单${amount} 实际认领订单${got}`);
    return picked;
}
function waitCum(ctx, uid, target) {
    let c = 0;
    const dl = Date.now() + ARRIVE_WAIT * 1000;
    while (true) { c = cumOf(ctx.adminToken, uid); if (c >= target || Date.now() > dl) break; sleep(3); }
    return c;
}
/** 后台补单(只补认领的这几张) → 等累计充值反映 → 取这几张单的服务端到账时间 */
function arriveOrders(ctx, uid, orders) {
    const expectAmt = orders.reduce((s, o) => s + Number(o.amount), 0);
    const before = cumOf(ctx.adminToken, uid);
    for (const o of orders) {
        if (o._local) manualAuditLocalRechargeOrder(ctx.adminToken, o.orderNo, uid, o.createTime, o.amount);
        else manualAuditRechargeOrder(ctx.adminToken, o.orderNo, uid, o.createTime, o.amount);
        sleep(0.3);
    }
    const after = waitCum(ctx, uid, before + expectAmt);
    const nos = new Set(orders.map(o => o.orderNo));
    const ts = listOrders(ctx.adminToken, uid).filter(o => nos.has(o.orderNo)).map(payTimeOf).filter(Boolean);
    return { amount: after - before, payTime: ts.length ? Math.max(...ts) : 0, orderNos: [...nos] };
}
/** 前台充值(下单+补单到账)；tgt={self:true}|{sub} */
function frontRecharge(st, ctx, tgt, amount, why) {
    const uid = tgt.self ? st.userId : tgt.sub.userId;
    const whoText = tgt.self ? `总代${uid}` : `下级[${tgt.sub.tag}]${uid}`;
    const token = tgt.self ? agentToken(st) : subToken(tgt.sub);
    if (!token) { st.dataErr.push(`${whoText} 登录失败，无法前台充值`); return false; }
    const orders = placeOrders(token, amount, st, whoText, uid, ctx);
    if (!orders.length) return false;
    const arr = arriveOrders(ctx, uid, orders);
    T(st, `${whoText}${tgt.sub && tgt.sub.gen !== st.gen ? '(老下级)' : ''} 前台商品充值${amount}：${orders.length}笔订单 → 后台补单到账${arr.amount}，服务端到账时间=${fmtTs(arr.payTime)}${why ? '（' + why + '）' : ''}`);
    if (arr.amount !== amount) st.dataErr.push(`${whoText} 充值${amount} 实际到账${arr.amount}`);
    return arr.amount === amount;
}

// ---------- 统计口径 ----------
/** 组三新增下级 = 上次通过之后注册的下级 */
function newSubs(st) { return st.subs.filter(s => s.gen === st.gen); }
/** 组一本轮下级 = 本轮(上次点提现之后)邀请的下级 */
function roundSubs(st) { return st.subs.filter(s => s.roundNo === st.roundNo); }
function sumCum(ctx, subs) { let s = 0; for (const x of subs) { s += cumOf(ctx.adminToken, x.userId); sleep(0.2); } return s; }
function measureSelfNew(st, ctx) { return cumOf(ctx.adminToken, st.userId) - st.selfBase; }
function snapshot(st, ctx) {
    const selfCum = cumOf(ctx.adminToken, st.userId);
    return { selfCum, selfNew: selfCum - st.selfBase, roundSelf: selfCum - st.selfRoundBase,
             subNew: sumCum(ctx, newSubs(st)), newSubCount: newSubs(st).length,
             roundSub: sumCum(ctx, roundSubs(st)), roundSubCount: roundSubs(st).length };
}
/** 把 本人新增 / 新增下级合计 / 本轮下级合计 补到正好 target（前台面额，差额须为100的倍数） */
function topUpTo(kind, target, st, ctx) {
    const label = { self: '本人新增', subs: '新增下级合计', round: '本轮下级合计' }[kind];
    const pool = kind === 'self' ? null : (kind === 'subs' ? newSubs(st) : roundSubs(st));
    if (pool && !pool.length) { st.dataErr.push(`${label}补到${target}：没有可充的下级`); return; }
    const measure = () => kind === 'self' ? measureSelfNew(st, ctx) : sumCum(ctx, pool);
    const cur = measure();
    if (cur > target) { st.dataErr.push(`${label}已是${cur}>${target}，无法精确`); return; }
    if (cur < target) frontRecharge(st, ctx, kind === 'self' ? { self: true } : { sub: pool[pool.length - 1] }, target - cur, `把${label}从${cur}补到${target}`);
    const now = measure();
    st.log.push(`${label}补到${target}→实测${now}`);
    if (now !== target) st.dataErr.push(`${label}补到${target} 实测${now}`);
}
/** 等自动旋转转满；返回转盘信息 */
function waitWheelFull(st) {
    const dl = Date.now() + WHEEL_WAIT * 1000;
    let info = null;
    while (true) {
        info = getUserInvitedWheelInfo(agentToken(st));
        if (info && info.success && info.totalPrizeAmount > 0 && info.userWheelAmount >= info.totalPrizeAmount) return { full: true, info };
        if (Date.now() > dl) return { full: false, info };
        sleep(3);
    }
}
/** 由 reason 文案判断是哪条规则拒的：拒绝规则 / 通过规则(组条件未命中) */
function reasonSource(reason) {
    if (!reason) return '';
    for (const rr of REJECT_RULES) if (Object.values(rr.rejectReason).some(v => v && v.length > 3 && v === reason)) return `拒绝规则${rr.id}`;
    for (const id of Object.keys(REASONS)) if (Object.values(REASONS[id]).some(v => v && v.length > 3 && v === reason)) return `通过规则${id}未命中`;
    return '其他';
}

function runCase(name, cfg, ctx, pooled) {
    const adminToken = ctx.adminToken;
    const st = { name, subs: [], gen: 0, roundNo: 0, inRound: false, selfBase: 0, selfRoundBase: 0, lastApplyAt: 0, log: [], dataErr: [], warn: [], recIssues: [],
                 phases: [], seenOrders: new Set(), pending: {}, arrivals: {}, known: {}, dupOrders: 0, dupAccts: new Set(), token: null, loginAt: 0, wheelCode: '', normalCode: '', reset: false, trail: [] };

    // ---- 账号 ----
    if (cfg.acct.type === 'new') {
        let reg = null;
        for (let a = 1; a <= 3 && !reg; a++) {
            const phone = generateRandomPhone(ctx.countryCode);
            const t = extractToken(phoneRegister(phone, ctx.adminData, PWD, '', null, generateCryptoRandomString(16), ''));
            const info = t ? getFrontUserInfo(t) : null;
            if (info && info.userId) reg = { account: phone, token: t, userId: info.userId, normalCode: info.inviteCode || '' };
            else sleep(2 + a);
        }
        if (!reg) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '?', ok: false, error: '新总代注册失败(注册总代是否又要求邀请码？)', phases: [] }); return; }
        Object.assign(st, reg, { isNew: true, loginAt: Date.now(), pkg: 0, histBefore: { pass: 0, rej: 0, pending: 0, total: 0 } });
        T(st, `前台注册新总代(官网渠道，无邀请码) 手机号=${reg.account} 密码=${PWD} → userId=${reg.userId}，成功领取轮次=0`);
    } else {
        if (!pooled) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '-', ok: false, error: '无符合条件的账号(已核实提现历史)', phases: [] }); return; }
        const lg = loginOrReset(adminToken, pooled.account, pooled.userId);
        if (!lg.token) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: pooled.userId, account: pooled.account, ok: false, error: '登录失败(改密码后仍失败)', phases: [] }); return; }
        // 开跑前再核实一次提现历史(防止挑号后状态变化)
        const s = summarize(fetchHistory(adminToken, pooled.userId));
        const why = poolMatch(cfg.acct, s, pooled.pkg) || (cfg.acct.rejOnly && !(s.rej > 0 && s.pass === 0) ? '已不是只有拒绝' : '');
        if (why) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: pooled.userId, account: pooled.account, ok: false, error: `开跑前复核不符：${why}`, phases: [] }); return; }
        const cum = cumOf(adminToken, pooled.userId);
        Object.assign(st, { account: pooled.account, userId: pooled.userId, token: lg.token, loginAt: Date.now(), reset: lg.reset, pkg: pooled.pkg, histBefore: s, isNew: false });
        T(st, `使用老账号 userId=${pooled.userId} 账号=${pooled.account}${lg.reset ? '(后台已改密码为' + PWD + ')' : ''} 渠道packageId=${pooled.pkg}；提现历史：通过${s.pass}/拒绝${s.rej}/审核中${s.pending}，上次通过完成时间=${fmtTs(s.lastPass)}，当前累计充值=${cum}`);
        // 起点：有通过 → 上次通过时的累计无法回溯，本人新增按「本用例内充值」计；从未通过 → 注册起全部历史
        st.selfBase = s.pass > 0 ? cum : 0;
        st.selfRoundBase = cum;
    }
    fetchHistory(adminToken, st.userId).forEach(r => st.seenOrders.add(r.orderNo));
    emit('U', { userId: st.userId });
    console.log(`[${TAG}] ${name} 总代 userId=${st.userId} account=${st.account} 渠道=${st.pkg} 成功轮次=${st.histBefore.pass}`);

    for (const step of cfg.steps) {
        if (!doStep(step, st, ctx)) break;
    }

    // ---- 提现历史复核：每个阶段的订单状态仍与观测一致；成功轮次增量 = 通过阶段数 ----
    const recs = fetchHistory(adminToken, st.userId);
    const after = summarize(recs);
    const byNo = {}; recs.forEach(r => { byNo[r.orderNo] = r; });
    const histIssues = [];
    for (const p of st.phases) {
        if (!p.orderNo) continue;
        const r = byNo[p.orderNo];
        const now = r ? stateName(Number(r.auditState)) : '查无此单';
        p.histNow = now;
        if (now !== p.actual) histIssues.push(`${p.orderNo} 观测=${p.actual} 历史=${now}`);
    }
    const passes = st.phases.filter(p => p.actual === 'pass').length;
    if (after.pass !== st.histBefore.pass + passes) histIssues.push(`成功轮次 ${st.histBefore.pass}+${passes}≠历史${after.pass}`);

    if (st.dupOrders) st.warn.push(`充值通道每次下单会另生成一张已取消的订单，共${st.dupOrders}张(涉及${st.dupAccts.size}个账号，未补单，不计入统计)`);
    const phasesOk = st.phases.length > 0 && st.phases.every(p => p.actual === p.expect);
    const ok = !st.dataErr.length && !histIssues.length && phasesOk;
    const trail = st.trail.length > 160 ? [...st.trail.slice(0, 120), `…(省略${st.trail.length - 150}步)…`, ...st.trail.slice(-30)] : st.trail;
    emit('A', {
        name, batch: BATCH, desc: cfg.desc, userId: st.userId, account: st.account, pkg: st.pkg, reset: st.reset,
        roundBefore: st.histBefore.pass, roundAfter: after.pass, phases: st.phases, log: st.log,
        dataErr: st.dataErr, warn: st.warn, recIssues: st.recIssues, trail, histOk: !histIssues.length, histIssues, ok,
    });
}

function doStep(step, st, ctx) {
    const [op, a1, a2, a3, a4] = step;
    const adminToken = ctx.adminToken;
    switch (op) {
        case 'round': {
            const spin = clickSpinInvitedWheel(agentToken(st));
            if (spin && spin.success) T(st, `总代点击4个礼物盒开启转盘(首转98%~99%，之后邀请自动旋转) isFirst=${spin.isFirstInvitedWheel}`);
            else {
                const w = getUserInvitedWheelInfo(agentToken(st));
                if (w && w.success && w.userWheelAmount > 0) T(st, `点礼物盒未成功，但转盘已有金额${w.userWheelAmount}(本轮进行中、还没点提现)，继续`);
                else { st.dataErr.push('点礼物盒失败'); return false; }
            }
            // 组一本轮从点礼物盒开始：本轮编号+1，本轮本人充值以此刻累计为基线
            st.roundNo++;
            st.inRound = true;
            st.selfRoundBase = cumOf(adminToken, st.userId);
            sleep(3);
            st.log.push('点礼物盒');
            return doStep(['code'], st, ctx);
        }
        case 'code': {
            const share = clickShareLink(agentToken(st));
            if (!share || !share.success || !share.inviteCode) { st.dataErr.push('拿邀请码失败'); return false; }
            st.wheelCode = share.inviteCode.slice(0, -1) + 'W';
            T(st, `总代获取邀请链接，转盘邀请码=${st.wheelCode}`);
            return true;
        }
        case 'invite': {
            const [n, each, tag, opts] = [a1, a2, a3, a4 || {}];
            if (!st.wheelCode && !doStep(['code'], st, ctx)) return false;
            if (opts.code === 'N' && !st.normalCode) { const info = getFrontUserInfo(agentToken(st)); st.normalCode = (info && info.inviteCode) || ''; }
            const code = opts.code === 'N' ? st.normalCode : st.wheelCode;
            if (!code) { st.dataErr.push(`取${opts.code === 'N' ? '普通' : '转盘'}邀请码失败`); return false; }
            let got = 0;
            for (let i = 0; i < n; i++) {
                const sub = registerSub(ctx, code);
                if (!sub) continue;
                Object.assign(sub, { tag, gen: st.gen, roundNo: st.inRound ? st.roundNo : null, regAt: Date.now(), code: opts.code === 'N' ? 'N' : 'W' });
                st.subs.push(sub);
                T(st, `用${opts.code === 'N' ? '普通码' : '转盘码'}${code}注册下级[${tag}] 手机号=${sub.phone} 密码=${PWD} → userId=${sub.userId}${st.gen > 0 ? '（上次通过之后注册=新增下级）' : ''}`);
                if (each > 0) frontRecharge(st, ctx, { sub }, each);
                if (opts.unpaid && i === 0) {
                    const unpaid = placeOrders(subToken(sub), opts.unpaid, st, `下级[${tag}]${sub.userId}`, sub.userId, ctx);
                    const placed = unpaid.reduce((s2, o) => s2 + Number(o.amount), 0);
                    T(st, `下级${sub.userId} 前台商品下单${placed}(${unpaid.map(o => o.orderNo).join(',')})但不支付(不补单，订单保持待支付)`);
                    if (placed < opts.unpaid) st.dataErr.push(`未支付订单只下到${placed}<${opts.unpaid}`);
                }
                got++;
                sleep(n > 5 ? 0.5 : 1);
            }
            st.log.push(`邀请[${tag}] ${got}/${n}人${opts.code === 'N' ? '(普通码)' : ''} 各充${each}`);
            if (got < n) st.warn.push(`下级[${tag}]只注册成功${got}/${n}`);
            return got > 0;
        }
        case 'self':
            frontRecharge(st, ctx, { self: true }, a1, st.wheelCode ? '' : '此时还没点礼物盒');
            st.log.push(`本人充值${a1}`);
            return true;
        case 'selfNewTo': topUpTo('self', a1, st, ctx); return true;
        case 'subsTo': topUpTo('subs', a1, st, ctx); return true;
        case 'roundSubsTo': topUpTo('round', a1, st, ctx); return true;
        case 'topTag': {
            const s = st.subs.find(x => x.tag === a1);
            if (!s) { st.dataErr.push(`无[${a1}]下级可充`); return false; }
            frontRecharge(st, ctx, { sub: s }, a2);
            st.log.push(`给[${a1}]下级${s.userId}充${a2}${s.gen === st.gen ? '' : '(老下级)'}`);
            return true;
        }
        case 'order': {
            const [who, amt, key] = [a1, a2, a3];
            const sub = who === 'self' ? null : st.subs.find(x => x.tag === who);
            if (who !== 'self' && !sub) { st.dataErr.push(`无[${who}]下级可下单`); return false; }
            const uid = sub ? sub.userId : st.userId;
            const orders = placeOrders(sub ? subToken(sub) : agentToken(st), amt, st, sub ? `下级[${who}]${uid}` : `总代${uid}`, uid, ctx);
            const placed = orders.reduce((s2, o) => s2 + Number(o.amount), 0);
            st.pending[key] = { uid, amount: placed, orders };
            T(st, `${sub ? '下级[' + who + ']' : '总代'}${uid} 前台商品下单${placed}(${orders.map(o => o.orderNo).join(',')})，暂不到账(订单待支付) 记为${key}`);
            return placed > 0;
        }
        case 'arrive': {
            const p = st.pending[a1];
            if (!p) { st.dataErr.push(`无待到账订单 ${a1}`); return false; }
            const arr = arriveOrders(ctx, p.uid, p.orders);
            st.arrivals[a1] = arr;
            T(st, `后台补单：${a1}(userId=${p.uid} 单号${arr.orderNos.join(',')}) 到账${arr.amount}，服务端到账时间=${fmtTs(arr.payTime)}`);
            if (arr.amount !== p.amount) st.dataErr.push(`${a1} 应到账${p.amount} 实际${arr.amount}`);
            return true;
        }
        case 'wheelFull': {
            const w = waitWheelFull(st);
            T(st, `转盘自动旋转${w.full ? '已转满' : '未转满'}：${w.info ? w.info.userWheelAmount : '?'}/${w.info ? w.info.totalPrizeAmount : '?'}（不点提现，继续邀请）`);
            if (!w.full) st.warn.push('wheelFull 步骤转盘未满');
            return true;
        }
        case 'apply': return doApply(a1, a2 || {}, st, ctx);
        default: st.dataErr.push(`未知步骤 ${op}`); return false;
    }
}

/** 申请提现 → 轮询提现历史里「新出现的那一单」直到 通过/拒绝 → 记录阶段结果 */
function doApply(expectIn, opts, st, ctx) {
    const adminToken = ctx.adminToken;
    const round = st.histBefore.pass + st.phases.filter(p => p.actual === 'pass').length;
    const phase = { idx: st.phases.length + 1, expect: typeof expectIn === 'function' ? '(动态)' : expectIn, round, rule: expectedRule(st.pkg, round) };

    // 1) 等自动旋转转满 500
    const w = waitWheelFull(st);
    if (!w.full) {
        phase.actual = `未提现(转盘${w.info ? w.info.userWheelAmount : '?'}未满${w.info ? w.info.totalPrizeAmount : '?'})`;
        st.phases.push(phase);
        st.dataErr.push(`第${phase.idx}次：等${WHEEL_WAIT}s转盘仍未转满，无法提现${opts.mayNotFull ? '（只邀请2人时首转偏低可能转不满，重跑即可）' : ''}`);
        return false;
    }
    // 2) 申请前核对（now=到账后立即申请：先申请，申请后再量）
    let snap = opts.now ? null : snapshot(st, ctx);
    if (snap) T(st, `申请前核对：本人累计=${snap.selfCum} 本人新增=${snap.selfNew} 新增下级${snap.newSubCount}人合计=${snap.subNew} | 本轮本人=${snap.roundSelf} 本轮下级${snap.roundSubCount}人=${snap.roundSub} | 成功轮次=${round} 应匹配规则=${phase.rule}`);

    // 3) 点提现 = 本轮结束
    const wd = clickWheelWithdraw(w.info.userWheelAmount, agentToken(st));
    phase.applyAt = Date.now();
    T(st, `总代申请转盘提现(/api/Activity/SumitInvitedWheelWithdraw) 金额=${w.info.userWheelAmount} → ${wd && wd.success ? '提交成功' : '失败 ' + (wd && wd.msg)}`);
    if (!wd || !wd.success) { phase.actual = `提现失败(${wd && wd.msg})`; st.phases.push(phase); st.dataErr.push(`第${phase.idx}次提现失败 ${wd && wd.msg}`); return false; }
    st.lastApplyAt = phase.applyAt;
    st.inRound = false;   // 点提现 = 组一本轮结束；到下次点礼物盒之前邀请的下级不属于任何一轮

    for (const s of opts.after || []) doStep(s, st, ctx); // 申请后、审核前的动作(验证终点)

    // 4) 等审核结果
    let rec = null;
    const deadline = Date.now() + AUDIT_WAIT * 1000;
    while (Date.now() < deadline) {
        sleep(opts.now ? 3 : 8);
        const fresh = fetchHistory(adminToken, st.userId).filter(r => !st.seenOrders.has(r.orderNo));
        if (fresh.length) { rec = fresh[0]; if ([2, 3].includes(Number(rec.auditState))) break; }
    }
    if (rec) st.seenOrders.add(rec.orderNo);
    if (!snap) { snap = snapshot(st, ctx); T(st, `(到账后立即申请，申请后补量) 本人新增=${snap.selfNew} 新增下级${snap.newSubCount}人合计=${snap.subNew}`); }
    Object.assign(phase, snap);
    phase.orderNo = rec ? rec.orderNo : '';
    phase.actual = rec ? stateName(Number(rec.auditState)) : '查无新订单';
    phase.reason = rec ? (rec.reason || '') : '';
    phase.src = phase.actual === 'reject' ? reasonSource(phase.reason) : '';
    phase.roundNum = rec ? rec.invitedWheelRoundNum : '';
    phase.applyMs = rec ? Number(rec.createTime) : 0;
    phase.completionMs = rec ? Number(rec.completionTime) : 0;
    phase.completionTime = rec ? fmtTs(rec.completionTime) : '';

    // 5) 动态预期(到账时间类)
    if (typeof expectIn === 'function') {
        const e = expectIn(st, phase);
        phase.expect = e.expect;
        phase.expectNote = e.note;
        T(st, `动态预期：${e.note} → 预期=${e.expect}`);
    }
    // 6) 拒绝来源校验：by='rule' 须被拒绝规则拦；否则被拒绝规则拦 = 造数误触发，验证无效
    if (phase.actual === 'reject' && phase.expect === 'reject') {
        const byRule = phase.src.startsWith('拒绝规则');
        if (opts.by === 'rule' && !byRule) st.dataErr.push(`第${phase.idx}次应由拒绝规则拦截，实际来源=${phase.src}`);
        if (opts.by !== 'rule' && byRule) st.dataErr.push(`第${phase.idx}次被${phase.src}拦截(非组条件判定，验证无效)`);
    }
    // 7) 提现记录邀请人数核对（本轮=本轮点礼物盒之后邀请的，仅新号）
    if (rec && st.isNew) {
        const expRound = st.subs.filter(s => s.roundNo === st.roundNo && s.regAt < phase.applyAt).length;
        const expTotal = st.subs.filter(s => s.regAt < phase.applyAt).length;
        phase.recInvited = rec.invitedUserCount; phase.recTotalInvited = rec.totalInvitedUserCount;
        phase.expInvited = expRound; phase.expTotalInvited = expTotal;
        if (Number(rec.invitedUserCount) !== expRound || Number(rec.totalInvitedUserCount) !== expTotal)
            st.recIssues.push(`第${phase.idx}次 记录本轮邀请=${rec.invitedUserCount}(应为${expRound}) 累计邀请=${rec.totalInvitedUserCount}(应为${expTotal})`);
    }
    st.phases.push(phase);
    T(st, `后台转盘提现记录 单号=${phase.orderNo || '-'} 审核结果=${phase.actual}${phase.src ? '（' + phase.src + '）' : ''} 申请=${fmtTs(phase.applyMs)} 完成=${phase.completionTime || '-'} 本轮邀请=${rec ? rec.invitedUserCount : '-'} 累计邀请=${rec ? rec.totalInvitedUserCount : '-'}（预期=${phase.expect}）`);
    console.log(`[${TAG}] ${st.name} 第${phase.idx}次申请 本人新增=${phase.selfNew} 新增下级=${phase.subNew} 预期=${phase.expect} 实际=${phase.actual} 单号=${phase.orderNo}`);

    // 8) 通过则组三起点移到本次(completionTime)，现有下级全部变老下级（组一基线在下次点礼物盒时重置）
    const cumNow = cumOf(adminToken, st.userId);
    if (phase.actual === 'pass') {
        st.gen++;
        st.selfBase = cumNow;
        st.lastPass = phase.completionTime;
    }
    return true;
}
