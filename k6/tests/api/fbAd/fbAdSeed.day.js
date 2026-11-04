/**
 * FB广告分析 - 每日造数 k6脚本（配合 fbAdSeedRunner.js 使用）
 *
 * ⚠️ 账号落盘由 Node 包装器 fbAdSeedRunner.js 完成（k6 沙箱无法写文件）：
 *    - 账号完整记录打成标记行走 stdout：`##ACCT##<json>`
 *    - runner 收集后用 libs/common/ndjsonStore.js 合并写入 state/accounts_<tenantId>.ndjson
 *    - 读上一次状态用 open()（模块顶层，文件不存在时兜底成空数组——第一次跑还没有历史数据）
 *
 * 流程：
 *   1) 注册 USER_COUNT 个新账号：按权重分配广告组合(fbAdConfig.pickWeightedAdCombo)
 *      + 均分 Facebook 渠道(fbAdConfig.assignFbChannels，fb419/facebook132/facebook)
 *      + D0充值目标档位(fbAdConfig.assignRechargeTargets，分桶保证每批覆盖各档位)，
 *      走 facebookIdentityRegister(带 adAttribution 归因对象：系列/组/广告的ID+名称共6个字段)，
 *      成功后按档位连续充值(hybridRecharge)。同时给账号抽一个随机种子和用户画像，写进状态。
 *   2) 老账号每天随机行为(libs/common/behaviorSim.js)：对每个注册日早于今天、今天还没模拟过的账号，
 *      按它的种子+画像随机决定今天 登录与否 / 充值0-n笔 / 投注0-n次 / 提现0-n笔，再逐个执行。
 *      不再按"第N天必登录必充值"的档位日程触发——留存人数、复充人数、流失、延迟首充都自然产生，
 *      验证脚本从后端实况自算期望，不依赖这里"计划"了什么，所以随机不影响验证。
 *      同一账号同一天的决策是确定的(种子化)，DRY_RUN 预览和实跑一致；每天只模拟一次(lastSimDate 幂等)；
 *      不回填历史(后端时间是真实时间)，漏跑哪天哪天就没有行为。
 *   所有账号的改动都原地更新 PREV_ACCOUNTS 里的对象，全部做完才统一输出一次(touchedAccounts)——
 *   Node 侧 upsertRecord 是浅合并，同一账号若分多条不完整记录输出，后到的旧字段会盖掉先到的新字段。
 *
 * 运行（推荐，见 fbAdSeedRunner.js）：
 *   node fbAdSeedRunner.js --tenant 3004 --user-count 10
 *
 * 参数（-e，由 runner 组装；下面几个不经过 runner，用 k6p -e 直接传）：
 *   TENANT_ID / USER_COUNT / COUNTRY_CODE / PIXEL_ID / EVENT_CONFIG_ID / PACKAGE_NAME / VIA_RUNNER
 *   DRY_RUN=1       只预览今天会做什么(含老账号的随机行为计划)，不注册/登录/充值，也不改状态
 *   SIM_DATE=YYYY-MM-DD  仅 DRY_RUN 有效：把"今天"换成这天，用来预览明天/后天会发生什么
 *   SIM_LIMIT=N     本次最多模拟前 N 个老账号(小跑验证新逻辑、控制耗时)，默认不限
 *   SIM_ACCOUNTS=a,b  只模拟这几个老账号(定向验证某条路径：先 DRY_RUN 找出有提现/投注意图的账号再单独跑)
 *   SIM_WITHDRAW=0  关闭提现(默认开：要求打码量清零，随机充值后常被业务规则拒绝，没有投注的话大半会失败；
 *                   首次提现没钱包时会自动绑卡设密码)
 *   SIM_BET=1       打开投注行为(默认关：执行器已接 betRun，但耗时不确定、没有实测；提现要成功需要先投注打满流水)
 */

/* global open */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange } from '../../../libs/common/time.js';
import {
    newProfile, ensureProfile, simulateDay, decideDay, summarizeIntents, hashSeed,
    applyDayResult
} from '../../../libs/common/behaviorSim.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { facebookIdentityRegister } from '../channel/facebookRegister.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { loginByPasswordRetry } from '../common/auth.js';
import { betRun } from '../runbet/betRun.js';
import { prepareWithdraw, doWithdrawOnce } from '../groupRechargeWithdrawReport/withdrawAssembler.js';
import { getWithdrawBasicInfo } from '../withdraw/withdrawApi.js';
import { pickWeightedAdCombo, assignRechargeTargets, assignFbChannels } from './fbAdConfig.js';

// ================= 参数（init 上下文） =================

const TENANT_ID = __ENV.TENANT_ID || '3004';
const USER_COUNT = parseInt(__ENV.USER_COUNT || '10', 10);
const COUNTRY_CODE = __ENV.COUNTRY_CODE || '91';

// 渠道(pixelId+eventConfigId)默认从 fbAdConfig.DEFAULT_FB_CHANNEL_CONFIGS 的3个
// Facebook渠道里分配；只要显式传了 PIXEL_ID / EVENT_CONFIG_ID 任意一个，就全部账号固定
// 用这一个渠道(调试/指定场景)。这两个变量刻意不设默认值——要靠"没传"来区分"随机多渠道"
// 和"手动固定"，之前写死 fb419 默认值就是只能造单渠道的原因。
const PIXEL_ID_OVERRIDE = __ENV.PIXEL_ID || '';
const EVENT_CONFIG_ID_OVERRIDE = __ENV.EVENT_CONFIG_ID ? parseInt(__ENV.EVENT_CONFIG_ID, 10) : 0;
const PACKAGE_NAME = __ENV.PACKAGE_NAME || 'com.ar3004.fb.app'; // 所有渠道共用

const DRY_RUN = __ENV.DRY_RUN === '1';
// SIM_DATE 只在 DRY_RUN 下生效：真实执行时"今天"必须是真今天，不能被误改
const SIM_DATE = DRY_RUN ? (__ENV.SIM_DATE || '') : '';
const SIM_LIMIT = parseInt(__ENV.SIM_LIMIT || '0', 10);
// 只模拟指定的老账号(逗号分隔)，用来定向验证某条路径：先 DRY_RUN 找出今天有提现意图的账号再单独跑
const SIM_ACCOUNTS = (__ENV.SIM_ACCOUNTS || '').split(',').map(s => s.trim()).filter(Boolean);
const SIM_BET = __ENV.SIM_BET === '1';
// 提现默认开(用户要求提现要真执行)，SIM_WITHDRAW=0 关闭
const SIM_WITHDRAW = __ENV.SIM_WITHDRAW !== '0';

const RECHARGE_AMOUNT_MIN = 2000;
const RECHARGE_AMOUNT_MAX = 5000;

const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

// init 阶段读上一次状态（文件不存在时兜底为空数组——第一次跑还没有历史数据）
let PREV_ACCOUNTS = [];
try {
    PREV_ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.warn(`[FbAdSeed] ⚠️ 读取本地状态 ${STATE_FILE} 失败（首次运行正常，否则检查路径）：${e.message}`);
}

export const options = {
    scenarios: {
        fbad_seed: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120m'
        }
    }
};

// ================= 工具 =================

function emitAcct(record) {
    console.log(`##ACCT##${JSON.stringify(record)}`);
}

const touchedAccounts = new Set();

function emitTouchedAccounts() {
    for (const acc of PREV_ACCOUNTS) {
        if (touchedAccounts.has(acc.account)) emitAcct(acc);
    }
}

function getRandomAmount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ================= 注册 + D0充值 =================

/**
 * 注册单个新账号并按目标档位完成 D0 充值，返回完整的本地状态记录（注册失败返回 null）。
 * fbChannel 是 assignFbChannels 分配给这个账号的渠道配置，会原样记进状态——验证时
 * 按渠道核对"渠道来源"要靠它(老记录没有这个字段，读取方要兼容，缺失按 fb419 处理)。
 */
function seedOneAccount(adminToken, registerDate, rechargeTier, fbChannel) {
    const phone = generateRandomPhone(COUNTRY_CODE);
    const adCombo = pickWeightedAdCombo();

    const result = facebookIdentityRegister(phone, { token: adminToken }, {
        pixelId: fbChannel.pixelId,
        eventConfigId: fbChannel.eventConfigId,
        packageName: PACKAGE_NAME,
        // 归因6个字段(3个ID+3个Name)必须全传——后端 adAttribution 对象要求完整结构
        campaignId: adCombo.campaignId,
        campaignName: adCombo.campaignName,
        adSetId: adCombo.adSetId,
        adSetName: adCombo.adSetName,
        adId: adCombo.adId,
        adName: adCombo.adName
    });

    if (!result || !result.data || !result.data.token) {
        console.error(`[FbAdSeed] ❌ 账号注册失败: ${phone}`);
        return null;
    }

    const token = result.data.token;
    // 注册响应是否直接带 userId 未经验证(项目里 channelInviteService.js 直接信任
    // data.userId，但 register.test.js 的 registerWithRetry 统一二次查询
    // getFrontUserInfo 才取 userId)——两边都试一下，不可靠时才多付一次查询代价。
    let userId = result.data.userId;
    if (!userId) {
        const info = getFrontUserInfo(token);
        userId = info && info.userId;
    }
    if (!userId) {
        console.error(`[FbAdSeed] ❌ 注册成功但拿不到userId: ${phone}`);
        return null;
    }
    const profile = newProfile();
    console.log(`[FbAdSeed] ✅ 注册成功: ${phone} (userId=${userId}) 渠道=${fbChannel.channelName} 广告=${adCombo.campaignName} 画像=${profile.persona} 目标档位=${rechargeTier}`);

    let d0RechargeCount = 0;
    let d0RechargeTotalAmount = 0;

    for (let i = 0; i < rechargeTier; i++) {
        if (i > 0) sleep(3);
        const amount = getRandomAmount(RECHARGE_AMOUNT_MIN, RECHARGE_AMOUNT_MAX);
        const rechargeResult = hybridRecharge({
            userToken: token,
            adminToken,
            userId,
            amount,
            frontendFirst: true,
            remark: `FbAdSeed-${i + 1}`
        });
        if (rechargeResult && rechargeResult.success) {
            d0RechargeCount++;
            d0RechargeTotalAmount += rechargeResult.amount;
        } else {
            console.warn(`[FbAdSeed] ⚠️ 第${i + 1}笔D0充值失败: ${phone}`);
            break;
        }
    }

    const now = new Date().toISOString();
    return {
        account: phone,
        password: 'qwer1234',
        userId,
        tenantId: TENANT_ID,
        registerDate,
        adCombo,
        fbChannel,
        seed: profile.seed,
        persona: profile.persona,
        // 首充日：复充留存(reRechargeN)的基准日。D0 第一笔充值成功即首充，首充日=注册日；
        // D0 没充成功则为 null，之后哪天随机行为里第一次充值成功，就把那天记成首充日(延迟首充)。
        firstRechargeDate: d0RechargeCount > 0 ? registerDate : null,
        rechargeCount: d0RechargeCount,
        rechargeTotalAmount: d0RechargeTotalAmount,
        d0RechargeCount,
        d0RechargeTotalAmount,
        d0Tier: rechargeTier,
        // 最后一次模拟(含注册当天)的自然日：模拟每天只做一次，靠它幂等
        lastSimDate: registerDate,
        // 每天结果的紧凑流水 [日期, 登录(0/1), 充值成功笔数, 投注成功次数, 提现成功笔数]，保留最近 120 天
        history: [[registerDate, 1, d0RechargeCount, 0, 0]],
        createdAt: now,
        updatedAt: now
    };
}

// ================= 老账号每天随机行为 =================

/**
 * 给一个账号造执行器(登录/充值/投注/提现)，供 simulateDay 按今天的随机意图调用。
 * 投注、提现只在 SIM_BET / SIM_WITHDRAW 打开时才传，否则框架把它们记成 skipped:no_executor。
 * 会员 token 很短命(约55秒)，充值沿用登录拿到的 token(和 D0 连续充值同样的用法)，
 * 投注/提现链更长，每次动手前重登一次拿新 token。
 */
function makeExecutors(acc, adminToken, today) {
    const freshToken = fallback => loginByPasswordRetry(acc.account, acc.password) || fallback;
    return {
        login: () => {
            const token = loginByPasswordRetry(acc.account, acc.password);
            return token ? { success: true, token } : { success: false, reason: 'login_failed' };
        },
        recharge: ({ token, amount, index }) => {
            if (index > 0) sleep(3);
            const r = hybridRecharge({
                userToken: token, adminToken, userId: acc.userId, amount,
                frontendFirst: true, remark: `FbAdSim-${today}-${index + 1}`
            });
            return r && r.success ? { success: true, amount: r.amount } : { success: false, reason: 'recharge_failed' };
        },
        bet: SIM_BET ? ({ token }) => {
            const r = betRun(freshToken(token), acc.account);
            return r ? { success: true, amount: r.amount } : { success: false, reason: 'bet_failed' };
        } : undefined,
        // 提现：先直接尝试，只有后端说"没绑钱包"(NO_WALLET)才绑卡设密码再试一次——不用"已绑卡"标志，
        // 因为 prepareWithdraw 不返回成败，绑卡失败时标志会误置成已绑，之后这个账号永远提不了现。
        // 被业务规则拒绝(打码量未清零、当日次数用完、余额不足 等)是真实结果，原因记在 reason 里。
        withdraw: SIM_WITHDRAW ? ({ token, amount, index }) => {
            const t = freshToken(token);
            const info = getWithdrawBasicInfo(t);
            const types = ((info && info.withdrawCategoryList) || []).map(c => c.withdrawType).filter(x => x !== 'UPI' && x !== 'ARPay');
            if (types.length === 0) return { success: false, reason: 'NO_CHANNEL' };
            const forceType = types[hashSeed(acc.seed, today, 'withdrawType', index) % types.length];
            let r = doWithdrawOnce(adminToken, acc.userId, t, amount, forceType, { audit: true });
            if (r && r.skipReason === 'NO_WALLET') {
                prepareWithdraw(adminToken, acc.userId, t);
                r = doWithdrawOnce(adminToken, acc.userId, t, amount, forceType, { audit: true });
            }
            return r && r.withdrew ? { success: true, amount: r.actualAmount || amount } : { success: false, reason: (r && r.skipReason) || 'withdraw_failed' };
        } : undefined
    };
}

function describeIntent(intent) {
    if (!intent.login) return '不登录';
    const part = (name, list) => (list.length ? `${name}[${list.join(',')}]` : '');
    return ['登录', part('充值', intent.recharge), part('投注', intent.bet), part('提现', intent.withdraw)].filter(Boolean).join(' ');
}

function simulateOldAccounts(adminToken, today) {
    PREV_ACCOUNTS.forEach(a => ensureProfile(a));
    // 注册日早于今天、且今天还没模拟过：注册当天的行为已经是 D0，每天只模拟一次
    let all = PREV_ACCOUNTS.filter(a => a.registerDate < today && (a.lastSimDate || a.registerDate) < today);
    if (all.length === 0) {
        console.log(`[FbAdSim] 今天(${today})没有需要模拟的老账号(本地共 ${PREV_ACCOUNTS.length} 个)`);
        return;
    }
    if (SIM_ACCOUNTS.length > 0) {
        all = all.filter(a => SIM_ACCOUNTS.includes(a.account));
        const missing = SIM_ACCOUNTS.filter(x => !all.some(a => a.account === x));
        if (missing.length > 0) console.warn(`[FbAdSim] ⚠️ SIM_ACCOUNTS 里这些账号不存在或今天已模拟过/还没到模拟日，已忽略: ${missing.join(',')}`);
    }
    const due = SIM_LIMIT > 0 ? all.slice(0, SIM_LIMIT) : all;
    console.log(`[FbAdSim] 今天(${today})待模拟老账号 ${all.length} 个${due.length < all.length ? `，本次只模拟前 ${due.length} 个(SIM_LIMIT)` : ''}${SIM_ACCOUNTS.length ? '(SIM_ACCOUNTS 已限定账号)' : ''}；` +
        `投注=${SIM_BET ? '开' : '关'} 提现=${SIM_WITHDRAW ? '开' : '关'}`);
    if (due.length === 0) return;

    if (DRY_RUN) {
        const items = due.map(acc => ({
            acc,
            intent: decideDay({ seed: acc.seed, account: acc.account, date: today, registerDate: acc.registerDate, persona: acc.persona })
        }));
        items.forEach(({ acc, intent }) => console.log(`[FbAdSim][DRY_RUN] ${acc.account} ${acc.persona} 第${intent.daysSinceRegister}天: ${describeIntent(intent)}`));
        const s = summarizeIntents(items);
        const persona = Object.keys(s.byPersona).map(p => `${p} 登录${s.byPersona[p].login}/${s.byPersona[p].accounts}`).join('  ');
        console.log(`[FbAdSim][DRY_RUN] 汇总：${s.accounts}个账号里会登录 ${s.login} 个；充值 ${s.recharge.count} 笔共 ${s.recharge.amount}；` +
            `投注 ${s.bet.count} 次；提现 ${s.withdraw.count} 笔；按画像：${persona}（未执行任何动作，状态未改）`);
        return;
    }

    for (const acc of due) {
        const result = simulateDay({
            seed: acc.seed, account: acc.account, date: today, registerDate: acc.registerDate, persona: acc.persona,
            executors: makeExecutors(acc, adminToken, today)
        });
        applyDayResult(acc, today, result.summary);
        acc.updatedAt = new Date().toISOString();
        touchedAccounts.add(acc.account);
        const s = result.summary;
        console.log(`[FbAdSim] ${acc.account} ${acc.persona} 第${result.intent.daysSinceRegister}天: 计划[${describeIntent(result.intent)}] ` +
            `实际 登录=${s.login} 充值=${s.recharge}/${s.planned.recharge}笔(${s.rechargeAmount}) 投注=${s.bet}/${s.planned.bet} 提现=${s.withdraw}/${s.planned.withdraw}`);
        sleep(1);
    }
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[FbAdSeed] ========== FB广告分析每日造数 租户=${TENANT_ID} 新增账号数=${USER_COUNT} ==========`);
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[FbAdSeed] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log('[FbAdSeed] ✅ 管理员登录成功');

    if (!__ENV.VIA_RUNNER && !DRY_RUN) {
        console.warn('[FbAdSeed] ⚠️ 直接 k6p 不会写状态文件（沙箱限制），请用: node fbAdSeedRunner.js --tenant ' + TENANT_ID);
    }

    return { adminToken, envConfig, today: SIM_DATE || getDayRange(0, TENANT_ID).dateStr };
}

export default function (data) {
    const { adminToken, envConfig, today } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    console.log(`[FbAdSeed] 今日日期(租户时区)=${today}${SIM_DATE ? '(SIM_DATE 预览)' : ''}`);

    // 1) 注册新账号 + D0充值(DRY_RUN 不注册)
    if (DRY_RUN) {
        console.log(`[FbAdSeed][DRY_RUN] 跳过新账号注册(USER_COUNT=${USER_COUNT})，只预览老账号今天的随机行为`);
    } else {
        const rechargeTargets = assignRechargeTargets(USER_COUNT);
        const channelTargets = assignFbChannels(USER_COUNT, PIXEL_ID_OVERRIDE, EVENT_CONFIG_ID_OVERRIDE);
        for (let i = 0; i < USER_COUNT; i++) {
            const record = seedOneAccount(adminToken, today, rechargeTargets[i], channelTargets[i]);
            if (record) emitAcct(record);
            sleep(1);
        }
    }

    // 2) 老账号每天随机行为(原地更新 PREV_ACCOUNTS，做完统一输出)
    simulateOldAccounts(adminToken, today);
    emitTouchedAccounts();
}
