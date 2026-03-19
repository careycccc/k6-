/**
 * 用户账号查询 API 接口封装
 */

import { sleep } from 'k6';
import { sendRequest } from '../common/request.js';

const tag = 'UserAccountApi';

/**
 * 获取用户账号
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @returns {string|null} 用户账号（手机号或邮箱）
 */
export function getUserAccount(adminToken, userId) {
    const api = '/api/Users/GetUserAccount';
    const payload = {
        userId: userId
    };

    const result = sendRequest(payload, api, tag, false, adminToken);

    if (!result) {
        console.error(`[${tag}] 获取用户 ${userId} 账号失败`);
        return null;
    }

    // 返回的 data 字段就是账号
    if (typeof result === 'string') {
        return result;
    }

    if (result.data) {
        return result.data;
    }

    return null;
}

/**
 * 判断账号类型
 * @param {string} account - 账号
 * @returns {string} 'email' 或 'phone'
 */
export function detectAccountType(account) {
    if (!account) return 'unknown';

    // 邮箱格式检测
    if (account.includes('@')) {
        return 'email';
    }

    // 手机号格式检测（包含区号）
    // 通常格式为：区号+手机号，如 "913187076307"
    if (/^\d+$/.test(account)) {
        return 'phone';
    }

    return 'unknown';
}

/**
 * 批量获取用户账号
 * @param {string} adminToken - 管理员token
 * @param {Array<number>} userIds - 用户ID列表
 * @param {number} delayMs - 每次请求间隔（毫秒），默认1000ms
 * @returns {Array<{userId: number, account: string, accountType: string}>}
 */
export function batchGetUserAccounts(adminToken, userIds, delayMs = 1000) {
    const results = [];

    console.log(`[${tag}] 开始批量查询 ${userIds.length} 个用户账号...`);

    for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];

        console.log(`[${tag}] [${i + 1}/${userIds.length}] 查询用户 ${userId}...`);

        const account = getUserAccount(adminToken, userId);

        if (account) {
            const accountType = detectAccountType(account);
            results.push({
                userId: userId,
                account: account,
                accountType: accountType
            });
            console.log(`[${tag}] ✅ 用户 ${userId}: ${account} (${accountType})`);
        } else {
            console.warn(`[${tag}] ⚠️ 用户 ${userId}: 获取账号失败`);
        }

        // 延迟，避免请求过快
        if (i < userIds.length - 1 && delayMs > 0) {
            sleep(delayMs / 1000);
        }
    }

    console.log(`[${tag}] 批量查询完成: 成功 ${results.length}/${userIds.length}`);

    return results;
}
