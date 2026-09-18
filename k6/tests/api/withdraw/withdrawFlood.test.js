/**
 * withdrawFlood.test.js — 提现「洪水」压测（只发起、不审核，测后台在大量待审核订单下会不会卡）
 *
 * 目标：往后台堆 TOTAL(默认6000) 条前台发起的提现订单，只发起、不走后台审核，
 *       用来验证「后台在提现条数过多时是否卡顿」。
 *
 * 需求口径：
 *   - 先采集某渠道会员做账号池（node ../../../playwrith/collect-users.js，见文件末尾用法）。
 *   - 登录账号 → 余额 < TOPUP_TO(5000) 就人工上分补到 5000（amountOfCode=0 免打码，充完即可提）。
 *   - 每笔提现金额随机 [MIN_AMOUNT, MAX_AMOUNT] = [100,600]，不超过当前余额。
 *   - 一个账号可反复提现，直到余额 < STOP_BALANCE(500) 换下一个账号。
 *   - 不管用多少账号，全局发起满 TOTAL 条就停。
 *   - 每笔提现间隔 GAP(4s)。多线程 = VUS(20) 个 VU 并发。
 *
 * 架构要点（为什么这么写）：
 *   - executor: 'shared-iterations' + iterations=TOTAL：所有 VU 共享 TOTAL 次迭代，
 *     每次迭代发起 1 笔提现 → 天然实现「全局封顶 6000 条」，无需跨 VU 共享计数器
 *     （k6 的 VU 之间不共享内存，这个 executor 正好绕开这一限制）。
 *   - 账号池按 __VU 切片分给各线程（i % VUS），互不抢占同一账号（k6 无锁，切片最安全）。
 *   - VU 级状态用模块顶层 let（同一 VU 跨迭代保留）：缓存当前账号 token/余额/提现通道，
 *     避免每笔都重登录/重拿通道；余额本地乐观扣减，减少查询压力。
 *
 * ⚠️ 账号池 vs 充值额要匹配：渠道账号有限时靠「充高一点」让单账号多提几笔。
 *    例：200 个账号、充到 15000、每笔均值 ~350 → 单账号约可提 (15000-500)/350 ≈ 41 笔，
 *    200×41 ≈ 8200 ≥ 6000，够用且有余量。（TOPUP_TO 越高、单账号可提越多、越省账号。）
 *    ⚠️ 但若后台对单账号「每日提现次数」有硬上限，可提笔数会被卡死，届时需后台放开或补更多账号。
 *    池子/额度不足时耗尽的 VU 会空转，实际发起数 < TOTAL —— summary 会如实报告。
 *
 * 直接运行（PowerShell）：
 *   k6 run -e TENANT=3004 -e VUS=20 -e TOTAL=6000 withdrawFlood.test.js
 *   自定义账号文件 / 金额区间：-e POOL_FILE=../activity/firebase/2.txt -e MIN_AMOUNT=100 -e MAX_AMOUNT=600
 *   也可用薄封装 node withdrawFloodRunner.js（友好参数 + 结果落档）。
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { autoLoginByAccount } from '../user/userAccountApi.js';
import { addAllWallets } from './addWalletApi.js';
import { manualRecharge } from '../recharge/manualRecharge.js';
import { getAccountBalance } from '../balance/balance.test.js';
import {
    getWithdrawBasicInfo,
    getUserWithdrawWallet,
    setWithdrawPassword,
} from './withdrawApi.js';

// ============================================================
// ==================== 参数 ==================================
// ============================================================
const TENANT       = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const TOTAL        = parseInt(__ENV.TOTAL || '6000', 10);        // 全局提现发起总数（封顶）
const VUS          = parseInt(__ENV.VUS || __ENV.CONCURRENCY || '20', 10); // 并发线程数
const MIN_AMOUNT   = parseInt(__ENV.MIN_AMOUNT || '100', 10);    // 单笔提现下限
const MAX_AMOUNT   = parseInt(__ENV.MAX_AMOUNT || '600', 10);    // 单笔提现上限
const STOP_BALANCE = parseInt(__ENV.STOP_BALANCE || '500', 10);  // 余额 < 此值 → 换下一个账号
const TOPUP_TO     = parseInt(__ENV.TOPUP_TO || '15000', 10);    // 余额 < 此值 → 上分补到此值（渠道账号少时充高些，让单账号多提几笔）
const GAP          = parseFloat(__ENV.GAP || '4');               // 每笔提现间隔秒（同账号两笔之间）
const JITTER       = parseFloat(__ENV.JITTER || '2');            // 每笔间隔随机抖动秒（多 VU 错峰，降后台限流）
const RATE_RETRY       = parseInt(__ENV.RATE_RETRY || '6', 10);       // 遇「Too frequent」限流(msgCode=13) 的退避重试次数
const RATE_BACKOFF_MIN = parseInt(__ENV.RATE_BACKOFF_MIN || '4', 10); // 限流退避最小秒
const RATE_BACKOFF_MAX = parseInt(__ENV.RATE_BACKOFF_MAX || '9', 10); // 限流退避最大秒
const WD_PWD       = __ENV.WITHDRAW_PWD || '123456';             // 提现密码
const MAX_DURATION = __ENV.MAX_DURATION || '3h';                 // 兜底总时长

// 账号池：默认读 firebase/2.txt（collect-users.js 产出的 account 列表，与 1.txt 的 userId 行对齐）
const POOL_FILE = __ENV.POOL_FILE || '../activity/firebase/2.txt';
let ACCOUNTS = [];
try {
    ACCOUNTS = open(POOL_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
} catch (e) {
    // 文件不存在时留空，由 setup 给出明确提示（先跑 collect-users.js 采集渠道账号）
}

// ============================================================
// ==================== 指标 ==================================
// ============================================================
const cLaunch   = new Counter('withdraw_launch');   // 发起总数（不管后台成/败，都是给后台的压力）
const cOK       = new Counter('withdraw_success');   // 后台受理成功
const cFail     = new Counter('withdraw_fail');      // 后台拒绝（次数上限/打码/风控等）
const cRecharge = new Counter('recharge_topup');     // 触发上分次数
const cLogin    = new Counter('account_login');      // 账号登录次数
const cSwitch   = new Counter('account_switch');     // 换账号次数
const cRate     = new Counter('withdraw_rate_limited'); // 退避重试后仍被限流(Too frequent)的笔数

// ============================================================
// ==================== VU 级状态（跨迭代保留）================
// ============================================================
let myAccounts = null;   // 本 VU 分到的账号子列表（切片）
let myPtr = 0;           // 本 VU 账号指针
let cur = null;          // 当前账号会话：{ account, token, userId, balance, withdrawType, withdrawCategoryId, walletId, amountList }

function getRandomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// 从提现通道列表挑一个非 UPI 通道（UPI 常有额外校验，排除）
function pickChannel(withdrawCategoryList) {
    const list = (withdrawCategoryList || []).filter(c => c && c.withdrawType !== 'UPI');
    if (list.length === 0) return null;
    return list[getRandomInt(0, list.length - 1)];
}

// 选提现金额：优先命中后台档位（落在 [MIN,MAX] 且 ≤ 余额）；无档位则纯随机整数
function pickAmount() {
    const cap = Math.min(MAX_AMOUNT, Math.floor(cur.balance));
    if (cap < MIN_AMOUNT) return 0; // 余额不够最小档
    const inRange = (cur.amountList || []).filter(a => a >= MIN_AMOUNT && a <= cap);
    if (inRange.length > 0) return inRange[getRandomInt(0, inRange.length - 1)];
    return getRandomInt(MIN_AMOUNT, cap);
}

// 直接发提现请求，拿到 msgCode —— 用来区分「限流(13)」与「真实失败」
// （withdrawApply 封装失败只返回 null，区分不了限流和真失败，所以这里自己发）
function withdrawOnce(session, amount) {
    const payload = {
        amount,
        walletId: session.walletId,
        withdrawCategoryId: session.withdrawCategoryId,
        withdrawType: session.withdrawType,
        withdrawPassword: WD_PWD,
    };
    const resp = tenantRequest('/api/Withdraw/WithdrawApply', payload, { token: session.token, isDesk: true });
    const code = resp ? (resp.msgCode !== undefined ? resp.msgCode : resp.code) : -1;
    return { ok: code === 0, code };
}

// ============================================================
// 取下一个可用账号：登录 → 加钱包 → 设提现密码 → 查余额 → 上分 → 拿通道/钱包
// 成功则设置 cur 并返回 true；本 VU 账号取尽返回 false（cur=null）
// ============================================================
function acquireAccount(adminToken) {
    while (myPtr < myAccounts.length) {
        const account = myAccounts[myPtr++];
        cSwitch.add(1);

        // 1) 免密登录（用 adminToken 换会员 token，走验证码流程但全自动，无需人工）
        const token = autoLoginByAccount(account, adminToken);
        cLogin.add(1);
        if (!token) { console.log(`[Flood]SKIP ${account} 登录失败`); continue; }

        // 2) 查余额（同时拿 userId）
        const bal = getAccountBalance(token);
        if (!bal || bal.userId == null) { console.log(`[Flood]SKIP ${account} 查余额失败`); continue; }
        const userId = bal.userId;
        let balance = Number(bal.balance) || 0;

        // 3) 提现前置（必须）：绑定银行卡等钱包 + 设置提现密码
        addAllWallets(adminToken, userId);   // 绑银行卡/电子钱包/PIX/USDT；后面 GetUserWithdrawWallet 拿的就是这里绑的卡
        setWithdrawPassword(token, WD_PWD);  // 提现密码，与 withdrawApply 的 withdrawPassword 一致
        sleep(1);                            // 等钱包数据同步，否则随后 GetUserWithdrawWallet 可能查不到刚绑的卡

        // 4) 余额不足则上分补到 TOPUP_TO（amountOfCode=0 免打码，充完即可提）
        if (balance < TOPUP_TO) {
            const need = TOPUP_TO - balance;
            const r = manualRecharge(adminToken, userId, need, 0, 'flood-topup');
            if (r && r.success) { balance = TOPUP_TO; cRecharge.add(1); }
            else { console.log(`[Flood]WARN ${account} 上分失败: ${r && (r.msg || r.error)}`); }
        }
        if (balance < STOP_BALANCE) { console.log(`[Flood]SKIP ${account} 余额不足(${balance})且上分未成功`); continue; }

        // 5) 提现通道 + 钱包（每账号拿一次，之后每笔复用）
        const info = getWithdrawBasicInfo(token);
        if (!info) { console.log(`[Flood]SKIP ${account} 获取提现基础信息失败`); continue; }
        const ch = pickChannel(info.withdrawCategoryList);
        if (!ch) { console.log(`[Flood]SKIP ${account} 无可用提现通道`); continue; }
        const walletId = getUserWithdrawWallet(token, ch.withdrawType);
        if (!walletId) { console.log(`[Flood]SKIP ${account} 获取钱包失败`); continue; }

        cur = {
            account, token, userId, balance,
            withdrawType: ch.withdrawType,
            withdrawCategoryId: ch.id,
            walletId,
            amountList: info.withdrawAmountList || [],
        };
        console.log(`[Flood]READY ${account} userId=${userId} 余额=${balance} 通道=${ch.withdrawType}`);
        return true;
    }
    cur = null;
    return false;
}

// ============================================================
// ==================== K6 options ============================
// ============================================================
export const options = {
    scenarios: {
        flood: {
            executor: 'shared-iterations',
            vus: VUS,
            iterations: TOTAL,        // 所有 VU 共享 TOTAL 次迭代 = 全局提现发起封顶
            maxDuration: MAX_DURATION,
        },
    },
    // 压测本身就是要看后台扛不扛，不用阈值卡失败；只留请求时长观察
    thresholds: {},
};

// ============================================================
// ==================== setup =================================
// ============================================================
export function setup() {
    const env = getEnvByTenantId(TENANT);
    console.log(`[Flood] 租户=${TENANT} 前台=${env.BASE_DESK_URL} 账号池=${ACCOUNTS.length} 目标=${TOTAL} 并发=${VUS} 金额=[${MIN_AMOUNT},${MAX_AMOUNT}] 间隔=${GAP}s`);
    if (ACCOUNTS.length === 0) throw new Error(`账号池为空：${POOL_FILE}（先跑 collect-users.js 采集渠道账号）`);

    const adminToken = tenantAdminLogin(TENANT);
    if (!adminToken) throw new Error('后台登录失败（检查 GOOGLE_SECRET / 时钟）');
    console.log('[Flood] ✅ 后台登录成功');
    return { adminToken };
}

// ============================================================
// ==================== 每次迭代 = 发起 1 笔提现 ==============
// ============================================================
export default function (data) {
    // 首次：按 __VU 切片领取本线程的账号 + 启动错峰（多 VU 别同一时刻打后台，降限流）
    if (myAccounts === null) {
        myAccounts = ACCOUNTS.filter((_, i) => i % VUS === (__VU - 1));
        sleep(Math.random() * GAP); // 首次随机错开 0~GAP 秒
    }

    // 当前无账号 / 余额见底 → 换下一个
    if (!cur || cur.balance < STOP_BALANCE) {
        acquireAccount(data.adminToken);
    }
    if (!cur) { sleep(1); return; } // 本 VU 账号池耗尽（账号足够时不会到这）

    const amount = pickAmount();
    if (amount < MIN_AMOUNT) { cur = null; sleep(0.2); return; } // 余额不够最小档，换账号

    // 发起提现：遇「Too frequent(msgCode=13)」= 后台限流 → 退避重试同一账号
    // （关键：限流不是账号问题，绝不能换账号——换账号=登录+绑卡+充值一堆请求，会把限流顶得更死）
    let r = withdrawOnce(cur, amount);
    let retry = 0;
    while (!r.ok && r.code === 13 && retry < RATE_RETRY) {
        retry++;
        sleep(getRandomInt(RATE_BACKOFF_MIN, RATE_BACKOFF_MAX)); // 限流退避，等一会儿再试同一笔
        r = withdrawOnce(cur, amount);
    }
    cLaunch.add(1);

    if (r.ok) {
        cOK.add(1);
        cur.balance -= amount; // 乐观扣减，避免每笔都查余额
    } else if (r.code === 13) {
        // 退避多次仍限流：这笔没成，但账号是好的 —— 保留账号下次迭代再试（不扣余额、不换账号）
        cRate.add(1);
        console.log(`[Flood] RATE VU${__VU} ${cur.account} amt=${amount} 限流重试${retry}次仍失败，保留账号稍后再试`);
    } else {
        // 真实失败（次数上限/打码/风控/余额等）才换账号
        cFail.add(1);
        console.log(`[Flood] FAIL VU${__VU} ${cur.account} amt=${amount} code=${r.code} → 换账号`);
        cur = null;
    }

    sleep(GAP + Math.random() * JITTER); // 间隔 + 抖动，进一步错峰
}

// ============================================================
// ==================== 汇总报表 ==============================
// ============================================================
export function handleSummary(data) {
    const n = (k) => (data.metrics[k] && data.metrics[k].values ? (data.metrics[k].values.count || 0) : 0);
    const launch = n('withdraw_launch');
    const ok = n('withdraw_success');
    const fail = n('withdraw_fail');
    const p95 = (data.metrics.http_req_duration && data.metrics.http_req_duration.values)
        ? data.metrics.http_req_duration.values['p(95)'] : 0;

    const lines = [];
    lines.push('[Flood]================ 提现洪水压测报表 ================');
    lines.push(`[Flood]租户: ${TENANT}   目标发起: ${TOTAL}   并发: ${VUS}   金额: [${MIN_AMOUNT},${MAX_AMOUNT}]   间隔: ${GAP}s`);
    lines.push(`[Flood]实际发起: ${launch}   后台受理成功: ${ok}   后台拒绝(真失败): ${fail}   限流未成: ${n('withdraw_rate_limited')}`);
    lines.push(`[Flood]触发上分: ${n('recharge_topup')}   账号登录: ${n('account_login')}   换账号: ${n('account_switch')}`);
    if (n('withdraw_rate_limited') > 0) lines.push(`[Flood]⚠️ 仍有限流(Too frequent)：整体速率超后台阈值，降 VUS 或加大 GAP/JITTER/RATE_RETRY 再跑`);
    lines.push(`[Flood]HTTP p95: ${p95 ? p95.toFixed(0) + 'ms' : 'N/A'}（观察后台是否随订单堆积变慢）`);
    if (launch < TOTAL) lines.push(`[Flood]⚠️ 实际发起(${launch}) < 目标(${TOTAL})：账号池不足或大量被拒，加大账号池或 TOTAL 余量`);
    lines.push('[Flood]================================================');
    const report = lines.join('\n');

    return {
        stdout: '\n' + report + '\n',
    };
}
