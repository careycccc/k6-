/**
 * 「有效邀请达标条件 + 生效游戏」测试的共用 API 层
 *
 * 读写都走集团后台（tenantAdminLogin 默认拿集团 token，tenantRequest isDesk:false），
 * 和后台界面 代理管理-新版代理-三级代理配置 是同一条路。
 */

import { sleep } from 'k6';
import { tenantRequest } from '../../../../libs/http/tenantRequest.js';

export const TAG = 'InviteCond';

// ---------------- 配置项 ----------------

/** 本需求会改到的配置项：代码里的驼峰 key → UpdateConfig 要的 settingKey */
export const SETTING_KEYS = {
    mode: 'AgentL3InviteConditionMode',          // "1"=同时满足  "2"=满足任一
    limitGame: 'AgentL3InviteBetLimitGame',      // "[]"=全体游戏，否则 JSON 字符串
    rechargeThreshold: 'AgentL3InviteRechargeAmount',
    betThreshold: 'AgentL3InviteBetAmount',
    dayLimit: 'AgentL3InviteDayLimitCount',
    totalLimit: 'AgentL3InviteTotalLimitCount',
    sameDeviceInvalid: 'AgentInviteSameDeviceInvalid'
};

export const MODE_BOTH = '1';   // 同时满足
export const MODE_EITHER = '2'; // 满足任一

function req(api, payload, token) {
    return tenantRequest(api, payload, { token, isDesk: false });
}

/**
 * 读三级代理配置，解析成结构化对象。
 * @returns {{mode:string, rechargeThreshold:number, betThreshold:number,
 *            limitGames:Array<{vendorCode:string,gameCode:string[]}>, limitGameRaw:string,
 *            dayLimit:number, totalLimit:number, inviterReward:number, invitedReward:number,
 *            sameDeviceInvalid:boolean, raw:object}|null}
 */
export function getConfig(token) {
    const r = req('/api/AgentL3/GetConfig', {}, token);
    if (!r || r.msgCode !== 0 || !r.data) {
        console.error(`[${TAG}] GetConfig 失败: ${JSON.stringify(r)}`);
        return null;
    }
    const d = r.data;
    const v = k => (d[k] && d[k].value1 !== undefined && d[k].value1 !== null ? d[k].value1 : '');
    const n = k => Number(v(k)) || 0;

    let limitGames = [];
    const limitGameRaw = v('agentL3InviteBetLimitGame');
    if (limitGameRaw) {
        try { limitGames = JSON.parse(limitGameRaw) || []; }
        catch (e) { console.error(`[${TAG}] 生效游戏解析失败: ${limitGameRaw}`); }
    }

    return {
        mode: String(v('agentL3InviteConditionMode')),
        rechargeThreshold: n('agentL3InviteRechargeAmount'),
        betThreshold: n('agentL3InviteBetAmount'),
        limitGames,
        limitGameRaw,
        dayLimit: n('agentL3InviteDayLimitCount'),
        totalLimit: n('agentL3InviteTotalLimitCount'),
        inviterReward: n('agentL3InviteRewardAmount'),
        invitedReward: n('agentL3InvitedRewardAmount'),
        sameDeviceInvalid: v('agentInviteSameDeviceInvalid') === '1',
        raw: d
    };
}

/**
 * 写一项配置，并回读确认真的落库了。
 *
 * UpdateConfig 成功时返回 {code:0, msg:"Succeed", msgCode:0, data:false} —— data:false
 * 不代表失败（已用真实抓包验证过配置确实生效）。所以只看 msgCode，并且必须回读。
 *
 * @param {string} settingKey SETTING_KEYS 里的值（大写开头）
 * @param {string} value1 一律传字符串；JSON 字段要先 JSON.stringify 成字符串再传
 * @param {string} readBackKey GetConfig 返回里对应的驼峰 key，用来回读校验
 * @returns {{ok:boolean, got:string, msg:string}}
 */
export function setConfig(token, settingKey, value1, readBackKey) {
    const r = req('/api/AgentL3/UpdateConfig', { settingKey, value1: String(value1) }, token);
    if (!r || r.msgCode !== 0) {
        return { ok: false, got: '', msg: `UpdateConfig 被拒: msgCode=${r && r.msgCode} msg=${r && r.msg}` };
    }
    sleep(1);
    const after = req('/api/AgentL3/GetConfig', {}, token);
    const got = after && after.data && after.data[readBackKey] ? String(after.data[readBackKey].value1) : '';
    const ok = got === String(value1);
    return { ok, got, msg: ok ? '写入已回读确认' : `回读不符: 期望 ${value1} 实际 ${got}` };
}

/** 把 limitGames 数组写成配置要的字符串；空数组 = 全体游戏 */
export function limitGamesToValue(limitGames) {
    return (!limitGames || limitGames.length === 0) ? '[]' : JSON.stringify(limitGames);
}

export function limitGamesText(limitGames) {
    if (!limitGames || limitGames.length === 0) return '全体游戏';
    return limitGames.map(g => {
        const codes = g.gameCode || [];
        return `${g.vendorCode}[${codes.length ? codes.join(',') : '全部子游戏'}]`;
    }).join(' + ');
}

// ---------------- 团队 ----------------

/**
 * 拉某代理的团队成员（接口会返回整个 L1~L3 团队，靠 parentId 区分层级）。
 * 返回项含 isOkInvite（后台自己的有效邀请判定结果）、totalRechargeAmount、registerDevice。
 */
export function getTeam(token, agentId, maxPages = 50) {
    const all = [];
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const r = req('/api/AgentL3/GetPageListInvitedList',
            { agentId, pageNo, pageSize: 200, orderBy: 'Desc' }, token);
        if (!r || r.msgCode !== 0 || !r.data) {
            console.error(`[${TAG}] GetPageListInvitedList 失败 agentId=${agentId}: ${JSON.stringify(r)}`);
            break;
        }
        const list = r.data.list || [];
        all.push(...list);
        if (pageNo >= (Number(r.data.totalPage) || 1) || list.length === 0) break;
        sleep(0.3);
    }
    return all;
}

/** 只要直推下级（有效邀请只算 L1） */
export function directDownlines(team, agentId) {
    return team.filter(m => Number(m.parentId) === Number(agentId));
}

// ---------------- 注单 ----------------

/**
 * limitGames → 注单查询清单。
 *   全体游戏(空)          → 5 个 categoryType 全查
 *   只有 vendorCode       → 查该厂商全部子游戏（用户已确认：只选厂商=该厂商下所有游戏都算）
 *   vendorCode + gameCode → 逐个子游戏查
 * 照搬 withdraw/autoWithdrawBetRatioVerify.js 里验证过的写法。
 */
export function buildBetQueries(limitGames) {
    if (!limitGames || limitGames.length === 0) {
        return [0, 1, 2, 3, 4].map(t => ({ label: `全体游戏 categoryType=${t}`, query: { categoryType: t } }));
    }
    const qs = [];
    for (const g of limitGames) {
        const codes = Array.isArray(g.gameCode) ? g.gameCode : [];
        if (codes.length === 0) {
            qs.push({ label: `${g.vendorCode} 全部子游戏`, query: { vendorCode: g.vendorCode } });
        } else {
            for (const code of codes) {
                qs.push({ label: `${g.vendorCode}-${code}`, query: { vendorCode: g.vendorCode, gameCode: code, gameCodeArr: [code] } });
            }
        }
    }
    return qs;
}

/**
 * 查某会员在给定游戏范围内的注单（按 orderNo 去重，多个查询分组可能查到同一单）。
 * 带 userId 时接口没有 15 天窗口限制（不带会员ID才有）。
 */
export function fetchOrders(token, userId, limitGames, beginMs, endMs, maxPages = 20) {
    const seen = {};
    const orders = [];
    for (const q of buildBetQueries(limitGames)) {
        for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
            const payload = Object.assign({
                queryTimeType: 'BetTime', userId,
                beginTimeUnix: beginMs, endTimeUnix: endMs,
                pageNo, pageSize: 200, orderBy: 'Desc', sortField: 'BetTime'
            }, q.query);
            const r = req('/api/ThirdGame/GetBetRecordPageList', payload, token);
            if (!r || r.msgCode !== 0 || !r.data) {
                console.error(`[${TAG}] 查注单失败 userId=${userId} ${q.label}: msgCode=${r && r.msgCode} ${r && r.msg}`);
                break;
            }
            const list = r.data.list || [];
            for (const o of list) {
                if (seen[o.orderNo]) continue;
                seen[o.orderNo] = true;
                orders.push(o);
            }
            if (pageNo >= (Number(r.data.totalPage) || 1) || list.length === 0) break;
            sleep(0.2);
        }
        sleep(0.2);
    }
    return orders;
}

/**
 * 汇总注单金额。
 * 有效投注(validAmount) 只有注单结算后才有值——未结算单 orderState=0、validAmount=0，
 * 所以这里把未结算单单独计数，调用方要据此判断"是不是还没到可以查有效邀请的时候"。
 */
export function sumOrders(orders) {
    let validAmount = 0, betAmount = 0, settled = 0, unsettled = 0;
    for (const o of orders) {
        validAmount += Number(o.validAmount) || 0;
        betAmount += Number(o.betAmount) || 0;
        if (Number(o.orderState) === 1) settled++; else unsettled++;
    }
    return { validAmount, betAmount, settled, unsettled, count: orders.length };
}

// ---------------- 判定 ----------------

/**
 * 按配置算"这个下级该不该是有效邀请"。
 *
 * 刻意只写需求里的纯公式，不加任何额外过滤（比如老脚本 agentL3Validation.js 里那条
 * "充值和投注都为0就不算"的僵尸用户过滤）——因为门槛设 0 时是否算达标正是要测的点，
 * 加了过滤就测不出后端的真实行为了。
 *
 * @param {object} config getConfig() 的返回
 * @param {number} totalRecharge 累计充值
 * @param {number} validBetInScope 范围内累计有效投注
 */
export function expectOkInvite(config, totalRecharge, validBetInScope) {
    const rechargeOk = totalRecharge >= config.rechargeThreshold;
    const betOk = validBetInScope >= config.betThreshold;
    const expected = config.mode === MODE_BOTH ? (rechargeOk && betOk) : (rechargeOk || betOk);
    return {
        expected, rechargeOk, betOk,
        reason: `充值 ${totalRecharge}${rechargeOk ? '≥' : '<'}${config.rechargeThreshold}`
            + ` ${config.mode === MODE_BOTH ? '且' : '或'} `
            + `范围内有效投注 ${validBetInScope.toFixed(2)}${betOk ? '≥' : '<'}${config.betThreshold}`
    };
}

// ---------------- 结果上报（k6 沙箱不能写文件，打标记给 Node runner 收）----------------

export function emit(kind, obj) {
    console.log(`##${kind}##` + JSON.stringify(obj));
}
