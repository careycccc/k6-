/**
 * 充值循环奖励活动 —— 配置接口封装
 *
 * ⚠️ 仅新增文件，不改动任何已有代码。
 *
 * 三个后台接口（均为管理后台接口，isDesk=false，带 adminToken）：
 *   - GetConfig    ：档位配置(tiers)。造数据/结算都依赖它；获取失败直接抛错终止程序。
 *   - GetSettingKey：总开关 + 付费奖励是否采用累计充值计算 的当前状态。
 *   - GetSwitchLog ：某开关的历史变更记录（index 0 为最新），用于「按昨日末态结算」。
 */

import { sendRequest } from '../common/request.js';

export const cycleRewardTag = 'cycleReward';

/** 统一解析 sendRequest 返回：兼容「完整响应(含msgCode)」与「已剥壳的data」两种形态 */
function unwrap(res) {
    if (!res) return null;
    if (res.msgCode !== undefined) {
        return res.msgCode === 0 ? res.data : null;
    }
    return res; // 已是 data 部分
}

/**
 * 获取活动档位配置  /api/RechargeCycleReward/GetConfig
 * @param {object} data - 含 token 的管理员数据
 * @returns {Array<object>} tiers 档位数组
 * @throws 当未取到档位配置时抛错（调用方据此停止程序）
 */
export function getCycleRewardConfig(data) {
    const api = '/api/RechargeCycleReward/GetConfig';
    const res = sendRequest({}, api, cycleRewardTag, false, data.token);
    const cfg = unwrap(res);
    const tiers = cfg && Array.isArray(cfg.tiers) ? cfg.tiers : null;

    if (!tiers || tiers.length === 0) {
        throw new Error(`[${cycleRewardTag}] ❌ 未获取到档位配置(tiers)，终止程序。响应: ${JSON.stringify(res)}`);
    }
    // 按 minAmount 升序，保证档位顺序稳定（后续按序分配人数）
    tiers.sort((a, b) => Number(a.minAmount) - Number(b.minAmount));
    return tiers;
}

/**
 * 获取开关设置  /api/RechargeCycleReward/GetSettingKey
 * @param {object} data - 含 token 的管理员数据
 * @returns {{switchOn:boolean, paidUseCumulative:boolean, raw:object|null}}
 *   switchOn          活动总开关是否开启
 *   paidUseCumulative 付费奖励是否采用累计充值计算（true=累计, false=单笔）
 */
export function getCycleRewardSettings(data) {
    const api = '/api/RechargeCycleReward/GetSettingKey';
    const res = sendRequest({}, api, cycleRewardTag, false, data.token);
    const d = unwrap(res);

    const sw = d && d.rechargeCycleRewardSwitch ? d.rechargeCycleRewardSwitch.value1 : null;
    const paidCum = d && d.rechargeCycleRewardPaidUseCumulative ? d.rechargeCycleRewardPaidUseCumulative.value1 : null;

    return {
        switchOn: String(sw) === '1',
        paidUseCumulative: String(paidCum) === '1',
        raw: d
    };
}

/**
 * 获取某开关的历史变更记录  /api/RechargeCycleReward/GetSwitchLog
 * @param {object} data       - 含 token 的管理员数据
 * @param {string} settingKey - 开关键名，如 'RechargeCycleRewardPaidUseCumulative'
 * @returns {Array<object>} 变更记录数组（index 0 为最新；每条含 updateTime/updateContent 等）
 */
export function getCycleRewardSwitchLog(data, settingKey) {
    const api = '/api/RechargeCycleReward/GetSwitchLog';
    const res = sendRequest({ settingKey }, api, cycleRewardTag, false, data.token);
    const arr = unwrap(res);
    return Array.isArray(arr) ? arr : [];
}
