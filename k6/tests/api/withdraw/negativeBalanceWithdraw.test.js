/**
 * 负数余额提现漏洞验证脚本 v2
 *
 * 【Fix v2】
 *   - Setup 阶段先为账号绑定所有类型钱包（银行卡/电子钱包/USDT），
 *     避免因「钱包为空」导致的假 PASS
 *   - attemptWithdraw 直接调用底层 tenantRequest，保留完整 msgCode，
 *     明确区分 "钱包/通道问题失败" vs "余额校验被后端拒绝" 两种失败场景
 *
 * 【Bug 描述】
 *   用户账户余额为负/零时，系统仍然允许提现申请通过。
 *   根本原因：余额读取与扣款不是原子操作，并发时各自读到正数快照，
 *   最终叠加扣款导致余额变负。
 *
 * 【验证方案】
 *   Case 1: 余额 <= 0 时直接提现，期望被后端以「余额不足」拒绝（msgCode ≠ 0）
 *   Case 2: 边界测试 — 余额 ≈ 提现金额时，不应产生负数余额
 *   Case 3: 快速重复提现 — 两次都成功则说明双重扣款漏洞存在
 *   Case 4: 并发 Race Condition（ENABLE_RACE_TEST=true）
 *
 * 【使用方式】
 *   # 注册新账号从零开始（余额为0，最直接验证拦截）：
 *   k6 run -e TENANT=3004 -e IS_REGISTER=true negativeBalanceWithdraw.test.js
 *
 *   # 对指定账号（已有余额）执行：
 *   k6 run -e TENANT=3004 -e TARGET_USER=918048050116 negativeBalanceWithdraw.test.js
 *
 *   # 并发竞争测试：
 *   k6 run -e TENANT=3004 -e TARGET_USER=918048050116 -e ENABLE_RACE_TEST=true negativeBalanceWithdraw.test.js
 *
 *   # 指定固定提现金额：
 *   k6 run -e TENANT=3004 -e TARGET_USER=918165802117 -e WITHDRAW_AMOUNT=200 negativeBalanceWithdraw.test.js
 * 
 *   # 场景一：合计 = 余额（800=500+300，两笔都应成功）
    k6 run -e TENANT=3004 -e TARGET_USER=917458000546 -e ENABLE_DUAL_CHANNEL_TEST=true -e CHANNEL1_AMOUNT=600 -e CHANNEL2_AMOUNT=600 negativeBalanceWithdraw.test.js

    # 场景二：合计 > 余额（1100>800，至少一笔应被拒）
    k6 run -e TENANT=3004 -e TARGET_USER=918165802117 -e ENABLE_DUAL_CHANNEL_TEST=true -e CHANNEL1_AMOUNT=600 -e CHANNEL2_AMOUNT=600 negativeBalanceWithdraw.test.js
 */

import { sleep } from 'k6';
import { check, group } from 'k6';
import { getTestSession } from '../common/session.js';
import { getAccountBalance } from '../balance/balance.test.js';
import {
    getWithdrawBasicInfo,
    setWithdrawPassword,
    getUserWithdrawWallet
} from './withdrawApi.js';
import { addAllWallets } from './addWalletApi.js';
import { tenantAdminLogin, tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

// ============================================================
// ==================== 参数解析 ==============================
// ============================================================

const TENANT_ID               = __ENV.TENANT || __ENV.TENANT_ID || '3004';
const TARGET_USER             = __ENV.TARGET_USER;
const IS_REGISTER             = __ENV.IS_REGISTER === 'true';
const ENABLE_RACE_TEST        = __ENV.ENABLE_RACE_TEST === 'true';
const ENABLE_DUAL_CHANNEL_TEST = __ENV.ENABLE_DUAL_CHANNEL_TEST === 'true';
const WITHDRAW_AMOUNT         = parseFloat(__ENV.WITHDRAW_AMOUNT || '0');
// Case 5 双通道并发参数
const CHANNEL1_AMOUNT         = parseFloat(__ENV.CHANNEL1_AMOUNT || '0');
const CHANNEL2_AMOUNT         = parseFloat(__ENV.CHANNEL2_AMOUNT || '0');
// Case 5 可手动指定两个通道类型（如 BankCard、EWallet、USDT）
// 不指定时脚本自动从 withdrawCategoryList 中选取前两个不同类型
const CHANNEL1_TYPE           = __ENV.CHANNEL1_TYPE || '';   // 如 'BankCard'
const CHANNEL2_TYPE           = __ENV.CHANNEL2_TYPE || '';   // 如 'USDT'

const TAG = 'NegativeBalanceTest';

// ============================================================
// ==================== K6 Options ============================
// ============================================================

export const options = {
    scenarios: {
        negative_balance_verify: {
            executor: 'per-vu-iterations',
            // Case4 同通道并发=2VU；Case5 双通道并发=2VU；普通=1VU
            vus:         (ENABLE_RACE_TEST || ENABLE_DUAL_CHANNEL_TEST) ? 2 : 1,
            iterations:  1,
            maxDuration: '15m'
        }
    },
    thresholds: {
        http_req_duration: ['p(95)<10000']
    }
};

// ============================================================
// ==================== 核心：底层提现调用 ====================
// ============================================================

/**
 * 直接调用 /api/Withdraw/WithdrawApply，返回完整的后端响应对象
 * 不做任何成功/失败封装，以便外部精确判断 msgCode
 *
 * @param {string} token
 * @param {number} amount
 * @param {string|number} walletId
 * @param {number} withdrawCategoryId
 * @param {string} withdrawType
 * @returns {object|null} 原始响应 { msgCode, msg, data } 或 null（网络异常）
 */
function rawWithdrawApply(token, amount, walletId, withdrawCategoryId, withdrawType) {
    const payload = {
        amount:             amount,
        walletId:           walletId,
        withdrawCategoryId: withdrawCategoryId,
        withdrawType:       withdrawType,
        withdrawPassword:   '123456'
    };

    console.log(`[${TAG}] 提现请求参数: amount=${amount}, walletId=${walletId}, type=${withdrawType}`);

    const response = tenantRequest('/api/Withdraw/WithdrawApply', payload, { token, isDesk: true });

    console.log(`[${TAG}] 提现响应: msgCode=${response ? response.msgCode : 'null'}, msg=${response ? response.msg : 'null'}`);

    return response; // 返回原始响应，不过滤
}

/**
 * 选一个最合适的提现通道
 * 优先级：BankCard > EWallet > 其他 > USDT（USDT最低提现额通常最高）
 * 目的：让 200 这类小额在 BankCard 通道能通过，避免 msgCode=10023
 * @param {object} withdrawInfo
 * @returns {object|null} { id, withdrawType }
 */
function pickCategory(withdrawInfo) {
    const all = withdrawInfo.withdrawCategoryList || [];
    // 排除 UPI
    const candidates = all.filter(c => c.withdrawType !== 'UPI');
    if (candidates.length === 0) return null;

    // 按优先级排序：BankCard > EWallet > USDT
    const priority = { BankCard: 0, EWallet: 1, USDT: 99 };
    candidates.sort((a, b) =>
        (priority[a.withdrawType] ?? 50) - (priority[b.withdrawType] ?? 50)
    );

    const chosen = candidates[0];
    console.log(`[${TAG}] 选取提现通道: ${chosen.withdrawType} (id=${chosen.id})`);
    return chosen;
}

/**
 * 选取测试用提现金额
 * @param {object} withdrawInfo
 * @param {number} balance
 * @returns {number}
 */
function pickAmount(withdrawInfo, balance) {
    // 优先使用外部指定金额
    if (WITHDRAW_AMOUNT > 0) return WITHDRAW_AMOUNT;

    const list = withdrawInfo.withdrawAmountList || [];
    if (list.length > 0) {
        return [...list].sort((a, b) => a - b)[0]; // 最小档
    }
    // 非商品模式：使用 100 作为最小测试金额
    return 100;
}

/**
 * 完整提现尝试：选通道 → 获取钱包 → 调接口
 * 遇到 msgCode=13（频率限制）时，最多退避重试 3 次
 *
 * @param {string} token
 * @param {number} amount
 * @param {object} withdrawInfo
 * @param {string|null} forceType  指定通道类型（如 'BankCard'/'EWallet'），null=自动优先选
 * @returns {{
 *   withdrew:   boolean,
 *   msgCode:    number|null,
 *   msg:        string,
 *   skipReason: string|null,
 *   withdrawType: string     实际使用的通道类型
 * }}
 */
function doWithdraw(token, amount, withdrawInfo, forceType = null) {
    // — 步骤 1：选通道 —
    let category;
    if (forceType) {
        // 指定通道类型（Case 5 使用）
        const all = withdrawInfo.withdrawCategoryList || [];
        category = all.find(c => c.withdrawType === forceType) || null;
        if (!category) {
            return { withdrew: false, msgCode: null, msg: `找不到通道类型: ${forceType}`, skipReason: `找不到指定通道 ${forceType}`, withdrawType: forceType };
        }
        console.log(`[${TAG}] 强制使用通道: ${category.withdrawType} (id=${category.id})`);
    } else {
        // 自动优先选（BankCard > EWallet > USDT）
        category = pickCategory(withdrawInfo);
        if (!category) {
            return { withdrew: false, msgCode: null, msg: '无可用提现通道', skipReason: '无可用非UPI通道', withdrawType: 'unknown' };
        }
    }

    // — 步骤 2：获取钱包 —
    const walletId = getUserWithdrawWallet(token, category.withdrawType);
    if (!walletId) {
        return { withdrew: false, msgCode: null, msg: '钱包为空，未绑定对应类型钱包', skipReason: `未绑定 ${category.withdrawType} 钱包`, withdrawType: category.withdrawType };
    }

    // — 步骤 3：调提现接口，遇到 msgCode=13 频率限制时退避重试 —
    let resp = null;
    const maxRetry = 3;
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
        resp = rawWithdrawApply(token, amount, walletId, category.id, category.withdrawType);
        if (!resp) break;
        if (resp.msgCode !== 13) break;
        const waitSec = attempt * 5;
        console.warn(`[${TAG}] msgCode=13 频率限制，${waitSec}s 后重试 (${attempt}/${maxRetry})`);
        sleep(waitSec);
    }

    if (!resp) {
        return { withdrew: false, msgCode: null, msg: '网络异常或接口无响应', skipReason: '接口异常', withdrawType: category.withdrawType };
    }

    return {
        withdrew:     resp.msgCode === 0,
        msgCode:      resp.msgCode,
        msg:          resp.msg || '',
        skipReason:   null,
        withdrawType: category.withdrawType
    };
}

// ============================================================
// ==================== SETUP 阶段 ============================
// ============================================================

export function setup() {
    console.log(`\n[${TAG}] ========== 负数余额提现验证 v2 - Setup 开始 ==========`);
    console.log(`[${TAG}] 租户: ${TENANT_ID}`);
    console.log(`[${TAG}] 并发竞争测试: ${ENABLE_RACE_TEST ? '启用' : '禁用'}`);

    // 1. 后台登录
    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[${TAG}] 后台登录失败`);
    console.log(`[${TAG}] ✅ 后台登录成功`);

    // 2. 前台会话
    const userName = (TARGET_USER && TARGET_USER !== 'undefined') ? TARGET_USER : null;
    const session  = getTestSession(userName, IS_REGISTER || !userName);
    if (!session) throw new Error(`[${TAG}] 前台会话建立失败`);
    console.log(`[${TAG}] ✅ 前台会话建立成功: userId=${session.userId}, userName=${session.userName}`);

    // 3. 绑定钱包（关键步骤，避免假PASS）
    console.log(`[${TAG}] 正在为用户绑定所有类型钱包...`);
    const walletsOk = addAllWallets(adminToken, session.userId, session.userToken);
    if (!walletsOk) {
        console.warn(`[${TAG}] ⚠️ 部分钱包绑定失败，但继续执行测试（已有钱包可用即可）`);
    } else {
        console.log(`[${TAG}] ✅ 钱包绑定完成`);
    }

    sleep(2); // 等待钱包数据同步

    // 4. 查询余额
    const balanceInfo = getAccountBalance(session.userToken);
    const balance     = balanceInfo ? balanceInfo.balance : 0;
    console.log(`[${TAG}] 当前账户余额: ${balance}`);

    // 5. 设置提现密码
    setWithdrawPassword(session.userToken, '123456');

    // 6. 获取提现基础信息
    const withdrawInfo = getWithdrawBasicInfo(session.userToken);
    if (!withdrawInfo) throw new Error(`[${TAG}] 获取提现基础信息失败`);

    // 7. 打印可用提现通道列表（关键！方便排查通道类型）
    const allCategories = withdrawInfo.withdrawCategoryList || [];
    const nonUpiCategories = allCategories.filter(c => c.withdrawType !== 'UPI');
    console.log(`[${TAG}] ========== 系统可用提现通道 ==========`);
    console.log(`[${TAG}] 共 ${allCategories.length} 个通道（含UPI），非UPI通道 ${nonUpiCategories.length} 个:`);
    allCategories.forEach((c, i) => {
        console.log(`[${TAG}]   [${i}] type=${c.withdrawType}, id=${c.id}, name=${c.name || '-'}`);
    });
    console.log(`[${TAG}] ==========================================`);

    // 8. Case 5 双通道自动选取逻辑
    // 优先使用 CHANNEL1_TYPE / CHANNEL2_TYPE 环境变量指定的通道
    // 若未指定，自动从非UPI通道中选取前两个不同类型
    let ch1Type = CHANNEL1_TYPE;
    let ch2Type = CHANNEL2_TYPE;

    if (!ch1Type || !ch2Type) {
        // 自动选：取前两个类型不同的非UPI通道
        const types = [];
        for (const c of nonUpiCategories) {
            if (!types.includes(c.withdrawType)) types.push(c.withdrawType);
            if (types.length >= 2) break;
        }
        if (!ch1Type) ch1Type = types[0] || 'BankCard';
        if (!ch2Type) ch2Type = types[1] || types[0] || 'BankCard';
    }
    console.log(`[${TAG}] Case 5 通道分配: VU1→${ch1Type}, VU2→${ch2Type}`);
    if (ch1Type === ch2Type) {
        console.warn(`[${TAG}] ⚠️ 两个通道类型相同(${ch1Type})，将退化为同通道并发（需确认后台是否配置了多个通道）`);
    }

    // 9. 确定测试金额
    const testAmount = pickAmount(withdrawInfo, balance);
    console.log(`[${TAG}] 默认测试提现金额: ${testAmount}`);
    console.log(`[${TAG}] ========== Setup 完成 ==========\n`);

    return {
        adminToken,
        userToken:        session.userToken,
        userId:           session.userId,
        userName:         session.userName,
        balance,
        withdrawInfo,
        testAmount,
        // Case 5 专用：实际分配的通道类型
        dualCh1Type:      ch1Type,
        dualCh2Type:      ch2Type
    };
}

// ============================================================
// ==================== 测试用例 ==============================
// ============================================================

/**
 * Case 1: 余额 <= 0 时，后端应拒绝提现（msgCode ≠ 0）
 *         余额充足时，验证正常流程不被破坏
 */
function case1_directGuard(data) {
    const { userToken, balance, withdrawInfo, testAmount } = data;

    console.log(`\n[${TAG}] ===== Case 1: 直接余额校验 =====`);
    console.log(`[${TAG}] 当前余额: ${balance}, 尝试提现金额: ${testAmount}`);

    const result = doWithdraw(userToken, testAmount, withdrawInfo);

    // 前置条件不满足（钱包/通道问题），本 Case 无法判断
    if (result.skipReason) {
        console.error(`[${TAG}] ❌ 前置条件不满足，无法完成测试: ${result.skipReason}`);
        check(result, {
            '[Case1] ⚠️ 前置条件满足（钱包/通道已就绪）': () => false
        });
        return;
    }

    if (balance <= 0) {
        // ======================================================
        // 余额为 0 或负数 → 后端【必须拒绝】提现
        // 预期：withdrew = false（msgCode ≠ 0）
        // ======================================================
        const rejected = !result.withdrew;

        check(result, {
            '[Case1] 余额<=0时 后端正确拒绝提现（msgCode≠0）': () => rejected
        });

        if (rejected) {
            console.log(`[${TAG}] ✅ [PASS] 余额为零/负，后端拒绝提现，msgCode=${result.msgCode}, msg="${result.msg}" → 修复有效！`);
        } else {
            console.error(`[${TAG}] ❌ [FAIL] 余额=${balance}（<=0），但提现仍然成功！Bug 未修复！msgCode=0`);
        }

    } else if (balance < testAmount) {
        // 余额不足提现档位
        const rejected = !result.withdrew;
        check(result, {
            '[Case1] 余额不足时 后端正确拒绝提现': () => rejected
        });
        if (rejected) {
            console.log(`[${TAG}] ✅ [PASS] 余额(${balance}) < 提现金额(${testAmount})，后端拒绝，msgCode=${result.msgCode}`);
        } else {
            console.error(`[${TAG}] ❌ [FAIL] 余额不足但提现成功！`);
        }

    } else {
        // 余额充足 → 正常流程，提现应成功（反向验证：修复没有误杀正常场景）
        check(result, {
            '[Case1] 余额充足时 提现正常成功（确认修复未误杀正常功能）': () => result.withdrew
        });
        if (result.withdrew) {
            console.log(`[${TAG}] ✅ [PASS] 余额充足(${balance})，提现成功，正常功能完好`);
        } else {
            console.warn(`[${TAG}] ⚠️ [WARN] 余额充足但提现失败 msgCode=${result.msgCode} msg="${result.msg}"（可能有打码量/次数限制）`);
        }
    }
}

/**
 * Case 2: 边界测试 — 余额 ≈ 提现金额，验证成功后余额不变负
 *         （余额差距 < 1 才触发）
 */
function case2_boundary(data) {
    const { userToken, balance, withdrawInfo, testAmount } = data;

    console.log(`\n[${TAG}] ===== Case 2: 边界余额校验 =====`);
    console.log(`[${TAG}] 余额: ${balance}, 提现金额: ${testAmount}`);

    const diff = Math.abs(balance - testAmount);
    if (diff >= 1) {
        console.log(`[${TAG}] ℹ️ 余额与提现金额差 ${diff.toFixed(2)}，不满足边界条件，跳过`);
        check({}, { '[Case2] 边界余额测试跳过（条件不满足）': () => true });
        return;
    }

    console.log(`[${TAG}] ⚡ 余额(${balance}) ≈ 提现金额(${testAmount})，执行边界测试`);
    const result = doWithdraw(userToken, testAmount, withdrawInfo);

    if (result.skipReason) {
        console.error(`[${TAG}] ❌ 前置条件不满足: ${result.skipReason}`);
        check(result, { '[Case2] ⚠️ 前置条件满足': () => false });
        return;
    }

    check(result, {
        '[Case2] 边界情况有明确后端响应（不因异常中断）': () => result.msgCode !== null
    });

    if (result.withdrew) {
        // 提现成功时，告知人工复查余额是否为 0 而非负数
        console.log(`[${TAG}] ✅ 提现成功，理论上余额应变为 ≈ 0，请后台复查余额 >= 0`);
    } else {
        console.log(`[${TAG}] ℹ️ 提现被拒绝 msgCode=${result.msgCode} msg="${result.msg}"`);
    }
}

/**
 * Case 3: 快速重复提现 — 两次都成功则存在双重扣款漏洞
 */
function case3_duplicate(data) {
    const { userToken, balance, withdrawInfo, testAmount } = data;

    console.log(`\n[${TAG}] ===== Case 3: 重复提现幂等验证 =====`);
    console.log(`[${TAG}] 余额: ${balance}, 提现金额: ${testAmount}`);

    if (balance <= 0) {
        console.log(`[${TAG}] ℹ️ 余额不足，跳过重复提现测试`);
        check({}, { '[Case3] 重复提现测试跳过（余额不足）': () => true });
        return;
    }

    console.log(`[${TAG}] 第一次提现申请...`);
    const first = doWithdraw(userToken, testAmount, withdrawInfo);
    console.log(`[${TAG}] 第一次 → withdrew=${first.withdrew}, msgCode=${first.msgCode}, msg="${first.msg}"`);

    if (first.skipReason) {
        console.error(`[${TAG}] ❌ 第一次前置条件不满足: ${first.skipReason}`);
        check(first, { '[Case3] ⚠️ 前置条件满足': () => false });
        return;
    }

    sleep(0.3); // 极短等待，模拟快速双击

    console.log(`[${TAG}] 第二次提现申请（快速重复）...`);
    const second = doWithdraw(userToken, testAmount, withdrawInfo);
    console.log(`[${TAG}] 第二次 → withdrew=${second.withdrew}, msgCode=${second.msgCode}, msg="${second.msg}"`);

    const bothSucceeded = first.withdrew && second.withdrew;

    check({ bothSucceeded }, {
        '[Case3] 快速重复提现不应两次都成功（防双重扣款）': (r) => !r.bothSucceeded
    });

    if (bothSucceeded) {
        console.error(`[${TAG}] ❌ [FAIL] 两次提现都成功！存在双重扣款风险，余额可能变负！Bug 未修复！`);
    } else if (first.withdrew && !second.withdrew) {
        console.log(`[${TAG}] ✅ [PASS] 第一次成功，第二次被拒（msgCode=${second.msgCode}）。幂等保护有效！`);
    } else if (!first.withdrew && !second.withdrew) {
        console.warn(`[${TAG}] ⚠️ [WARN] 两次都失败，可能有其他限制（msgCode=${first.msgCode}）`);
    } else {
        console.warn(`[${TAG}] ⚠️ [WARN] 第一次失败，第二次成功（顺序异常，建议检查）`);
    }
}

/**
 * Case 4: 同通道并发竞争测试（ENABLE_RACE_TEST=true）
 * 2个VU用相同通道、相同金额几乎同时提现
 * 验证后端对同一通道的并发锁是否生效
 */
function case4_race(data, vuIndex) {
    const { userToken, balance, withdrawInfo, testAmount } = data;

    console.log(`[${TAG}][VU${vuIndex + 1}] ===== Case 4: 同通道并发竞争测试 =====`);
    console.log(`[${TAG}][VU${vuIndex + 1}] 余额: ${balance}, 提现金额: ${testAmount}`);

    const result = doWithdraw(userToken, testAmount, withdrawInfo);
    console.log(`[${TAG}][VU${vuIndex + 1}] 结果 → withdrew=${result.withdrew}, msgCode=${result.msgCode}, msg="${result.msg}"`);

    check(result, {
        [`[Case4-VU${vuIndex + 1}] 并发提现有明确后端响应`]: () => result.skipReason === null && result.msgCode !== null
    });

    if (result.withdrew) {
        console.log(`[${TAG}][VU${vuIndex + 1}] 提现成功（注意：若两个VU都成功则存在并发漏洞）`);
    } else {
        console.log(`[${TAG}][VU${vuIndex + 1}] 提现被拒 msgCode=${result.msgCode}（符合预期：并发锁生效）`);
    }
}

/**
 * Case 5: 双通道并发提现（ENABLE_DUAL_CHANNEL_TEST=true）
 *
 * 场景：同一用户余额=800，VU1 走通道A 提 500，VU2 走通道B 提 300，
 *       两个请求几乎同时发出。
 *
 * 验证目的：
 *   - 若系统只有「单通道锁」而无「用户全局余额锁」，
 *     两个不同通道的请求会各自读到相同的余额快照并同时通过校验，
 *     最终叠加扣款导致余额异常（超额扣款或变负）。
 *   - 修复有效时：两笔合计不超过余额则都能成功；
 *     合计超过余额则至少有一笔被后端拒绝。
 *
 * 判断逻辑：
 *   - ch1Amount + ch2Amount <= balance  → 两笔都应成功（正常场景）
 *   - ch1Amount + ch2Amount >  balance  → 至少一笔应被拒绝（互斥保护）
 *
 * @param {object} data  setup() 返回的数据
 * @param {number} vuIndex  0=VU1(BankCard), 1=VU2(EWallet)
 */
function case5_dualChannelRace(data, vuIndex) {
    const { userToken, balance, withdrawInfo, dualCh1Type, dualCh2Type } = data;

    // ── 计算每个VU的通道和金额 ──
    // VU1: dualCh1Type，VU2: dualCh2Type
    const isVU1      = vuIndex === 0;
    const myType     = isVU1 ? dualCh1Type : dualCh2Type;

    // 金额：优先用参数，否则按余额各取约 62.5% / 37.5% 分配
    let ch1Amount = CHANNEL1_AMOUNT > 0 ? CHANNEL1_AMOUNT : Math.floor(balance * 0.625 / 100) * 100 || 500;
    let ch2Amount = CHANNEL2_AMOUNT > 0 ? CHANNEL2_AMOUNT : Math.floor(balance * 0.375 / 100) * 100 || 300;
    const myAmount   = isVU1 ? ch1Amount : ch2Amount;
    const totalAmount = ch1Amount + ch2Amount;

    console.log(`[${TAG}][VU${vuIndex + 1}] ===== Case 5: 双通道并发提现 =====`);
    console.log(`[${TAG}][VU${vuIndex + 1}] 通道: ${myType}, 提现金额: ${myAmount}`);
    console.log(`[${TAG}][VU${vuIndex + 1}] 账户余额: ${balance}, 两笔合计: ${totalAmount}`);
    console.log(`[${TAG}][VU${vuIndex + 1}] 预期结论: ${
        totalAmount <= balance
            ? '合计<=余额，两笔都应成功'
            : '合计>余额，至少一笔应被拒绝'
    }`);

    // ── 执行提现（强制指定通道类型）──
    const result = doWithdraw(userToken, myAmount, withdrawInfo, myType);

    console.log(`[${TAG}][VU${vuIndex + 1}] 结果 → withdrew=${result.withdrew}, msgCode=${result.msgCode}, msg="${result.msg}", 通道=${result.withdrawType}`);

    if (result.skipReason) {
        console.error(`[${TAG}][VU${vuIndex + 1}] ❌ 前置条件不满足: ${result.skipReason}`);
        check(result, {
            [`[Case5-VU${vuIndex+1}(${myType})] ⚠️ 前置条件满足`]: () => false
        });
        return;
    }

    // ── 将各VU结果存入 data 以便两VU都完成后做综合断言 ──
    // k6 VU间不能直接共享变量，所以每个VU只做自身的基础check，
    // 综合判断（两VU结果对比）在日志层面输出，由 handleSummary 汇总
    check(result, {
        [`[Case5-VU${vuIndex+1}(${myType})] 有明确后端响应（非前置异常）`]:
            () => result.skipReason === null && result.msgCode !== null
    });

    if (totalAmount > balance) {
        // 合计超余额场景：两笔不能都成功 → 每个VU自身检查
        // （全局断言在 handleSummary 中说明，因为VU间无法通信）
        if (result.withdrew) {
            console.log(`[${TAG}][VU${vuIndex + 1}] ✅ 提现成功（若另一VU也成功则存在超额扣款漏洞 ⚠️）`);
        } else {
            console.log(`[${TAG}][VU${vuIndex + 1}] 提现被拒 msgCode=${result.msgCode}（符合预期：全局余额锁生效）`);
        }
    } else {
        // 合计不超余额场景：两笔都应成功
        check(result, {
            [`[Case5-VU${vuIndex+1}(${myType})] 合计<=余额，本笔应成功`]: () => result.withdrew
        });
        if (result.withdrew) {
            console.log(`[${TAG}][VU${vuIndex + 1}] ✅ [PASS] 提现成功，符合预期`);
        } else {
            console.warn(`[${TAG}][VU${vuIndex + 1}] ⚠️ [WARN] 合计未超余额但提现失败 msgCode=${result.msgCode}`);
        }
    }
}

// ============================================================
// ==================== Default 入口 ==========================
// ============================================================

export default function (data) {
    if (!data) {
        console.error(`[${TAG}] Setup 数据为空，跳过执行`);
        return;
    }

    const vuIndex = __VU - 1;

    console.log(`\n[${TAG}] ${'='.repeat(60)}`);
    console.log(`[${TAG}] 负数余额提现漏洞验证测试 v2`);
    console.log(`[${TAG}] 租户: ${TENANT_ID} | 用户: ${data.userName} | 余额: ${data.balance}`);
    console.log(`[${TAG}] ${'='.repeat(60)}\n`);

    if (ENABLE_DUAL_CHANNEL_TEST) {
        // ── Case 5：双通道并发 ──
        group(`Case 5: 双通道并发提现（跨通道余额锁验证）`, () => {
            case5_dualChannelRace(data, vuIndex);
        });

    } else if (ENABLE_RACE_TEST) {
        // ── Case 4：同通道并发 ──
        group('Case 4: 同通道并发竞争测试 (Race Condition)', () => {
            case4_race(data, vuIndex);
        });

    } else {
        // ── 顺序执行 Case 1/2/3 ──
        group('Case 1: 直接余额校验（核心验证）', () => {
            case1_directGuard(data);
        });

        // Case 之间等待 8s，避开服务端频率限制（msgCode=13）
        sleep(8);

        group('Case 2: 边界余额校验', () => {
            case2_boundary(data);
        });

        sleep(8);

        group('Case 3: 重复提现幂等验证', () => {
            case3_duplicate(data);
        });
    }
}

// ============================================================
// ==================== 汇总报告 ==============================
// ============================================================

export function handleSummary(data) {
    const checks = data.metrics?.checks;
    const total  = checks?.values?.count  ?? 'N/A';
    const rate   = checks?.values?.rate   != null
        ? (checks.values.rate * 100).toFixed(1) + '%'
        : 'N/A';

    const ch1 = CHANNEL1_AMOUNT > 0 ? CHANNEL1_AMOUNT : '自动';
    const ch2 = CHANNEL2_AMOUNT > 0 ? CHANNEL2_AMOUNT : '自动';

    const lines = [
        '='.repeat(65),
        '  负数余额提现漏洞验证 v2 - 结果汇总',
        '='.repeat(65),
        `  租户:           ${TENANT_ID}`,
        `  目标用户:       ${TARGET_USER || '（自动注册）'}`,
        `  同通道并发:     ${ENABLE_RACE_TEST ? '已启用(Case4)' : '未启用'}`,
        `  双通道并发:     ${ENABLE_DUAL_CHANNEL_TEST ? `已启用(Case5) ${CHANNEL1_TYPE || 'Ch1'}=${ch1} ${CHANNEL2_TYPE || 'Ch2'}=${ch2}` : '未启用'}`,
        `  总 Checks:      ${total}`,
        `  通过率:         ${rate}`,
        '',
        '  【结果判读】',
        '  Case 1 PASS → 余额<=0时后端正确拦截，修复有效 ✅',
        '  Case 1 FAIL → 余额<=0仍可提现，Bug 未修复   ❌',
        '  Case 3 PASS → 重复提现第二次被拒，幂等保护有效 ✅',
        '  Case 3 FAIL → 两次都成功，存在双重扣款漏洞   ❌',
        '  Case 4      → 同通道，两VU都成功=并发锁未生效 ⚠️',
        '',
        '  Case 5 双通道并发判读：',
        `  合计(${ch1}+${ch2})<=余额 → 两笔都成功=正常 ✅`,
        `  合计(${ch1}+${ch2})>余额  → 两笔都成功=全局余额锁缺失 ❌`,
        `  合计(${ch1}+${ch2})>余额  → 至少一笔失败=全局锁有效 ✅`,
        '  ⚠️ 需查阅 VU1 和 VU2 的日志确认各自结果',
        '',
        '  【根因回顾】',
        '  若系统只有「单通道锁」无「用户全局余额锁」，',
        '  不同通道的并发请求各自读到相同余额快照，',
        '  同时通过校验 → 叠加扣款 → 余额变负',
        '  修复方案：余额扣减必须加用户级别的分布式锁或乐观锁',
        '='.repeat(65)
    ];

    return { stdout: lines.join('\n') + '\n' };
}
