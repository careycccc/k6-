/**
 * 代理相关 API 接口封装
 */

import { sendRequest } from '../common/request.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { getAllTeamMembersL3 } from '../agentL3/agentL3Api.js';

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

/**
 * 获取 L3 级代理的下级列表
 * @param {string} adminToken - 管理员token
 * @param {number} agentId - L3代理的ID
 * @param {object} options - 可选参数
 * @returns {Array} 代理列表
 */
export function getL3AgentInvitedList(adminToken, agentId, options = {}) {
    const {
        pageSize = 500
    } = options;

    const api = '/api/AgentL3/GetPageListInvitedList';
    // 随机数，语言，签名，时间戳在 request.js 中可能会自动补充，如果没有，此处手动补充必要的
    const payload = {
        agentId: agentId,
        pageNo: 1,
        pageSize: pageSize,
        orderBy: "Desc"
    };

    console.log(`[AgentApi] ========== 开始查询 L3 代理下级列表 ==========`);

    const result = sendRequest(payload, api, tag, false, adminToken);

    if (!result) {
        console.error(`[AgentApi] 请求失败，返回空`);
        return [];
    }

    let list = [];
    let totalCount = 0;

    if (Array.isArray(result)) {
        list = result;
        totalCount = result.length;
    } else if (result.list) {
        list = result.list;
        totalCount = result.totalCount || result.list.length;
    } else if (result.data && result.data.list) {
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

    return list;
}

/**
 * 获取 L3 代理的所有下级 userId 列表
 * @param {string} adminToken - 管理员token
 * @param {number} agentId - L3代理ID
 * @returns {Array<number>} userId 列表
 */
export function getL3AllRelatedUserIds(adminToken, agentId) {
    console.log(`[AgentApi] 查询 L3 代理 ${agentId} 的所有下级...`);

    const agentList = getL3AgentInvitedList(adminToken, agentId);

    if (!agentList || agentList.length === 0) {
        console.warn(`[AgentApi] 未找到 L3 代理 ${agentId} 的下级关系`);
        return [];
    }

    const userIds = agentList.map(agent => agent.userId).filter(id => id);
    console.log(`[AgentApi] 找到 ${userIds.length} 个相关用户`);

    return userIds;
}

/**
 * 自适应获取团队成员（根据 tenantId 对应的 AGENT_MODE 自动选 6级/3级查询）。
 * 2026-10-30 新增：不同商户的代理层级体系不同（见 config/envconfig.js 的
 * AGENT_MODE，0=6级代理走本文件 getAgentHierarchyList，1=3级代理走
 * agentL3Api.js 的 getAllTeamMembersL3），用错接口会被后端判"No operation
 * permission"（已通过对照实验确认：和集团/商户登录模式无关，纯粹是接口选错）。
 *
 * 只新增这个分发函数，不改动 getAgentHierarchyList/getAllRelatedUserIds 本身
 * ——这两个函数在全项目还有其他 14+3 处调用，大概率都固定跑在6级代理商户上，
 * 不应该被这次改动波及。
 *
 * 统一输出 [{userId, hierarchy, ...}]：hierarchy 是相对 rootId 的相对层级，
 * root 自己不含在返回列表内，直接下级=1，和 getAgentHierarchyList 原有字段
 * 兼容，调用方现有的 `member.hierarchy >= 1` 这类过滤逻辑不用改。
 * @param {string} adminToken
 * @param {number} rootId
 * @param {string|number} tenantId
 * @returns {Array<{userId:number, hierarchy:number}>}
 */
export function getTeamMembersAuto(adminToken, rootId, tenantId) {
    const envConfig = getEnvByTenantId(String(tenantId));
    if (envConfig.AGENT_MODE === 1) {
        console.log(`[AgentApi] 租户 ${tenantId} 是3级代理(AGENT_MODE=1)，走 AgentL3 递归查询`);
        return getAllTeamMembersL3({ token: adminToken }, rootId);
    }
    return getAgentHierarchyList(adminToken, rootId);
}

/**
 * 自适应版的"查全部下级 userId 扁平数组"，给需要纯 userId 列表的场景用
 * （如 multiThread/step3_action.js）。
 * @param {string} adminToken
 * @param {number} rootId
 * @param {string|number} tenantId
 * @returns {Array<number>}
 */
export function getAllRelatedUserIdsAuto(adminToken, rootId, tenantId) {
    const members = getTeamMembersAuto(adminToken, rootId, tenantId);
    if (!members || members.length === 0) {
        console.warn(`[AgentApi] 未找到用户 ${rootId} 的代理关系`);
        return [];
    }
    const userIds = members.map(m => m.userId).filter(id => id);
    console.log(`[AgentApi] (自适应) 找到 ${userIds.length} 个相关用户`);
    return userIds;
}
