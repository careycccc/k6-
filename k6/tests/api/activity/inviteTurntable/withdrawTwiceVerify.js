/**
 * 邀请转盘 - 二次提现验证（相同 payload 重放 / 重复提现防护）
 *
 * 需求：1 总代邀请 3 下级、满足提现后 → 第一次提现成功 → 隔 3s 用【完全相同的 payload】
 *       (random/timestamp/signature/amount 全部一样，等于把提现接口原样重放一次) 再请求一次，
 *       看第二次是否还会产生提现订单。预期：第二次应被拒、不产生新订单；若又生成订单 = 重复提现/未防重放。
 *
 * ⚠️ 关键：clickWheelWithdraw 内部每次都 getTimeRandom() 生成新 random/timestamp/signature，
 *    无法满足"payload 一摸一样"。故本脚本预生成一次 timeData，两次提现共用同一 payload。
 *
 * 用法（在本目录运行）：
 *   node withdrawTwiceRunner.js --tenant 3004        # 推荐，拿干净报表 + 落档
 *   k6 run -e TENANT_ID=3004 withdrawTwiceVerify.js  # 直接看 k6 输出
 *
 * 可选 -e：SUBS(默认3) SUB_RECHARGE(默认1000) GAP(两次提现间隔秒,默认3)
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
const SUBS = parseInt(__ENV.SUBS || '3', 10);
const SUB_RECHARGE = parseInt(__ENV.SUB_RECHARGE || '1000', 10);
const GAP = parseFloat(__ENV.GAP || '3');
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);
const TAG = 'WithdrawTwice';

export const options = { scenarios: { w: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '20m' } } };

// ---------- 工具 ----------
function W(msg) { console.log(`##W##${msg}`); }
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

/**
 * 用【固定 payload】提交提现：两次调用传同一 timeData → random/timestamp/amount 完全一致，
 * signature 由框架基于相同内容算出 → 两次请求体一摸一样（真·重放）。
 */
function rawWithdraw(amt, userToken, timeData) {
    const api = '/api/Activity/SumitInvitedWheelWithdraw';
    const payload = {
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp,
        amount: amt
    };
    httpClient.setAuthToken(userToken);
    const resp = httpClient.post(api, payload, {}, true);
    let body = resp && resp.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const code = body ? (body.code !== undefined ? body.code : body.msgCode) : undefined;
    const success = (code === 0 || (body && body.msg === 'Succeed'));
    return { success, code, msg: body ? body.msg : undefined };
}

/** 查总代的邀请转盘提现订单（管理员口径） */
function fetchWithdrawRecords(adminToken, userId) {
    const res = sendRequest(
        { userId, startDay: '2026-01-01', endDay: '2026-12-31', pageNo: 1, pageSize: 50, orderBy: 'Desc' },
        '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken
    );
    const list = extractList(res);
    const cnt = totalCountOf(res);
    return { count: (cnt != null ? cnt : list.length), list };
}

/** 确保邀请转盘活动开启（活动/主钱包提现/自动旋转） */
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

/** 注册（带退避重试，缓解写库限流），照 inviteWheelRetention.day.js */
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

// ---------- Setup / VU ----------
export function setup() {
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    ensureWheelConfig(token);
    return { token, envConfig };
}

export default function (data) {
    const adminToken = data.token;
    const envConfig = data.envConfig;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const countryCode = __ENV.COUNTRY_CODE || envConfig.COUNTRY_CODE || '91';
    const adminData = { token: adminToken, envConfig };
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };
    const ctx = { countryCode, adminData, customUrls };

    // 1) 造总代
    const agent = registerWithRetry('agent', null, ctx);
    if (!agent) { W('❌ 总代注册失败，终止'); return; }
    W(`总代 phone=${agent.phone} userId=${agent.userId}`);

    // 2) 参与转盘：点 4 礼物盒 + 转
    const spin = clickSpinInvitedWheel(agent.token);
    if (!spin || !spin.success) { W('❌ 点礼物盒失败，终止'); return; }
    sleep(5);
    clickSpinningTurntable(agent.token);

    // 3) 拿邀请码（末位换 W = 转盘邀请码）
    const share = clickShareLink(agent.token);
    if (!share || !share.success || !share.inviteCode) { W('❌ 拿邀请码失败，终止'); return; }
    const wheelCode = share.inviteCode.slice(0, -1) + 'W';
    W(`邀请码=${wheelCode}`);

    // 4) 邀请 SUBS 个下级 + 充值（贡献总代转盘奖金）
    let subOk = 0;
    for (let i = 0; i < SUBS; i++) {
        const sub = registerWithRetry('sub', wheelCode, ctx);
        if (!sub) { W(`下级${i + 1} 注册失败`); continue; }
        hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: SUB_RECHARGE, frontendFirst: true, remark: 'WithdrawTwiceSub' });
        subOk++;
        W(`下级${i + 1} phone=${sub.phone} userId=${sub.userId} 充值=${SUB_RECHARGE}`);
        sleep(1);
    }
    W(`下级成功=${subOk}/${SUBS}`);

    // 5) 等奖金结算，查可提金额
    sleep(8);
    const info = getUserInvitedWheelInfo(agent.token);
    const amt = (info && info.success) ? info.totalPrizeAmount : 0;
    W(`转盘奖金 totalPrizeAmount=${amt}  已旋转 userWheelAmount=${info ? info.userWheelAmount : '?'}`);
    if (!amt || amt <= 0) { W('⚠️ 无可提奖金，测不了提现（可加大 SUBS / SUB_RECHARGE 后重试）'); return; }

    // 6) 提现前订单数
    const before = fetchWithdrawRecords(adminToken, agent.userId);
    W(`提现前 订单数=${before.count}`);

    // 7) 第一次提现（预生成一次 payload，两次共用）
    const timeData = getTimeRandom();
    W(`固定 payload: random=${timeData.random} timestamp=${timeData.timestamp} amount=${amt}`);
    const w1 = rawWithdraw(amt, agent.token, timeData);
    W(`第一次提现 success=${w1.success} code=${w1.code} msg=${w1.msg || (w1.success ? 'Succeed' : '?')}`);
    sleep(3);
    const after1 = fetchWithdrawRecords(adminToken, agent.userId);
    W(`第一次后 订单数=${after1.count}  (增量=${after1.count - before.count})`);

    // 8) 隔 GAP 秒，用【完全相同的 payload】再发一次（同一 timeData）
    sleep(GAP);
    const w2 = rawWithdraw(amt, agent.token, timeData);
    W(`第二次提现(payload一摸一样) success=${w2.success} code=${w2.code} msg=${w2.msg || (w2.success ? 'Succeed' : '?')}`);
    sleep(3);
    const after2 = fetchWithdrawRecords(adminToken, agent.userId);
    W(`第二次后 订单数=${after2.count}  (增量=${after2.count - after1.count})`);

    // 9) 结论
    const d1 = after1.count - before.count;
    const d2 = after2.count - after1.count;
    W(`—— 结论 ——`);
    W(`第一次提现 ${d1 >= 1 ? '产生了订单 ✅' : '未产生订单 ⚠️(第一次就没提成功，需先调参数造出可提金额)'}（增量=${d1}）`);
    if (d2 > 0) {
        W(`🔴 第二次(相同payload)又产生了 ${d2} 个订单 → 疑似【重复提现/未防重放】`);
    } else {
        W(`✅ 第二次(相同payload)未产生新订单（防重正常），返回 success=${w2.success} msg=${w2.msg || '-'}`);
    }
    after2.list.slice(0, 6).forEach(r => W(`订单 orderNo=${r.orderNo} 金额=${r.withdrawAmount} auditState=${r.auditState}(${r.auditStateName || ''}) 轮次=${r.invitedWheelRoundNum} time=${r.createTime || r.addTime || ''}`));
}
