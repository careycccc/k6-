/**
 * 邀请转盘 · 出款自动审核「通过规则(含累计组二)」验证 —— 一用例一账号并发
 *
 * 后台通过规则(2026-09 配置，动态可改 RULES)：
 *   R1 轮次=0 / 全部     / 组一(本轮人≥300 且 下级≥2000) 或 组二(累计人≥600 或 下级累计≥1000)
 *   R2 轮次=1 / carey    / 组一(本轮人≥300 或 下级≥2000) 或 组二(累计人≥1000 且 下级累计≥1000)
 *   R3 轮次>1 / official… / 组一(本轮人≥300 或 下级≥2000) 或 组二(累计人≥2000 且 下级累计≥3000)
 * 拒绝规则 1/2/3 开(未首充类 + 充值<100且邀请<3)，IP/设备 4/5/6 关。判定：拒绝优先，
 * 再按「渠道+轮次」匹配唯一一条通过规则(优先指定渠道)，满足组一或组二→通过，否则→拒绝(不降级)，无匹配→拒绝。
 *
 * 关键口径：
 *   - 累计 = GetUserDetail.accountSummaryRsp.totalRechargeAmount(全量历史 Payed，含活动前)
 *   - 本轮 = 点礼物盒(开本轮)之后的充值；活动前充值只进累计、不进本轮
 *   - 组二"下级" = 本轮下级各自 totalRechargeAmount 之和(查前 sleep 20s)
 *   - 组二能否独立验：仅当「组二下级累计阈值 < 组一下级阈值(2000)」→ 下级充该额度满足组二不满足组一(R1/R2 可，R3 不可，自适应)
 *
 * 用法：node auditRuleRunner.js --tenant 3004
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { sendRequest } from '../../common/request.js';
import { phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';

const TAG = 'AuditRuleVerify';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const PWD = 'qwer1234';
const AUDIT_WAIT = parseInt(__ENV.AUDIT_WAIT || '60', 10);   // 提现后等自动审核秒数
const SUB_CUM_WAIT = parseInt(__ENV.SUB_CUM_WAIT || '20', 10); // 查下级累计前等待(数据延迟)
const GROUP1_SUB_MIN = 2000; // 组一"下级充值"阈值(所有规则一致)，用于判断组二能否独立

// ---- 通过规则(按后台截图，按租户切换) ----
const RULES_BY_TENANT = {
    '3004': [
        { id: 'R1', round: { op: '=', val: 0 }, channels: null,
          g1: { agent: 300, op: 'and', sub: 2000 }, g2: { agent: 600, op: 'or', sub: 1000 } },
        { id: 'R2', round: { op: '=', val: 1 }, channels: ['carey_tiktok_022'],
          g1: { agent: 300, op: 'or', sub: 2000 }, g2: { agent: 1000, op: 'and', sub: 1000 } },
        { id: 'R3', round: { op: '>', val: 1 }, channels: ['official', 'agent', 'wheel'],
          g1: { agent: 300, op: 'or', sub: 2000 }, g2: { agent: 2000, op: 'and', sub: 3000 } },
    ],
    '3101': [
        { id: 'R1', round: { op: '=', val: 0 }, channels: null,
          g1: { agent: 500, op: 'or', sub: 3000 }, g2: { agent: 1000, op: 'and', sub: 2000 } },
        { id: 'R2', round: { op: '=', val: 1 }, channels: ['official'],
          g1: { agent: 1000, op: 'and', sub: 3000 }, g2: { agent: 2000, op: 'and', sub: 2000 } },
        { id: 'R3', round: { op: '>', val: 0 }, channels: ['carey_tiktok_002'],
          g1: { agent: 2000, op: 'and', sub: 2000 }, g2: { agent: 1000, op: 'or', sub: 3000 } },
    ],
};
const RULES = RULES_BY_TENANT[TENANT_ID] || RULES_BY_TENANT['3004'];

// ---- 用例：一条一账号（account 带区号；channel 用于规则匹配；intent 造数意图；expect 预期）----
const CASES_BY_TENANT = {
  '3004': {
    // R1 轮次0，只对「非指定渠道(other)」生效(carey/official 轮次0会被各自渠道规则锁定)：组一"且" / 组二"或"
    R1_g1:     { account: '914210951576', channel: 'other', intent: 'group1', expect: 'pass' },   // 本轮人≥300 且 下级≥2000
    R1_g2:     { account: '919896362946', channel: 'other', intent: 'group2', expect: 'pass' },   // 累计人≥600 或 下级累计≥1000
    R1_reject: { account: '919896362946', channel: 'other', intent: 'none',   expect: 'reject' }, // 已验证；与 R1_g2 同号，勿同批跑
    // carey 轮次0：渠道优先锁定规则2、轮次≠1 → 拒绝(不降级到规则1)
    carey_r0:  { account: '914246492586', channel: 'carey_tiktok_022', intent: 'none', expect: 'reject' },
    // R2 轮次1 carey：组一"或" / 组二"且"
    R2_g1:     { account: '914209703084', channel: 'carey_tiktok_022', intent: 'group1', expect: 'pass' },
    R2_g2:     { account: '914189428001', channel: 'carey_tiktok_022', intent: 'group2', expect: 'pass' },
    R2_reject: { account: '914189086138', channel: 'carey_tiktok_022', intent: 'none',   expect: 'reject' },
    // R3 轮次>1 official：组一"或" / 组二"且"(下级累计3000>组一2000→组二只能组一组二同成立)
    R3_g1:     { account: '918142044929', channel: 'official',         intent: 'group1', expect: 'pass' },
    R3_g2:     { account: '912821016960', channel: 'official',         intent: 'group2', expect: 'pass' },
    // 无匹配→拒绝
    nomatch:   { account: '918830015787', channel: 'official',         intent: 'none',   expect: 'reject' },
  },
  // ===== 3101（累计组二；渠道 official / carey_tiktok_002；R3 需轮次>0 的 carey）=====
  '3101': {
    R1_g1:     { account: '918231189093', channel: 'other',            intent: 'group1', expect: 'pass' },   // R1 组一"或"(本轮人≥500)
    R1_g2:     { account: '913347017169', channel: 'other',            intent: 'group2', expect: 'pass' },   // R1 组二"且"(累计人≥1000 且 下级累计≥2000) 独立
    R1_reject: { account: '913612008291', channel: 'other',            intent: 'none',   expect: 'reject' },
    R2_g1:     { account: '919173093644', channel: 'official',         intent: 'group1', expect: 'pass' },   // R2 组一"且"(本轮人≥1000 且 下级≥3000)
    R2_g2:     { account: '917309364416', channel: 'official',         intent: 'group2', expect: 'pass' },   // R2 组二"且"(累计人≥2000 且 下级累计≥2000) 独立
    R2_reject: { account: '916769006198', channel: 'official',         intent: 'none',   expect: 'reject' },
    R3_g1:     { account: '914184739681', channel: 'carey_tiktok_002', intent: 'group1', expect: 'pass' },   // R3 组一"且"(本轮人≥2000 且 下级≥2000)，carey 轮次>0
    R3_g2:     { account: '914189598867', channel: 'carey_tiktok_002', intent: 'group2', expect: 'pass' },   // R3 组二"或"(累计人≥1000 或 下级累计≥3000) 独立
    carey_r0:  { account: '914189094286', channel: 'carey_tiktok_002', intent: 'none',   expect: 'reject' }, // carey 轮次0 → 规则3 要轮次>0 → 拒
  },
};
const CASES = CASES_BY_TENANT[TENANT_ID] || CASES_BY_TENANT['3004'];
const CASE_LIST = (__ENV.CASES || Object.keys(CASES).join(',')).split(',').map(s => s.trim()).filter(Boolean);

export const options = {
    setupTimeout: '5m',
    scenarios: { audit_rule: { executor: 'per-vu-iterations', vus: CASE_LIST.length, iterations: 1, maxDuration: '40m' } },
};

// ================= 工具 =================
function A(name, userId, msg, pass) { console.log(`##A##${name}|${userId}|${msg}|${pass ? 'PASS' : 'FAIL'}`); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(off) { const d = new Date(Date.now() + off * 86400000); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    return null;
}

/** GetUserDetail → { account, cumRecharge(累计), packageName } */
function getUserDetail(adminToken, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, adminToken);
    const d = (res && res.usersBaseRsp) ? res : (res && res.data ? res.data : res);
    if (!d) return null;
    return {
        account: d.usersBaseRsp ? d.usersBaseRsp.account : null,
        cumRecharge: d.accountSummaryRsp ? Number(d.accountSummaryRsp.totalRechargeAmount) || 0 : 0,
        packageName: d.registerSourceRsp ? d.registerSourceRsp.packageName : '',
    };
}

/** 提现记录（查 auditState / 成功轮次） */
function fetchWithdrawRecords(adminToken, userId) {
    const res = sendRequest({ userId, startDay: dateStr(-60), endDay: dateStr(1), pageNo: 1, pageSize: 100, orderBy: 'Desc' },
        '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken);
    if (res && res.data && Array.isArray(res.data.list)) return res.data.list;
    if (res && Array.isArray(res.list)) return res.list;
    return [];
}
/** 成功领取轮次 = auditState==2 的条数 */
function queryRound(adminToken, userId) {
    return fetchWithdrawRecords(adminToken, userId).filter(r => Number(r.auditState) === 2).length;
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

/** 按渠道+轮次匹配唯一通过规则(优先指定渠道)；无匹配返回 null */
function matchRule(channel, round) {
    const roundOk = (r) => r.round.op === '=' ? round === r.round.val : r.round.op === '>' ? round > r.round.val : round < r.round.val;
    // 优先匹配「指定渠道」规则——只看渠道、不看轮次：后台一旦按渠道锁定该规则，轮次不符也不降级到全部规则(→拒绝)
    const specific = RULES.filter(r => r.channels !== null && r.channels.includes(channel));
    if (specific.length) return specific[0];
    // 渠道无指定规则命中 → 落「全部」规则，按轮次匹配
    const all = RULES.filter(r => r.channels === null && roundOk(r));
    return all.length ? all[0] : null;
}

// ================= 造数：邀请下级并按额度充值 =================
/** 邀请 n 个下级，每个充 each（0=不充）；返回 {subUserIds:[], subThisRound:总本轮充值} */
function inviteSubs(agent, wheelCode, n, each, ctx) {
    const subIds = [];
    let subThisRound = 0;
    for (let i = 0; i < n; i++) {
        const res = phoneRegisterByInvite(generateRandomPhone(ctx.countryCode), wheelCode, ctx.adminData, PWD, '', ctx.customUrls);
        const token = extractToken(res);
        if (!token) continue;
        const info = getFrontUserInfo(token);
        if (!info || !info.userId) continue;
        subIds.push(info.userId);
        if (each > 0) {
            hybridRecharge({ userToken: token, adminToken: ctx.adminData.token, userId: info.userId, amount: each, frontendFirst: true, remark: `AuditRule-sub` });
            subThisRound += each;
        }
        sleep(1);
    }
    return { subUserIds: subIds, subThisRound };
}
/** 下级累计 = Σ GetUserDetail(sub).totalRechargeAmount（查前 sleep SUB_CUM_WAIT） */
function sumSubCumRecharge(adminToken, subUserIds, target) {
    let sum = 0;
    // 到账/统计有延迟：重试查，直到 ≥target 或最多 3 轮
    for (let attempt = 1; attempt <= 3; attempt++) {
        sleep(SUB_CUM_WAIT);
        sum = 0;
        for (const uid of subUserIds) {
            const d = getUserDetail(adminToken, uid);
            if (d) sum += d.cumRecharge;
            sleep(0.3);
        }
        if (!target || sum >= target) break;
        console.log(`[${TAG}] 下级累计=${sum} 未达 ${target}，第${attempt}次后重试...`);
    }
    return sum;
}

// ================= Setup =================
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(adminToken);
    return { adminToken, envConfig };
}

// ================= VU：一 VU 一用例 =================
export default function (data) {
    const { adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const vuIndex = (exec.vu.idInInstance - 1) % CASE_LIST.length;
    const caseName = CASE_LIST[vuIndex];
    const cfg = CASES[caseName];
    if (!cfg) { A(caseName, '?', '未知用例', false); return; }

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const customUrls = {
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
    };
    const ctx = { countryCode, adminData: { token: adminToken, envConfig }, customUrls };

    runCase(caseName, cfg, ctx);
}

// ================= 用例主流程 =================
function runCase(caseName, cfg, ctx) {
    const adminToken = ctx.adminData.token;

    // 1) 登录老号（Do not resubmit / 并发撞防重时退避重试）
    let token = null;
    for (let a = 1; a <= 4 && !token; a++) { token = loginWithPassword(cfg.account, PWD); if (!token) sleep(2 + a * 2); }
    if (!token) { A(caseName, cfg.account, `老号登录失败(Do not resubmit/需带区号91)`, false); return; }
    const info = getFrontUserInfo(token);
    if (!info || !info.userId) { A(caseName, cfg.account, '取前台userId失败', false); return; }
    const agent = { account: cfg.account, token, userId: info.userId };

    // 2) 查轮次 + 匹配规则
    const round = queryRound(adminToken, agent.userId);
    const rule = matchRule(cfg.channel, round);
    const ruleId = rule ? rule.id : '(无匹配)';
    console.log(`[${TAG}] ${caseName} userId=${agent.userId} 渠道=${cfg.channel} 轮次=${round} → 规则=${ruleId}`);

    // 3) 造数（按 intent）
    const built = buildData(agent, rule, cfg.intent, ctx);

    // 4) 提现
    const winfo = getUserInvitedWheelInfo(agent.token);
    const amt = (winfo && winfo.success) ? winfo.totalPrizeAmount : 0;
    if (amt > 0) clickWheelWithdraw(amt, agent.token);
    else console.warn(`[${TAG}] ${caseName} 无可提转盘奖金(totalPrizeAmount=${amt})`);

    // 5) 等自动审核 → 查 auditState
    sleep(AUDIT_WAIT);
    const recs = fetchWithdrawRecords(adminToken, agent.userId);
    const latest = recs.length ? recs[0] : null;
    const auditState = latest ? Number(latest.auditState) : 0;
    const reason = latest ? (latest.reason || '') : '';
    const actual = auditState === 2 ? 'pass' : auditState === 3 ? 'reject' : `未知(auditState=${auditState})`;

    const pass = actual === cfg.expect;
    const msg = `渠道=${cfg.channel} 轮次=${round} 规则=${ruleId} 意图=${cfg.intent} ; 本轮人=${built.selfThisRound} 本轮下级=${built.subThisRound} 累计人=${built.agentCum} 下级累计=${built.subCum} ; 预期=${cfg.expect} 实际=${actual} reason=[${reason}]`;
    A(caseName, agent.userId, msg, pass);
}

/** 按 intent 造组一 / 组二 / 都不满足 */
function buildData(agent, rule, intent, ctx) {
    const adminToken = ctx.adminData.token;
    const out = { selfThisRound: 0, subThisRound: 0, agentCum: 0, subCum: 0 };

    // 组二意图：先在"活动前"把总代累计补到 ≥ g2.agent（点礼物盒之前充 = 只进累计不进本轮）
    if (intent === 'group2' && rule) {
        const cur = getUserDetail(adminToken, agent.userId);
        const need = rule.g2.agent - (cur ? cur.cumRecharge : 0);
        if (need > 0) {
            hybridRecharge({ userToken: agent.token, adminToken, userId: agent.userId, amount: need, frontendFirst: true, remark: 'AuditRule-preCum' });
            sleep(2);
        }
    }

    // 点礼物盒开本轮（此后的充值才算本轮）
    const spin = clickSpinInvitedWheel(agent.token);
    if (!spin || !spin.success) { console.error(`[${TAG}] 点礼物盒失败`); return out; }
    sleep(5);
    clickSpinningTurntable(agent.token);

    // 本人本轮充值
    let selfRound = 0;
    if (intent === 'group1' && rule) selfRound = rule.g1.agent;      // 组一：本人充 ≥ g1.agent（若 op=or 一个够）
    else if (intent === 'none') selfRound = 101;                     // reject：>100 避开拒绝3，<300 不满足组一
    // group2：本人本轮不充（=0，组一人不满足）
    if (selfRound > 0) { hybridRecharge({ userToken: agent.token, adminToken, userId: agent.userId, amount: selfRound, frontendFirst: true, remark: 'AuditRule-self' }); out.selfThisRound = selfRound; sleep(2); }

    // 邀请码
    const share = clickShareLink(agent.token);
    if (!share || !share.success || !share.inviteCode) { console.error(`[${TAG}] 拿邀请码失败`); return out; }
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';

    // 邀请下级 + 按 intent 定下级充值额
    let subCount = 3, subEach = 100; // 默认：≥3 人避开拒绝3；充点避开未首充类
    if (intent === 'group1' && rule) {
        // 组一 op='and'：下级也要充够 g1.sub(留30%余量抵折损)；op='or'：本人已够、下级少充
        if (rule.g1.op === 'and') subEach = Math.max(Math.ceil(rule.g1.sub * 1.3 / 3), 100);
        else subEach = 100;
    }
    else if (intent === 'group2' && rule) {
        subCount = 3;
        let subTotal = Math.ceil(rule.g2.sub * 1.6); // 下级总和目标(留余量抵到账折损)
        // 组一"或" 且 组二下级阈值 < 组一下级阈值 → 可独立：把下级总和压到 < 组一下级(满足组二、不触发组一下级)
        if (rule.g1.op === 'or' && rule.g2.sub < rule.g1.sub) {
            subTotal = Math.min(subTotal, rule.g1.sub - 3);
            if (subTotal < rule.g2.sub) subTotal = rule.g2.sub;
        }
        // 组一"且"(本人不充→组一已✗) 或 g2.sub≥g1.sub(无法独立)：下级充≥g2.sub 即可(组一组二可同成立)
        subEach = Math.max(Math.ceil(subTotal / 3), 100);
    } else if (intent === 'none') { subCount = 3; subEach = 100; } // 都不满足：下级充少

    const inv = inviteSubs(agent, wheelCode, subCount, subEach, ctx);
    out.subThisRound = inv.subThisRound;

    sleep(3);

    // 记录累计（供报表核对预期）
    const agD = getUserDetail(adminToken, agent.userId);
    out.agentCum = agD ? agD.cumRecharge : 0;
    out.subCum = inv.subUserIds.length ? sumSubCumRecharge(adminToken, inv.subUserIds, (intent === 'group2' && rule) ? rule.g2.sub : 0) : 0;
    return out;
}
