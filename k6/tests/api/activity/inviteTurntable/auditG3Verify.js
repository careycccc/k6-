/**
 * 邀请转盘 · 出款自动审核「通过规则 条件组三(新增)」验证 —— 按配置批次跑，一用例一账号并发
 *
 * 判定：拒绝规则优先 → 按「渠道+轮次」匹配唯一通过规则(优先指定渠道，不降级) →
 *       组一(本轮) 或 组二(累计) 或 组三(新增)，任一命中即通过，否则拒绝；组三是组一/组二的补充。
 *
 * 组三口径：
 *   - 统计起点 = 上一次成功领取(auditState=2)的 completionTime；从未成功领取(新号/只有拒绝的老号) = 注册时间(全部历史)
 *   - 统计终点 = 本次申请时间(申请后才发生的充值不算)
 *   - 新增下级 = 起点之后通过邀请注册的下级；老下级之后再充也不算
 *   - 被拒不重置起点：被拒后本轮结束，下一轮开始前 / 开始后下级的充值都继续累计
 *   - 邀请人新增充值 = 起点~终点 本人成功充值
 *
 * 批次(每批改一次规则 → 等 CONFIG_WAIT(30s) → 并发跑该批用例)：
 *   CH   渠道×轮次(老账号，先核实提现历史)      AND  组三「且」
 *   OFF  组三不勾                              ALL  三组全开(组三补充)
 *   OR   组三「或」核心逻辑 + 跨轮累计 + 拒绝优先 + 跨天手动造数(最后一批，跑完配置保留给手动验证)
 *   RESTORE  把 3 条通过规则恢复成原始配置
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
import { hybridRecharge, backendRecharge } from '../../recharge/rechargeService.js';
import { goodsDepositRecharge } from '../../recharge/frontendRechargeApi.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';

const TAG = 'AuditG3';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const BATCH = (__ENV.BATCH || 'OR').toUpperCase();
const PWD = 'qwer1234';
const CONFIG_WAIT = parseInt(__ENV.CONFIG_WAIT || '30', 10);   // 改规则后等生效
const AUDIT_WAIT = parseInt(__ENV.AUDIT_WAIT || '120', 10);    // 提现后最多等自动审核秒数(轮询)
const SUB_CUM_WAIT = parseInt(__ENV.SUB_CUM_WAIT || '15', 10); // 查充值累计前等待(统计延迟)
const SUB_BASE = parseInt(__ENV.SUB_BASE || '100', 10);        // 每轮邀请下级的基础充值(产生转盘奖金)
const HIST_START = __ENV.HIST_START || '2026-01-01';           // 核实账号时查提现历史的起始日
const SCAN_START = __ENV.SCAN_START || monthStart();           // 找「只有拒绝」老号：扫提现记录的起始日(默认本月)
const POOL_PAGES = parseInt(__ENV.POOL_PAGES || '10', 10);     // 会员列表最多翻几页(每页20)
const EXCLUDE_IDS = new Set((__ENV.EXCLUDE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

// 组三阈值(批次 OR/AND/OFF/ALL 用)：X=邀请人新增充值  Y=新增下级充值合计
const X = parseInt(__ENV.G3_X || '2000', 10);
const Y = parseInt(__ENV.G3_Y || '5000', 10);
const CH_X = parseInt(__ENV.CH_X || '3000', 10);               // 渠道批次只用「本人新增」判定，下级阈值拉满
const HUGE = 99999999;

// ================= 渠道 =================
const PKG = { official: 0, agent: 1, wheel: 2, carey: 100051 };
const SPECIFIC_PKGS = [PKG.carey, PKG.agent, PKG.wheel]; // 生产配置里有指定渠道规则的渠道

// ================= 规则原始配置(恢复用，来自后台) =================
const REASON_48 = { zh: '0', ru: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.', es: '-', hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.1', pt: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.1', ur: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.' };
const REASON_49 = { hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.2', ur: '8', es: '8', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.2', pt: '8', ru: '8', zh: '8' };
const REASON_50 = { pt: '9', hi: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.3', zh: '9', es: '9', en: 'If the conditions are met, the application is automatically approved; if not, it is automatically rejected.3', ur: '9', ru: '9' };
const RULE_IDS = { r48: 300048, r49: 300049, r50: 300050 };
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
const BATCH_CONFIG = {
    // 渠道×轮次：保持生产结构(48全部=0 / 49 carey>0 / 50 agent+wheel>1)，只开组三，只靠「本人新增≥CH_X」判定
    CH: {
        300048: { round: ['=', 0], pkgs: [], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
        300049: { round: ['>', 0], pkgs: [PKG.carey], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
        300050: { round: ['>', 1], pkgs: [PKG.agent, PKG.wheel], g1: OFF1, g2: OFF2, g3: G(CH_X, 'or', HUGE) },
    },
    AND: g3Batch(OFF1, OFF2, G(X, 'and', Y)),
    OFF: g3Batch(G(300, 'and', 2000), G(999999, 'and', 999999), G(X, 'or', Y, false)),
    ALL: g3Batch(G(300, 'and', 2000), G(1000, 'and', 1000), G(X, 'or', Y)),
    OR: g3Batch(OFF1, OFF2, G(X, 'or', Y)),
    RESTORE: ORIGINAL,
};

// ================= 用例 =================
// acct: {type:'new'} 新注册官网总代 | {type:'pool', pool, pass:{eq|min}, rejOnly, cum:{lt|gte}}
// steps: ['round'] 点礼物盒开本轮 | ['code'] 仅拿邀请码 | ['invite', n, each, tag, opts] 邀请n个下级各充each(0不充)
//        ['self', amt] 本人充值 | ['selfNewTo', t] 本人新增补到正好t | ['subsTo', t] 新增下级合计补到正好t
//        ['topTag', tag, amt] 给某批(tag)第一个下级充 | ['apply', expect, afterSteps] 申请提现并核对
//        ['manual', kind] 跨天手动：输出明天要充多少
const CASES = {
    // ---------- 批次 CH：渠道×轮次(老账号，核实提现历史后使用) ----------
    CH_new_r0:       { batch: 'CH', acct: { type: 'new' }, desc: '新注册官网总代首次申请(成功轮次0)，本人新增≥X → 应匹配规则48(全部/轮次=0) → 通过',
                       steps: [['round'], ['invite', 3, SUB_BASE, 'r'], ['self', CH_X + 100], ['apply', 'pass']] },
    CH_carey_r0:     { batch: 'CH', acct: { type: 'pool', pool: 'carey', pass: { eq: 0 } }, desc: 'carey 轮次0(从未成功)，本人新增≥X → 渠道锁定规则49(轮次>0)不降级 → 拒绝',
                       steps: [['self', CH_X + 100], ['round'], ['invite', 3, SUB_BASE, 'r'], ['apply', 'reject']] },
    CH_carey_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'carey', pass: { min: 1 } }, desc: 'carey 轮次≥1 命中规则49，本人新增≥X → 通过',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'pass']] },
    CH_agent_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'agent', pass: { eq: 1 } }, desc: 'agent 轮次=1，规则50要>1 → 拒绝(不降级)',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'reject']] },
    CH_agent_r2:     { batch: 'CH', acct: { type: 'pool', pool: 'agent', pass: { min: 2 } }, desc: 'agent 轮次≥2 命中规则50，本人新增≥X → 通过',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'pass']] },
    CH_wheel_r1:     { batch: 'CH', acct: { type: 'pool', pool: 'wheel', pass: { eq: 1 } }, desc: 'wheel 轮次=1，规则50要>1 → 拒绝',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'reject']] },
    CH_wheel_r2:     { batch: 'CH', acct: { type: 'pool', pool: 'wheel', pass: { min: 2 } }, desc: 'wheel 轮次≥2 命中规则50 → 通过',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'pass']] },
    CH_official_r1:  { batch: 'CH', acct: { type: 'pool', pool: 'official', pass: { min: 1 } }, desc: 'official 轮次≥1 无匹配规则(48只管轮次0) → 拒绝',
                       steps: [['round'], ['self', CH_X + 100], ['invite', 3, SUB_BASE, 'r'], ['apply', 'reject']] },
    CH_rejOnly_eq:   { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gt: 0, lt: CH_X - 1 } }, desc: '只有拒绝的老号(起点=注册)：历史充值+补充=正好X → 通过(历史充值算新增)',
                       steps: [['round'], ['invite', 3, SUB_BASE, 'r'], ['selfNewTo', CH_X], ['apply', 'pass']] },
    CH_rejOnly_lt:   { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gt: 0, lt: CH_X - 1 } }, desc: '只有拒绝的老号：历史充值+补充=X-1 → 拒绝',
                       steps: [['round'], ['invite', 3, SUB_BASE, 'r'], ['selfNewTo', CH_X - 1], ['apply', 'reject']] },
    CH_rejOnly_hist: { batch: 'CH', acct: { type: 'pool', pool: 'rejOnly', rejOnly: true, cum: { gte: CH_X } }, desc: '只有拒绝的老号：历史累计已≥X，本轮本人不充 → 通过(全部历史都算新增)',
                       steps: [['round'], ['invite', 3, SUB_BASE, 'r'], ['apply', 'pass']] },

    // ---------- 批次 AND：组三「且」(组一组二不勾) ----------
    AND_both:     { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X 且 新增下级=Y → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X], ['subsTo', Y], ['apply', 'pass']] },
    AND_self_only:{ batch: 'AND', acct: { type: 'new' }, desc: '本人新增≥X，下级<Y → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X], ['apply', 'reject']] },
    AND_sub_only: { batch: 'AND', acct: { type: 'new' }, desc: '下级≥Y，本人新增<X → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['self', 101], ['subsTo', Y], ['apply', 'reject']] },
    AND_sub_lt:   { batch: 'AND', acct: { type: 'new' }, desc: '本人新增=X，下级=Y-1 → 拒绝(边界)',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X], ['subsTo', Y - 1], ['apply', 'reject']] },

    // ---------- 批次 OFF：组三不勾(组一 300且2000，组二不可达) ----------
    OFF_g3data:   { batch: 'OFF', acct: { type: 'new' }, desc: '组三不勾，数据只满足组三(下级≥Y，本人不充) → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'reject']] },
    OFF_g1_ctrl:  { batch: 'OFF', acct: { type: 'new' }, desc: '对照：满足组一(本轮本人300 且 下级≥2000) → 通过',
                    steps: [['round'], ['self', 300], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', 2100], ['apply', 'pass']] },

    // ---------- 批次 ALL：三组全开，组三为补充(组一300且2000 / 组二1000且1000 / 组三 X或Y) ----------
    ALL_only_g1:  { batch: 'ALL', acct: { type: 'new' }, desc: '只命中组一(本轮本人300 且 下级≥2000；累计人300<1000) → 通过',
                    steps: [['round'], ['self', 300], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', 2100], ['apply', 'pass']] },
    ALL_only_g2:  { batch: 'ALL', acct: { type: 'new' }, desc: '只命中组二(开轮前本人1000 → 本轮人0；下级1100) → 通过',
                    steps: [['self', 1000], ['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', 1100], ['apply', 'pass']] },
    ALL_only_g3:  { batch: 'ALL', acct: { type: 'new' }, desc: '组一组二都不中(本人0)，组三下级≥Y → 通过(组三补充)',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass']] },
    ALL_none:     { batch: 'ALL', acct: { type: 'new' }, desc: '三组都不中(本人101，下级基础充值) → 拒绝',
                    steps: [['round'], ['self', 101], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject']] },

    // ---------- 批次 OR：组三「或」核心 ----------
    OR_sub_eq:    { batch: 'OR', acct: { type: 'new' }, desc: '新增下级合计=Y(边界) → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y], ['apply', 'pass']] },
    OR_sub_lt:    { batch: 'OR', acct: { type: 'new' }, desc: '新增下级合计=Y-1 → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y - 1], ['apply', 'reject']] },
    OR_self_eq:   { batch: 'OR', acct: { type: 'new' }, desc: '本人新增=X(边界) → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X], ['apply', 'pass']] },
    OR_self_lt:   { batch: 'OR', acct: { type: 'new' }, desc: '本人新增=X-1，下级基础充值 → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X - 1], ['apply', 'reject']] },
    OR_none:      { batch: 'OR', acct: { type: 'new' }, desc: '两项都不达标 → 拒绝',
                    steps: [['round'], ['self', 101], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject']] },
    OR_pre_round_self: { batch: 'OR', acct: { type: 'new' }, desc: '新号点礼物盒前本人充X(起点=注册，不是开轮) → 通过',
                    steps: [['self', X + 50], ['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'pass']] },
    OR_unpaid:    { batch: 'OR', acct: { type: 'new' }, desc: '新下级只下单不支付(金额≥Y) → 不算成功充值 → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1', { unpaid: Y + 100 }], ['apply', 'reject']] },
    OR_after_apply: { batch: 'OR', acct: { type: 'new' }, desc: '申请后(审核前)下级再充≥Y → 终点是申请时间，不算 → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject', [['topTag', 'r1', Y + 100]]]] },
    OR_old_sub_excl: { batch: 'OR', acct: { type: 'new' }, desc: '通过后老下级再充≥Y，新下级只有基础充值 → 老下级不算 → 拒绝(起点已重置)',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'],
                            ['topTag', 'r1', Y + 100], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'reject']] },
    OR_old_new_mix: { batch: 'OR', acct: { type: 'new' }, desc: '通过后老下级再充≥Y，新下级合计正好=Y → 只算新下级 → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'],
                            ['topTag', 'r1', Y + 100], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['subsTo', Y], ['apply', 'pass']] },
    OR_old_self_excl: { batch: 'OR', acct: { type: 'new' }, desc: '通过后本人新增=X-1(总累计远超X) → 通过前的本人充值不算 → 拒绝',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['selfNewTo', X + 100], ['apply', 'pass'],
                            ['round'], ['invite', 3, SUB_BASE, 'r2'], ['selfNewTo', X - 1], ['apply', 'reject']] },
    OR_pre_round_sub: { batch: 'OR', acct: { type: 'new' }, desc: '通过后、下一轮开始前邀请的下级也算新增(充≥Y) → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'],
                            ['code'], ['invite', 1, 0, 'pre'], ['topTag', 'pre', Y + 100], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'pass']] },
    // 被拒后跨轮累计：补充金额 = Y(单独就够)，不补时各轮基础充值合计 < Y → 结果能区分「算/不算」
    X_before_next: { batch: 'OR', acct: { type: 'new' }, desc: '被拒后、下一轮开始前，上轮下级补充值 → 下一轮申请累计 → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject'],
                            ['topTag', 'r1', Y], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'pass']] },
    X_after_next:  { batch: 'OR', acct: { type: 'new' }, desc: '被拒后、下一轮开始后，上轮下级补充值 → 累计 → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject'],
                            ['round'], ['topTag', 'r1', Y], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'pass']] },
    X_both:        { batch: 'OR', acct: { type: 'new' }, desc: '下一轮开始前/后各补一半(单独一半不够) → 两段都算 → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject'],
                            ['topTag', 'r1', Math.ceil(Y / 2)], ['round'], ['topTag', 'r1', Math.ceil(Y / 2)], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'pass']] },
    X_multi:       { batch: 'OR', acct: { type: 'new' }, desc: '连续被拒2轮，第3轮把全部新增补到正好Y(第3轮单独<Y) → 通过',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject'],
                            ['round'], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'reject'],
                            ['round'], ['invite', 3, SUB_BASE, 'r3'], ['subsTo', Y], ['apply', 'pass']] },
    X_reject_new_multi: { batch: 'OR', acct: { type: 'new' }, desc: '被拒后下一轮只新增基础充值(累计仍<Y) → 仍拒绝，起点不重置不会凭空满足',
                    steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['apply', 'reject'],
                            ['round'], ['invite', 3, SUB_BASE, 'r2'], ['apply', 'reject']] },
    // 拒绝优先(组三满足也拒)
    REJ3_priority: { batch: 'OR', acct: { type: 'new' }, rejectBy: 'rule', desc: '组三满足(下级≥Y)，但本人累计50<100 且 总邀请2<3 → 命中拒绝3 → 拒绝',
                    steps: [['self', 50], ['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'reject']] },
    REJ1_priority: { batch: 'OR', acct: { type: 'new' }, rejectBy: 'rule', desc: '组三满足，但本人未首充 且 最近被邀请人未首充 → 命中拒绝1 → 拒绝',
                    steps: [['round'], ['invite', 2, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['invite', 1, 0, 'last'], ['apply', 'reject']] },
    // 跨天手动：今天造好「通过 + 新一轮 + 新下级」，明天你手动充值后申请
    M_eq:   { batch: 'OR', acct: { type: 'new' }, desc: '【跨天手动】明天给新下级充到新增合计正好=Y → 申请 → 预期通过',
              steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['manual', 'eq']] },
    M_lt:   { batch: 'OR', acct: { type: 'new' }, desc: '【跨天手动】明天给新下级充到新增合计=Y-1 → 申请 → 预期拒绝',
              steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['manual', 'lt']] },
    M_old:  { batch: 'OR', acct: { type: 'new' }, desc: '【跨天手动】明天只给老下级(上次通过前的)充Y → 申请 → 预期拒绝',
              steps: [['round'], ['invite', 3, SUB_BASE, 'r1'], ['subsTo', Y + 100], ['apply', 'pass'], ['round'], ['invite', 3, SUB_BASE, 'r2'], ['manual', 'old']] },
};

const BATCH_CASES = Object.keys(CASES).filter(k => CASES[k].batch === BATCH);
const CASE_LIST = (__ENV.CASES ? __ENV.CASES.split(',').map(s => s.trim()).filter(k => CASES[k] && CASES[k].batch === BATCH) : BATCH_CASES);

export const options = {
    setupTimeout: '30m',
    scenarios: { g3: { executor: 'per-vu-iterations', vus: Math.max(CASE_LIST.length, 1), iterations: 1, maxDuration: '90m' } },
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
        packageIds: r.pkgs, id, state: 1, rejectReason: REASONS[id],
    };
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
    return `${id} 轮次${r.round[0]}${r.round[1]} 渠道=${ch} ${g('一', r.g1)} ${g('二', r.g2)} ${g('三', r.g3)}`;
}
/** 按「渠道+轮次」算本次应匹配的规则(优先指定渠道，锁定后不降级)；返回规则文本 */
function expectedRule(pkg, round) {
    const cfg = BATCH_CONFIG[BATCH] || {};
    const roundOk = (r) => r.round[0] === '=' ? round === r.round[1] : r.round[0] === '>' ? round > r.round[1] : r.round[0] === '>=' ? round >= r.round[1] : round < r.round[1];
    const ids = Object.keys(cfg);
    const specific = ids.find(id => cfg[id].pkgs.includes(Number(pkg)));
    if (specific) return `${ruleText(specific, cfg[specific])}${roundOk(cfg[specific]) ? '' : `（渠道锁定此规则，但轮次${round}不满足→应拒绝）`}`;
    const all = ids.find(id => !cfg[id].pkgs.length && roundOk(cfg[id]));
    return all ? ruleText(all, cfg[all]) : `无匹配规则(渠道${pkg} 轮次${round})→应拒绝`;
}
function applyBatchConfig(adminToken, batch) {
    const cfg = BATCH_CONFIG[batch];
    if (!cfg) throw new Error(`[${TAG}] 未知批次 ${batch}`);
    let ok = true;
    if (batch !== 'RESTORE') for (const rr of REJECT_RULES) ok = updateRule(adminToken, rr) && ok;
    const lines = [];
    for (const id of Object.keys(cfg)) {
        ok = updateRule(adminToken, passRulePayload(Number(id), cfg[id])) && ok;
        lines.push(ruleText(id, cfg[id]));
    }
    emit('C', { batch, ok, rules: lines });
    if (!ok) throw new Error(`[${TAG}] 批次 ${batch} 规则配置失败，终止`);
    console.log(`[${TAG}] 批次 ${batch} 规则已更新，等待 ${CONFIG_WAIT}s 生效...`);
    sleep(CONFIG_WAIT);
}

// ================= 后台：会员 / 提现历史 =================
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

// ================= Setup =================
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(adminToken);

    // 先挑账号再改配置（挑号不依赖配置；改完配置立即等 30s 后开跑）
    const assigned = {};
    const used = new Set();
    for (const name of CASE_LIST) {
        const need = CASES[name].acct;
        if (need.type !== 'pool') continue;
        const c = need.rejOnly ? pickRejectOnly(adminToken, need, used) : pickFromMemberList(adminToken, need, used);
        if (c) { used.add(String(c.userId)); assigned[name] = c; console.log(`[${TAG}] ${name} ← userId=${c.userId} 渠道=${c.pkg} 成功轮次=${c.hist.pass} 拒绝=${c.hist.rej} 累计=${c.cum}`); }
        else console.error(`[${TAG}] ${name} 找不到符合条件的账号`);
    }
    applyBatchConfig(adminToken, BATCH);
    return { adminToken, envConfig, assigned };
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
    const { adminToken, envConfig, assigned } = data;
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
/** 前台 token 约 55s 失效：超过 40s 就重登 */
function agentToken(st) {
    if (!st.token || Date.now() - st.loginAt > 40000) {
        st.token = login(st.account);
        st.loginAt = Date.now();
    }
    return st.token;
}
function registerSub(st, ctx) {
    for (let a = 1; a <= 5; a++) {
        const phone = generateRandomPhone(ctx.countryCode);
        const res = phoneRegisterByInvite(phone, st.wheelCode, ctx.adminData, PWD, '', ctx.customUrls, generateCryptoRandomString(16), '');
        const token = extractToken(res);
        if (token) { const info = getFrontUserInfo(token); if (info && info.userId) return { phone, token, userId: info.userId }; }
        sleep(3 + a * 3 + Math.random() * 3); // Too frequent access：拉开退避
    }
    return null;
}
/** 商品模式下只下单不支付(留 Wait)，挑面额最大的商品，下到金额合计 ≥ target；返回已下单金额 */
function makeUnpaid(userToken, target) {
    const resp = sendRequest({}, '/api/Recharge/GetRechargeBasicInfo', TAG, true, userToken);
    const basic = resp && resp.goodsList !== undefined ? resp : (resp && resp.data) || null;
    const goods = (basic && Array.isArray(basic.goodsList) ? basic.goodsList : [])
        .map(g => ({ g, cats: (g.supportCategories || []).filter(c => !['ArUpi', 'ARPay'].includes(c.rechargeType)) }))
        .filter(x => x.cats.length).sort((a, b) => Number(b.g.rechargeAmount) - Number(a.g.rechargeAmount));
    if (!goods.length) return 0;
    const pick = goods[0];
    let made = 0;
    for (let k = 0; k < 8 && made < target; k++) {
        const r = goodsDepositRecharge(userToken, pick.g.id, pick.cats[0].id);
        if (!r || !(r.msgCode === 0 || r.code === 0)) break;
        made += Number(pick.g.rechargeAmount) || 0;
        sleep(2);
    }
    return made;
}
/** 由 reason 文案判断是哪条规则拒的：拒绝规则 / 通过规则(组条件未命中) */
function reasonSource(reason) {
    if (!reason) return '';
    for (const rr of REJECT_RULES) if (Object.values(rr.rejectReason).some(v => v && v.length > 3 && v === reason)) return `拒绝规则${rr.id}`;
    for (const id of Object.keys(REASONS)) if (Object.values(REASONS[id]).some(v => v && v.length > 3 && v === reason)) return `通过规则${id}未命中`;
    return '其他';
}
/** 窗口内(上次通过之后注册)的下级 */
function newSubs(st) { return st.subs.filter(s => s.gen === st.gen); }
function measureSubsNew(st, ctx) {
    sleep(SUB_CUM_WAIT);
    let sum = 0;
    for (const s of newSubs(st)) { sum += cumOf(ctx.adminToken, s.userId); sleep(0.3); }
    return sum;
}
function measureSelfNew(st, ctx) { sleep(3); return cumOf(ctx.adminToken, st.userId) - st.selfBase; }
/** 充值补到正好 target：量→补差→轮询等到账(统计有延迟，没到账不重复补)；超了记造数失败 */
function topUpTo(kind, target, st, ctx) {
    const measure = () => kind === 'self' ? measureSelfNew(st, ctx) : measureSubsNew(st, ctx);
    if (kind === 'subs' && !newSubs(st).length) { st.dataErr.push(`subsTo ${target}：窗口内无新增下级`); return; }
    let cur = measure();
    for (let a = 1; a <= 2 && cur < target; a++) {
        const delta = target - cur;
        const who = kind === 'self' ? st.userId : newSubs(st).slice(-1)[0].userId;
        backendRecharge(ctx.adminToken, who, delta, `AuditG3-${kind}To`);
        T(st, `后台人工充值给${kind === 'self' ? '总代' : '新增下级'} userId=${who} 金额=${delta}（把${kind === 'self' ? '本人新增' : '新增下级合计'}从${cur}补到${target}）`);
        for (let p = 1; p <= 10; p++) { cur = measure(); if (cur >= target) break; sleep(3); }
    }
    const ok = cur === target;
    st.log.push(`${kind === 'self' ? '本人新增' : '新增下级'}补到${target}→实测${cur}${ok ? '' : '(未精确,用例无效)'}`);
    if (!ok) st.dataErr.push(`${kind}To ${target} 实测 ${cur}`);
}

function runCase(name, cfg, ctx, pooled) {
    const adminToken = ctx.adminToken;
    const st = { name, subs: [], gen: 0, selfBase: 0, log: [], dataErr: [], warn: [], phases: [], seenOrders: new Set(), token: null, loginAt: 0, wheelCode: '', reset: false, rejectBy: cfg.rejectBy || 'group', trail: [] };

    // ---- 账号 ----
    if (cfg.acct.type === 'new') {
        let reg = null;
        for (let a = 1; a <= 3 && !reg; a++) {
            const phone = generateRandomPhone(ctx.countryCode);
            const t = extractToken(phoneRegister(phone, ctx.adminData, PWD, '', null, generateCryptoRandomString(16), ''));
            const info = t ? getFrontUserInfo(t) : null;
            if (info && info.userId) reg = { account: phone, token: t, userId: info.userId };
            else sleep(2 + a);
        }
        if (!reg) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '?', ok: false, error: '新总代注册失败', phases: [] }); return; }
        Object.assign(st, reg, { loginAt: Date.now(), pkg: 0, histBefore: { pass: 0, rej: 0, pending: 0, total: 0 } });
        T(st, `前台注册新总代(官网渠道，无邀请码) 手机号=${reg.account} 密码=${PWD} → userId=${reg.userId}，成功领取轮次=0`);
    } else {
        if (!pooled) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: '-', ok: false, error: '无符合条件的账号(已核实提现历史)', phases: [] }); return; }
        const lg = loginOrReset(adminToken, pooled.account, pooled.userId);
        if (!lg.token) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: pooled.userId, account: pooled.account, ok: false, error: '登录失败(改密码后仍失败)', phases: [] }); return; }
        // 开跑前再核实一次提现历史(防止挑号后状态变化)
        const s = summarize(fetchHistory(adminToken, pooled.userId));
        const why = poolMatch(cfg.acct, s, pooled.pkg) || (cfg.acct.rejOnly && !(s.rej > 0 && s.pass === 0) ? '已不是只有拒绝' : '');
        if (why) { emit('A', { name, batch: BATCH, desc: cfg.desc, userId: pooled.userId, account: pooled.account, ok: false, error: `开跑前复核不符：${why}`, phases: [] }); return; }
        Object.assign(st, { account: pooled.account, userId: pooled.userId, token: lg.token, loginAt: Date.now(), reset: lg.reset, pkg: pooled.pkg, histBefore: s });
        T(st, `使用老账号 userId=${pooled.userId} 账号=${pooled.account}${lg.reset ? '(后台已改密码为' + PWD + ')' : ''} 渠道packageId=${pooled.pkg}；提现历史：通过${s.pass}/拒绝${s.rej}/审核中${s.pending}，上次通过完成时间=${fmtTs(s.lastPass)}，当前累计充值=${pooled.cum}`);
        // 起点：有通过 → 上次通过时的累计作基线无法回溯，本人新增按「本用例内充值」计；从未通过 → 注册起全部历史
        st.selfBase = s.pass > 0 ? cumOf(adminToken, st.userId) : 0;
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

    const phasesOk = st.phases.length > 0 && st.phases.every(p => p.actual === p.expect);
    const manualOnly = cfg.steps.some(s => s[0] === 'manual');
    const ok = !st.dataErr.length && !histIssues.length && phasesOk;
    emit('A', {
        name, batch: BATCH, desc: cfg.desc, userId: st.userId, account: st.account, pkg: st.pkg, reset: st.reset,
        roundBefore: st.histBefore.pass, roundAfter: after.pass, phases: st.phases, log: st.log,
        dataErr: st.dataErr, warn: st.warn, trail: st.trail, histOk: !histIssues.length, histIssues, ok, manual: manualOnly,
    });
}

function doStep(step, st, ctx) {
    const [op, a1, a2, a3, a4] = step;
    const adminToken = ctx.adminToken;
    switch (op) {
        case 'round': {
            const tk = agentToken(st);
            const spin = clickSpinInvitedWheel(tk);
            if (!spin || !spin.success) { st.dataErr.push('点礼物盒失败'); return false; }
            sleep(5);
            T(st, `总代点击4个礼物盒开启新一轮(/api/Activity/SpinInvitedWheel) isFirst=${spin.isFirstInvitedWheel}`);
            clickSpinningTurntable(agentToken(st));
            T(st, '总代转动转盘');
            st.log.push('开新一轮');
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
            let got = 0;
            for (let i = 0; i < n; i++) {
                const sub = registerSub(st, ctx);
                if (!sub) continue;
                T(st, `用邀请码${st.wheelCode}注册下级[${tag}] 手机号=${sub.phone} 密码=${PWD} → userId=${sub.userId}${st.gen > 0 ? '（在上次通过之后注册=新增下级）' : ''}`);
                if (each > 0) {
                    const hr = hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: each, frontendFirst: true, remark: `AuditG3-${tag}` });
                    T(st, `下级${sub.userId}充值${each}（方式=${hr && hr.method === 'backend' ? '后台人工充值' : '前台充值+后台审核'}，结果=${hr && hr.success ? '成功' : '失败'}）`);
                }
                if (opts.unpaid && i === 0) {
                    const made = makeUnpaid(sub.token, opts.unpaid);
                    st.log.push(`下级${sub.userId}只下单不支付 ${made}`);
                    T(st, `下级${sub.userId}前台商品充值只下单不支付，合计${made}（订单保持待支付）`);
                    if (made < opts.unpaid) st.dataErr.push(`未支付订单只造到${made}<${opts.unpaid}`);
                }
                st.subs.push({ ...sub, tag, gen: st.gen });
                got++;
                sleep(1);
            }
            st.log.push(`邀请[${tag}] ${got}/${n}人 各充${each}`);
            if (got < n) st.warn.push(`下级[${tag}]只注册成功${got}/${n}`);
            return got > 0;
        }
        case 'self':
            backendRecharge(adminToken, st.userId, a1, 'AuditG3-self');
            T(st, `后台人工充值给总代 userId=${st.userId} 金额=${a1}${st.wheelCode ? '' : '（此时还未点礼物盒/未参与转盘）'}`);
            st.log.push(`本人充值${a1}`);
            return true;
        case 'selfNewTo': topUpTo('self', a1, st, ctx); return true;
        case 'subsTo': topUpTo('subs', a1, st, ctx); return true;
        case 'topTag': {
            const s = st.subs.find(x => x.tag === a1);
            if (!s) { st.dataErr.push(`无[${a1}]下级可充`); return false; }
            backendRecharge(adminToken, s.userId, a2, `AuditG3-top-${a1}`);
            T(st, `后台人工充值给下级[${a1}] userId=${s.userId} 手机号=${s.phone} 金额=${a2}${s.gen === st.gen ? '' : '（老下级：上次通过前注册）'}`);
            st.log.push(`给[${a1}]下级${s.userId}充${a2}${s.gen === st.gen ? '' : '(老下级)'}`);
            return true;
        }
        case 'apply': return doApply(a1, a2 || [], st, ctx);
        case 'manual': return doManual(a1, st, ctx);
        default: st.dataErr.push(`未知步骤 ${op}`); return false;
    }
}

/** 申请提现 → 轮询提现历史里「新出现的那一单」直到 通过/拒绝 → 记录阶段结果 */
function doApply(expect, afterSteps, st, ctx) {
    const adminToken = ctx.adminToken;
    const selfNew = measureSelfNew(st, ctx);
    const subNew = measureSubsNew(st, ctx);
    const selfCum = cumOf(adminToken, st.userId);

    let amt = 0;
    for (let a = 1; a <= 3 && amt <= 0; a++) {
        const info = getUserInvitedWheelInfo(agentToken(st));
        amt = (info && info.success) ? (info.totalPrizeAmount || info.userWheelAmount || 0) : 0;
        if (amt <= 0) sleep(8);
    }
    const round = st.histBefore.pass + st.phases.filter(p => p.actual === 'pass').length;
    const phase = { idx: st.phases.length + 1, expect, selfNew, subNew, newSubCount: newSubs(st).length, amount: amt,
                    round, rule: expectedRule(st.pkg, round), selfCum };
    if (amt <= 0) { phase.actual = '未提现(无可提奖金)'; st.phases.push(phase); st.dataErr.push(`第${phase.idx}次申请无可提奖金`); return false; }
    T(st, `申请前核对：本人累计充值=${selfCum} 本人新增=${selfNew} 新增下级${phase.newSubCount}人合计=${subNew} 成功轮次=${round} 应匹配规则=${phase.rule}`);
    const w = clickWheelWithdraw(amt, agentToken(st));
    phase.applyAt = Date.now();
    T(st, `总代申请转盘提现(/api/Activity/SumitInvitedWheelWithdraw) 金额=${amt} → ${w && w.success ? '提交成功' : '失败 ' + (w && w.msg)}`);
    if (!w || !w.success) { phase.actual = `提现失败(${w && w.msg})`; st.phases.push(phase); st.dataErr.push(`第${phase.idx}次提现失败 ${w && w.msg}`); return false; }

    for (const s of afterSteps) doStep(s, st, ctx); // 申请后、审核前的动作(验证终点)

    let rec = null;
    const deadline = Date.now() + AUDIT_WAIT * 1000;
    while (Date.now() < deadline) {
        sleep(10);
        const fresh = fetchHistory(adminToken, st.userId).filter(r => !st.seenOrders.has(r.orderNo));
        if (fresh.length) { rec = fresh[0]; if ([2, 3].includes(Number(rec.auditState))) break; }
    }
    if (rec) st.seenOrders.add(rec.orderNo);
    phase.orderNo = rec ? rec.orderNo : '';
    phase.actual = rec ? stateName(Number(rec.auditState)) : '查无新订单';
    phase.reason = rec ? (rec.reason || '') : '';
    phase.src = phase.actual === 'reject' ? reasonSource(phase.reason) : '';
    if (phase.actual === 'reject' && expect === 'reject') {
        const byRule = phase.src.startsWith('拒绝规则');
        if (st.rejectBy === 'rule' && !byRule) st.dataErr.push(`第${phase.idx}次应由拒绝规则拦截，实际来源=${phase.src}`);
        if (st.rejectBy !== 'rule' && byRule) st.dataErr.push(`第${phase.idx}次被${phase.src}拦截(非组条件判定，验证无效)`);
    }
    phase.roundNum = rec ? rec.invitedWheelRoundNum : '';
    phase.completionTime = rec ? fmtTs(rec.completionTime) : '';
    st.phases.push(phase);
    T(st, `后台转盘提现记录 单号=${phase.orderNo || '-'} 审核结果=${phase.actual}${phase.src ? '（' + phase.src + '）' : ''} 完成时间=${phase.completionTime || '-'} reason=${phase.reason || '-'}（预期=${expect}）`);
    console.log(`[${TAG}] ${st.name} 第${phase.idx}次申请 本人新增=${selfNew} 新增下级=${subNew} 预期=${expect} 实际=${phase.actual} 单号=${phase.orderNo}`);

    if (phase.actual === 'pass') {       // 成功领取 → 起点移到本次(completionTime)，现有下级全部变老下级
        st.gen++;
        st.selfBase = selfCum;
        st.lastPass = phase.completionTime;
    }
    return true;
}

/** 跨天手动：量出当前新增，算出明天要充多少 */
function doManual(kind, st, ctx) {
    const subNew = measureSubsNew(st, ctx);
    const selfNew = measureSelfNew(st, ctx);
    const fresh = newSubs(st);
    const old = st.subs.filter(s => s.gen !== st.gen);
    let target, amount, expect, note;
    if (kind === 'eq') { target = fresh.slice(-1)[0]; amount = Y - subNew; expect = 'pass'; note = `充后新增下级合计=${Y}(正好=Y)`; }
    else if (kind === 'lt') { target = fresh.slice(-1)[0]; amount = Y - 1 - subNew; expect = 'reject'; note = `充后新增下级合计=${Y - 1}(Y-1)`; }
    else { target = old[0]; amount = Y + 100; expect = 'reject'; note = `老下级(上次通过前注册)充${Y + 100}，新增下级仍=${subNew}`; }
    emit('M', {
        name: st.name, agentUserId: st.userId, agentAccount: st.account, pwd: PWD, lastPass: st.lastPass || '-',
        subUserId: target ? target.userId : '-', subPhone: target ? target.phone : '-', amount, expect, note,
        curSubNew: subNew, curSelfNew: selfNew, X, Y,
    });
    st.log.push(`跨天手动：明天给下级${target && target.userId}充${amount} → 预期${expect}`);
    return true;
}
