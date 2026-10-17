/**
 * mixedBehaviorStress.test.js — 充值/提现/登录混合随机行为压力测试
 *
 * 用 3 个新注册账号，在整个测试期间反复、随机地做：
 *   - 登录（刷新 token）
 *   - 充值批次：一批内连续发起 N 笔（间隔4s），然后统一审核（立即或5s后，随机）
 *   - 提现批次：同上节奏，发起 N 笔申请后统一走后台审核到账
 * 三种行为按权重随机穿插，模拟真实用户交叉操作，而不是固定脚本顺序。
 *
 * 运行：
 *   k6 run -e TENANT=3004 -e ROUNDS=6 tests/api/mixedStress/mixedBehaviorStress.test.js
 *
 * 可选参数：
 *   -e ROUNDS=6             每个账号跑几轮随机行为（默认 6，"少量"压测）
 *   -e BATCH_MIN=3          充值/提现每批最少笔数（默认 3）
 *   -e BATCH_MAX=10         充值/提现每批最多笔数（默认 10，对应需求里举例的"10笔"）
 *   -e WITHDRAW_PWD=123456  提现密码（默认 123456）
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { getTestSession } from '../common/session.js';
import { loginByPasswordRetry } from '../common/auth.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import { getWithdrawBasicInfo, getUserWithdrawWallet, setWithdrawPassword } from '../withdraw/withdrawApi.js';
import { runBackendWithdrawApproval } from '../withdraw/backendWithdrawApi.js';
import { getAccountBalance } from '../balance/balance.test.js';
import { tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getConfigRechargeAmount, eventBatchFrontendRechargeRequest, eventBatchAuditUserOrders } from '../recharge/rechargeService.js';
import { randInt } from '../../../libs/common/index.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

const TAG = 'MixedStress';
const ROUNDS = parseInt(__ENV.ROUNDS || '6', 10);
const BATCH_MIN = parseInt(__ENV.BATCH_MIN || '3', 10);
const BATCH_MAX = parseInt(__ENV.BATCH_MAX || '10', 10);
const WD_PWD = __ENV.WITHDRAW_PWD || '123456';

// ========== 指标（console + k6 自带 summary 可见，不落盘） ==========
const cLoginOK = new Counter('login_success');
const cLoginFail = new Counter('login_fail');
const cRechargeSubmit = new Counter('recharge_submit');
const cRechargeApprove = new Counter('recharge_approve');
const cWithdrawSubmit = new Counter('withdraw_submit');
const cWithdrawApprove = new Counter('withdraw_approve');
const cRateLimited = new Counter('rate_limited');

export const options = {
    scenarios: {
        mixed_behavior: {
            executor: 'per-vu-iterations',
            vus: 3,
            iterations: ROUNDS,
            maxDuration: '60m',
        },
    },
    thresholds: hanlderThresholds('mixedBehaviorStress'),
};

// ============================================================
// ==================== Setup：注册 3 个新账号 =================
// ============================================================
export function setup() {
    const tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    console.log(`[${TAG}] ========== Setup: 租户 ${tenantId}，注册 3 个新账号 ==========`);

    const users = [];
    for (let i = 0; i < 3; i++) {
        const session = getTestSession(null, true); // 不传账号 → 随机生成 + 强制走注册
        if (!session) {
            console.error(`[${TAG}] 第 ${i + 1} 个账号注册失败，跳过`);
            continue;
        }

        const bound = addAllWallets(session.adminToken, session.userId, session.userToken);
        sleep(1); // 等钱包数据同步
        const pwdRes = setWithdrawPassword(session.userToken, WD_PWD);
        console.log(`[${TAG}] 账号${i + 1} ${session.userName}(userId=${session.userId}) 注册完成, 绑卡=${bound}, 设密码msgCode=${pwdRes && pwdRes.msgCode}`);

        // expect* 为该账号在整个压测期间的"真实成功笔数"累加器，用于最后一轮收尾核对
        users.push({ ...session, expectRechargeApproved: 0, expectWithdrawSubmitted: 0, expectWithdrawApproved: 0 });
        sleep(2); // 账号之间错开，避免注册/绑卡请求过密触发限流
    }

    if (users.length === 0) throw new Error('3 个账号全部注册失败，Setup 终止');
    console.log(`[${TAG}] ✅ Setup 完成，成功账号数: ${users.length}/3`);
    return { users };
}

// ============================================================
// ==================== 行为1：登录（刷新 token） ==============
// ============================================================
function doLogin(user) {
    const newToken = loginByPasswordRetry(user.userName, user.password);
    if (newToken) {
        user.userToken = newToken;
        cLoginOK.add(1);
        console.log(`[${TAG}][${user.userName}] ✅ 登录刷新成功`);
    } else {
        cLoginFail.add(1);
        console.warn(`[${TAG}][${user.userName}] ❌ 登录失败`);
    }
}

// ============================================================
// ==================== 行为2：充值批次 =========================
// 发起 N 笔（间隔4s） → 随机(立即 或 5s后) → 统一审核这批
// ============================================================
function doRechargeBatch(user) {
    const n = randInt(BATCH_MIN, BATCH_MAX);
    const amount = getConfigRechargeAmount(); // 同批固定金额（来自 ENV_CONFIG.RECHARGE_AMOUNT_MIN/MAX）
    console.log(`[${TAG}][${user.userName}] 充值批次开始: ${n} 笔 × ${amount}`);

    // 注意：eventBatchFrontendRechargeRequest 自带的 success 判定不完全可靠——
    // 实测中它会把一些"后端其实已经建单成功"的请求误判为失败（返回"所有可用前台通道尝试失败"），
    // 但紧接着的 eventBatchAuditUserOrders 仍能按后端真实订单状态审核通过。
    // 所以这里"提交尝试数"只统计调用次数，真正的成功口径以下面"审核通过数"（后端真实状态）为准。
    for (let i = 0; i < n; i++) {
        const r = eventBatchFrontendRechargeRequest(user.userToken, amount);
        cRechargeSubmit.add(1);
        if (!r || !r.success) console.warn(`[${TAG}][${user.userName}] 充值第${i + 1}笔前端判定失败(后端可能仍已建单，以审核结果为准): ${r && r.message}`);
        if (i < n - 1) sleep(4 + Math.random()); // 每笔间隔4s(+0~1s抖动)，贴近真实操作并避开限流
    }

    sleep(Math.random() < 0.5 ? 1 : 5); // 随机："一下子同意"(≈立即) 或 "5s后统一"
    const audited = eventBatchAuditUserOrders(user.adminToken, user.userId); // 批量审核该账号所有挂起订单（按后端真实状态，权威口径）
    cRechargeApprove.add(audited);
    user.expectRechargeApproved += audited; // 累加"真实充值到账"笔数，收尾核对用
    console.log(`[${TAG}][${user.userName}] 充值批次完成: 提交尝试${n}笔, 审核通过(真实成功)${audited}笔`);
}

// ============================================================
// ==================== 行为3：提现批次 =========================
// 发起 N 笔（间隔4s，带限流重试） → 随机(立即 或 5s后) → 逐笔走后台审核到账
// ============================================================
// setup 阶段 addAllWallets(前台接口) 实际只绑定了这三种钱包，提现通道必须限定在这个范围内，
// 否则随机选到 PIX/UPI 等未绑定类型会导致 getUserWithdrawWallet 查不到钱包而失败
const BOUND_WITHDRAW_TYPES = ['BankCard', 'EWallet', 'USDT'];
function pickWithdrawChannel(list) {
    const pool = (list || []).filter(c => c && BOUND_WITHDRAW_TYPES.includes(c.withdrawType));
    return pool.length ? pool[randInt(0, pool.length - 1)] : null;
}

/** 直连 tenantRequest 保留真实 msgCode/msg，用于区分"限流(13)"和"真实业务拒绝"（如当日提现次数/打码量限制） */
function rawWithdrawApply(user, amount, walletId, categoryId, withdrawType) {
    const payload = { amount, walletId, withdrawCategoryId: categoryId, withdrawType, withdrawPassword: WD_PWD };
    const resp = tenantRequest('/api/Withdraw/WithdrawApply', payload, { token: user.userToken, isDesk: true });
    const code = resp ? (resp.msgCode !== undefined ? resp.msgCode : resp.code) : -1;
    const msg = resp ? resp.msg : 'no response';
    return { ok: code === 0, code, msg };
}

function doWithdrawBatch(user, balance) {
    const basic = getWithdrawBasicInfo(user.userToken);
    if (!basic) { console.warn(`[${TAG}][${user.userName}] 获取提现信息失败，本轮改为充值`); doRechargeBatch(user); return; }

    // 真实业务限制：今日提现次数用完 / 还有未完成打码量 → 这轮提现不了，改为登录（充值也解决不了打码量问题）
    if (basic.userTodayWithdrawCount === 0) {
        console.warn(`[${TAG}][${user.userName}] 今日提现次数已用完，本轮改为登录`); doLogin(user); return;
    }
    if (basic.amountCoding && basic.amountCoding !== 0) {
        console.warn(`[${TAG}][${user.userName}] 还有未完成打码量(${basic.amountCoding})，本轮改为登录`); doLogin(user); return;
    }

    const channel = pickWithdrawChannel(basic.withdrawCategoryList);
    if (!channel) { console.warn(`[${TAG}][${user.userName}] 无可用提现通道，本轮改为充值`); doRechargeBatch(user); return; }

    const walletId = getUserWithdrawWallet(user.userToken, channel.withdrawType);
    if (!walletId) { console.warn(`[${TAG}][${user.userName}] 获取钱包失败，本轮改为充值`); doRechargeBatch(user); return; }

    const n = randInt(BATCH_MIN, BATCH_MAX);
    // 同批固定金额：优先命中后台档位，否则按余额随机，确保 n*amount 不超过当前真实余额（留 5% 余量给手续费/打码量波动）
    const cap = Math.floor((balance * 0.95) / n);
    const candidates = (basic.withdrawAmountList || []).filter(a => a > 0 && a <= cap);
    const amount = candidates.length ? candidates[randInt(0, candidates.length - 1)] : (cap >= 100 ? Math.floor(cap / 100) * 100 : 0);

    if (!amount || amount < 1) {
        console.warn(`[${TAG}][${user.userName}] 余额(${balance})不足以支撑 ${n} 笔提现批次，本轮改为充值`);
        doRechargeBatch(user);
        return;
    }

    console.log(`[${TAG}][${user.userName}] 提现批次开始: ${n} 笔 × ${amount}，通道=${channel.withdrawType}`);

    let submitted = 0;
    for (let i = 0; i < n; i++) {
        let r = rawWithdrawApply(user, amount, walletId, channel.id, channel.withdrawType);
        let retry = 0;
        while (!r.ok && r.code === 13 && retry < 3) { // 限流(13)退避重试，不是真失败不换策略
            retry++;
            cRateLimited.add(1);
            console.warn(`[${TAG}][${user.userName}] 提现第${i + 1}笔限流，${3 + retry}s后重试(${retry}/3)`);
            sleep(3 + retry);
            r = rawWithdrawApply(user, amount, walletId, channel.id, channel.withdrawType);
        }
        if (r.ok) {
            submitted++;
            cWithdrawSubmit.add(1);
        } else {
            console.warn(`[${TAG}][${user.userName}] 提现第${i + 1}笔提交失败 code=${r.code} msg=${r.msg}`);
            // 非限流的真实业务拒绝（如当日提现次数/打码量限制）：后续笔大概率同样失败，提前终止本批，
            // 不再浪费请求，也更贴近真实用户"被拒一次就不会接着连点"的行为
            console.warn(`[${TAG}][${user.userName}] 命中非限流拒绝，提前终止本批剩余 ${n - i - 1} 笔提交`);
            break;
        }
        if (i < n - 1) sleep(4 + Math.random()); // 每笔间隔4s(+0~1s抖动)
    }

    sleep(Math.random() < 0.5 ? 1 : 5); // 随机："一下子同意" 或 "5s后统一"
    let approved = 0;
    for (let i = 0; i < submitted; i++) {
        if (runBackendWithdrawApproval(user.adminToken, user.userId, channel.withdrawType, amount)) approved++;
    }
    cWithdrawApprove.add(approved);
    user.expectWithdrawSubmitted += submitted; // 累加"真实提交成功的提现申请"笔数（后台订单口径），收尾核对用
    user.expectWithdrawApproved += approved;   // 累加"真实提现到账"笔数，收尾核对用
    console.log(`[${TAG}][${user.userName}] 提现批次完成: 发起${submitted}/${n}笔, 审核到账${approved}笔`);
}

// ============================================================
// ==================== 收尾核对（每个账号最后一轮结束后） =====
// 注意：k6 的 VU 之间不共享内存，setup() 返回的 data 在每个 VU 里是独立拷贝，
// teardown() 拿到的也是 setup() 时的原始快照，看不到各 VU 在 default() 里的累加结果——
// 所以这个核对必须放在各账号自己最后一轮的 VU 上下文里做，而不是 teardown/handleSummary。
// ============================================================

/**
 * 分页拉取 Platform 消息列表，按标题计数（GetUserMessagePageList 无现成封装，自己拼 tenantRequest）
 *
 * 几个踩坑点都记在这儿，供以后维护参考：
 * 1. tenantRequest 返回的是 {status, data, msgCode, msg, raw}，分页数据在 response.data.list /
 *    response.data.totalPage，不是顶层的 response.list（withdrawApi.js 现成的 getWithdrawHistory
 *    就是读了顶层 response.list，一直返回 null —— 这个函数项目里从没被真正调用验证过）。
 * 2. pageSize 超过后端上限(实测 30 都会被拒) 会报 msgCode=6 "PageSize..."。
 * 3. 不能用 tenantQueryRequest：它会自动注入 orderBy 字段，而这个接口的签名校验不认 orderBy，
 *    带了就报 msgCode=3 "Wrong signature"（不是参数值的问题，是多了这个字段）。必须直连 tenantRequest，
 *    自己只传 pageNo/pageSize。
 */
function countPlatformMessages(token) {
    const counts = { 'Account recharge notification': 0, 'Withdrawal Request Received': 0, 'Withdrawal arrival notification': 0 };
    let pageNo = 1;
    const pageSize = 20;
    for (let guard = 0; guard < 20; guard++) { // 翻页上限20页，够用且避免死循环
        const resp = tenantRequest('/api/User/GetUserMessagePageList', { pageNo, pageSize }, { token, isDesk: true });
        const data = resp && resp.data;
        const list = (data && data.list) || [];
        for (const m of list) {
            if (counts[m.title] !== undefined) counts[m.title]++;
        }
        const totalPage = (data && data.totalPage) || 1;
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
    }
    return counts;
}

/** 后台真实提现订单列表（去重用）——同样不用 tenantQueryRequest/现成 getWithdrawHistory，理由同上 */
function fetchWithdrawOrders(token, startTime, endTime) {
    const resp = tenantRequest('/api/Withdraw/GetWithdrawHistory', { withdrawType: '', withdrawState: '', startTime, endTime, pageNo: 1, pageSize: 20 }, { token, isDesk: true });
    const data = resp && resp.data;
    return (data && data.list) || [];
}

/** 该账号整个压测期间的最终核对：提现申请数以后台真实订单为准（测试环境消息可能一笔多条），充值/提现到账以实际成功笔数为准 */
function verifyAccountFinal(user) {
    console.log(`[${TAG}][${user.userName}] ========== 收尾核对: 等待5s后拉取平台消息 + 后台提现记录 ==========`);
    sleep(5);

    // token 到这时可能已经过了会员 token ~55s 有效期，核对前强制刷新一次，保证查询不因401落空
    const freshToken = loginByPasswordRetry(user.userName, user.password) || user.userToken;

    const msgCounts = countPlatformMessages(freshToken);

    // 提现"申请"以后台真实订单为准（去重 orderNo），不是直接信 Withdrawal Request Received 的消息条数
    const since = Date.now() - 24 * 3600 * 1000;
    const historyList = fetchWithdrawOrders(freshToken, since, Date.now());
    const distinctOrderNos = new Set(historyList.map(o => o.orderNo));
    const actualWithdrawOrders = distinctOrderNos.size;

    const rechargeMsg = msgCounts['Account recharge notification'];
    const withdrawReqMsg = msgCounts['Withdrawal Request Received'];
    const withdrawArrivalMsg = msgCounts['Withdrawal arrival notification'];

    const rechargeOk = rechargeMsg === user.expectRechargeApproved;
    const withdrawOrderOk = actualWithdrawOrders === user.expectWithdrawSubmitted;
    const withdrawArrivalOk = withdrawArrivalMsg === user.expectWithdrawApproved;
    const allOk = rechargeOk && withdrawOrderOk && withdrawArrivalOk;

    console.log(`[${TAG}][${user.userName}] ================= 最终核对结果 =================`);
    console.log(`[${TAG}][${user.userName}] 充值到账:   期望(真实审核通过)=${user.expectRechargeApproved}  消息数="Account recharge notification"=${rechargeMsg}  ${rechargeOk ? '✅ 一致' : '❌ 不一致'}`);
    console.log(`[${TAG}][${user.userName}] 提现申请:   期望(真实提交成功)=${user.expectWithdrawSubmitted}  后台真实订单数(去重)=${actualWithdrawOrders}  ${withdrawOrderOk ? '✅ 一致' : '❌ 不一致'}  （消息数="Withdrawal Request Received"=${withdrawReqMsg}，测试环境可能一笔多条，不作为判定依据，仅供参考）`);
    console.log(`[${TAG}][${user.userName}] 提现到账:   期望(真实审核到账)=${user.expectWithdrawApproved}  消息数="Withdrawal arrival notification"=${withdrawArrivalMsg}  ${withdrawArrivalOk ? '✅ 一致' : '❌ 不一致'}`);
    console.log(`[${TAG}][${user.userName}] 综合结论:   ${allOk ? '✅ 符合预期' : '❌ 不符合预期，见上方明细'}`);
    console.log(`[${TAG}][${user.userName}] ================================================`);
}

// ============================================================
// ==================== 每轮随机选一种行为 =====================
// ============================================================
// 余额不够覆盖最小一批提现时，强制改为充值（真实用户逻辑：没钱先充值）
function pickAction(balance) {
    if (balance < BATCH_MIN * 100) return 'rechargeBatch';
    const r = Math.random();
    if (r < 0.4) return 'login';       // 40%
    if (r < 0.7) return 'rechargeBatch'; // 30%
    return 'withdrawBatch';             // 30%
}

export default function (data) {
    if (!data || !data.users || data.users.length === 0) {
        console.error(`[${TAG}] Setup 数据为空，跳过执行`);
        return;
    }

    const user = data.users[(__VU - 1) % data.users.length];

    // 每轮先查真实余额（而非本地估算）：充值通道常按自身 maxAmount/随机区间改写实际到账金额，
    // 本地估算容易跟后端真实余额脱节，进而让提现按"虚高余额"选金额、必然被拒（Balance is not enough）
    const balInfo = getAccountBalance(user.userToken);
    const balance = balInfo ? Number(balInfo.balance) || 0 : 0;

    const action = pickAction(balance);
    console.log(`[${TAG}][VU${__VU}][${user.userName}] 第 ${__ITER + 1}/${ROUNDS} 轮，真实余额=${balance}，行为=${action}`);

    if (action === 'login') doLogin(user);
    else if (action === 'rechargeBatch') doRechargeBatch(user);
    else doWithdrawBatch(user, balance);

    const isLastRound = __ITER === ROUNDS - 1;
    if (isLastRound) {
        verifyAccountFinal(user); // 该账号最后一轮：等5s后拉消息+后台提现记录核对，打印是否符合预期
    } else {
        sleep(2 + Math.random() * 4); // 轮次之间 2~6s 随机 think-time，模拟真实用户停顿
    }
}
