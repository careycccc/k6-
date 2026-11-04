/**
 * 多天随机用户行为框架（公共模块：纯逻辑，不发请求，不依赖 k6，node 里也能直接单测）
 *
 * 目的：造数时让"老用户每天做什么"完全随机——今天可能登录也可能不登录，登录了可能充值也可能不充，
 * 充值可能 0/1/2/3…笔；投注、提现同理(0-n)。项目里一个用户的行为目前只有 登录/充值/投注/提现 四种。
 *
 * 设计要点
 *  1) 决策与执行分离：decideDay() 是纯函数，只决定"今天做什么(意图)"，不发任何请求；simulateDay()
 *     按意图调用调用方注入的执行器(executors)，k6 副作用留在调用方，这个模块本身可单测。
 *  2) 可复现：随机数用种子化 PRNG(mulberry32)，种子 = hash(账号自己的 seed, 账号, 日期)。同一账号同一天
 *     不管决策多少次结果都一样——DRY_RUN 预览和实跑完全一致，出了问题能原样复现。PRNG 和哈希只用整数
 *     运算，k6(goja) 与 node(V8) 同种子结果一致。【契约】抽样顺序(登录→充值→投注→提现)和 hashSeed 的
 *     算法不能改，否则已有账号以后每天的决策都会变。改动前后可用这几个值核对：
 *     hashSeed('a','b')=692878806，hashSeed(1,'acc','2026-11-05')=3239194630，
 *     createRng(12345) 前三个 next() 依次约 0.979728 / 0.306752 / 0.484205。
 *  3) 用户画像(persona)：注册时按权重给账号抽一个，决定它的登录概率(可随天数变化)和充值/投注/提现
 *     的倾向，让个体之间有差异。默认模型把"次日登录率(70/75/80%)"和"付费倾向(小额/普通/常充/大户)"
 *     两个维度组合成 12 种画像，登录率还会逐天衰减。模型全部可配置(见 DEFAULT_BEHAVIOR_MODEL)。
 *  4) 前置依赖：充值/投注/提现都以"今天登录"为前提(登录=拿到会员 token)。
 *  5) 不回填历史：只决定"今天"。后端登录日志/订单的时间是真实时间，补不了过去，漏跑哪天哪天就没有行为。
 */

/** 登录之后可能发生的行为，顺序即抽样顺序，也是执行顺序(先有钱才能投注、提现) */
export const BEHAVIOR_KINDS = ['recharge', 'bet', 'withdraw'];

// ================= 种子化随机数 =================

/** 32 位字符串哈希(FNV-1a)：把任意个片段混成一个种子 */
export function hashSeed(...parts) {
    let h = 0x811c9dc5;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 创建种子化随机数发生器：next() 取 [0,1)，chance(p) 以概率 p 返回 true，int(min,max) 闭区间整数，weighted(权重数组) 返回下标 */
export function createRng(seed) {
    const next = mulberry32(seed);
    return {
        next,
        chance: p => next() < p,
        int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
        weighted(weights) {
            let total = 0;
            for (const w of weights) total += w;
            let r = next() * total;
            let lastPositive = 0;
            for (let i = 0; i < weights.length; i++) {
                if (weights[i] > 0) {
                    lastPositive = i;
                    r -= weights[i];
                    if (r < 0) return i;
                }
            }
            return lastPositive;
        }
    };
}

// ================= 日期 =================

/** 两个 YYYY-MM-DD 日期相差的天数(a-b) */
export function diffDays(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

// ================= 行为模型 =================

// 次日登录率三档(用户要求"次日约 70%~80% 的会员会登录")，每个账号注册时固定一档
const LOGIN_BASE_TIERS = [
    { name: 'active70', base: 0.70 },
    { name: 'active75', base: 0.75 },
    { name: 'active80', base: 0.80 }
];

// 登录率每天比前一天减少多少(相对)：0.10 = 每天乘 0.9。循环连乘而不是 Math.pow——浮点乘法是确定的，
// 避免 pow 在 k6(goja)/node(V8) 之间可能差 1ulp，影响"同账号同一天决策可复现"
const LOGIN_DECAY_PER_DAY = 0.10;
// 登录率下限(用户 2026-11-04 要求加 5%)：衰减到这个值就不再往下降，保证 30/60/90 日这类长周期档位
// 始终有少量人可验。不加的话次日75%时第30天约3.5%、第60/90天约0。0=不设下限
const LOGIN_FLOOR = 0.05;

function loginProbOf(base, d) {
    if (d <= 0) return 1;
    let p = base;
    for (let i = 1; i < d; i++) p *= (1 - LOGIN_DECAY_PER_DAY);
    return Math.max(LOGIN_FLOOR, p);
}

// 付费倾向四档，和登录率独立(组合出 3x4=12 种个体)。boost 把"0 次"的权重除以它：>1 更爱做，<1 更不爱做
const PAYER_TIERS = [
    { name: 'low', weight: 35, boost: { recharge: 0.5, bet: 0.7, withdraw: 0.5 } },
    { name: 'mid', weight: 40, boost: { recharge: 1, bet: 1, withdraw: 1 } },
    { name: 'high', weight: 20, boost: { recharge: 2, bet: 1.5, withdraw: 1.5 } },
    { name: 'whale', weight: 5, boost: { recharge: 4, bet: 2.5, withdraw: 3 } }
];

const DEFAULT_PERSONAS = [];
for (const a of LOGIN_BASE_TIERS) {
    for (const p of PAYER_TIERS) {
        DEFAULT_PERSONAS.push({ name: `${a.name}_${p.name}`, weight: p.weight, loginProb: d => loginProbOf(a.base, d), boost: p.boost });
    }
}

/**
 * 默认行为模型(可整体替换，也可只改某一项)。
 *
 * 默认值按用户 2026-11-04 的要求定：两层随机——
 *   第一层 每个老会员每天有一定概率登录：次日 70%~80%(注册时在 70/75/80 三档里固定一档)，之后每天
 *          比前一天减少 10%(相对，×0.9)，最低降到 5%(LOGIN_FLOOR)，不登录就什么都不做；
 *   第二层 登录的人再分别随机 充值/投注/提现 0-n 次，也可能只登录什么都不做；每个会员还有自己的付费
 *          倾向(小额/普通/常充/大户，权重 35/40/20/5)，决定它登录后做这些事的积极程度。
 *
 *  personas[].loginProb(d)  注册后第 d 天(次日 d=1)当天登录的概率
 *  personas[].boost         可选。对"非 0 次"的倾向系数：>1 更爱做，<1 更不爱做(把 0 次的权重除以它)，默认 1
 *  behaviors[kind].countWeights  登录当天做 kind 的次数分布，下标=次数，值=权重(这是"普通"档，其它档用 boost 调)
 *  behaviors[kind].amount        每次的金额范围，决策时就抽好(可复现，DRY_RUN 能预览总额)
 *
 * 登录当天整体约 44% 充值、60% 投注、24% 提现，约 19% 只登录什么都不做；大户约 77% 充值、50% 提现。
 * 次数分布和各档 boost 都是我定的默认值，可按需调。
 *
 * 注意：这里的提现/投注只是"意图"。真正执行时提现要先有钱包，并要求打码量清零、当日次数未用完，
 * 随机充值后打码量通常没清，会被业务规则拒绝，成功的提现需要先投注把流水打满。
 */
export const DEFAULT_BEHAVIOR_MODEL = {
    personas: DEFAULT_PERSONAS,
    behaviors: {
        recharge: { countWeights: [55, 25, 12, 5, 3], amount: { min: 2000, max: 5000 } },
        bet: { countWeights: [40, 30, 15, 10, 5], amount: { min: 100, max: 1000 } },
        withdraw: { countWeights: [75, 20, 5], amount: { min: 100, max: 500 } }
    }
};

function personaOf(name, model) {
    return model.personas.find(p => p.name === name) || model.personas[0];
}

/** 按权重给账号抽画像(由账号 seed 确定，同一个 seed 永远抽到同一个画像) */
export function drawPersona(seed, model = DEFAULT_BEHAVIOR_MODEL) {
    const rng = createRng(hashSeed(seed, 'persona'));
    return model.personas[rng.weighted(model.personas.map(p => p.weight))].name;
}

/** 新账号的行为档案：随机生成 seed(整个框架唯一的"真随机"来源，生成后固化进账号记录) + 画像 */
export function newProfile(model = DEFAULT_BEHAVIOR_MODEL) {
    const seed = Math.floor(Math.random() * 4294967296) >>> 0;
    return { seed, persona: drawPersona(seed, model) };
}

/** 老账号补档案：没有 seed 就用账号派生一个确定的 legacy seed(不依赖运行时随机，每次补出来都一样)；画像缺失/不在模型里则重抽 */
export function ensureProfile(acc, model = DEFAULT_BEHAVIOR_MODEL) {
    if (acc.seed === undefined || acc.seed === null) acc.seed = hashSeed('legacy', acc.account);
    if (!acc.persona || !model.personas.some(p => p.name === acc.persona)) acc.persona = drawPersona(acc.seed, model);
    return acc;
}

// ================= 决策(纯函数) =================

/**
 * 决定某账号某天做什么。返回
 *   { date, daysSinceRegister, persona, login: boolean, recharge: [金额...], bet: [金额...], withdraw: [金额...] }
 * 数组长度就是次数；没登录则三个数组都为空。同样的入参永远得到同样的结果。
 */
export function decideDay({ seed, account, date, registerDate, persona, model = DEFAULT_BEHAVIOR_MODEL }) {
    const p = personaOf(persona, model);
    const days = diffDays(date, registerDate);
    const rng = createRng(hashSeed(seed, account, date));
    const intent = { date, daysSinceRegister: days, persona: p.name, login: false, recharge: [], bet: [], withdraw: [] };

    if (!rng.chance(p.loginProb(days))) return intent;
    intent.login = true;

    for (const kind of BEHAVIOR_KINDS) {
        const cfg = model.behaviors[kind];
        if (!cfg) continue;
        const boost = (p.boost && p.boost[kind]) || 1;
        const weights = cfg.countWeights.slice();
        weights[0] = weights[0] / boost;
        const n = rng.weighted(weights);
        for (let i = 0; i < n; i++) intent[kind].push(rng.int(cfg.amount.min, cfg.amount.max));
    }
    return intent;
}

// ================= 编排(执行器由调用方注入) =================

function summarize(intent, outcome) {
    const ok = list => list.filter(r => r && r.success);
    const amount = list => ok(list).reduce((s, r) => s + (r.amount || 0), 0);
    return {
        login: outcome.login && outcome.login.success ? 1 : 0,
        recharge: ok(outcome.recharge).length, rechargeAmount: amount(outcome.recharge),
        bet: ok(outcome.bet).length, betAmount: amount(outcome.bet),
        withdraw: ok(outcome.withdraw).length, withdrawAmount: amount(outcome.withdraw),
        planned: { recharge: intent.recharge.length, bet: intent.bet.length, withdraw: intent.withdraw.length }
    };
}

/**
 * 模拟某账号的"今天"：先 decideDay 得到意图，再按 登录→充值→投注→提现 的顺序调用执行器。
 *
 * executors：
 *   login({account,date})                      -> { success, token }   成功才会继续后面的行为
 *   recharge/bet/withdraw({token,amount,index,account,date}) -> { success, amount?, reason? }
 * 某类行为没传执行器：该类每次都记 { success:false, skipped:'no_executor' }(意图照常产生，方便先接一部分)。
 * 某类行为失败一次，同类后面的不再执行(记 skipped:'previous_failed')，避免通道坏了还连着失败浪费时间。
 *
 * 返回 { intent, outcome, summary }：outcome 是每次执行的结果，summary 是成功次数/金额汇总。
 */
export function simulateDay({ seed, account, date, registerDate, persona, model = DEFAULT_BEHAVIOR_MODEL, executors = {} }) {
    const intent = decideDay({ seed, account, date, registerDate, persona, model });
    const outcome = { login: null, recharge: [], bet: [], withdraw: [] };
    if (!intent.login) return { intent, outcome, summary: summarize(intent, outcome) };

    const loginRes = executors.login ? executors.login({ account, date }) : null;
    outcome.login = loginRes || { success: false, reason: 'no_login_executor' };
    if (!outcome.login.success) return { intent, outcome, summary: summarize(intent, outcome) };

    for (const kind of BEHAVIOR_KINDS) {
        const exec = executors[kind];
        let failed = false;
        intent[kind].forEach((amount, index) => {
            if (!exec) { outcome[kind].push({ success: false, skipped: 'no_executor', amount }); return; }
            if (failed) { outcome[kind].push({ success: false, skipped: 'previous_failed', amount }); return; }
            const res = exec({ token: outcome.login.token, amount, index, account, date }) || { success: false, reason: 'no_result' };
            if (res.amount === undefined) res.amount = amount;
            if (!res.success) failed = true;
            outcome[kind].push(res);
        });
    }
    return { intent, outcome, summary: summarize(intent, outcome) };
}

// ================= 账号账本(模拟结果写回账号记录) =================

/**
 * 首充日：优先用记录里的 firstRechargeDate；老记录没有这个字段时，D0(注册当天)有充值就等于注册日，
 * 否则这个账号还没首充过(返回 null)。
 */
export function firstRechargeDateOf(acc) {
    if (acc.firstRechargeDate) return acc.firstRechargeDate;
    return acc.d0RechargeCount > 0 ? acc.registerDate : null;
}

/**
 * 把 simulateDay 的 summary 记回账号(原地修改)：
 *   lastSimDate        这天已模拟过的幂等标记(每天只模拟一次)
 *   rechargeCount/rechargeTotalAmount  累计充值笔数/金额(老记录没有就从 d0 字段起算)
 *   firstRechargeDate  之前从未首充、今天第一次充值成功 -> 今天记为首充日(延迟首充)
 *   history            每日流水 [日期, 登录(0/1), 充值成功笔数, 投注成功次数, 提现成功笔数]，只留最近 historyLimit 天
 */
export function applyDayResult(acc, date, summary, historyLimit = 120) {
    acc.lastSimDate = date;
    if (summary.recharge > 0) {
        acc.rechargeCount = (acc.rechargeCount || acc.d0RechargeCount || 0) + summary.recharge;
        acc.rechargeTotalAmount = (acc.rechargeTotalAmount || acc.d0RechargeTotalAmount || 0) + summary.rechargeAmount;
        if (!firstRechargeDateOf(acc)) acc.firstRechargeDate = date;
    }
    acc.history = (acc.history || []).concat([[date, summary.login, summary.recharge, summary.bet, summary.withdraw]]).slice(-historyLimit);
    return acc;
}

// ================= 预览汇总(DRY_RUN 用) =================

/** 汇总一批意图：items = [{ intent }]，返回 登录人数、各行为总次数/总金额、按画像分布 */
export function summarizeIntents(items) {
    const out = { accounts: items.length, login: 0, recharge: { count: 0, amount: 0 }, bet: { count: 0, amount: 0 }, withdraw: { count: 0, amount: 0 }, byPersona: {} };
    for (const { intent } of items) {
        const bp = out.byPersona[intent.persona] = out.byPersona[intent.persona] || { accounts: 0, login: 0, recharge: 0 };
        bp.accounts++;
        if (intent.login) { out.login++; bp.login++; }
        for (const kind of BEHAVIOR_KINDS) {
            out[kind].count += intent[kind].length;
            out[kind].amount += intent[kind].reduce((s, a) => s + a, 0);
        }
        bp.recharge += intent.recharge.length;
    }
    return out;
}
