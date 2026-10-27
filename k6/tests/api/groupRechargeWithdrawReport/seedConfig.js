/**
 * 集团充提报表核对 —— 造数/验证共用常量
 *
 * 范围限定在 3004/3006/3007：这几个租户在 envconfig.js 里配置了非空
 * GOOGLE_SECRET，能用自动化脚本正常登录后台核对数据；3001/3002/3005 没配
 * 密钥，排除在外。
 *
 * 3003 原本也在范围内，2026-10-26 实测排除：①"添加提现钱包"接口要求验证码
 * (msgCode=5029 Verification code cannot be empty)，现有addFrontBankCard/
 * addFrontEWallet/addFrontUsdt完全没处理这个参数，导致该商户所有账号钱包
 * 绑定全部失败、提现无法进行；②充值本身也有问题——经典模式BankCard直充
 * 报"Order failed"(msgCode=19)，商品模式的BankCard商品发起充值又报
 * "Unsupport recharge mode"(msgCode=10049，配置里写着支持、实际不通)。
 * 两边都走不通，用户已确认排除3003，不在当前这次造数范围内。
 */

export const TARGET_TENANT_IDS = ['3004', '3006', '3007'];

// 每个账号整体先随机决定是不是"USDT账号"(充值和提现都跟随这个标记)，
// 不是充值/提现各自独立随机——这是已经和用户确认过的设计决定。
export const USDT_ACCOUNT_RATE = 0.30;

export const ACCOUNT_COUNT_MIN = 15;
export const ACCOUNT_COUNT_MAX = 25;

export const BET_COUNT_MIN = 1;
export const BET_COUNT_MAX = 2;
export const BET_AMOUNT_MIN = 200;
export const BET_AMOUNT_MAX = 500;

export const WITHDRAW_COUNT_MIN = 2;
export const WITHDRAW_COUNT_MAX = 3;

// USDT充值到账金额范围：底层depositRecharge是透传实现，自己控制金额，
// 不像frontendRecharge那样被内部强制覆盖成50-300。用和普通充值同量级的
// 金额，方便和法币渠道的统计做量级上的交叉比对。
export const USDT_RECHARGE_AMOUNT_MIN = 500;
export const USDT_RECHARGE_AMOUNT_MAX = 2000;

// 单笔USDT提现金额(amount，到账前会扣手续费，实际到账看actualAmount字段)
export const USDT_WITHDRAW_AMOUNT = 100;
// 单笔法币提现金额
export const FIAT_WITHDRAW_AMOUNT = 150;

/** [min,max]闭区间随机整数 */
export function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
// 多天衰减造数系列（第二阶段，2026-10-26新增）——配合 dailyRunner.js 使用
//
// 目的：单日一次性造数只能验证报表"当天数据对不对"，验证不了报表核心的
// "按成功时间统计(非发起时间)"和"按天去重、多天累加"这两个口径——这些
// 只有构造跨天的订单/行为才能测出来。所以要连续真实运行多天，人数逐天
// 衰减(模拟"活动刚上线时人多、慢慢冷却"的真实曲线)，并故意让一部分充值
// 订单"今天发起、明天才审核通过"，制造创建时间和成功时间跨天的样本。
// ============================================================

/** 系列固定跑几天（真实自然日，每天运行一次 dailyRunner.js）*/
export const TOTAL_DAYS = 5;

/** 第1天新增账号数(固定)，之后每天新增数=前一天的一半(向下保护，不会衰减到0) */
export const DAY1_NEW_COUNT = 20;
export const NEW_COUNT_FLOOR = 1;

/** 第1天"捞"老会员数量范围(随机)；第2天固定5个；第3天起继续约减半(向下保护) */
export const DAY1_FISH_MIN = 5;
export const DAY1_FISH_MAX = 10;
export const DAY2_FISH_COUNT = 5;
export const FISH_COUNT_FLOOR = 2;

/** 每账号充值笔数(不再是1笔)，其中 PENDING_MIN~MAX 笔故意不立即审核(留给明天补单) */
export const RECHARGE_COUNT_MIN = 3;
export const RECHARGE_COUNT_MAX = 5;
export const RECHARGE_PENDING_MIN = 2;
export const RECHARGE_PENDING_MAX = 3;

/**
 * 提现同理要构造跨天样本(2026-10-27用户指出，跟充值对称)：WITHDRAW_COUNT
 * 本来只有2-3笔，固定留1笔故意不审核即可，不用MIN~MAX范围——留太多会导致
 * "立即完成"的笔数经常变成0或1，当天没有可供对比的成功提现基线样本。
 * 提现的Wait状态和充值的Wait不同，没有"5-6分钟自动转Cancel"的机制，"不批准"
 * 只能是维持Wait不动(项目里没有现成的"拒绝提现"接口可用)，不会变成Reject
 * 终态——这个不对称是业务系统本身决定的，不是本次改动能解决的。
 */
export const WITHDRAW_PENDING_COUNT = 1;

/** 补单：对前一天"故意不审核"的订单，随机挑这个比例审核通过，其余维持Cancel不动 */
export const BACKFILL_APPROVE_RATE = 0.5;

/** 捞到的老会员重置密码后统一用这个密码登录(和新账号密码保持一致，复用现有登录逻辑) */
export const FISHED_PASSWORD = 'qwer1234';

/**
 * "衰减一步"：给定前一天的实际值，算出今天的值(约减半，向下保护)。
 * 只负责"昨天→今天"这一步，不负责"从第1天推算到任意天"——dailyRunner.js
 * 会把每天实际使用的 newCount/fishTarget 记进状态文件，今天的值永远基于
 * "状态文件里记录的昨天实际值"算出来，不是凭公式重新反推历史。
 */
export function decayNewCount(prevCount) {
    return Math.max(NEW_COUNT_FLOOR, Math.round(prevCount / 2));
}
export function decayFishCount(prevCount) {
    return Math.max(FISH_COUNT_FLOOR, Math.round(prevCount / 2));
}
