/**
 * 邀请转盘 - 并发提现验证（重复提现 / 竞态条件）
 *
 * 背景：串行二次提现会被接口频率限流(Too frequent access, code=11)挡住，测不到提现业务层的防重。
 *       重复提现是竞态漏洞：多个请求卡在"查可提金额→扣减生成订单"的窗口内同时到达，
 *       若后端无锁/无幂等，就会各自生成订单 → 一笔奖金被提多次。
 *
 * 做法：setup 造 1 总代 + 3 下级(充值贡献奖金) + 参与转盘 → 查可提金额 → 记录提现前订单数；
 *       然后 CONC 个 VU【同时】对同一总代发提现(默认各自独立签名，避免被 nonce 去重挡)；
 *       teardown 查提现后订单数，>1 即重复提现。
 *
 * 用法（在本目录运行）：
 *   node withdrawConcurrentRunner.js --tenant 3004 --conc 5
 *   node withdrawConcurrentRunner.js --tenant 3004 --conc 10 --same 1   # 相同 payload 并发重放
 *
 * 可选 -e：CONC(并发数,默认5) SAME(1=相同payload,0=各自签名,默认0) SUBS(默认3) SUB_RECHARGE(默认1000)
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import { sendRequest } from '../../common/request.js';
import { httpClient } from '../../../../libs/http/client.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';
import { phoneRegister, phoneRegisterByInvite } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import {
    getInvitedWheelConfig, updateInvitedWheelConfig,
    clickSpinInvitedWheel, clickSpinningTurntable, clickShareLink,
    getUserInvitedWheelInfo
} from './inviteTurntableApi.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const CONC = parseInt(__ENV.CONC || '5', 10);
const SAME = __ENV.SAME === '1';           // true=所有VU相同payload重放；false=各自独立签名
const SUBS = parseInt(__ENV.SUBS || '3', 10);
const SUB_RECHARGE = parseInt(__ENV.SUB_RECHARGE || '1000', 10);
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);
const TAG = 'WithdrawConc';

// CONC 个 VU 同时发提现（不加错峰，尽量同一时刻打进"查→扣减"窗口）
export const options = {
    scenarios: { c: { executor: 'per-vu-iterations', vus: CONC, iterations: 1, maxDuration: '20m' } }
};

// ---------- 工具 ----------
function C(msg) { console.log(`##C##${msg}`); }
function extractToken(r) {
    if (!r) return null;
    if (typeof r === 'string' && r.length > 10) return r;
    if (r.data && r.data.token) return r.data.token;
    return null;
}
function extractList(res) {
    if (!res) return [];
    if (res.data && Array.isArray(res.data.list)) return res.data.list;
    if (Array.isArray(res.list)) return res.list;
    return [];
}
function totalCountOf(res) {
    if (res && res.data && res.data.totalCount != null) return res.data.totalCount;
    if (res && res.totalCount != null) return res.totalCount;
    return null;
}

/** 提交提现：timeData 传入则用固定 payload(相同重放)，否则内部各自 getTimeRandom(独立签名) */
function rawWithdraw(amt, userToken, timeData) {
    const api = '/api/Activity/SumitInvitedWheelWithdraw';
    const td = timeData || getTimeRandom();
    const payload = { random: td.random, language: td.language, signature: '', timestamp: td.timestamp, amount: amt };
    httpClient.setAuthToken(userToken);
    const resp = httpClient.post(api, payload, {}, true);
    let body = resp && resp.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const code = body ? (body.code !== undefined ? body.code : body.msgCode) : undefined;
    const success = (code === 0 || (body && body.msg === 'Succeed'));
    return { success, code, msg: body ? body.msg : undefined };
}

function fetchWithdrawRecords(adminToken, userId) {
    const res = sendRequest(
        { userId, startDay: '2026-01-01', endDay: '2026-12-31', pageNo: 1, pageSize: 50, orderBy: 'Desc' },
        '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken
    );
    const list = extractList(res);
    const cnt = totalCountOf(res);
    return { count: (cnt != null ? cnt : list.length), list };
}

function ensureWheelConfig(adminToken) {
    const cfg = getInvitedWheelConfig(adminToken);
    if (!cfg || !cfg.success) return false;
    const updates = [];
    if (!cfg.isOpen) updates.push(['IsOpenInvitedWheel', '1']);
    if (!cfg.cashToMainWallet) updates.push(['IsInvitedWheelCashToMainWallet', '1']);
    if (!cfg.autoRotate) updates.push(['InviteAutoRotate', '1']);
    for (const [k, v] of updates) updateInvitedWheelConfig(adminToken, k, v);
    if (updates.length > 0) sleep(10);
    return true;
}

function registerWithRetry(kind, parentCode, ctx) {
    const { countryCode, adminData, customUrls } = ctx;
    for (let attempt = 1; attempt <= MAX_REG_ATTEMPTS; attempt++) {
        const phone = generateRandomPhone(countryCode);
        const res = (kind === 'agent')
            ? phoneRegister(phone, adminData, 'qwer1234', '', null, generateCryptoRandomString(16), '')
            : phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
        const token = extractToken(res);
        if (token) {
            const info = getFrontUserInfo(token);
            if (info && info.userId) return { phone, token, userId: info.userId, inviteCode: info.inviteCode || '' };
        }
        sleep(1 + attempt);
    }
    return null;
}

// ---------- Setup：造数（只跑一次，所有 VU 共享返回值）----------
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(adminToken);

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    const ctx = { countryCode, adminData, customUrls };

    const agent = registerWithRetry('agent', null, ctx);
    if (!agent) throw new Error(`[${TAG}] 总代注册失败`);
    C(`总代 phone=${agent.phone} userId=${agent.userId}`);

    const spin = clickSpinInvitedWheel(agent.token);
    if (!spin || !spin.success) throw new Error(`[${TAG}] 点礼物盒失败`);
    sleep(5);
    clickSpinningTurntable(agent.token);

    const share = clickShareLink(agent.token);
    if (!share || !share.success || !share.inviteCode) throw new Error(`[${TAG}] 拿邀请码失败`);
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';
    C(`邀请码=${wheelCode}`);

    let subOk = 0;
    for (let i = 0; i < SUBS; i++) {
        const sub = registerWithRetry('sub', wheelCode, ctx);
        if (!sub) { C(`下级${i + 1} 注册失败`); continue; }
        hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: SUB_RECHARGE, frontendFirst: true, remark: 'WithdrawConcSub' });
        subOk++;
        C(`下级${i + 1} phone=${sub.phone} userId=${sub.userId} 充值=${SUB_RECHARGE}`);
        sleep(1);
    }
    C(`下级成功=${subOk}/${SUBS}`);

    sleep(8);
    const info = getUserInvitedWheelInfo(agent.token);
    const amt = (info && info.success) ? info.totalPrizeAmount : 0;
    C(`转盘奖金 totalPrizeAmount=${amt}  已旋转 userWheelAmount=${info ? info.userWheelAmount : '?'}`);
    if (!amt || amt <= 0) throw new Error(`[${TAG}] 无可提奖金，加大 SUBS/SUB_RECHARGE 后重试`);

    const before = fetchWithdrawRecords(adminToken, agent.userId);
    C(`提现前 订单数=${before.count}`);

    // SAME 模式：预生成一份 payload，所有 VU 共用（相同重放）
    const timeData = SAME ? getTimeRandom() : null;
    C(`并发数 CONC=${CONC}  模式=${SAME ? '相同payload重放' : '各自独立签名'}  提现金额=${amt}`);

    return { adminToken, agentToken: agent.token, agentUserId: agent.userId, amt, before: before.count, timeData };
}

// ---------- VU：并发提现（每 VU 打一发）----------
export default function (data) {
    const td = SAME ? data.timeData : null;   // SAME 用共享 payload；否则各自签名
    const r = rawWithdraw(data.amt, data.agentToken, td);
    C(`VU${__VU} 提现 success=${r.success} code=${r.code} msg=${r.msg || (r.success ? 'Succeed' : '?')}`);
}

// ---------- Teardown：统计结果 ----------
export function teardown(data) {
    sleep(5); // 等订单落库
    const after = fetchWithdrawRecords(data.adminToken, data.agentUserId);
    const delta = after.count - data.before;
    C(`—— 结论 ——`);
    C(`提现前订单=${data.before}  并发${CONC}发提现后订单=${after.count}  (增量=${delta})`);
    if (delta > 1) {
        C(`🔴 产生了 ${delta} 个订单 → 【重复提现漏洞】：一笔奖金被并发提取多次(后端无锁/无幂等)`);
    } else if (delta === 1) {
        C(`✅ 只产生 1 个订单 → 防重正常(有锁/幂等，或限流把多余并发挡住了)`);
    } else {
        C(`⚠️ 产生 0 个订单 → 提现都没成功(全被限流/校验拒)，看各 VU 的 msg`);
    }
    after.list.slice(0, 10).forEach(r => C(`订单 orderNo=${r.orderNo} 金额=${r.withdrawAmount} auditState=${r.auditState}(${r.auditStateName || ''}) 轮次=${r.invitedWheelRoundNum}`));
}
