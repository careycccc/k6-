/**
 * 「有效邀请达标条件 + 生效游戏」场景验证（会改配置、会造真实数据）
 *
 * 每个场景的节奏（时序纪律来自实践，不能省）：
 *   应用配置 → 回读确认 → 等 WAIT_CONFIG(默认60s) → 建总代+造下级 → 等注单全部结算
 *   → 等 WAIT_CHECK(默认90s) → 查 GetPageListInvitedList 比对 isOkInvite
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
    getTeam, directDownlines, fetchOrders, sumOrders, expectOkInvite, getInviteOkRewardCount, emit
} from './api.js';
import { createAgent, createDownline, seedDownline, waitAllSettled, betAmountForValid, doRecharge, doBet } from './seed.js';
import { getFrontUserInfo } from '../../user/userManagement.js';

const TENANT_ID = __ENV.TENANT_ID || '3004';
const DRY_RUN = __ENV.DRY_RUN === '1';
const WAIT_CONFIG = parseInt(__ENV.WAIT_CONFIG || '60', 10);   // 改配置后等多久再造数/再查
const WAIT_CHECK = parseInt(__ENV.WAIT_CHECK || '90', 10);     // 注单结算后等多久再查 isOkInvite
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

    // 组 2：门槛为 0（用户口径：某项门槛为 0 = 该项自动满足；两个都为 0 = 只要邀请就算成功）。
    // 按产品口径重做成单阶段：每种门槛组合先配置、再建全新下级，不在同一批下级上切配置
    // （改配置不触发重判，加上"已满足项的同类行为不触发重判"缺陷，多阶段复用下级会把结论搅混）。
    '2a': {
        name: '门槛为0：充值门槛=0 / 投注门槛=300 / 同时满足',
        base: { rechargeThreshold: 0, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'Z 只注册', recharge: 0, bets: [] },
            { label: 'A 充值2000不投注', recharge: 2000, bets: [] },
            { label: 'B 充值500+投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [{ caseId: '2-1', name: '充值条件恒满足，只看投注 → Z否 A否 B是', config: {} }]
    },
    '2b': {
        name: '门槛为0：充值门槛=1000 / 投注门槛=0 / 同时满足',
        base: { rechargeThreshold: 1000, betThreshold: 0, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'Z 只注册', recharge: 0, bets: [] },
            { label: 'A 充值2000不投注', recharge: 2000, bets: [] },
            { label: 'B 充值500+投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [{ caseId: '2-2', name: '投注条件恒满足，只看充值 → Z否 A是(没投注也算) B否', config: {} }]
    },
    '2c': {
        name: '门槛为0：两个门槛都=0 / 同时满足',
        base: { rechargeThreshold: 0, betThreshold: 0, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'Z 只注册', recharge: 0, bets: [] },
            { label: 'A 充值2000不投注', recharge: 2000, bets: [] },
            { label: 'B 充值500+投注达标', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [{ caseId: '2-3', name: '只要邀请就算成功 → 三个都应为是（Z 什么都没做）', config: {} }]
    },
    '2d': {
        name: '门槛为0：两个门槛都=0 / 满足任一',
        base: { rechargeThreshold: 0, betThreshold: 0, limitGames: ARL([WG30]), mode: '2' },
        downlines: [{ label: 'Z 只注册', recharge: 0, bets: [] }],
        phases: [{ caseId: '2-4', name: '只要邀请就算成功 → Z 应为是', config: {} }]
    },

    // 组 3：生效游戏 —— 充值门槛设到极大屏蔽充值条件，结果只由投注范围决定。同样改成单阶段。
    '3': {
        name: '生效游戏：指定 ARLottery[WinGo_30S]',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: ARL([WG30]), mode: '2' },
        downlines: [
            { label: 'X 投 WinGo_30S', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'Y 投 WinGo_5M', recharge: FUND, bets: [bet(WG5, BET_PASS)] }
        ],
        phases: [{ caseId: '3-1', name: '范围内的 X 达标，范围外的 Y 不达标', config: {} }]
    },
    '3d': {
        name: '生效游戏：全体游戏',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: [], mode: '2' },
        downlines: [
            { label: 'X 投 WinGo_30S', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'Y 投 WinGo_5M', recharge: FUND, bets: [bet(WG5, BET_PASS)] }
        ],
        phases: [{ caseId: '3-2', name: '全体游戏 → X、Y 都应达标', config: {} }]
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
    },

    // 组 9：触发类型隔离 —— 只充值 vs 只投注，能否单独触发重判。
    // 依据：组7/组8 的触发都含投注，全部重判成功；组5 只补充值，没重判。需求 11/03 修订写的是
    // "发生投注或者充值行为后"重判，所以只充值也该触发。三个下级起点相同，一轮对照。
    //   起点：充值500(<1000) + 有效投注450.80(≥300)，同时满足 → 不达标
    //   切满足任一：按累计已达标(投注够)，但没有新行为 → 按产品口径维持不达标
    //   U1 不动 / U2 只补充值 / U3 只补一小注
    '9': {
        name: '触发类型隔离：只充值 vs 只投注',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'U1 对照组不做行为', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'U2 只充值触发', recharge: FUND, bets: [bet(WG30, BET_PASS)] },
            { label: 'U3 只投注触发', recharge: FUND, bets: [bet(WG30, BET_PASS)] }
        ],
        phases: [
            { caseId: '9-1', name: '同时满足：充值500不够 → 三个都不达标', config: { mode: MODE_BOTH } },
            { caseId: '9-2', name: '切满足任一，不做行为 → 按产品口径维持不达标', config: { mode: '2' } },
            {
                caseId: '9-3', name: 'U2 只补充值、U3 只补一小注、U1 不动 → U2/U3 应转为达标',
                config: {},
                actions: [
                    { type: 'recharge', amount: FUND, targets: ['U2'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['U3'] }
                ]
            }
        ]
    },

    // 组 10：验证「跨门槛才触发」假设。
    // 组5/7/8/9 的全部触发案例都能用一条规则解释：后台只在新行为让「它自己那个条件」从不满足
    // 变成满足时才重新判定；条件本来就满足，再做同类行为不触发判定（时间线证据：奖励发放时刻
    // 与触发行为对齐，且 U2/U3 在同一批次里一个判有效一个被跳过）。
    // 这里用假设去预测：H1/H2 给大额、两种行为都做，但都不让「未满足的那个条件」跨门槛 → 假设预测仍为否；
    // H3/H4 让未满足的条件跨门槛 → 预测为是。按产品口径（满足任一 + 有新行为 + 累计数据）六个都该为是。
    '10': {
        name: '验证「只有跨门槛才触发重判」假设',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            // 充值不满足(500) + 投注已满足(310→有效303.8)。余额 500+97-310≈287，触发时先充200再投460够本金
            { label: 'H1a 投注已满足型', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            { label: 'H1b 投注已满足型', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            // 充值已满足(2000) + 未投注
            { label: 'H2a 充值已满足型', recharge: 2000, bets: [] },
            { label: 'H2b 充值已满足型', recharge: 2000, bets: [] },
            // 正向对照
            { label: 'H3 充值跨门槛对照', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            { label: 'H4 投注跨门槛对照', recharge: 2000, bets: [] }
        ],
        phases: [
            { caseId: '10-1', name: '同时满足 → 六个都不达标', config: { mode: MODE_BOTH } },
            { caseId: '10-2', name: '切满足任一，不做行为 → 按产品口径维持不达标', config: { mode: '2' } },
            {
                caseId: '10-3', name: '各自施加触发行为 → 按产品口径六个都应达标（假设预测 H1/H2 仍为否）',
                config: {},
                actions: [
                    // H1：充值 200(累计700 仍<1000，充值条件不跨门槛) + 大额投注 460(投注本就满足)
                    { type: 'recharge', amount: 200, targets: ['H1a', 'H1b'] },
                    { type: 'bet', game: WG30, amount: 460, targets: ['H1a', 'H1b'] },
                    // H2：大额充值 2000(充值本就满足) + 小额投注 100(有效98<300，投注条件不跨门槛)
                    { type: 'recharge', amount: 2000, targets: ['H2a', 'H2b'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['H2a', 'H2b'] },
                    // H3：充值 500，累计到 1000，充值条件跨门槛
                    { type: 'recharge', amount: FUND, targets: ['H3'] },
                    // H4：投注 460，有效 450.8，投注条件跨门槛
                    { type: 'bet', game: WG30, amount: 460, targets: ['H4'] }
                ]
            }
        ]
    },

    // 组 11：验证修正后的假设（组10 推翻了「跨门槛才触发」）。
    // 修正假设：一笔行为只有在「它对应的那一项条件此前尚未满足」时才触发重判；那一项此前已满足，
    // 这笔行为被直接跳过。能解释组5/7/8/9/10 全部 13 个触发案例，但是看完组10 才归纳的，需要预测验证。
    // 全部用**单笔**行为，排除组10 那种"两类行为都做、总有一笔命中"的干扰：
    //   K1/K2：对「已满足的那一项」做单笔大额同类行为 → 预测否（复现组5 R1 / 组9 U3，加大金额排除金额因素）
    //   K3/K4：对「未满足的那一项」做单笔、且不让它跨门槛 → 预测是（被推翻的旧假设会预测否，可区分两者）
    '11': {
        name: '验证修正假设：已满足那一项的同类单笔行为会被跳过',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'K1a 充值已满足', recharge: 2000, bets: [] },
            { label: 'K1b 充值已满足', recharge: 2000, bets: [] },
            // 投注已满足(310→有效303.8)；余额 500+97-310≈287，单笔投 280 够本金
            { label: 'K2a 投注已满足', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            { label: 'K2b 投注已满足', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            { label: 'K3 充值未满足', recharge: FUND, bets: [{ game: WG30, amount: 310 }] },
            { label: 'K4 投注未满足', recharge: 2000, bets: [] }
        ],
        phases: [
            { caseId: '11-1', name: '同时满足 → 六个都不达标', config: { mode: MODE_BOTH } },
            { caseId: '11-2', name: '切满足任一，不做行为 → 维持不达标', config: { mode: '2' } },
            {
                caseId: '11-3', name: '各施加单笔行为 → 按产品口径六个都应达标（修正假设预测 K1/K2 仍为否）',
                config: {},
                actions: [
                    { type: 'recharge', amount: 2000, targets: ['K1a', 'K1b'] },          // 已满足项：充值
                    { type: 'bet', game: WG30, amount: 280, targets: ['K2a', 'K2b'] },    // 已满足项：投注
                    { type: 'recharge', amount: 200, targets: ['K3'] },                   // 未满足项：充值，累计700<1000
                    { type: 'bet', game: WG30, amount: 100, targets: ['K4'] }             // 未满足项：投注，有效98<300
                ]
            }
        ]
    },

    // 组 12：大改小（门槛下降）+ 历史数据自动满足新门槛时，哪种新行为能触发重判。
    // 2026-11-05 用户要求：改配置后下级的历史充值也要算入新配置。门槛从 2500/500 降到 1000/500
    // 后，M0~M3 的历史数据（充值2000、有效投注588）已经**同时满足**两项新门槛，但在"门槛还是
    // 2500"那次判定里，充值记的是"未满足"、投注记的是"已满足"。按已证实的缺陷（已满足项的
    // 同类行为不触发重判），M2（只补投注，落在"已满足"那一项）预计仍会被跳过；M1（只补充值，
    // 落在"未满足"那一项）预计触发。这组是把缺陷换到"门槛下降"这个新外壳下复现，留给后端修复
    // 后回归。
    // 2026-11-05 坑：首版用 recharge:1200 起步，商品模式充值把 1200 打折成了 1000——正好卡在
    // 新门槛(1000)的边界上，M2/O1 的不一致测不出是重判没触发还是 `>` / `≥` 边界口径问题。改用
    // 已验证不会被取整的 2000（旧门槛同步抬到 2500，保持"旧门槛下不满足"的起点不变）。
    '12': {
        name: '大改小：门槛2500/500降到1000/500，历史数据自动达标，哪种新行为触发重判',
        base: { rechargeThreshold: 2500, betThreshold: 500, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'M0 对照组不做行为', recharge: 2000, bets: [{ game: WG30, amount: 600 }] },
            { label: 'M1 只补充值(此前未满足项)', recharge: 2000, bets: [{ game: WG30, amount: 600 }] },
            { label: 'M2 只补投注(此前已满足项)', recharge: 2000, bets: [{ game: WG30, amount: 600 }] },
            { label: 'M3 充值投注都补', recharge: 2000, bets: [{ game: WG30, amount: 600 }] }
        ],
        phases: [
            { caseId: '12-1', name: '门槛2500/500 → 充值2000不够，四个都不达标', config: { mode: MODE_BOTH, rechargeThreshold: 2500, betThreshold: 500 } },
            { caseId: '12-2', name: '门槛降到1000/500，不做行为 → 产品口径维持不达标（历史数据已同时满足两项新门槛）', config: { rechargeThreshold: 1000 } },
            {
                caseId: '12-3', name: 'M1补充值100/M2补投注100/M3两者都补，M0不动 → 按产品口径三个有行为的都应达标',
                config: {},
                actions: [
                    { type: 'recharge', amount: 100, targets: ['M1'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['M2'] },
                    { type: 'recharge', amount: 100, targets: ['M3'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['M3'] }
                ]
            }
        ]
    },

    // 组 12b：同样的大改小，但配置是「满足任一」——用户确认这种更简单：历史数据只要有一项满足
    // 新门槛，随便哪种新行为触发一下就该判有效，不用像组12那样区分触发类型。
    // 同样把 recharge 从 1200(会被打折成1000,正好卡在门槛边界) 改成已验证不会被取整的 2000，
    // 旧门槛同步抬到 2500。
    '12b': {
        name: '大改小 + 满足任一：充值门槛降到历史数据已满足，任意一种新行为应触发',
        base: { rechargeThreshold: 2500, betThreshold: 500, limitGames: ARL([WG30]), mode: '2' },
        downlines: [
            { label: 'O1 两项都不达标', recharge: 2000, bets: [{ game: WG30, amount: 200 }] } // 有效196<500，充值2000<2500
        ],
        phases: [
            { caseId: '12b-1', name: '门槛2500/500 → 两项都不达标', config: { mode: '2', rechargeThreshold: 2500, betThreshold: 500 } },
            { caseId: '12b-2', name: '充值门槛降到1000，投注门槛不变，不做行为 → 产品口径维持不达标（历史充值2000已满足新门槛，投注仍不满足）', config: { rechargeThreshold: 1000 } },
            {
                caseId: '12b-3', name: '补一笔小额投注(新行为，不要求本身达标) → 满足任一：充值早就够了，应转为达标',
                config: {},
                action: { type: 'bet', game: WG30, amount: 100, targets: ['O1'] }
            }
        ]
    },

    // 组 13（6-1）：已达标下级，把门槛调高到它达不到的值，是否仍保持已达标不撤销。
    // 用充值隔离：投注门槛设成不可能达到，isOkInvite 完全由充值条件决定，和组16一致的隔离手法。
    // J1：门槛500时充值1000达标；门槛调高到2000(1000<2000)后不做任何行为 → 应保持已达标(sticky)。
    // J2（对照）：门槛500时充值远低于500不达标；门槛调高到2000后更不可能达标 → 应维持不达标，
    //     证明新门槛确实生效（不是"只要判过一次全员恒真"之类的假达标）。
    '13': {
        name: '已达标下级：门槛调高到它达不到的值，是否保持已达标不撤销（6-1）',
        base: { rechargeThreshold: 500, betThreshold: 99999999, limitGames: [], mode: '2' },
        downlines: [
            { label: 'J1 门槛500时充值1000达标', recharge: 1000, bets: [] },
            { label: 'J2 对照：门槛500时充值100(远低于500)不达标', recharge: 100, bets: [] }
        ],
        phases: [
            { caseId: '13-1', name: '门槛500 → J1(1000≥500)达标 J2(100<500)不达标', config: {} },
            {
                caseId: '13-2', name: '门槛调高到2000(J1的1000<2000)，不做任何行为 → J1应保持已达标不撤销；J2继续不达标',
                config: { rechargeThreshold: 2000 }
            }
        ]
    },

    // 组 14：补「3-6：缩小生效游戏范围后，已达标不撤销」（需求第5节"生效游戏调整示例"）。
    // 原例子：全体游戏下累计有效投注200(JILI150+PP50)，门槛200→达标；收窄为仅JILI后范围内
    // 只剩150<200，但已达标的不撤销。JILI/PP 接口下不了单（见 bet-game-availability-3004-3007），
    // 用 3004 已验证能投的 WinGo_30S(替JILI，留在范围内) / WinGo_5M(替PP，被收窄掉) 类举。
    // rechargeThreshold 设成不可能达到，mode 用满足任一，让 isOkInvite 完全由投注条件决定，和
    // 组3/3d/3b/3c 的隔离手法一致。
    // G1：全体游戏时刚好达标(201.88≥200) → 收窄到仅WG30(150.92<200)后应保持已达标(sticky)。
    // G2：全体游戏时不够(147<200)，对照；收窄后只认WG30(98)，仍不够；phase 14-3 让它只在WG30
    //     补一笔(新行为)，范围内累计到205.8，验证"收窄后用新范围的累计重算"而不是维持老范围
    //     或者直接清零。
    '14': {
        name: '生效游戏范围收窄：已达标不撤销 + 范围内累计重算（需求第5节示例）',
        base: { rechargeThreshold: 99999999, betThreshold: 200, limitGames: [], mode: '2' },
        downlines: [
            { label: 'G1 全体游戏时达标(WG30:150.92+WG5:50.96=201.88)', recharge: FUND, bets: [{ game: WG30, amount: 154 }, { game: WG5, amount: 52 }] },
            { label: 'G2 全体游戏时不达标(WG30:98+WG5:49=147)', recharge: FUND, bets: [{ game: WG30, amount: 100 }, { game: WG5, amount: 50 }] }
        ],
        phases: [
            { caseId: '14-1', name: '全体游戏，门槛200 → G1达标(201.88) G2不达标(147)', config: { mode: '2', rechargeThreshold: 99999999, betThreshold: 200, limitGames: [] } },
            { caseId: '14-2', name: '生效游戏收窄为仅WG30(类比"仅选JILI")，不做行为 → G1已达标不撤销；G2范围内仅98<200，维持不达标', config: { limitGames: ARL([WG30]) } },
            {
                caseId: '14-3', name: 'G2 在WG30(范围内)补投110(新行为) → 范围内累计98+107.8=205.8≥200，应转为达标；G1不动，继续已达标不撤销',
                config: {},
                action: { type: 'bet', game: WG30, amount: 110, targets: ['G2'] }
            }
        ]
    },

    // 组 15（3-5）：多子游戏合并统计。生效游戏配两个子游戏(WinGo_30S+WinGo_5M)，任一单独都不够
    // 门槛，两者合并才够——能分辨"是否正确合并统计"：只统计了其中一个会判否，正确合并才判是。
    '15': {
        name: '生效游戏：多子游戏合并统计（WinGo_30S + WinGo_5M）',
        base: { rechargeThreshold: 99999999, betThreshold: 300, limitGames: ARL([WG30, WG5]), mode: '2' },
        downlines: [
            { label: 'F1 两个子游戏合并才达标(150.92+150.92=301.84)', recharge: FUND, bets: [{ game: WG30, amount: 154 }, { game: WG5, amount: 154 }] },
            { label: 'F2 只投一个子游戏不够(147<300)', recharge: FUND, bets: [{ game: WG30, amount: 150 }] }
        ],
        phases: [{ caseId: '15-1', name: '范围=WinGo_30S+WinGo_5M，门槛300 → F1合并达标(301.84) F2单游戏不够(147)', config: {} }]
    },

    // 组 16（4-4）：充值分两笔累计达标。投注门槛设成不可能达到，隔离出纯充值判定；
    // 第一笔充值故意不够，第二笔补齐正好到门槛，验证系统用的是"累计充值"而不是最后一笔或某一笔。
    '16': {
        name: '充值分两笔累计达标',
        base: { rechargeThreshold: 1000, betThreshold: 99999999, limitGames: [], mode: '2' },
        downlines: [{ label: 'H1 分两笔充值500+500累计到1000', recharge: 500, bets: [] }],
        phases: [
            { caseId: '16-1', name: '充值500<1000，不达标', config: {} },
            {
                caseId: '16-2', name: '再充值500(新行为)，累计1000刚好达标 → 应转为达标',
                config: {},
                action: { type: 'recharge', amount: 500, targets: ['H1'] }
            }
        ]
    },

    // 组 19（排查 2026-11-06 全量回归里 9-2/U3 的异常）：全程 mode=1(同时满足) 不做任何
    // 切换，下级 V1 按这个 mode 的逻辑该恒为 false(充值不够、投注够，AND=false)。如果这个
    // false 是最终正确答案，不管等多久都不该变；如果多等几分钟后自己变成 true，说明判定系统
    // 本身会漂移，和"切配置触发重判"无关——用更长的 WAIT_CHECK(比如 -e WAIT_CHECK=300)跑。
    '19': {
        name: '验证判定是否会在配置不变的情况下自行漂移(排查9-2异常)',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'V1 同时满足下充值不够投注够(本该恒为false)', recharge: 500, bets: [{ game: WG30, amount: 460 }] }
        ],
        phases: [{ caseId: '19-1', name: '造数后不切配置，用更长WAIT_CHECK多等几分钟再查 → 期望仍是false', config: {} }]
    },

    // 组 20（排查 2026-11-06 全量回归里 11-3/K4 的异常）：复刻组11 K3/K4 的对称结构，换成
    // 全新账号重跑，排查"K4(投注未满足补投注,不跨门槛)失败而K3(充值未满足补充值,不跨门槛)
    // 成功"这个结果是稳定复现还是偶发——两者结构完全对称，唯一差别是补的是哪个字段。
    // 必须是三阶段(mode=1造出false基线 → 切mode=2不触发 → 补单字段行为触发)，原始K3/K4就
    // 是这个结构；如果直接用mode=2造数，OR逻辑在造数那一刻就已经满足，sticky后测不出后面
    // 补行为到底有没有生效(20第一版就是踩了这个坑，20-1造数时就已经意外是true了，作废)。
    '20': {
        name: '复刻K3/K4对称结构(排查K4异常是否稳定复现，三阶段版)',
        base: { rechargeThreshold: 1000, betThreshold: 300, limitGames: ARL([WG30]), mode: MODE_BOTH },
        downlines: [
            { label: 'V2 类K3充值未满足(投注已满足)', recharge: 500, bets: [{ game: WG30, amount: 460 }] },
            { label: 'V3 类K4投注未满足(充值已满足)', recharge: 2000, bets: [] }
        ],
        phases: [
            { caseId: '20-1', name: '同时满足造数：V2充值500<1000投注450.8≥300(AND=false)；V3充值2000≥1000不投注(AND=false)', config: { mode: MODE_BOTH } },
            { caseId: '20-2', name: '切满足任一，不做行为 → 产品口径维持false(即使OR逻辑现算是true)', config: { mode: '2' } },
            {
                caseId: '20-3', name: 'V2补充值200(到700仍<1000不跨门槛)/V3补投注100(有效98仍<300不跨门槛) → 满足任一下两者都应转为达标',
                config: {},
                actions: [
                    { type: 'recharge', amount: 200, targets: ['V2'] },
                    { type: 'bet', game: WG30, amount: 100, targets: ['V3'] }
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
        if (id === '17' || id === '18') continue; // 组17/18 是自定义场景(奖励流水/多级邀请关系)，不走 SCENARIOS 表的预检查
        const sc = SCENARIOS[id];
        if (!sc) throw new Error(`[${TAG}] 未知场景 ${id}，可选: ${Object.keys(SCENARIOS).join(',')},17,18`);
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
    if (!now) throw new Error(`${label}：写完配置后回读失败（重试后仍失败）`);
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
    //
    // 期望值模型 = 产品口径（2026-11-04 用户确认）：
    //   「配置变更后，下级再次充值/投注满足条件，才算有效邀请」—— 改配置本身不触发重判。
    //   判定时用累计数据（历史充值 + 当前游戏范围内的累计有效投注）。
    // 所以每个下级的期望按"触发点"推进：
    //   - 首个阶段：造数行为发生在初始配置下 → 期望 = 公式(当前配置, 累计数据)
    //   - 之后某阶段该下级有新行为 → 期望 = 已达标 || 公式(当前配置, 累计数据)
    //   - 之后某阶段该下级没有新行为 → 期望 = 上一阶段的期望（配置变了也不重判）
    //   - 任何时候后台已判过有效 → 不撤销，期望恒为是
    const everOk = {};     // userId -> 后台是否曾经判为有效（「已达标不撤销」）
    const prevExpect = {}; // userId -> 上一阶段的期望
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
        const touched = {};          // 本阶段有新行为的下级 userId -> 行为描述
        if (actions.length) {
            if (DRY_RUN) {
                actions.forEach(a => console.log(`[${TAG}][DRY] 将对 ${a.targets.join('/')} 执行 ${a.type}=${a.amount}`));
            } else {
                for (const act of actions) {
                    const hit = seeded.filter(d => act.targets.some(t => d.label.indexOf(t) === 0));
                    for (const d of hit) {
                        if (act.type === 'recharge') doRecharge(token, d.userId, d.account, act.amount);
                        else if (act.type === 'bet') d.bets.push(doBet(d.account, act.game, act.amount));
                        touched[d.userId] = (touched[d.userId] ? touched[d.userId] + '+' : '')
                            + (act.type === 'recharge' ? `充值${act.amount}` : `投注${act.game}:${act.amount}`);
                        sleep(2);
                    }
                }
                if (actions.some(a => a.type === 'bet')) waitAllSettled(token, Object.keys(touched).map(Number), seedStart, SETTLE_MAX);
                waitWithLog(WAIT_CHECK, '新行为后等后端重算');
            }
        }
        if (DRY_RUN) { console.log(`[${TAG}][DRY] 将核对阶段 ${ph.caseId}：${ph.name}`); continue; }

        const cfg = getConfig(token);
        if (!cfg) throw new Error(`阶段 ${ph.caseId} 读配置失败（重试后仍失败），无法核对`);
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
            const sticky = !!everOk[d.userId];
            const trigger = pi === 0 ? '造数' : (touched[d.userId] || '');
            let expected, basis;
            if (sticky) {
                expected = true; basis = '此前已被判为有效，按「已达标不撤销」期望为是';
            } else if (trigger) {
                expected = base.expected; basis = `本阶段有新行为(${trigger})，按当前配置重判：${base.reason}`;
            } else {
                expected = !!prevExpect[d.userId];
                basis = `本阶段无新行为，按产品口径不重判，维持上一阶段期望=${expected ? '是' : '否'}（若按当前配置算：${base.reason} → ${base.expected ? '是' : '否'}）`;
            }
            prevExpect[d.userId] = expected;
            const actual = !!m.isOkInvite;
            if (actual) everOk[d.userId] = true;

            const match = expected === actual;
            console.log(`[${TAG}] ${noDrift ? (match ? '✅' : '❌') : '⚠️配置被改,结论不可信'} [${ph.caseId}] ${d.label} userId=${d.userId}`
                + ` 充值=${totalRecharge} 范围内有效投注=${sum.validAmount.toFixed(2)}`
                + ` 新行为=${trigger || '无'} 期望=${expected}${sticky ? '(已达标不撤销)' : ''} 实际=${actual}`);

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
                trigger: trigger || '无', formulaExpected: base.expected,
                caliber: noDrift ? '产品口径：配置变更后需新行为触发重判，按累计数据判定'
                    : '⚠️ 配置在本阶段被外部改动，本行结论不可信',
                reason: basis
            });
            sleep(0.3);
        }
    }
    console.log(`[${TAG}] ================ 场景 ${id} 结束（总代 ${agent.account} userId=${agent.userId}）================\n`);
}

/**
 * 组 17（6-3/6-4）：同一下级最多计为一次有效邀请、奖励不重复发放。
 *
 * 用「满足任一」隔离：充值门槛一步到位(造数时直接达标)，投注门槛设成不可能达到——这样投注
 * 这一项永远"此前未满足"，每次补一笔小投注都能可靠触发重判(不会撞上"已满足项同类行为被
 * 跳过"那条缺陷)，但因为充值早就通过「满足任一」让整体判有效了，这次重判只是重新确认，不是
 * 新的达标。查上级收到的「邀请成功奖励(L3InviteOkReward)」笔数，验证这几轮重判不会让笔数增加。
 */
function runRewardDedupeScenario(data) {
    const { token, countryCode } = data;
    const id = '17';
    console.log(`\n[${TAG}] ================ 场景 ${id}：同一下级只计一次有效邀请，奖励不重复发放 ================`);

    const cfg = { mode: '2', rechargeThreshold: 500, betThreshold: 99999999, limitGames: [] };
    applyConfig(token, cfg, `场景${id} 初始配置`);
    waitWithLog(WAIT_CONFIG, '配置生效');

    const testStart = Date.now() - 3600000;
    let agent = { account: 'DRY', userId: 0, inviteCode: 'DRY' };
    let d = null;
    if (DRY_RUN) {
        console.log(`[${TAG}][DRY] 将建 1 个总代 + 1 个下级，充值500(满足任一→立即达标)，再追加2笔小投注触发重判，核对奖励笔数不增加`);
        return;
    }
    agent = createAgent(token, countryCode);
    if (!agent) throw new Error(`[${TAG}] 场景 ${id} 建总代失败`);
    d = createDownline(token, agent.inviteCode, countryCode, TENANT_ID);
    if (!d) throw new Error(`[${TAG}] 场景 ${id} 建下级失败`);
    doRecharge(token, d.userId, d.account, 500);
    sleep(2);
    waitWithLog(WAIT_CHECK, '等后端重算有效邀请（首次达标）');

    function checkRound(label) {
        const team = getTeam(token, agent.userId);
        const m = team.find(x => Number(x.userId) === Number(d.userId));
        const isOk = !!(m && m.isOkInvite);
        const reward = getInviteOkRewardCount(token, agent.userId, testStart);
        const rc = reward ? reward.count : null;
        console.log(`[${TAG}] [17] ${label} isOkInvite=${isOk} 奖励笔数=${rc}`);
        return { isOk, rewardCount: rc };
    }

    const r1 = checkRound('首次达标(造数后)');
    emit('CASE', {
        caseId: '17-1', caseName: '同一下级只计一次有效邀请/奖励不重复发放 / 首次达标',
        scenario: id, label: '首次达标', agentId: agent.userId, agentAccount: agent.account,
        userId: d.userId, account: d.account, hierarchy: 'L1直推',
        totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
        expected: true, actual: r1.isOk, match: r1.isOk === true,
        caliber: '首次充值500(满足任一门槛500)应立即判有效，建立奖励笔数基线',
        reason: `isOkInvite=${r1.isOk}，上级邀请成功奖励笔数=${r1.rewardCount}`
    });

    // 补两笔小投注(投注门槛不可能达到，始终是"未满足项"，可靠触发重判)，重复确认不应增加奖励笔数
    for (let i = 2; i <= 3; i++) {
        doBet(d.account, WG30, 50);
        sleep(2);
        waitAllSettled(token, [d.userId], testStart, SETTLE_MAX);
        waitWithLog(WAIT_CHECK, `第${i}次重判`);
        const ri = checkRound(`第${i}次重判(重复触发)`);
        const noDup = r1.rewardCount !== null && ri.rewardCount !== null && ri.rewardCount <= r1.rewardCount;
        emit('CASE', {
            caseId: `17-${i}`, caseName: '同一下级只计一次有效邀请/奖励不重复发放 / 重复触发重判',
            scenario: id, label: `重复触发第${i - 1}次`, agentId: agent.userId, agentAccount: agent.account,
            userId: d.userId, account: d.account, hierarchy: 'L1直推',
            totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
            expected: true, actual: noDup, match: noDup === true,
            caliber: '已达标下级反复触发重判，奖励笔数不应比首次达标时增加',
            reason: `isOkInvite=${ri.isOk}，奖励笔数 首次=${r1.rewardCount} 本次=${ri.rewardCount}`
        });
    }
    console.log(`[${TAG}] ================ 场景 ${id} 结束（总代 ${agent.account} userId=${agent.userId}）================\n`);
}

/**
 * 组 18（组8/层级）：L2/L3 间推不计入直接上级的有效邀请。
 *
 * 建三层关系：Top(总代) → A(Top的直推) → B(A的直推，对Top是间推/L2)。只让 B 满足有效邀请
 * 门槛，核对：①Top 查到的团队树里 B 的 parentId 应该是 A 的 userId，不是 Top 的；
 * ②Top 自己的直推列表(directDownlines) 不应包含 B；③A 自己查，B 应该在 A 的直推列表里，
 * 且对 A 而言 isOkInvite=true；④「邀请成功奖励」应该记在 A 名下，Top 不应该因为 B 达标而
 * 多收到一笔。
 */
function runHierarchyScenario(data) {
    const { token, countryCode } = data;
    const id = '18';
    console.log(`\n[${TAG}] ================ 场景 ${id}：L2/L3 间推不计入直接上级的有效邀请 ================`);

    const cfg = { mode: '2', rechargeThreshold: 500, betThreshold: 99999999, limitGames: [] };
    applyConfig(token, cfg, `场景${id} 初始配置`);
    waitWithLog(WAIT_CONFIG, '配置生效');

    const testStart = Date.now() - 3600000;
    if (DRY_RUN) {
        console.log(`[${TAG}][DRY] 将建 Top总代 → A(Top直推) → B(A直推,对Top是间推)，只让B充值500达标，核对层级归属和奖励归属`);
        return;
    }
    const top = createAgent(token, countryCode);
    if (!top) throw new Error(`[${TAG}] 场景 ${id} 建总代失败`);
    const a = createDownline(token, top.inviteCode, countryCode, TENANT_ID);
    if (!a) throw new Error(`[${TAG}] 场景 ${id} 建A失败`);
    const aInfo = getFrontUserInfo(a.token);
    const aInviteCode = aInfo && aInfo.inviteCode;
    if (!aInviteCode) throw new Error(`[${TAG}] 场景 ${id} 拿不到A的邀请码`);
    const b = createDownline(token, aInviteCode, countryCode, TENANT_ID);
    if (!b) throw new Error(`[${TAG}] 场景 ${id} 建B失败`);
    doRecharge(token, b.userId, b.account, 500);
    sleep(2);
    waitWithLog(WAIT_CHECK, '等后端重算有效邀请');

    const teamFromTop = getTeam(token, top.userId);
    const bInTopTree = teamFromTop.find(x => Number(x.userId) === Number(b.userId));
    const topDirect = directDownlines(teamFromTop, top.userId);
    const bInTopDirect = topDirect.some(x => Number(x.userId) === Number(b.userId));

    const teamFromA = getTeam(token, a.userId);
    const bInATree = teamFromA.find(x => Number(x.userId) === Number(b.userId));
    const aDirect = directDownlines(teamFromA, a.userId);
    const bInADirect = aDirect.some(x => Number(x.userId) === Number(b.userId));
    const bOkUnderA = !!(bInATree && bInATree.isOkInvite);

    const topReward = getInviteOkRewardCount(token, top.userId, testStart);
    const aReward = getInviteOkRewardCount(token, a.userId, testStart);

    console.log(`[${TAG}] [18] B在Top团队树里parentId=${bInTopTree ? bInTopTree.parentId : '找不到'}（A的userId=${a.userId}）`);
    console.log(`[${TAG}] [18] Top直推列表是否含B=${bInTopDirect}  A直推列表是否含B=${bInADirect}  B对A是否isOkInvite=${bOkUnderA}`);
    console.log(`[${TAG}] [18] Top邀请奖励笔数=${topReward && topReward.count}  A邀请奖励笔数=${aReward && aReward.count}`);

    const parentOk = !!(bInTopTree && Number(bInTopTree.parentId) === Number(a.userId));
    emit('CASE', {
        caseId: '18-1', caseName: 'L2/L3间推不计入上级 / B的层级归属',
        scenario: id, label: 'B的parentId应为A', agentId: top.userId, agentAccount: top.account,
        userId: b.userId, account: b.account, hierarchy: 'L2间推(对Top)',
        totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
        expected: true, actual: parentOk, match: parentOk === true,
        caliber: 'B是A邀请的，B的parentId应该是A的userId而不是Top的userId',
        reason: `B在Top团队树里${bInTopTree ? `parentId=${bInTopTree.parentId}` : '查不到这条记录'}，A的userId=${a.userId}`
    });

    const notInTopDirect = !bInTopDirect;
    emit('CASE', {
        caseId: '18-2', caseName: 'L2/L3间推不计入上级 / Top直推列表',
        scenario: id, label: 'Top直推列表不应含B', agentId: top.userId, agentAccount: top.account,
        userId: b.userId, account: b.account, hierarchy: 'L2间推(对Top)',
        totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
        expected: true, actual: notInTopDirect, match: notInTopDirect === true,
        caliber: 'B不是Top的直接邀请人，不应出现在Top的直推(有效邀请候选)列表里',
        reason: `Top的直推userId列表=[${topDirect.map(x => x.userId).join(',')}]`
    });

    const bValidUnderA = bInADirect && bOkUnderA;
    emit('CASE', {
        caseId: '18-3', caseName: 'L2/L3间推不计入上级 / A直推列表',
        scenario: id, label: 'A直推列表应含B且判有效', agentId: a.userId, agentAccount: a.account,
        userId: b.userId, account: b.account, hierarchy: 'L1直推(对A)',
        totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
        expected: true, actual: bValidUnderA, match: bValidUnderA === true,
        caliber: 'B是A的直接邀请人，充值500达标后对A而言应该是有效邀请',
        reason: `A的直推是否含B=${bInADirect}，B对A的isOkInvite=${bOkUnderA}`
    });

    const rewardOk = !!(topReward && aReward && topReward.count === 0 && aReward.count >= 1);
    emit('CASE', {
        caseId: '18-4', caseName: 'L2/L3间推不计入上级 / 奖励归属',
        scenario: id, label: '邀请成功奖励应记A不记Top', agentId: top.userId, agentAccount: top.account,
        userId: b.userId, account: b.account, hierarchy: 'L2间推(对Top)',
        totalRecharge: 500, validBetAll: 0, validBetDay: 0, orderCount: 0, unsettled: 0,
        expected: true, actual: rewardOk, match: rewardOk === true,
        caliber: 'B达标带来的「邀请成功奖励」应该发给直接邀请人A，不应该发给间推的Top',
        reason: `Top邀请成功奖励笔数=${topReward && topReward.count}，A邀请成功奖励笔数=${aReward && aReward.count}`
    });

    console.log(`[${TAG}] ================ 场景 ${id} 结束（Top=${top.account} A=${a.account} B=${b.account}）================\n`);
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
        for (const id of CASES) {
            // 单个场景异常不连累后面的场景；同时发 FATAL 给 runner，让报告和退出码如实反映"中断了"，
            // 而不是像 2026-11-04 场景9 那样中断后报"核对0人、一致0、退出码0"，看起来像成功
            try {
                if (id === '17') runRewardDedupeScenario(data);
                else if (id === '18') runHierarchyScenario(data);
                else runScenario(data, id);
            } catch (e) {
                console.error(`[${TAG}] ❌❌ 场景 ${id} 中途异常中断：${e && e.message ? e.message : e}`);
                emit('FATAL', { scenario: id, error: String(e && e.message ? e.message : e), at: new Date().toISOString() });
            }
        }
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
