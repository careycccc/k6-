/**
 * FB广告分析 - 虚拟广告配置 + D0复充档位分配算法
 *
 * 5组广告组合数据照抄 Go 版本(k6-go) pkg/fbad/config.go 的 DefaultAdCombos，
 * 保持两边造的测试数据一致可比对。权重首档最高依次递减，避免5等分的假数据感。
 */

// ================= 留存周期清单（2026/11/02 报表优化需求） =================

/**
 * 「留存分析」Tab 的登录留存周期清单——2026-11-03 核对真实接口
 * /api/RptFbAd/GetRetentionPageList 响应字段实锤确认：retention2/3/5/7/15/30/60/90，
 * 从2开始，没有retention1(注册当天必然在线，没有判定意义，次日留存就是retention2)。
 *
 * 分母口径(接口实测确认)：retentionN 的分母是 registerCount(当天注册人数)。
 *
 * 这是被测报表的字段清单，只有验证脚本(verifyRetention.day.js)用。造数不再按这些档位
 * 触发行为——老账号每天做什么由 libs/common/behaviorSim.js 随机决定，留存自然产生。
 */
export const LOGIN_RETENTION_DAY_MARKS = [2, 3, 5, 7, 15, 30, 60, 90];

/**
 * 「留存分析」Tab 的"复充"周期清单——2026-11-03 核对真实接口
 * /api/RptFbAd/GetRetentionPageList 响应字段实锤确认：reRecharge1/2/3/4/5/6/7/10/
 * 15/20/25/30/60/90/120/180，1~7连续后跳档到10再等差放大，和登录留存(见
 * fbAdSeed.day.js 的 LOGIN_RETENTION_DAY_MARKS)的档位、起点都不一样，不能混用。
 *
 * 基准群体是"首充日"当天首充的会员(首充日不一定等于注册日)，分母是该行
 * firstRechargeCount，不是 registerCount——例如某行 registerCount=0,
 * firstRechargeCount=1, reRecharge1=1, reRecharge1Rate=100.0，可见 1/1=100% 而非 1/0。
 *
 * 各档位含义(2026-11-03 用真实报表响应+后端订单逐用户反推，15组数据全部吻合)：
 *   - reRecharge1 = 首充日当天充值≥2笔，数值等于同行的 d0Recharge2Count，不是"跨天"。
 *   - reRechargeN(N>=2) = 首充日+(N-1) 那天有 Payed 充值(几笔都算，去重到人)。
 * 只有验证脚本用，造数不按档位触发(见上面登录留存清单的说明)。
 */
export const RECHARGE_RETENTION_DAY_MARKS = [1, 2, 3, 4, 5, 6, 7, 10, 15, 20, 25, 30, 60, 90, 120, 180];

/**
 * 「充值分析」Tab 的复充档位阈值——2026-11-05 核对真实接口 /api/RptFbAd/GetRechargePageList
 * 响应字段实锤确认：d0Recharge{2,3,4,5,10}Count/Rate/Text（首充当天复充档位）、
 * cumRecharge1Count、cumRecharge{2,3,4,5,10}Count/Rate/Text（历史累计复充档位）。
 * 和上面两套留存档位(从2起步、等差跳档)完全不同的清单，不能混用。只有 verifyRecharge.js/
 * verifyRechargeRunner.js 用。
 */
export const RECHARGE_REPEAT_TIER_MARKS = [2, 3, 4, 5, 10];

// ================= 数据起点（验证范围约定） =================

/**
 * FB广告分析验证的数据起点(用户 2026-11-04 明确约定)：以 2026-11-03 为起点，更早的数据一律
 * 不管；后面所有的留存分析、充值分析(以及归因记录)验证，都以 11-03 起的广告归因记录表为源。
 * 之前的数据是压测/开发遗留，体量大(单日订单 10~20万条)、口径杂，会干扰验证。
 *
 * 含义是"只验证报表日期>=起点的行"，不是"只读起点后注册的人"：基准群体仍要看完整的归因
 * 记录表，因为"起点前注册、起点后才首充"的会员属于起点后那天的首充群体(复充留存的基准是
 * 首充日不是注册日)，若只取起点后注册的人，这类会员会让首充数期望偏少、造成假阳性。
 *
 * 三个验证脚本(归因/留存/充值)统一读这一个常量，可用 -e START_DATE=YYYY-MM-DD 临时覆盖。
 */
export const FBAD_DATA_START_DATE = '2026-11-03';

// ================= 目标日 / 到期判定（验证用的纯函数，不依赖 k6） =================

/** YYYY-MM-DD 字符串加 n 天（纯 UTC 日期运算） */
export function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    const pad2 = v => String(v).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * N 日档位对应的目标日 = 基准日 + (N-1) 天。登录留存的基准日是注册日，复充留存的
 * 基准日是首充日。口径来自后台页面"数据定义说明"弹窗："注册当天为第1天，次日留存对应
 * 第2天"，即 N=2 指基准日的下一天。之前造数和验证脚本都写成"基准日+N天"，整体错位一天。
 */
export function targetDateOf(baseDate, n) {
    return addDays(baseDate, n - 1);
}

/** 该档位已到期(目标日严格早于今天)——验证脚本据此决定要不要比对，没到期后端是 null */
export function isReached(baseDate, n, today) {
    return targetDateOf(baseDate, n) < today;
}

// ================= 虚拟广告配置 =================

export const DEFAULT_AD_COMBOS = [
    { campaignId: '120345678901', campaignName: 'Summer Promo', adSetId: '220345678901', adSetName: 'US - Male 25+', adId: '320345678901', adName: 'Video - 01' },
    { campaignId: '120345678902', campaignName: 'Casino APP', adSetId: '220345678902', adSetName: 'CA - All', adId: '320345678902', adName: 'Image - 02' },
    { campaignId: '120345678903', campaignName: 'Brand Campaign', adSetId: '220345678903', adSetName: 'UK - Female', adId: '320345678903', adName: 'Video - 03' },
    { campaignId: '120345678904', campaignName: 'Retargeting', adSetId: '220345678904', adSetName: 'AU - 25-40', adId: '320345678904', adName: 'Carousel - 01' },
    { campaignId: '120345678905', campaignName: 'New User', adSetId: '220345678905', adSetName: 'US - Interest', adId: '320345678905', adName: 'Image - 05' }
];

const AD_COMBO_WEIGHTS = [35, 25, 20, 12, 8];

/**
 * 按权重随机抽一组广告组合(深拷贝，避免调用方意外修改到共享的默认配置对象)。
 * @returns {object} { campaignId, campaignName, adSetId, adSetName, adId, adName }
 */
export function pickWeightedAdCombo() {
    const idx = weightedRandomIndex(AD_COMBO_WEIGHTS);
    return { ...DEFAULT_AD_COMBOS[idx] };
}

// ================= Facebook 渠道配置池 =================

/**
 * 后台"三方埋点管理"真实配置里确认是 Facebook 渠道的 3 条，照抄 k6-go
 * pkg/fbad/config.go 的 DefaultFbChannelConfigs，两边造的数据保持一致可比对。
 * 其余 13 条(marinatest1~4、纯数字/字母占位符等)不是 Facebook 渠道，不收录。
 *
 * 渠道之间只有 eventIdentity 里的 eventConfigId + eventIdentityInfo.PixelId 不同，
 * packageName(包名)所有渠道共用 com.ar3004.fb.app。后端归因记录/报表里的"渠道来源"
 * 是后端按 eventConfigId 反查出来的渠道名(实测 fb419 渠道的归因记录 packageName
 * 字段返回 "fb419"，不是请求里传的包名)，channelName 就是这个名字。
 *
 * facebook132/facebook 两条的像素ID是后台填的非标准 Meta Pixel 格式(不是16位数字)，
 * 但这是后台配置本身的真实值，照抄不是错误——这里验证的是"注册接口+归因存储"这条
 * 链路，不是去对接 Facebook 官方 API 校验像素有效性。
 *
 * 之前 JS 版只固定用 fb419 一个渠道(照抄 Go 版早期 facebookRegisterFn 的默认值)，
 * Go 版后来演进成渠道池、JS 版没同步，造出的数据只有单渠道，渠道来源维度测不到。
 */
export const DEFAULT_FB_CHANNEL_CONFIGS = [
    { pixelId: '2010850729480687', eventConfigId: 200018, channelName: 'fb419' },
    { pixelId: 'facebook132', eventConfigId: 200015, channelName: 'facebook132' },
    { pixelId: 'facebook', eventConfigId: 200013, channelName: 'facebook' }
];

/**
 * 为 userCount 个账号分配渠道，返回长度=userCount 的数组(每项是渠道配置副本)。
 *
 * - pixelId/eventConfigId 任意一个被显式指定(调试/指定场景)：全部账号固定用这一个渠道，
 *   不随机。只指定了一个时，在池里按它反查补齐另一个——不能拿 fb419 的值硬补，否则会
 *   造出 pixelId 和 eventConfigId 错配的数据(比如只指定 eventConfigId=200015 却带着
 *   fb419 的 pixelId)。两个值恰好对应池里同一条时沿用池里的渠道名，否则标"手动指定"。
 * - 否则按池子轮流铺平再打乱(和 assignRechargeTargets 同样的"分桶+打乱"模式)：
 *   每个渠道分到的人数相差不超过 1，userCount>=渠道数时每个渠道至少 1 个账号。
 *   这里刻意不照抄 Go 版的"逐个纯随机"——纯随机在小批量下可能漏掉某个渠道，
 *   而渠道来源维度要求每批数据都能覆盖到所有渠道。
 */
export function assignFbChannels(userCount, pixelIdOverride, eventConfigIdOverride) {
    if (pixelIdOverride || eventConfigIdOverride) {
        const matched = DEFAULT_FB_CHANNEL_CONFIGS.find(c =>
            (eventConfigIdOverride && c.eventConfigId === eventConfigIdOverride) ||
            (pixelIdOverride && c.pixelId === pixelIdOverride));
        const fallback = DEFAULT_FB_CHANNEL_CONFIGS[0];
        const pixelId = pixelIdOverride || (matched ? matched.pixelId : fallback.pixelId);
        const eventConfigId = eventConfigIdOverride || (matched ? matched.eventConfigId : fallback.eventConfigId);
        const exact = DEFAULT_FB_CHANNEL_CONFIGS.find(c => c.pixelId === pixelId && c.eventConfigId === eventConfigId);
        const fixed = { pixelId, eventConfigId, channelName: exact ? exact.channelName : '手动指定' };
        return Array.from({ length: userCount }, () => ({ ...fixed }));
    }

    const flat = [];
    for (let i = 0; i < userCount; i++) {
        flat.push({ ...DEFAULT_FB_CHANNEL_CONFIGS[i % DEFAULT_FB_CHANNEL_CONFIGS.length] });
    }
    return shuffle(flat);
}

// ================= D0复充档位分配算法 =================

// 0=不充值，其余为"当天充值笔数"目标；权重:不充20% / 仅首充45% / 其余递减
const RECHARGE_TIER_LABELS = [0, 1, 2, 3, 4, 5, 10];
const RECHARGE_TIER_WEIGHTS = [20, 45, 15, 10, 6, 3, 1];

/**
 * 按权重把 userCount 个人分到各档位，floor取整后按小数部分余数从大到小补齐差额，
 * 确保总人数精确 = userCount(照抄 Go 版本 weightedTierCounts 的算法)。
 * @param {number} total
 * @param {number[]} weights
 * @returns {number[]} 和 weights 等长，每项为该档位分到的人数
 */
function weightedTierCounts(total, weights) {
    const sumWeight = weights.reduce((s, w) => s + w, 0);
    const raw = weights.map(w => (w / sumWeight) * total);
    const counts = raw.map(r => Math.floor(r));
    const assigned = counts.reduce((s, c) => s + c, 0);
    let remaining = total - assigned;

    // 按小数部分余数从大到小排序，优先把剩余名额补给余数最大的档位
    const order = raw
        .map((r, i) => ({ i, frac: r - Math.floor(r) }))
        .sort((a, b) => b.frac - a.frac);

    for (let k = 0; k < order.length && remaining > 0; k++) {
        counts[order[k].i]++;
        remaining--;
    }
    return counts;
}

/**
 * 按 RECHARGE_TIER_WEIGHTS 把 userCount 人分到各充值档位，返回每档位人数。
 * @param {number} userCount
 * @returns {{tier:number, count:number}[]}
 */
export function computeRechargeTierCounts(userCount) {
    const counts = weightedTierCounts(userCount, RECHARGE_TIER_WEIGHTS);
    return RECHARGE_TIER_LABELS.map((tier, i) => ({ tier, count: counts[i] }));
}

/**
 * 把 userCount 人的档位分桶结果铺平+打乱，返回长度=userCount的数组，
 * 每个元素是对应账号的目标充值笔数(0表示不充值)。
 * @param {number} userCount
 * @returns {number[]}
 */
export function assignRechargeTargets(userCount) {
    const tierCounts = computeRechargeTierCounts(userCount);
    const flat = [];
    for (const { tier, count } of tierCounts) {
        for (let i = 0; i < count; i++) flat.push(tier);
    }
    return shuffle(flat);
}

// ================= 内部工具 =================

function weightedRandomIndex(weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}
