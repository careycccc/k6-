/**
 * 提现组装器 —— 支持强制指定渠道类型 + 连续多笔的提现封装
 *
 * 背景：项目现成的 executeWithdrawCase/RunWithDrawCase(withdraw/withdraw.test.js)
 * 只支持单笔、且渠道类型是从候选里随机挑的，不支持强制指定、不支持循环多笔，
 * 不能直接用于这次"每账号2-3笔、按账号身份强制走USDT或法币"的需求。
 *
 * 核心"强制指定通道+透传真实msgCode"的写法照抄
 * withdraw/negativeBalanceWithdraw.test.js 的 doWithdraw(forceType参数)/
 * rawWithdrawApply —— withdrawApi.js 的 withdrawApply 在 msgCode!==0 时会
 * 直接丢弃细节返回 null，没法判断是不是 msgCode=13 频率限制，所以不能直接用。
 */

import { sleep } from 'k6';
import { tenantRequest } from '../../../libs/http/tenantRequest.js';
import { getWithdrawBasicInfo, getUserWithdrawWallet, setWithdrawPassword } from '../withdraw/withdrawApi.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import { getAccountBalance } from '../balance/balance.test.js';
import {
    getWithdrawLockPageList, lockWithdrawOrder, getCanWithdrawChannelByOrder,
    thirdWithdraw, confirmWithdrawOrder, artificialConfirmWithdrawOrder
} from '../withdraw/backendWithdrawApi.js';

/**
 * 投注后游戏那边(第三方游戏服务商)的余额变化，不会立即同步回主钱包——
 * getAccountBalance 内部打的 /api/ThirdGame/RecoverSaasBalance 这个接口，
 * 顾名思义是主动触发"把游戏侧余额同步回来"，不是单纯的只读查询。2026-10-26
 * 用户指出：提现前应该先调用它看游戏那边还有没有钱，有就等1s再提现，这样
 * 主钱包(getWithdrawBasicInfo 的 balance 字段)才能及时反映最新余额——不调
 * 这一步、靠自然延迟硬查 getWithdrawBasicInfo，很容易查到"明明有钱却显示
 * 没有"的过期数据。
 */
function syncGameBalance(token) {
    const info = getAccountBalance(token);
    if (info && info.balance > 0) {
        sleep(1);
    }
    return info;
}

/** 透传原始响应(含msgCode)，不像 withdrawApi.js 的 withdrawApply 那样在失败时丢弃细节 */
function rawWithdrawApply(token, amount, walletId, withdrawCategoryId, withdrawType) {
    const payload = { amount, walletId, withdrawCategoryId, withdrawType, withdrawPassword: '123456' };
    return tenantRequest('/api/Withdraw/WithdrawApply', payload, { token, isDesk: true });
}

/**
 * 提现前置准备：加全部钱包(银行卡/电子钱包/USDT) + 设置提现密码。
 * 幂等，账号已有钱包/密码时后端自己处理，不需要调用方关心。
 */
export function prepareWithdraw(adminToken, userId, userToken) {
    addAllWallets(adminToken, userId, userToken);
    setWithdrawPassword(userToken);
    sleep(1);
}

/**
 * 走完后台审核放款流程，让提现订单从Wait变成Pass——不能直接用项目现成的
 * withdraw/backendWithdrawApi.js 的 runBackendWithdrawApproval()：那个函数
 * "获取三方通道失败"时直接判定整个审核失败(return false)，只有"三方提现
 * 调用本身失败"才会降级到人工确认兜底。2026-10-26在3006商户EWallet渠道
 * 实测到：固定卡在"获取三方通道"这一步失败("没有可用的提现通道")，不是
 * 偶发——这个环境里至少部分渠道没有配置三方代付通道，只能走人工确认，但
 * runBackendWithdrawApproval的兜底覆盖不到这种情况。
 *
 * 这里自己组装同样的5步流程，但把"获取通道失败"也纳入兜底范围：拿不到
 * 通道就直接走人工确认，不是直接放弃——两种"三方这条路走不通"的失败原因
 * 理应得到同样的兜底，而不是厚此薄彼。
 *
 * runBackendWithdrawApproval 被项目里至少15个现成脚本依赖，不修改它的
 * 行为，这里是平行的、更宽容的替代实现，只用于这个feature内部。
 *
 * @param {string} adminToken
 * @param {number} userId
 * @param {string} withdrawType
 * @param {number} amount
 * @returns {boolean}
 */
function approveWithdrawOrder(adminToken, userId, withdrawType, amount) {
    const orderInfo = getWithdrawLockPageList(adminToken, userId, withdrawType, amount, amount);
    if (!orderInfo) { console.error('[WithdrawApprove] 未找到待审核订单'); return false; }

    sleep(1);
    if (!lockWithdrawOrder(adminToken, userId, orderInfo)) { console.error('[WithdrawApprove] 锁定订单失败'); return false; }

    sleep(1);
    const channelId = getCanWithdrawChannelByOrder(adminToken, userId, orderInfo);
    if (!channelId) {
        console.warn('[WithdrawApprove] 获取三方通道失败，降级到人工确认出款...');
        sleep(1);
        return artificialConfirmWithdrawOrder(adminToken, userId, orderInfo);
    }

    sleep(1);
    if (!thirdWithdraw(adminToken, userId, orderInfo, channelId)) {
        console.warn('[WithdrawApprove] 三方提现失败，降级到人工确认出款...');
        sleep(1);
        return artificialConfirmWithdrawOrder(adminToken, userId, orderInfo);
    }

    sleep(1);
    return confirmWithdrawOrder(adminToken, userId, orderInfo);
}

/**
 * 发起一笔提现，强制走指定渠道类型，并走完后台审核放款流程。
 *
 * ⚠️ 不要用 basicInfo.balance 在客户端预判"余额够不够"去拦截请求——
 * 2026-10-26 实测过这个思路是错的：充值2000不投注，直接申请USDT提现100，
 * balance 字段当时也是0，但 WithdrawApply 仍然正常返回 msgCode=0 成功；
 * 而用 balance 做客户端预判拦截后，反而会把本该交给后端判定的请求在本地
 * 直接拦掉，导致后端连一条订单记录都不会生成——这完全违背造数的目的。
 * (后续排查确认：当时查到 balance=0 是因为查询前没有触发游戏余额同步，
 * 见 syncGameBalance 注释)真正的拒绝信号只能是后端 WithdrawApply 返回的
 * msgCode(比如142="Balance is not enough")——这里只管发请求+先同步一次
 * 余额，用真实响应判断，不做任何本地猜测性拦截。
 *
 * ⚠️ 2026-10-26重大发现并修复：WithdrawApply返回msgCode=0只代表"申请提交
 * 成功"，订单会停在withdrawState=Wait，不会自动变成Pass(真正放款成功)——
 * 之前这里一直把"申请成功"当成"提现成功"返回给调用方，但实测确认同一
 * 商户产生的订单全部停在Wait，没有一笔是Pass。现在申请成功后补上
 * approveWithdrawOrder()(见下方定义)走完完整后台审核放款流程让订单变Pass，
 * withdrew 字段改为"申请成功且审核放款也成功"才算true，更贴近"提现成功"
 * 的真实语义。
 *
 * @param {string} adminToken
 * @param {number} userId
 * @param {string} token
 * @param {number} amount
 * @param {string} forceType - 'USDT' 或某个法币类型('BankCard'/'EWallet'等)
 * @param {{audit?:boolean}} [opts] - audit:false 时申请成功后故意不走审核放款，
 *   留给明天补单(2026-10-27新增，跟充值的assembleXXXRecharge({audit})对称)
 * @returns {{withdrew:boolean, msgCode:number|null, msg:string, skipReason:string|null, withdrawType:string, approved?:boolean, pending?:boolean}}
 */
export function doWithdrawOnce(adminToken, userId, token, amount, forceType, opts = {}) {
    const { audit = true } = opts;
    syncGameBalance(token);
    const basicInfo = getWithdrawBasicInfo(token);
    if (!basicInfo) {
        console.warn(`[WithdrawAssembler] 跳过: 获取提现基础信息失败 type=${forceType}`);
        return { withdrew: false, msgCode: null, msg: '获取提现基础信息失败', skipReason: 'NO_BASIC_INFO', withdrawType: forceType };
    }

    // 业务层面的正常拒绝条件：次数用完/打码量未清零——不是脚本错误，调用方要识别 BUSINESS_SKIP
    if (basicInfo.userTodayWithdrawCount === 0) {
        console.warn(`[WithdrawAssembler] 跳过: 今日提现次数已用完 type=${forceType}`);
        return { withdrew: false, msgCode: null, msg: '今日提现次数已用完', skipReason: 'DAILY_COUNT_LIMIT', withdrawType: forceType };
    }
    if (basicInfo.amountCoding && basicInfo.amountCoding !== 0) {
        console.warn(`[WithdrawAssembler] 跳过: 打码量未清零(剩余${basicInfo.amountCoding}) type=${forceType}`);
        return { withdrew: false, msgCode: null, msg: `打码量未清零(剩余${basicInfo.amountCoding})`, skipReason: 'CODING_NOT_CLEARED', withdrawType: forceType };
    }

    const category = (basicInfo.withdrawCategoryList || []).find(c => c.withdrawType === forceType);
    if (!category) {
        console.warn(`[WithdrawAssembler] 跳过: 该商户没有${forceType}提现通道，实际有${(basicInfo.withdrawCategoryList || []).map(c => c.withdrawType).join(',')}`);
        return { withdrew: false, msgCode: null, msg: `该商户没有${forceType}提现通道`, skipReason: 'NO_SUCH_CHANNEL', withdrawType: forceType };
    }

    const walletId = getUserWithdrawWallet(token, forceType);
    if (!walletId) {
        console.warn(`[WithdrawAssembler] 跳过: 未绑定${forceType}钱包(addAllWallets可能未覆盖这个类型)`);
        return { withdrew: false, msgCode: null, msg: `未绑定${forceType}钱包`, skipReason: 'NO_WALLET', withdrawType: forceType };
    }

    let resp = null;
    const maxRetry = 3;
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
        resp = rawWithdrawApply(token, amount, walletId, category.id, forceType);
        if (!resp) break;
        if (resp.msgCode !== 13) break;
        const waitSec = attempt * 5;
        console.warn(`[WithdrawAssembler] msgCode=13 频率限制，${waitSec}s后重试(${attempt}/${maxRetry})`);
        sleep(waitSec);
    }

    if (!resp) {
        console.warn(`[WithdrawAssembler] 跳过: 网络异常或接口无响应 type=${forceType}`);
        return { withdrew: false, msgCode: null, msg: '网络异常或接口无响应', skipReason: 'NO_RESPONSE', withdrawType: forceType };
    }
    if (resp.msgCode !== 0) {
        console.warn(`[WithdrawAssembler] 提现申请被拒绝: msgCode=${resp.msgCode} msg=${resp.msg} amount=${amount} walletId=${walletId} categoryId=${category.id} type=${forceType}`);
        return {
            withdrew: false, msgCode: resp.msgCode, msg: resp.msg || '',
            skipReason: 'APPLY_REJECTED', withdrawType: forceType, actualAmount: amount
        };
    }

    if (!audit) {
        // 故意不走审核放款，留给明天补单——订单停在Wait，不调approveWithdrawOrder。
        // 跟充值不同：提现的Wait没有"5-6分钟自动转Cancel"机制，backfill阶段
        // 要靠userId+withdrawType+amount重新定位这笔订单(见resolvePendingWithdraw)，
        // 不需要也拿不到orderNo(WithdrawApply响应本身不返回它)。
        console.log(`[WithdrawAssembler] 提现已申请(故意不审核，留给明天补单): userId=${userId} amount=${amount} type=${forceType}`);
        return {
            withdrew: false, pending: true, msgCode: resp.msgCode, msg: resp.msg || '',
            skipReason: null, withdrawType: forceType, actualAmount: amount
        };
    }

    // 申请成功，走完整后台审核放款流程(先sleep让订单落库可查，避免查询太快查不到)
    sleep(2);
    const approved = approveWithdrawOrder(adminToken, userId, forceType, amount);
    if (!approved) {
        console.warn(`[WithdrawAssembler] 提现申请成功但审核放款失败: userId=${userId} amount=${amount} type=${forceType}`);
    }
    return {
        withdrew: approved,
        msgCode: resp.msgCode,
        msg: resp.msg || '',
        skipReason: approved ? null : 'APPROVAL_FAILED',
        withdrawType: forceType,
        actualAmount: amount,
        approved
    };
}

/**
 * 补单专用：决定一笔"故意不审核"的提现是approve还是维持Wait不动。
 * approve=false时什么都不做——提现没有现成的"拒绝"接口，也没有像充值Cancel
 * 那样的自动终态，"不批准"只能是"不采取会让它成功的操作"，订单继续停Wait。
 * approve=true时复用 approveWithdrawOrder 按userId+withdrawType+amount查找
 * 当前处于Wait状态的订单——这笔账号的"立即审核"几笔此时应该已经是Pass，
 * 不会和这笔pending的订单混淆。
 * @returns {{approved:boolean}}
 */
export function resolvePendingWithdraw(adminToken, userId, withdrawType, amount, approve) {
    if (!approve) return { approved: false };
    const approved = approveWithdrawOrder(adminToken, userId, withdrawType, amount);
    if (!approved) console.error(`[WithdrawAssembler] [补单] userId=${userId} amount=${amount} type=${withdrawType} 补单审核调用失败`);
    else console.log(`[WithdrawAssembler] [补单] userId=${userId} amount=${amount} type=${withdrawType} 补单审核通过`);
    return { approved };
}

/**
 * 连续发起多笔提现，遇到业务层面的正常拒绝(次数用完/打码量未清零)立即停止剩余笔数，
 * 不当作脚本错误。返回每笔的结果 + 最终停止原因(如果提前停止)。
 *
 * 2026-10-27新增 pendingCount：跟充值的operateAccount一样，先做完全部"立即
 * 审核"的，再做"故意延迟"的——这样哪怕立即那几笔里有1笔业务拒绝触发了
 * stopReason提前停止，也不会再去发起本该延迟的那笔(避免当天流程中断后
 * 还留下一个"应该跨天但没真正发起"的幽灵pending记录)。
 * @param {number} [pendingCount=0]
 * @returns {{attempts:Array, stopReason:string|null}}
 */
export function doWithdrawMultiple(adminToken, userId, token, count, amount, forceType, pendingCount = 0) {
    const attempts = [];
    let stopReason = null;
    const actualPending = Math.min(pendingCount, Math.max(0, count - 1));
    const immediateCount = count - actualPending;

    for (let i = 0; i < immediateCount; i++) {
        if (i > 0) sleep(2);
        const result = doWithdrawOnce(adminToken, userId, token, amount, forceType, { audit: true });
        attempts.push(result);
        if (!result.withdrew && (result.skipReason === 'DAILY_COUNT_LIMIT' || result.skipReason === 'CODING_NOT_CLEARED')) {
            stopReason = result.skipReason;
            break;
        }
    }
    if (!stopReason) {
        for (let i = 0; i < actualPending; i++) {
            sleep(2);
            const result = doWithdrawOnce(adminToken, userId, token, amount, forceType, { audit: false });
            attempts.push(result);
            if (!result.pending && (result.skipReason === 'DAILY_COUNT_LIMIT' || result.skipReason === 'CODING_NOT_CLEARED')) {
                stopReason = result.skipReason;
                break;
            }
        }
    }
    return { attempts, stopReason };
}

/**
 * 探测该商户是否支持USDT提现。2026-10-26 用户指出充值USDT支持和提现USDT
 * 支持要分开判断，不能假设一致(有的商户可能只支持其中一种)。提现这边只有
 * 一套 withdrawCategoryList，不像充值要分经典/商品两路查。
 */
export function detectUsdtWithdrawSupport(token) {
    const info = getWithdrawBasicInfo(token);
    const list = (info && Array.isArray(info.withdrawCategoryList)) ? info.withdrawCategoryList : [];
    return list.some(c => c.withdrawType === 'USDT');
}
