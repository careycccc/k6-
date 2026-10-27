/**
 * 老会员捶取 —— 从商户会员列表里随机抽取账号来复用操作(多天衰减系列专用)
 *
 * 背景：用户要求每天除了新注册账号外，还要从"当前商户的会员列表"里捶几个
 * 老会员一起参与造数(模拟真实用户里既有新客也有回头客的分布)。这些老会员
 * 的密码未知，但 /api/Users/UpdatePassword {userId, password} 不需要原密码
 * 就能重置(2026-10-26读代码确认)，所以流程是：先用标准密码尝试登录，
 * 失败就后台重置密码再登录——完全照抄已验证过的现成模式：
 *   - 查会员列表：auditG3Verify.js 的 plainAccount()/listOf()
 *   - 改密码+重登：auditG3Verify.js 的 loginOrReset()、playwrith/collect-users.js 的 setPassword()
 */
import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';
import { loginByPasswordRetry } from '../common/auth.js';

const TAG = 'OldMemberFisher';
const STANDARD_PASSWORD = 'qwer1234';

/** /api/Users/GetPageList 的响应结构不完全统一，照抄 auditG3Verify.js 的 listOf() 兼容两种形态 */
function listOf(res) {
    if (res && res.list && Array.isArray(res.list)) return res.list;
    if (res && res.data && Array.isArray(res.data.list)) return res.data.list;
    return [];
}

/**
 * 从会员列表里抽取最多 count 个账号，排除 excludeAccounts(本系列已出现过的
 * 账号——包括这次系列新注册的和之前已经捶过的，避免捶到自己人)。
 *
 * 脱敏账号(含'*')没法登录，直接跳过；只有userType=0(普通会员)才纳入候选。
 *
 * @param {string} adminToken
 * @param {Set<string>|string[]} excludeAccounts
 * @param {number} count
 * @returns {Array<{userId:number, account:string}>} 实际抽到的数量可能小于count(会员总数不够时)
 */
export function fishOldMembers(adminToken, excludeAccounts, count) {
    const excludeSet = excludeAccounts instanceof Set ? excludeAccounts : new Set(excludeAccounts);
    const candidates = [];
    const maxPages = 15;
    for (let page = 1; page <= maxPages && candidates.length < count * 3; page++) {
        const res = sendRequest({ userType: [0], pageNo: page, pageSize: 100, orderBy: 'Desc' }, '/api/Users/GetPageList', TAG, false, adminToken);
        const list = listOf(res);
        if (!list.length) break;
        for (const u of list) {
            if (!u.account || String(u.account).includes('*')) continue;
            const account = String(u.account);
            if (excludeSet.has(account)) continue;
            candidates.push({ userId: u.userId, account });
        }
        sleep(0.5);
    }

    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picked = candidates.slice(0, count);
    console.log(`[${TAG}] 会员列表候选${candidates.length}个(已排除${excludeSet.size}个本系列已知账号)，本次捶到${picked.length}/${count}个`);
    return picked;
}

/**
 * 老会员登录：先用标准密码尝试(万一这个会员本来就是qwer1234，或者是本系列
 * 之前某天已经捶过并重置过密码的)，失败就后台重置密码再登录。
 *
 * @param {string} adminToken
 * @param {string} account
 * @param {number} userId
 * @returns {{token:string|null, passwordWasReset:boolean}}
 */
export function loginOrResetFished(adminToken, account, userId) {
    let token = loginByPasswordRetry(account, STANDARD_PASSWORD, 2);
    if (token) return { token, passwordWasReset: false };

    const resetResp = sendRequest({ userId, password: STANDARD_PASSWORD }, '/api/Users/UpdatePassword', TAG, false, adminToken);
    console.log(`[${TAG}] userId=${userId}(${account}) 标准密码登录失败，后台重置密码: ${JSON.stringify(resetResp)}`);
    sleep(3);
    token = loginByPasswordRetry(account, STANDARD_PASSWORD, 2);
    if (!token) console.error(`[${TAG}] userId=${userId}(${account}) 重置密码后仍登录失败`);
    return { token, passwordWasReset: true };
}
