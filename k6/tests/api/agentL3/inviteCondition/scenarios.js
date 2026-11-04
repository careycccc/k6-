/**
 * 「有效邀请达标条件 + 生效游戏」场景验证（会改配置、会造真实数据）
 *
 * 每个场景的节奏（时序纪律来自实践，不能省）：
 *   应用配置 → 回读确认 → 等 WAIT_CONFIG(默认180s) → 建总代+造下级 → 等注单全部结算
 *   → 等 WAIT_CHECK(默认180s) → 查 GetPageListInvitedList 比对 isOkInvite
 *   多阶段场景（切配置复用同一批下级）：改配置 → 等 WAIT_CONFIG → 再查一次
 *
 * 「已达标不撤销」用 sticky 表达：某下级在任一阶段实际达标过，后续阶段期望恒为 true。
 *
 * 用法（落报告走 runner）：
 *   node runner.js --tenant 3004 --script scenarios.js --cases 1
 *   node runner.js --tenant 3004 --script scenarios.js --cases 1,2,3 --tag batch1
 *   k6p -e TENANT_ID=3004 -e CASES=1 -e DRY_RUN=1 scenarios.js -q      # 只预览计划
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    TAG, SETTING_KEYS, MODE_BOTH, getConfig, setConfig, limitGamesToValue, limitGamesText,
    getTeam, fetchOrders, sumOrders, expectOkInvite, emit
} from './api.js';
import { createAgent, seedDownline, waitAllSettled, betAmountForValid, doRecharge, doBet } from './seed.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const DRY_RUN = __ENV.DRY_RUN === '1';
const WAIT_CONFIG = parseInt(__ENV.WAIT_CONFIG || '180', 10);  // 改配置后等多久再造数/再查
const WAIT_CHECK = parseInt(__ENV.WAIT_CHECK || '180', 10);    // 注单结算后等多久再查 isOkInvite
const SETTLE_MAX = parseInt(__ENV.SETTLE_MAX || '600', 10);    // 等结算最长秒数
const CASES = (__ENV.CASES || '1').split(',').map(s => s.trim()).filter(Boolean);

const ARL = v => [{ vendorCode: 'ARLottery', gameCode: v }];
const WG30 = 'WinGo_30S';
const WG5 = 'WinGo_5M';
/** 要让"范围内有效投注"达到 v，投注额取 v/0.98 上取整（ARLottery 扣 2% 税） */
const bet = (game, validTarget) => ({ game, amount: betAmountForValid(validTarget) });

/**
 * 投注需要本金 —— 要投注的下级必须先充值，否则 Balance is not enough 投不出去。
 * 所以「充值条件不达标」不能靠"不充值"实现，要充一笔**低于充值门槛**的钱：
 * 既够当投注本金，又不会让充值条件达标。FUND 就是这笔本金（各组门槛要么 ≥1000 要么被屏蔽）。
 *
 * 为什么是 500 而不是随便一个数：3004 走商品模式充值，只能充固定面额，实测充 600 会被
 * 取整成 500。500 是已验证可用的面额。另外首充有赠送（实测充500送97，余额597），但投注额
 * 刻意压在 500 以内，不依赖赠送，免得赠送规则一改本金就不够。
 * 期望值一律用后台实际的 totalRechargeAmount 算，不看这里写的数，所以充多少都不会算错。
 */
const FUND = 500;
/** 让"投注达标"的下级投到有效投注 450（门槛 300），实际投注额 460，低于 FUND */
const BET_PASS = 450;

// ============================================================
// 场景定义
// ============================================================
const SCENARIOS = {
    // 组 1：达标条件真值表（需求第 5 节 A/B/C/D）
    '1': {
        name: '达标条件真值表',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]) },
        downlines: [
            { label: 'A 充值达标/投注不达标', recharge: 2000, bets: [] },
            { label: 'B 充值不达标/投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'C 两者都不达标', recharge: 500, bets: [bet(WG30, 200)] },
            { label: 'D 两者都达标', recharge: 2000, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [
            { caseId: '1-1', name: '同时满足', config: { mode: MODE_BOTH } },
            { caseId: '1-2', name: '切「满足任一」，A/B 应转为达标', config: { mode: '2' } },
            { caseId: '1-3', name: '切回「同时满足」，已达标的不应被撤销', config: { mode: MODE_BOTH }, sticky: true }
        ]
    },

    // 组 2：门槛为 0（两个都 0 = 只要邀请就算成功）
    '2': {
        name: '门槛为 0',
        base: { rechargeThreshold: 0, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'Z 什么都不做', recharge: 0, bets: [] },
            { label: 'A2 充值达标/不投注', recharge: 2000, bets: [] },
            { label: 'B2 充值500/投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [
            { caseId: '2-1', name: '充值门槛=0 投注门槛=300 同时满足', config: { mode: MODE_BOTH, rechargeThreshold: 0, betThreshold: 300 } },
            { caseId: '2-2', name: '充值门槛=1000 投注门槛=0 同时满足', config: { mode: MODE_BOTH, rechargeThreshold: 1000, betThreshold: 0 }, sticky: true },
            { caseId: '2-3', name: '两个门槛都=0 → 只要邀请就算成功', config: { mode: MODE_BOTH, rechargeThreshold: 0, betThreshold: 0 }, sticky: true }
        ]
    },

    // 组 3：生效游戏 —— 充值门槛设到极大屏蔽充值条件，结果只由投注范围决定
    '3': {
        name: '生效游戏（范围内 vs 范围外）',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: ARL([WG30]), mode: '2' },
        downlines: [
            { label: 'X 投 WinGo_30S', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'Y 投 WinGo_5M', recharge: FUND, bets: [bet(WG5, BET_PASS)] }
        ],
        phases: [
            { caseId: '3-1', name: '指定 ARLottery[WinGo_30S] → X 达标 Y 不达标', config: { limitGames: ARL([WG30]) } },
            { caseId: '3-2', name: '改全体游戏 → Y 也应达标', config: { limitGames: [] }, sticky: true }
        ]
    },

    // 组 3b：只选厂商不选子游戏 = 该厂商下所有游戏都算（用户已确认）
    '3b': {
        name: '生效游戏：只选厂商',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: ARL([]), mode: '2' },
        downlines: [
            { label: 'X2 投 WinGo_30S', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'Y2 投 WinGo_5M', recharge: FUND, bets: [bet(WG5, BET_PASS)] }
        ],
        phases: [{ caseId: '3-3', name: '指定 ARLottery 不选子游戏 → 两个都应达标', config: { limitGames: ARL([]) } }]
    },

    // 组 3c：范围配成别的厂商，本厂商投注不应计入
    '3c': {
        name: '生效游戏：范围外厂商',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: [{ vendorCode: 'JILI', gameCode: ['108'] }], mode: '2' },
        downlines: [{ label: 'Z3 投 ARLottery/WinGo_30S', recharge: FUND, bets: [bet(WG30, BET_PASS)] }],
        phases: [{ caseId: '3-4', name: '范围=JILI[108]，投的是 ARLottery → 不应计入', config: { limitGames: [{ vendorCode: 'JILI', gameCode: ['108'] }] } }]
    },

    // 组 4：金额口径（卡在门槛两侧，确定后端用有效投注还是投注额）
    '4': {
        name: '金额口径',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: ARL([WG30]), mode: '2' },
        downlines: [
            { label: 'E1 投300(有效294)', recharge: FUND, bets: [{ game: WG30, amount: 300 }] },
            { label: 'E2 投307(有效300.86)', recharge: FUND, bets: [{ game: WG30, amount: 307 }] },
            { label: 'E3 两笔各200(有效392)', recharge: FUND, bets: [{ game: WG30, amount: 200 }, { game: WG30, amount: 200 }] }
        ],
        phases: [{ caseId: '4-1', name: '投注门槛=300，验证税后口径与累计', config: {} }]
    },

    // 组 5：重判时机 —— 需求自相矛盾（第4节/举例说"配置保存后自动重判"，11/03修订说"下级发生
    // 投注或充值后才重判"）。组1已实测到"切配置后不自动重判"，这里再补一笔新行为看能否触发。
    '5': {
        name: '重判时机（改配置后是否自动重判）',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'R1 充值达标/不投注', recharge: 2000, bets: [] },
            { label: 'R2 充值不达标/投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [
            { caseId: '5-0', name: '同时满足 → 两个都不该达标', config: { mode: MODE_BOTH } },
            { caseId: '5-1', name: '切「满足任一」后什么都不做 → 文档说应自动重判为达标', config: { mode: '2' } },
            {
                caseId: '5-2', name: '再等一轮 → 排除只是重算慢', config: {}
            },
            {
                // 只对 R1 施加新行为，R2 留作对照：若 R1 转为达标而 R2 不变，就证明重判是靠新行为触发的。
                // 刻意不动 R2 —— 它充了 500，再充 500 就正好到 1000 门槛，充值条件也会达标，原因就混在一起了。
                caseId: '5-3', name: '只让 R1 再充 500（新行为），R2 作对照 → 看是否触发重判', config: {},
                action: { type: 'recharge', amount: 500, targets: ['R1'] }
            }
        ]
    },

    // 组 6：「满足任一」对新数据是否生效 —— 组5 证明了切配置对已有下级不重判，这里先把配置设成
    // 满足任一、再建下级，用来区分两种结论：
    //   新下级判定正确 → 问题只是「不重判历史数据」
    //   新下级也判不出 → 「满足任一」这个配置根本没生效，严重得多
    '6': {
        name: '「满足任一」对新建下级是否生效',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: '2' },
        downlines: [
            { label: 'N1 只充值达标', recharge: 2000, bets: [] },
            { label: 'N2 只投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'N3 两者都不达标', recharge: 500, bets: [bet(WG30, 200)] }
        ],
        phases: [{ caseId: '6-1', name: '先设满足任一再建下级 → N1/N2 应达标，N3 不达标', config: { mode: '2' } }]
    },

    // 组 7：产品口径验证 —— 「配置变更后，下级再次充值投注满足条件才算有效邀请」。
    // 组5 用「补充值」触发失败了，这里改用「投注」触发，而且让这笔新投注本身就把条件做到达标，
    // 以排除两种解释：(a) 只有投注能触发、(b) 新行为自身必须达标而不是看累计。
    '7': {
        name: '产品口径：配置变更后需新行为才重判',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'P1 充值达标/先不投注', recharge: 2000, bets: [] },
            { label: 'P2 充值不达标/先不投注', recharge: FUND, bets: [] }
        ],
        phases: [
            { caseId: '7-1', name: '同时满足 → 两个都不达标', config: { mode: MODE_BOTH } },
            { caseId: '7-2', name: '切满足任一但不做任何行为 → 预计仍不达标（已知不自动重判）', config: { mode: '2' } },
            {
                // 这笔投注有效 450.80 ≥ 300：P1 变成充值+投注都达标，P2 变成只有投注达标。
                // 两个都应判为有效邀请；若仍为否，说明新行为也触发不了重判，是硬缺陷。
                caseId: '7-3', name: '两个下级各投一笔达标的注（新行为）→ 应判为有效邀请', config: {},
                action: { type: 'bet', game: WG30, amount: betAmountForValid(BET_PASS), targets: ['P1', 'P2'] }
            }
        ]
    },

    // 组 8：降低门槛后，多大的新行为才能触发重判（三组账号同时验证三种触发强度，只等一轮）
    //   起点：门槛 充值1500/投注500，下级 充值1200 + 投注600(有效588) → 充值不够，不达标
    //   降门槛到 1000/500 后，按累计这些下级本就都该达标（充值1200≥1000、有效投注588≥500）
    //   T1 不做任何行为 / T2 小额补 100 / T3 大额补 1000+500，看谁会被判为有效邀请
    '8': {
        name: '降低门槛后的重判触发强度（三组并行）',
        base: { rechargeThreshold: 1500, betThreshold: 500, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            // 投 600 而不是 500：有效投注 = 600×0.98 = 588，无论后端按有效投注还是投注额算都 ≥500，
            // 免得把「门槛口径」的问题混进这个场景
            { label: 'T1 对照组不做行为', recharge: 1200, bets: [bet(WG30, 588)] },
            { label: 'T2 小额触发', recharge: 1200, bets: [bet(WG30, 588)] },
            { label: 'T3 大额触发', recharge: 1200, bets: [bet(WG30, 588)] }
        ],
        phases: [
            { caseId: '8-1', name: '门槛1500/500 → 充值1200不够，三个都不达标', config: { mode: MODE_BOTH, rechargeThreshold: 1500, betThreshold: 500 } },
            { caseId: '8-2', name: '降门槛到1000/500，不做任何行为，等5分钟', config: { rechargeThreshold: 1000 } },
            {
                caseId: '8-3', name: 'T2 补充值100+投注100，T3 补充值1000+投注500，T1 不动',
                config: {},
                actions: [
                    { type: 'recharge', amount: 100, targets: ['T2'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['T2'] },
                    { type: 'recharge', amount: 1000, targets: ['T3'] },
                    { type: 'bet', game: WG30, amount: 500, targets: ['T3'] }
                ]
            }
        ]
    }
};

export const options = {
    setupTimeout: '2m',
    scenarios: { run: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '180m' } }
};

export function setup() {
    const env = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, env);
    for (const id of CASES) {
        const sc = SCENARIOS[id];
        if (!sc) throw new Error(`[${TAG}] 未知场景 ${id}，可选: ${Object.keys(SCENARIOS).join(',')}`);
        // 投注要本金：充值额不够投注总额的话，下注会 Balance is not enough，整条用例作废
        for (const d of sc.downlines) {
            const need = (d.bets || []).reduce((s, b) => s + b.amount, 0);
            if (need > 0 && d.recharge < need) {
                throw new Error(`[${TAG}] 场景 ${id} 下级「${d.label}」充值 ${d.recharge} < 投注总额 ${need}，本金不足，请改场景定义`);
            }
        }
    }
    const token = tenantAdminLogin(TENANT_ID);
    if (!token) throw new Error(`[${TAG}] 租户 ${TENANT_ID} 管理员登录失败`);
    return { token, env, countryCode: env.COUNTRY_CODE || '91' };
}

/** 把一组配置写进后台，逐项回读确认 */
function applyConfig(token, cfg, label) {
    const items = [];
    if (cfg.mode !== undefined) items.push([SETTING_KEYS.mode, cfg.mode, 'agentL3InviteConditionMode']);
    if (cfg.rechargeThreshold !== undefined) items.push([SETTING_KEYS.rechargeThreshold, String(cfg.rechargeThreshold), 'agentL3InviteRechargeAmount']);
    if (cfg.betThreshold !== undefined) items.push([SETTING_KEYS.betThreshold, String(cfg.betThreshold), 'agentL3InviteBetAmount']);
    if (cfg.limitGames !== undefined) items.push([SETTING_KEYS.limitGame, limitGamesToValue(cfg.limitGames), 'agentL3InviteBetLimitGame']);

    for (const [key, val, readBack] of items) {
        if (DRY_RUN) { console.log(`[${TAG}][DRY] 将设置 ${key} = ${val}`); continue; }
        const r = setConfig(token, key, val, readBack);
        console.log(`[${TAG}] ${r.ok ? '✅' : '❌'} 配置 ${key} = ${val}  ${r.msg}`);
        if (!r.ok) throw new Error(`[${TAG}] 配置写入失败 ${key}: ${r.msg}`);
        sleep(1);
    }
    if (DRY_RUN) return null;
    const now = getConfig(token);
    emit('CONFIG', {
        label, tenantId: TENANT_ID, mode: now.mode, rechargeThreshold: now.rechargeThreshold,
        betThreshold: now.betThreshold, limitGameRaw: now.limitGameRaw,
        limitGamesText: limitGamesText(now.limitGames), dayLimit: now.dayLimit,
        totalLimit: now.totalLimit, sameDeviceInvalid: now.sameDeviceInvalid, readAt: new Date().toISOString()
    });
    return now;
}

/**
 * 配置漂移检测：核对前确认配置还是脚本自己设的那组。
 *
 * 这是 2026-11-04 场景7 踩的坑：跑到一半有人在后台手工把配置改成了别的值，脚本照常读
 * 当时配置算期望，期望和实际"对上了"，报告显示 6/6 全通过 —— 但验证的根本不是设计的那件事，
 * 整轮静默作废。所以宁可大声报错，也不要给出一个看似通过的结论。
 */
function assertNoDrift(cfg, expected, caseId) {
    const diffs = [];
    if (expected.mode !== undefined && String(cfg.mode) !== String(expected.mode)) diffs.push(`达标条件 期望${expected.mode}实际${cfg.mode}`);
    if (expected.rechargeThreshold !== undefined && Number(cfg.rechargeThreshold) !== Number(expected.rechargeThreshold)) diffs.push(`充值门槛 期望${expected.rechargeThreshold}实际${cfg.rechargeThreshold}`);
    if (expected.betThreshold !== undefined && Number(cfg.betThreshold) !== Number(expected.betThreshold)) diffs.push(`投注门槛 期望${expected.betThreshold}实际${cfg.betThreshold}`);
    if (expected.limitGameRaw !== undefined && cfg.limitGameRaw !== expected.limitGameRaw) diffs.push(`生效游戏 期望${expected.limitGameRaw}实际${cfg.limitGameRaw}`);
    if (diffs.length === 0) return true;
    console.error(`[${TAG}] ❌❌ 配置被外部改动！阶段 ${caseId} 的结论不可信：${diffs.join('；')}`);
    emit('DRIFT', { caseId, diffs, expected, actual: { mode: cfg.mode, rechargeThreshold: cfg.rechargeThreshold, betThreshold: cfg.betThreshold, limitGameRaw: cfg.limitGameRaw }, at: new Date().toISOString() });
    return false;
}

function waitWithLog(sec, why) {
    if (DRY_RUN) { console.log(`[${TAG}][DRY] 将等待 ${sec}s（${why}）`); return; }
    console.log(`[${TAG}] ⏳ 等待 ${sec}s（${why}）...`);
    const step = 30;
    for (let left = sec; left > 0; left -= step) { sleep(Math.min(step, left)); if (left > step) console.log(`[${TAG}]    还剩 ${left - step}s`); }
}

function runScenario(data, id) {
    const sc = SCENARIOS[id];
    const { token, countryCode } = data;
    console.log(`\n[${TAG}] ================ 场景 ${id}：${sc.name} ================`);

    // 1) 基线配置。intended 记着"脚本认为当前应该是什么配置"，核对前用它检测外部改动
    const intended = {};
    const trackIntent = cfg => {
        if (cfg.mode !== undefined) intended.mode = cfg.mode;
        if (cfg.rechargeThreshold !== undefined) intended.rechargeThreshold = cfg.rechargeThreshold;
        if (cfg.betThreshold !== undefined) intended.betThreshold = cfg.betThreshold;
        if (cfg.limitGames !== undefined) intended.limitGameRaw = limitGamesToValue(cfg.limitGames);
    };
    const firstCfg = Object.assign({}, sc.base, sc.phases[0].config);
    trackIntent(firstCfg);
    applyConfig(token, firstCfg, `场景${id} 初始配置`);
    waitWithLog(WAIT_CONFIG, '配置生效');

    // 2) 建树造数
    let agent = { account: 'DRY', userId: 0, inviteCode: 'DRY' };
    const seeded = [];
    if (DRY_RUN) {
        console.log(`[${TAG}][DRY] 将建 1 个总代 + ${sc.downlines.length} 个下级：`);
        sc.downlines.forEach(d => console.log(`[${TAG}][DRY]   ${d.label} 充值=${d.recharge} 投注=${(d.bets || []).map(b => `${b.game}:${b.amount}`).join(',') || '无'}`));
    } else {
        agent = createAgent(token, countryCode);
        if (!agent) throw new Error(`[${TAG}] 场景 ${id} 建总代失败`);
        for (const spec of sc.downlines) {
            const d = seedDownline(token, agent.inviteCode, spec, countryCode, TENANT_ID);
            if (d) seeded.push(d); else console.error(`[${TAG}] ❌ 下级 ${spec.label} 造数失败，该行结论不可信`);
            sleep(2);
        }
    }

    // 3) 等结算 + 等判定
    const seedStart = Date.now() - 3600000;
    if (!DRY_RUN && seeded.some(d => d.bets.length > 0)) {
        waitAllSettled(token, seeded.map(d => d.userId), seedStart, SETTLE_MAX);
    }
    waitWithLog(WAIT_CHECK, '等后端重算有效邀请');

    // 4) 逐阶段核对
    const everOk = {}; // userId -> 是否曾经达标（「已达标不撤销」的依据）
    for (let pi = 0; pi < sc.phases.length; pi++) {
        const ph = sc.phases[pi];
        if (pi > 0) {
            console.log(`\n[${TAG}] ---- 阶段 ${ph.caseId}：${ph.name} ----`);
            trackIntent(ph.config);
            applyConfig(token, ph.config, `场景${id} ${ph.caseId}`);
            waitWithLog(WAIT_CONFIG, '配置生效 + 后端重算');
        }
        // 阶段内可以插入"让下级再发生行为"——用来区分重判是改配置就触发，还是要靠新行为触发。
        // 支持一个阶段内对不同下级施加不同强度的行为（留对照组不动），这样三种触发强度只等一轮。
        const actions = ph.actions || (ph.action ? [ph.action] : []);
        if (actions.length) {
            if (DRY_RUN) {
                actions.forEach(a => console.log(`[${TAG}][DRY] 将对 ${a.targets.join('/')} 执行 ${a.type}=${a.amount}`));
            } else {
                const touched = {};
                for (const act of actions) {
                    const hit = seeded.filter(d => act.targets.some(t => d.label.indexOf(t) === 0));
                    for (const d of hit) {
                        if (act.type === 'recharge') doRecharge(token, d.userId, d.account, act.amount);
                        else if (act.type === 'bet') d.bets.push(doBet(d.account, act.game, act.amount));
                        touched[d.userId] = true;
                        sleep(2);
                    }
                }
                if (actions.some(a => a.type === 'bet')) waitAllSettled(token, Object.keys(touched).map(Number), seedStart, SETTLE_MAX);
                waitWithLog(WAIT_CHECK, '新行为后等后端重算');
            }
        }
        if (DRY_RUN) { console.log(`[${TAG}][DRY] 将核对阶段 ${ph.caseId}：${ph.name}`); continue; }

        const cfg = getConfig(token);
        const noDrift = assertNoDrift(cfg, intended, ph.caseId);
        const team = getTeam(token, agent.userId);
        const now = Date.now();

        for (const d of seeded) {
            const m = team.find(x => Number(x.userId) === Number(d.userId));
            if (!m) { console.error(`[${TAG}] ❌ 团队里找不到下级 ${d.userId}`); continue; }

            const orders = fetchOrders(token, d.userId, cfg.limitGames, seedStart, now);
            const sum = sumOrders(orders);
            const totalRecharge = Number(m.totalRechargeAmount) || 0;
            const base = expectOkInvite(cfg, totalRecharge, sum.validAmount);
            const sticky = !!(ph.sticky && everOk[d.userId]);
            const expected = base.expected || sticky;
            const actual = !!m.isOkInvite;
            if (actual) everOk[d.userId] = true;

            const match = expected === actual;
            console.log(`[${TAG}] ${noDrift ? (match ? '✅' : '❌') : '⚠️配置被改,结论不可信'} [${ph.caseId}] ${d.label} userId=${d.userId}`
                + ` 充值=${totalRecharge} 范围内有效投注=${sum.validAmount.toFixed(2)}`
                + ` 期望=${expected}${sticky ? '(已达标不撤销)' : ''} 实际=${actual}`);

            emit('CASE', {
                caseId: ph.caseId, caseName: `${sc.name} / ${ph.name}`,
                scenario: id, label: d.label,
                agentId: agent.userId, agentAccount: agent.account,
                userId: d.userId, account: d.account, hierarchy: 'L1直推',
                registerTime: new Date(Number(m.registerTime)).toISOString(),
                registerDevice: m.registerDevice || '',
                configMode: cfg.mode, configRecharge: cfg.rechargeThreshold, configBet: cfg.betThreshold,
                configGames: limitGamesText(cfg.limitGames), configGamesRaw: cfg.limitGameRaw,
                seedRecharge: d.spec.recharge,
                seedBets: (d.spec.bets || []).map(b => `${b.game}:${b.amount}`).join(',') || '无',
                seedBetOk: d.bets.every(b => b.ok),
                totalRecharge,
                validBetAll: Number(sum.validAmount.toFixed(2)),
                validBetDay: Number(sum.validAmount.toFixed(2)),
                betAmountAll: Number(sum.betAmount.toFixed(2)),
                orderCount: sum.count, settled: sum.settled, unsettled: sum.unsettled,
                expected, actual, match, sticky, configDrift: !noDrift,
                caliber: noDrift ? (sticky ? '期望含「已达标不撤销」' : '按当前配置公式')
                    : '⚠️ 配置在本阶段被外部改动，本行结论不可信',
                reason: base.reason + (sticky ? '；且此前阶段已达标，按不撤销规则期望为是' : '')
            });
            sleep(0.3);
        }
    }
    console.log(`[${TAG}] ================ 场景 ${id} 结束（总代 ${agent.account} userId=${agent.userId}）================\n`);
}

export default function (data) {
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, data.env);
    if (DRY_RUN) console.log(`[${TAG}] === DRY_RUN：只打印计划，不改配置、不造数据 ===`);
    console.log(`[${TAG}] 待跑场景: ${CASES.join(', ')}  等待参数: 配置后${WAIT_CONFIG}s / 判定前${WAIT_CHECK}s`);

    const before = DRY_RUN ? null : getConfig(data.token);
    if (before) {
        console.log(`[${TAG}] 原始配置已快照（结束会还原）: mode=${before.mode} 充值=${before.rechargeThreshold} 投注=${before.betThreshold} 游戏=${before.limitGameRaw}`);
        emit('CONFIG', {
            label: '【开始前原始配置】', tenantId: TENANT_ID, mode: before.mode,
            rechargeThreshold: before.rechargeThreshold, betThreshold: before.betThreshold,
            limitGameRaw: before.limitGameRaw, limitGamesText: limitGamesText(before.limitGames),
            dayLimit: before.dayLimit, totalLimit: before.totalLimit,
            sameDeviceInvalid: before.sameDeviceInvalid, readAt: new Date().toISOString()
        });
    }

    try {
        for (const id of CASES) runScenario(data, id);
    } finally {
        // 不管成功失败都把配置还原回来，否则会把后台留在测试中间态
        if (before) {
            console.log(`\n[${TAG}] ===== 还原原始配置 =====`);
            const r = applyConfig(data.token, {
                mode: before.mode, rechargeThreshold: before.rechargeThreshold,
                betThreshold: before.betThreshold, limitGames: before.limitGames
            }, '【结束后还原】');
            const ok = r && r.mode === before.mode && r.rechargeThreshold === before.rechargeThreshold
                && r.betThreshold === before.betThreshold && r.limitGameRaw === before.limitGameRaw;
            console.log(`[${TAG}] ${ok ? '✅ 配置已还原' : '❌❌ 配置未完全还原，请手工检查！原始值: ' + JSON.stringify({ mode: before.mode, rt: before.rechargeThreshold, bt: before.betThreshold, games: before.limitGameRaw })}`);
            emit('SUMMARY', { restored: ok, original: { mode: before.mode, rechargeThreshold: before.rechargeThreshold, betThreshold: before.betThreshold, limitGameRaw: before.limitGameRaw } });
        }
    }
}
