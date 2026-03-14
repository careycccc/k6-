/**
 * 用户管理模块
 * 提供用户信息查询功能
 */

import { sendQueryRequest, sendRequest } from '../common/request.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

/**
 * 根据用户账号获取用户ID
 * @param {string} adminToken - 管理员token
 * @param {string} userAccount - 用户账号（手机号或邮箱）
 * @returns {number|null} 用户ID，失败返回null
 */
export function getUserIdByAccount(adminToken, userAccount) {
    console.log(`[UserManagement] 查询用户ID: ${userAccount}`);

    const api = '/api/Member/GetPageListMember';

    // 构建查询负载
    const payload = {
        userName: userAccount,  // 用户账号
        pageNo: 1,
        pageSize: 10
    };

    try {
        // 发送查询请求
        const response = sendQueryRequest(payload, api, 'GetUserInfo', true, adminToken);

        // 检查响应
        if (!response) {
            console.error('[UserManagement] 查询失败：响应为空');
            return null;
        }

        // 检查业务状态码
        if (response.msgCode !== 0 || response.msg !== 'Succeed') {
            console.error(`[UserManagement] 查询失败: msgCode=${response.msgCode}, msg=${response.msg}`);
            return null;
        }

        // 检查数据
        if (!response.data || !response.data.list || response.data.list.length === 0) {
            console.error(`[UserManagement] 未找到用户: ${userAccount}`);
            return null;
        }

        // 获取第一个匹配的用户ID
        const userId = response.data.list[0].userId;
        console.log(`[UserManagement] ✅ 找到用户ID: ${userAccount} -> ${userId}`);

        return userId;

    } catch (error) {
        console.error(`[UserManagement] 查询异常: ${userAccount}, error=${error.message}`);
        return null;
    }
}

/**
 * 批量获取用户ID
 * @param {string} adminToken - 管理员token
 * @param {string[]} userAccounts - 用户账号列表
 * @returns {Map<string, number>} 账号到ID的映射
 */
export function batchGetUserIds(adminToken, userAccounts) {
    console.log(`[UserManagement] 批量查询用户ID: 共${userAccounts.length}个用户`);

    const userIdMap = new Map();

    for (let i = 0; i < userAccounts.length; i++) {
        const account = userAccounts[i];
        console.log(`[UserManagement] [${i + 1}/${userAccounts.length}] 查询: ${account}`);

        const userId = getUserIdByAccount(adminToken, account);

        if (userId) {
            userIdMap.set(account, userId);
        } else {
            console.error(`[UserManagement] 查询失败: ${account}`);
        }
    }

    console.log(`[UserManagement] 批量查询完成: 成功${userIdMap.size}, 失败${userAccounts.length - userIdMap.size}`);

    return userIdMap;
}

/**
 * 获取用户详细信息（后台管理员接口）
 * @param {string} adminToken - 管理员token
 * @param {string} userAccount - 用户账号
 * @returns {object|null} 用户详细信息
 */
export function getUserInfo(adminToken, userAccount) {
    console.log(`[UserManagement] 查询用户详细信息: ${userAccount}`);

    const api = '/api/Member/GetPageListMember';

    const payload = {
        userName: userAccount,
        pageNo: 1,
        pageSize: 10
    };

    try {
        const response = sendQueryRequest(payload, api, 'GetUserInfo', true, adminToken);

        if (!response || response.msgCode !== 0) {
            console.error('[UserManagement] 查询用户信息失败');
            return null;
        }

        if (!response.data || !response.data.list || response.data.list.length === 0) {
            console.error(`[UserManagement] 未找到用户: ${userAccount}`);
            return null;
        }

        const userInfo = response.data.list[0];
        console.log(`[UserManagement] ✅ 获取用户信息成功: ${userAccount}`);

        return {
            userId: userInfo.userId,
            userName: userInfo.userName,
            nickName: userInfo.nickName,
            balance: userInfo.balance,
            currency: userInfo.currency,
            inviteCode: userInfo.inviteCode,
            // 可以根据需要添加更多字段
        };

    } catch (error) {
        console.error(`[UserManagement] 查询异常: ${error.message}`);
        return null;
    }
}

/**
 * 获取前台用户信息（用户登录后调用）
 * 调用前台接口 /api/User/GetUserInfo 获取用户的 userId 和 inviteCode
 * @param {string} userToken - 用户登录token
 * @returns {object|null} 返回 {userId, inviteCode, nickName, ...} 或 null
 */
export function getFrontUserInfo(userToken) {
    console.log(`[UserManagement] 获取前台用户信息`);
    console.log(`[UserManagement] Debug - 当前 ENV_CONFIG.BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);

    const api = '/api/User/GetUserInfo';

    // ✅ 尝试不同的 channel 值（3002环境可能需要）
    const channelValues = [undefined, 0, 1, 100];

    for (const channelValue of channelValues) {
        const payload = channelValue !== undefined ? { channel: channelValue } : {};

        if (channelValue !== undefined) {
            console.log(`[UserManagement] 尝试 channel=${channelValue}`);
        }

        try {
            const response = sendRequest(payload, api, 'GetFrontUserInfo', true, userToken);

            // 检查响应
            if (!response) {
                console.log(`[UserManagement] channel=${channelValue} 响应为空，尝试下一个...`);
                continue;
            }

            // sendRequest 可能返回三种类型
            let userInfo = null;

            if (typeof response === 'string') {
                console.log(`[UserManagement] channel=${channelValue} 返回格式错误，尝试下一个...`);
                continue;
            } else if (response.userId !== undefined) {
                // 返回的是 data 对象，直接使用
                userInfo = response;
            } else {
                // 返回的是完整响应对象
                const statusCode = response.code !== undefined ? response.code : response.msgCode;

                // 如果是 channel 错误，继续尝试下一个值
                if (statusCode === 5023 || statusCode === 7) {
                    console.log(`[UserManagement] channel=${channelValue} 失败 (code=${statusCode}), 尝试下一个...`);
                    continue;
                }

                if (statusCode !== 0 || response.msg !== 'Succeed') {
                    console.error(`[UserManagement] 获取前台用户信息失败: code=${statusCode}, msg=${response.msg}`);
                    continue;
                }

                // 检查数据
                if (!response.data) {
                    console.log(`[UserManagement] channel=${channelValue} data为空，尝试下一个...`);
                    continue;
                }

                userInfo = response.data;
            }

            // 验证必需字段
            if (!userInfo.userId) {
                console.log(`[UserManagement] channel=${channelValue} userId为空，尝试下一个...`);
                continue;
            }

            // ✅ 成功获取用户信息
            console.log(`[UserManagement] ✅ 获取前台用户信息成功 (channel=${channelValue}): userId=${userInfo.userId}, inviteCode=${userInfo.inviteCode || 'N/A'}`);

            return {
                userId: userInfo.userId,
                inviteCode: userInfo.inviteCode || null,
                nickName: userInfo.nickName || '',
                userPhoto: userInfo.userPhoto || '',
                userType: userInfo.userType !== undefined ? userInfo.userType : null,
                walletBalance: userInfo.walletBalance || 0,
                // 保留完整的用户信息
                ...userInfo
            };

        } catch (error) {
            console.log(`[UserManagement] channel=${channelValue} 异常: ${error.message}, 尝试下一个...`);
            continue;
        }
    }

    // 所有 channel 值都失败了
    console.error('[UserManagement] ❌ 所有 channel 值都失败，无法获取用户信息');
    return null;
}
