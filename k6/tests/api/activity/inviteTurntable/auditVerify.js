/**
 * 邀请转盘 · 出款自动审核 验证脚本（CASE 驱动，配合 auditRunner.js）
 *
 * 用法（推荐 runner，会收集结果打印报表）：
 *   node auditRunner.js --case R3 --tenant 3004
 * 也可直跑：
 *   k6 run -e TENANT_ID=3004 -e CASE=R3 auditVerify.js
 *
 * 流程：按 CASE 造总代(官网/tiktok/老号)→点礼物盒开轮→邀请下级(数量/设备/充值按 case)
 *   →本人充值→转盘提现(SumitInvitedWheelWithdraw)→sleep 60s→查 GetPageListWithdrawRecord
 *   最新一条 auditState(2通过/3拒绝)+成功领取轮次→输出 ##AUDIT## 供 runner 打印报表。
 *
 * ⚠️ 后台开关需按该 case 的 openHint 手动配好（见 withdrawAuditTestGuide.md）。
 * ⚠️ 通过规则用例(useOld)需轮次≥1 老号：从提现记录捞 auditState=2 的老号复用；
 *    捞不到/登录失败时用 -e OLD_USER=<account> 手动指定(密码默认 qwer1234)。
 */

import { sleep } from 'k6';
import encoding from 'k6/encoding';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { sendRequest } from '../../common/request.js';
import { phoneRegister, phoneRegisterByInvite, eventIdentityRegister } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { loginWithPassword } from '../../recharge/rechargeLevel.service.js';
import { getEventConfig } from '../../../../config/eventRegisterConfig.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo, clickWheelWithdraw
} from './inviteTurntableApi.js';

const TAG = 'AuditVerify';
const TENANT_ID = __ENV.TENANT_ID || '3004';
const CASE = __ENV.CASE || 'R3';
const OLD_USER = __ENV.OLD_USER || '';           // 手动指定老号 account（通过规则用例）
const OLD_PWD = __ENV.OLD_PWD || 'qwer1234';     // 老号登录密码（默认 qwer1234；历史号密码不同时用 -e OLD_PWD 指定）
const PWD = 'qwer1234';
const AUDIT_WAIT = parseInt(__ENV.AUDIT_WAIT || '60', 10);

// ================= CASE 配置 =================
// channel: official=普通注册 / tiktok=eventIdentityRegister(包22)
// selfRecharge: 本人(总代)本轮充值额，0=不充(未首充)
// subCount: 邀请下级数；subRecharge: 每个下级充值额(0=不充)
// devMode: unique=每人唯一设备 / share2=前2个下级共用同一设备号(触发规则5)
// useOld: true=用轮次≥1老号(通过规则)；false=新造总代
// expect: pass(2) / reject(3)
// oldUser: 老号 account（带区号）；规则命中唯一一条、不降级：满足→通过/不满足→直接拒绝
// 3101 通过规则：1 轮次>0/本人≥500或下级≥1000/全部；2 轮次>2/本人≥1000且下级≥3000/官网；3 轮次=0/本人≥200且下级≥2000/tiktok
// 3101 拒绝规则：1 未首充+最近下级未首充≥2；2 未首充+全下级未充+下级≥3；3 充值<100且邀请<3；5 同设备≥2
const CASES = {
    // ===== 拒绝规则（新号；reason=命中的拒绝规则号）=====
    R1: { title: '拒绝1 未首充+最近下级未首充≥2', channel: 'official', useOld: false, selfRecharge: 0, subCount: 4, subRechargeCount: 2, subRecharge: 1000, devMode: 'unique', expect: 'reject' },
    R2: { title: '拒绝2 未首充+全下级未充+下级≥3', channel: 'official', useOld: false, selfRecharge: 0, subCount: 3, subRechargeCount: 0, subRecharge: 0, devMode: 'unique', expect: 'reject' },
    R3: { title: '拒绝3 充值<100且邀请<3', channel: 'official', useOld: false, selfRecharge: 50, subCount: 2, subRecharge: 1000, devMode: 'unique', expect: 'reject' },
    R5: { title: '拒绝5 同设备关联≥2', channel: 'official', useOld: false, selfRecharge: 300, subCount: 3, subRecharge: 1000, devMode: 'share2', expect: 'reject' },
    // ===== 通过规则2（官网 918177101194 轮次3>2；本人≥1000且下级≥3000）=====
    T2_pass: { title: '规则2 官网 本人1500+下级6000 满足', oldUser: '918177101194', channel: 'official', useOld: true, selfRecharge: 1500, subCount: 3, subRecharge: 2000, devMode: 'unique', expect: 'pass' },
    T2_fail_notdown: { title: '规则2 官网 满足规则1但规则2不满足→拒(验不降级)', oldUser: '918177101194', channel: 'official', useOld: true, selfRecharge: 600, subCount: 3, subRecharge: 500, devMode: 'unique', expect: 'reject' },
    T2_sub_single: { title: '规则2 官网 下级单个冲高(远超3000)', oldUser: '918177101194', channel: 'official', useOld: true, selfRecharge: 1500, subCount: 1, subRecharge: 9000, devMode: 'unique', expect: 'pass' },
    T2_sub_accum: { title: '规则2 官网 下级多个累计(3×3000远超3000)', oldUser: '918177101194', channel: 'official', useOld: true, selfRecharge: 1500, subCount: 3, subRecharge: 3000, devMode: 'unique', expect: 'pass' },
    // ===== 通过规则3（tiktok 914184739681 轮次0；本人≥200且下级≥2000）=====
    T3_pass: { title: '规则3 tiktok 本人300+下级3000 满足', oldUser: '914184739681', channel: 'tiktok', useOld: true, selfRecharge: 300, subCount: 3, subRecharge: 1000, devMode: 'unique', expect: 'pass' },
    T3_fail: { title: '规则3 tiktok 不满足→拒', oldUser: '914184739681', channel: 'tiktok', useOld: true, selfRecharge: 100, subCount: 2, subRecharge: 500, devMode: 'unique', expect: 'reject' },
    // ===== 其他渠道 911113199711 轮次0：规则1要轮次>0→无匹配→拒 =====
    T1_other_reject: { title: '其他渠道 轮次0 无规则匹配→拒', oldUser: '911113199711', channel: 'other', useOld: true, selfRecharge: 1000, subCount: 3, subRecharge: 2000, devMode: 'unique', expect: 'reject' }
};

export const options = {
    scenarios: { audit_verify: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' } }
};

// ================= 日期工具 =================
function pad2(n) { return String(n).padStart(2, '0'); }
function dateStr(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ================= 查询：转盘提现记录 =================
function fetchWithdrawRecords(adminToken, userId) {
    const api = '/api/InvitedWheel/GetPageListWithdrawRecord';
    const payload = { userId, startDay: dateStr(-30), endDay: dateStr(1), pageNo: 1, pageSize: 100, orderBy: 'Desc' };
    const res = sendRequest(payload, api, TAG, false, adminToken);
    if (res && res.data && Array.isArray(res.data.list)) return res.data.list;
    if (res && Array.isArray(res.list)) return res.list;
    return [];
}

/** 全站捞一个 auditState=2 且渠道匹配的老号 userId（用于通过规则）；返回 {userId, account} 或 null */
function findOldSuccessUser(adminToken, channel) {
    const api = '/api/InvitedWheel/GetPageListWithdrawRecord';
    const payload = { startDay: dateStr(-60), endDay: dateStr(1), pageNo: 1, pageSize: 200, orderBy: 'Desc' };
    const res = sendRequest(payload, api, TAG, false, adminToken);
    const list = (res && res.data && Array.isArray(res.data.list)) ? res.data.list : (res && Array.isArray(res.list) ? res.list : []);
    // 统计每个 userId 的成功(auditState=2)次数
    const okCount = {};
    for (const r of list) { if (Number(r.auditState) === 2 && r.userId != null) okCount[r.userId] = (okCount[r.userId] || 0) + 1; }
    const candidates = Object.keys(okCount).map(Number);
    console.log(`[${TAG}] 捞到 auditState=2 的候选老号 ${candidates.length} 个`);
    for (const uid of candidates) {
        const account = getUserAccount(adminToken, uid);
        if (!account) continue;
        // 渠道匹配：用 GetUserDetail 的 packageName 粗判（tiktok 含 fb 包+埋点较难精确，先按能登录为主）
        const token = loginWithPassword(account, PWD);
        if (token) {
            console.log(`[${TAG}] ✅ 复用老号 userId=${uid} account=${account}（成功领取轮次≈${okCount[uid]}）`);
            return { userId: uid, account, token };
        }
        sleep(0.3);
    }
    return null;
}

/** userId → account（GetUserDetail.usersBaseRsp.account） */
function getUserAccount(adminToken, userId) {
    const res = sendRequest({ userId }, '/api/Users/GetUserDetail', TAG, false, adminToken);
    const d = (res && res.usersBaseRsp) ? res : (res && res.data ? res.data : res);
    return d && d.usersBaseRsp ? d.usersBaseRsp.account : null;
}

// ================= 转盘活动开启 =================
function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) return false;
    const updates = [];
    if (!cfg.isOpen) updates.push(['IsOpenInvitedWheel', '1']);
    if (!cfg.cashToMainWallet) updates.push(['IsInvitedWheelCashToMainWallet', '1']);
    if (!cfg.autoRotate) updates.push(['InviteAutoRotate', '1']);
    for (const [k, v] of updates) updateInvitedWheelConfig(adminToken, k, v);
    if (updates.length) sleep(10);
    return true;
}

// ================= 注册 =================
function registerAgent(channel, ctx) {
    const phone = generateRandomPhone(ctx.countryCode);
    let res;
    if (channel === 'tiktok') {
        const cfg = getEventConfig(TENANT_ID, ''); // 3004 专属 tiktok（或包22）
        res = eventIdentityRegister(phone, ctx.adminData, {
            pixelId: cfg.pixelId, eventConfigId: cfg.id, packageName: cfg.packageName,
            inviteCode: cfg.inviteCode, registerUrl: cfg.registerDomain
        });
    } else {
        res = phoneRegister(phone, ctx.adminData, PWD, '', null, generateCryptoRandomString(16), '');
    }
    const token = extractToken(res);
    if (!token) return null;
    const info = getFrontUserInfo(token);
    if (!info || !info.userId) return null;
    return { phone, token, userId: info.userId };
}

function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    if (res.headers) { const a = res.headers['Authorization'] || res.headers['authorization']; if (a) return a.replace(/^Bearer\s+/i, '').trim(); }
    return null;
}

// ================= Setup =================
export function setup() {
    const cfg = CASES[CASE];
    if (!cfg) throw new Error(`[${TAG}] ❌ 未知 CASE=${CASE}，可选: ${Object.keys(CASES).join(', ')}`);
    console.log(`[${TAG}] ===== CASE ${CASE}: ${cfg.title} =====`);
    console.log(`[${TAG}] ⚙️ 后台开关要求: ${cfg.openHint}`);

    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(adminToken);
    return { adminToken, envConfig };
}

// ================= VU =================
export default function (data) {
    const { adminToken, envConfig } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const cfg = CASES[CASE];
    // 调试用：env 覆盖充值额/下级数，便于排查阈值/本轮统计
    if (__ENV.SELF_RECHARGE != null && __ENV.SELF_RECHARGE !== '') cfg.selfRecharge = parseInt(__ENV.SELF_RECHARGE, 10);
    if (__ENV.SUB_RECHARGE != null && __ENV.SUB_RECHARGE !== '') cfg.subRecharge = parseInt(__ENV.SUB_RECHARGE, 10);
    if (__ENV.SUB_COUNT != null && __ENV.SUB_COUNT !== '') cfg.subCount = parseInt(__ENV.SUB_COUNT, 10);
    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const customUrls = {
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL
    };
    const ctx = { countryCode, adminData: { token: adminToken, envConfig }, customUrls };

    // 1) 总代：老号 or 新造
    let agent;
    if (cfg.useOld) {
        const acct = OLD_USER || cfg.oldUser;   // 命令行 -e OLD_USER 覆盖 > CASE 内置 oldUser
        if (acct) {
            const token = loginWithPassword(acct, OLD_PWD);
            const info = token && getFrontUserInfo(token);
            agent = token && info ? { phone: acct, token, userId: info.userId } : null;
        } else {
            agent = findOldSuccessUser(adminToken, cfg.channel);
        }
        if (!agent) { emitResult(cfg, null, 0, 0, 0, `老号 ${acct || '(自动捞)'} 登录失败(需带区号91)`); return; }
    } else {
        agent = registerAgent(cfg.channel, ctx);
        if (!agent) { emitResult(cfg, null, 0, 0, 0, '总代注册失败'); return; }
    }
    console.log(`[${TAG}] 总代 userId=${agent.userId} 渠道=${cfg.channel} ${cfg.useOld ? '(老号复用)' : '(新造)'}`);

    // 2) 点礼物盒 + 转盘（先开本轮：本人/下级充值必须在此之后才算"本轮"）
    const spin = clickSpinInvitedWheel(agent.token);
    if (!spin || !spin.success) { emitResult(cfg, agent.userId, 0, 0, cfg.subCount, '点礼物盒失败'); return; }
    sleep(5);
    clickSpinningTurntable(agent.token);

    // 3) 本人本轮充值（点礼物盒之后 = 本轮内）
    let selfRecharge = 0;
    if (cfg.selfRecharge > 0) {
        const r = hybridRecharge({ userToken: agent.token, adminToken, userId: agent.userId, amount: cfg.selfRecharge, frontendFirst: true, remark: `Audit-${CASE}-self` });
        if (r && r.success !== false) selfRecharge = cfg.selfRecharge;
        sleep(2);
    }

    // 4) 拿邀请码 + 邀请下级
    const share = clickShareLink(agent.token);
    if (!share || !share.success || !share.inviteCode) { emitResult(cfg, agent.userId, selfRecharge, 0, cfg.subCount, '拿邀请码失败'); return; }
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';
    const shareDevice = generateCryptoRandomString(16); // devMode=share2 时前2个下级共用
    let subRechargeSum = 0;
    for (let i = 0; i < cfg.subCount; i++) {
        const dev = (cfg.devMode === 'share2' && i < 2) ? shareDevice : generateCryptoRandomString(16);
        const phone = generateRandomPhone(countryCode);
        const subRes = phoneRegisterByInvite(phone, wheelCode, ctx.adminData, PWD, '', customUrls, dev, '');
        const subToken = extractToken(subRes);
        if (!subToken) { console.warn(`[${TAG}] 第${i + 1}个下级注册失败`); continue; }
        const subInfo = getFrontUserInfo(subToken);
        const rcCount = cfg.subRechargeCount != null ? cfg.subRechargeCount : cfg.subCount; // 充值的下级数(其余不充=未首充)
        if (cfg.subRecharge > 0 && i < rcCount && subInfo && subInfo.userId) {
            const r = hybridRecharge({ userToken: subToken, adminToken, userId: subInfo.userId, amount: cfg.subRecharge, frontendFirst: true, remark: `Audit-${CASE}-sub` });
            if (r && r.success !== false) subRechargeSum += cfg.subRecharge;
        }
        sleep(1);
    }

    // 5) 提现（转盘奖金）
    sleep(3);
    const info = getUserInvitedWheelInfo(agent.token);
    if (!info || !info.success || !(info.totalPrizeAmount > 0)) {
        emitResult(cfg, agent.userId, selfRecharge, subRechargeSum, cfg.subCount, `无转盘奖金可提现(totalPrizeAmount=${info ? info.totalPrizeAmount : 'N/A'})`);
        return;
    }
    const wd = clickWheelWithdraw(info.totalPrizeAmount, agent.token);
    if (!wd || !wd.success) { emitResult(cfg, agent.userId, selfRecharge, subRechargeSum, cfg.subCount, `提现提交失败(${wd ? wd.msg : ''})`); return; }
    console.log(`[${TAG}] ✅ 已提交提现 金额=${info.totalPrizeAmount}，等待 ${AUDIT_WAIT}s 自动审核...`);

    // 6) 等待自动审核 + 查结果
    sleep(AUDIT_WAIT);
    const records = fetchWithdrawRecords(adminToken, agent.userId);
    const latest = records.length ? records[0] : null;             // Desc 第一条=本次
    const rounds = records.filter(r => Number(r.auditState) === 2).length; // 成功领取轮次(含本次若通过)
    emitResult(cfg, agent.userId, selfRecharge, subRechargeSum, cfg.subCount, null, latest, rounds);
}

// ================= 输出结果 marker =================
function emitResult(cfg, userId, selfRecharge, subRechargeSum, subCount, errNote, latest, rounds) {
    const actual = latest ? (Number(latest.auditState) === 2 ? 'pass' : Number(latest.auditState) === 3 ? 'reject' : `state${latest.auditState}`) : (errNote || 'no-record');
    const match = latest ? (actual === cfg.expect) : false;
    const result = {
        case: CASE, title: cfg.title, openHint: cfg.openHint, channel: cfg.channel,
        userId, subCount, selfRecharge, subRechargeSum,
        rounds: rounds == null ? '' : rounds,
        expect: cfg.expect,
        actual, auditState: latest ? latest.auditState : '', match,
        reason: latest ? latest.reason : '',
        errNote: errNote || '', orderNo: latest ? latest.orderNo : '', withdrawAmount: latest ? latest.withdrawAmount : ''
    };
    console.log(`##AUDIT## ${encoding.b64encode(JSON.stringify(result))}`);
    console.log(`[${TAG}] 结果: 预期=${cfg.expect} 实际=${actual} ${match ? '✅符合' : '❌不符'} ${errNote ? '(' + errNote + ')' : ''}`);
}
