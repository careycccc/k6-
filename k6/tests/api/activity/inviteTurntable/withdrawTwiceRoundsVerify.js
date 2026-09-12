/**
 * 邀请转盘 - 多轮二次提现验证（相同 payload 重放 / 重复提现防护）
 *
 * 需求：同一个总代做 ROUNDS 轮(默认2)，每轮都：
 *   点 4 礼物盒开本轮 → 邀请 SUBS 个下级(充值贡献奖金) → 满足提现 →
 *   第一次提现 → 等待 GAP 秒 → 用【完全相同的 payload】再发起一次提现(验重复) → 进入下一轮。
 *
 * ⚠️ 每轮的两次提现共用同一份预生成 payload(random/timestamp/signature/amount 全同 = 真重放)；
 *    不同轮各自独立(金额可能不同)。
 *
 * 用法（在本目录运行）：
 *   node withdrawTwiceRoundsRunner.js --tenant 3004 --rounds 2 --subs 3 --sub-recharge 1000 --gap 5
 *   k6 run -e TENANT_ID=3004 -e ROUNDS=2 -e GAP=5 withdrawTwiceRoundsVerify.js
 *
 * 可选 -e：ROUNDS(轮数,默认2) SUBS(每轮下级数,默认3) SUB_RECHARGE(默认1000) GAP(每轮两次提现间隔秒,默认3)
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
const ROUNDS = parseInt(__ENV.ROUNDS || '2', 10);
const SUBS = parseInt(__ENV.SUBS || '3', 10);
const SUB_RECHARGE = parseInt(__ENV.SUB_RECHARGE || '1000', 10);
const GAP = parseFloat(__ENV.GAP || '3');
const ROUND_GAP = parseFloat(__ENV.ROUND_GAP || '3'); // 轮间缓冲，避免撞频率限流
const MAX_REG_ATTEMPTS = parseInt(__ENV.MAX_REG_ATTEMPTS || '3', 10);
const TAG = 'WithdrawTwiceRounds';

export const options = { scenarios: { w: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '40m' } } };

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

/** 提现：timeData 传入用固定 payload（重放）；两次调用同一 timeData → 请求体一摸一样 */
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

function fetchWithdrawCount(adminToken, userId) {
    const res = sendRequest(
        { userId, startDay: '2026-01-01', endDay: '2026-12-31', pageNo: 1, pageSize: 50, orderBy: 'Desc' },
        '/api/InvitedWheel/GetPageListWithdrawRecord', TAG, false, adminToken
    );
    const list = extractList(res);
    const cnt = totalCountOf(res);
    return (cnt != null ? cnt : list.length);
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

    // 造总代（整个测试用同一个总代做多轮）
    const agent = registerWithRetry('agent', null, ctx);
    if (!agent) { W('❌ 总代注册失败，终止'); return; }
    W(`总代 phone=${agent.phone} userId=${agent.userId}  计划轮数=${ROUNDS}  每轮下级=${SUBS}  间隔GAP=${GAP}s`);

    let roundBugs = 0;

    for (let round = 1; round <= ROUNDS; round++) {
        W(`========== 第 ${round} 轮 ==========`);

        // 1) 点 4 礼物盒开本轮 + 转
        const spin = clickSpinInvitedWheel(agent.token);
        if (!spin || !spin.success) { W(`第${round}轮 ❌ 点礼物盒失败，跳过本轮`); sleep(ROUND_GAP); continue; }
        sleep(5);
        clickSpinningTurntable(agent.token);

        // 2) 拿邀请码
        const share = clickShareLink(agent.token);
        if (!share || !share.success || !share.inviteCode) { W(`第${round}轮 ❌ 拿邀请码失败，跳过本轮`); sleep(ROUND_GAP); continue; }
        const wheelCode = share.inviteCode.slice(0, -1) + 'W';
        W(`第${round}轮 邀请码=${wheelCode}`);

        // 3) 邀请 SUBS 个下级 + 充值
        let subOk = 0;
        for (let i = 0; i < SUBS; i++) {
            const sub = registerWithRetry('sub', wheelCode, ctx);
            if (!sub) { W(`第${round}轮 下级${i + 1} 注册失败`); continue; }
            hybridRecharge({ userToken: sub.token, adminToken, userId: sub.userId, amount: SUB_RECHARGE, frontendFirst: true, remark: `W2RSub-R${round}` });
            subOk++;
            W(`第${round}轮 下级${i + 1} phone=${sub.phone} userId=${sub.userId} 充值=${SUB_RECHARGE}`);
            sleep(1);
        }
        W(`第${round}轮 下级成功=${subOk}/${SUBS}`);

        // 4) 等结算，查可提
        sleep(8);
        const info = getUserInvitedWheelInfo(agent.token);
        const amt = (info && info.success) ? info.totalPrizeAmount : 0;
        W(`第${round}轮 转盘奖金 totalPrizeAmount=${amt}  已旋转=${info ? info.userWheelAmount : '?'}`);
        if (!amt || amt <= 0) { W(`第${round}轮 ⚠️ 无可提奖金，跳过本轮提现`); sleep(ROUND_GAP); continue; }

        // 5) 提现前订单数
        const before = fetchWithdrawCount(adminToken, agent.userId);
        W(`第${round}轮 提现前 订单数=${before}`);

        // 6) 第一次提现（预生成 payload，本轮两次共用）
        const timeData = getTimeRandom();
        const w1 = rawWithdraw(amt, agent.token, timeData);
        W(`第${round}轮 第1次提现 amount=${amt} success=${w1.success} code=${w1.code} msg=${w1.msg || (w1.success ? 'Succeed' : '?')}`);
        sleep(3);
        const after1 = fetchWithdrawCount(adminToken, agent.userId);
        W(`第${round}轮 第1次后 订单数=${after1} (增量=${after1 - before})`);

        // 7) 等待 GAP，用相同 payload 再提一次
        sleep(GAP);
        const w2 = rawWithdraw(amt, agent.token, timeData);
        W(`第${round}轮 第2次提现(payload一摸一样) success=${w2.success} code=${w2.code} msg=${w2.msg || (w2.success ? 'Succeed' : '?')}`);
        sleep(3);
        const after2 = fetchWithdrawCount(adminToken, agent.userId);
        W(`第${round}轮 第2次后 订单数=${after2} (增量=${after2 - after1})`);

        // 8) 本轮结论
        const d2 = after2 - after1;
        if (d2 > 0) { W(`第${round}轮 🔴 第2次(相同payload)又产生 ${d2} 个订单 → 疑似重复提现`); roundBugs++; }
        else { W(`第${round}轮 ✅ 第2次未产生新订单(防重正常) msg=${w2.msg || '-'}`); }

        // 轮间缓冲，避免下一轮点礼物盒撞频率限流
        if (round < ROUNDS) sleep(ROUND_GAP);
    }

    W(`========== 汇总 ==========`);
    W(`总代 userId=${agent.userId} 共 ${ROUNDS} 轮，疑似重复提现的轮数=${roundBugs}`);
    if (roundBugs > 0) W(`🔴 有 ${roundBugs} 轮第2次提现又出了订单，需重点排查重复提现/防重放`);
    else W(`✅ 所有轮次第2次提现都没再出订单（相同 payload 被防住/被限流）`);
}
