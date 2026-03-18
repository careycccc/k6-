/**
 * 代理相关 API 接口封装
 */

import { sendRequest } from '../common/request.js';

const tag = 'AgentApi';

/**
 * 获取代理层级列表（包括上下级）
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {object} options - 可选参数
 * @returns {Array} 代理列表
 */
export function getAgentHierarchyList(adminToken, userId, options = {}) {
    const {
        isAll = true,
        isIncludeSelfAndParent = true,
        pageSize = 500
    } = options;

    const api = '/api/Agent/GetPageListAgentList';
    const payload = {
        userId: userId,
        isAll: isAll,
        isIncludeSelfAndParent: isIncludeSelfAndParent,
        pageNo: 1,
        pageSize: pageSize,
        orderBy: "Desc"
    };

    console.log(`[AgentApi] ========== 开始查询代理列表 ==========`);
    //console.log(`[AgentApi] 请求接口: ${api}`);
    //console.log(`[AgentApi] 请求参数: ${JSON.stringify(payload)}`);

    const result = sendRequest(payload, api, tag, false, adminToken);

    //console.log(`[AgentApi] 原始响应类型: ${typeof result}`);
    //console.log(`[AgentApi] 原始响应: ${JSON.stringify(result).substring(0, 500)}...`);

    if (!result) {
        console.error(`[AgentApi] 请求失败，返回空`);
        return [];
    }

    // sendRequest 可能直接返回 data，也可能返回完整响应
    let list = [];
    let totalCount = 0;

    if (Array.isArray(result)) {
        // 直接返回数组
        //console.log(`[AgentApi] 响应格式: 直接数组`);
        list = result;
        totalCount = result.length;
    } else if (result.list) {
        // 返回对象包含 list
        //console.log(`[AgentApi] 响应格式: result.list`);
        list = result.list;
        totalCount = result.totalCount || result.list.length;
    } else if (result.data && result.data.list) {
        // 返回对象包含 data.list
        //console.log(`[AgentApi] 响应格式: result.data.list`);
        list = result.data.list;
        totalCount = result.data.totalCount || result.data.list.length;
    } else {
        console.error(`[AgentApi] 未知响应格式`);
    }

    console.log(`[AgentApi] 解析结果: ${list.length} 个用户 (总数: ${totalCount})`);
    console.log(`[AgentApi] ========== 查询完成 ==========`);

    if (list.length === 0) {
        console.warn(`[AgentApi] 未获取到任何用户数据`);
        return [];
    }

    return list.sort((a, b) => a.hierarchy - b.hierarchy);
}

/**
 * 获取所有上下级的 userId 列表
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @returns {Array<number>} userId 列表
 */
export function getAllRelatedUserIds(adminToken, userId) {
    console.log(`[AgentApi] 查询用户 ${userId} 的所有上下级...`);

    const agentList = getAgentHierarchyList(adminToken, userId);

    if (!agentList || agentList.length === 0) {
        console.warn(`[AgentApi] 未找到用户 ${userId} 的代理关系`);
        return [];
    }

    const userIds = agentList.map(agent => agent.userId).filter(id => id);
    console.log(`[AgentApi] 找到 ${userIds.length} 个相关用户`);

    return userIds;
}

/**
 * 更新用户代理返佣模式
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {number} rebateMode - 返佣模式 (1=固定, 2=特殊)
 * @param {number} rebateLevel - 返佣等级 (1-6)
 * @returns {boolean} 是否成功
 */
export function updateUserAgentRebateMode(adminToken, userId, rebateMode, rebateLevel) {
    const api = '/api/Agent/UpdateUserAgentRebateMode';
    const payload = {
        userId: userId,
        rebateMode: rebateMode,
        rebateLevel: rebateLevel
    };

    const rebateModeText = rebateMode === 1 ? '固定' : '特殊';
    console.log(`[AgentApi] 更新用户 ${userId} 返佣模式: ${rebateModeText}, 等级: ${rebateLevel}`);

    const result = sendRequest(payload, api, tag, false, adminToken);

    if (!result) {
        console.error(`[AgentApi] ❌ 更新返佣模式失败: 用户 ${userId}`);
        return false;
    }

    console.log(`[AgentApi] ✅ 更新返佣模式成功: 用户 ${userId}`);
    return true;
}
