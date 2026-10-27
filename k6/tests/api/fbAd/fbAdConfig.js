/**
 * FB广告分析 - 虚拟广告配置 + D0复充档位分配算法
 *
 * 5组广告组合数据照抄 Go 版本(k6-go) pkg/fbad/config.go 的 DefaultAdCombos，
 * 保持两边造的测试数据一致可比对。权重首档最高依次递减，避免5等分的假数据感。
 */

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
