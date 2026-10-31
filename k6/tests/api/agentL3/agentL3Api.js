import { sleep } from 'k6';
import { sendRequest, sendQueryRequest } from '../common/request.js';
import { logger } from '../../../libs/utils/logger.js';

export const agentL3Tag = 'agentL3Api';

/**
 * 获取3级代理验证配置
 * @param {Object} data - 包含 token 的环境对象
 * @returns {Object|null} 
 */
export function GetConfig(data) {
    const api = '/api/AgentL3/GetConfig';
    const payload = {};
    const res = sendRequest(payload, api, agentL3Tag, false, data.token);
    
    // sendRequest 返回的已经是解析后的 Object（即 response.json()）
    if (res) {
        if (res.msgCode !== undefined) {
            if (res.msgCode === 0) return res.data;
        } else {
            return res; // testCommonRequest 已经返回了 data 部分
        }
    }
    logger.error(`[${agentL3Tag}] GetConfig 接口请求失败或业务报错: ${JSON.stringify(res)}`);
    return null;
}

/**
 * 获取邀请任务阶梯奖励配置
 * @param {Object} data - 包含 token 的环境对象
 * @returns {Array|null} 
 */
export function GetListInviteTaskConfig(data) {
    const api = '/api/AgentL3/GetListInviteTaskConfig';
    const payload = {};
    const res = sendRequest(payload, api, agentL3Tag, false, data.token);
    
    if (res) {
        if (res.msgCode !== undefined) {
            if (res.msgCode === 0) return res.data;
        } else {
            return res; // 已经返回了数组
        }
    }
    logger.error(`[${agentL3Tag}] GetListInviteTaskConfig 接口请求失败或业务报错: ${JSON.stringify(res)}`);
    return null;
}

/**
 * 获取3级代理团队返佣等级和利率配置
 * @param {Object} data - 包含 token 的环境对象
 * @returns {Array|null} 
 */
export function GetListRebateLevelRate(data) {
    const api = '/api/AgentL3/GetListRebateLevelRate';
    const payload = {};
    const res = sendRequest(payload, api, agentL3Tag, false, data.token);
    
    if (res) {
        if (res.msgCode !== undefined) {
            if (res.msgCode === 0) return res.data;
        } else {
            return res; // 已经返回了数组
        }
    }
    logger.error(`[${agentL3Tag}] GetListRebateLevelRate 接口请求失败或业务报错: ${JSON.stringify(res)}`);
    return null;
}

/**
 * 获取某代理直推被邀请成员列表（单层，自动翻页）
 * 2026-10-30 从 agentL3Validation.js 的同名私有函数移植到这里，供 invite/agentApi.js
 * 的自适应查询函数复用，避免 api封装层反向依赖 验证脚本层的内部函数。
 * @param {object} data - 包含 token 的对象 {token}
 * @param {number} agentId
 * @returns {Array} 该代理的直推成员列表（原始接口字段，未加工）
 */
export function getInvitedListAllPages(data, agentId) {
    const api = '/api/AgentL3/GetPageListInvitedList';
    const pageSize = 500;
    let allItems = [];
    let pageNo = 1;

    while (true) {
        const payload = { agentId, pageNo, pageSize, orderBy: 'Desc' };
        let result = sendQueryRequest(payload, api, agentL3Tag, false, data.token);
        if (typeof result !== 'object') {
            try { result = JSON.parse(result); } catch (e) { break; }
        }
        const list = (result && result.list) ? result.list : [];
        allItems = allItems.concat(list);
        const totalPage = (result && result.totalPage) ? result.totalPage : 1;
        if (pageNo >= totalPage || list.length === 0) break;
        pageNo++;
        sleep(0.3);
    }
    return allItems;
}

/**
 * 递归获取完整团队 L1~L3 成员（3级代理专用），拍平成一维数组，每个成员带
 * hierarchy 字段——相对 rootId 的相对层级（直接下级=1，不含 root 自己）。
 * 逻辑移植自 agentL3Validation.js 的 getAllTeamMembers，去掉了该文件专属的
 * rootParentId 反推逻辑，只保留"拍平+打层级"的核心部分。
 * @param {object} data - 包含 token 的对象 {token}
 * @param {number} rootId
 * @returns {Array<{userId:number, hierarchy:number, [key:string]:any}>}
 */
export function getAllTeamMembersL3(data, rootId) {
    const memberList = [];

    const l1List = getInvitedListAllPages(data, rootId);
    for (const m of l1List) {
        memberList.push({ ...m, hierarchy: 1 });
        sleep(0.2);

        const l2List = getInvitedListAllPages(data, m.userId);
        for (const m2 of l2List) {
            memberList.push({ ...m2, hierarchy: 2 });
            sleep(0.2);

            const l3List = getInvitedListAllPages(data, m2.userId);
            for (const m3 of l3List) {
                memberList.push({ ...m3, hierarchy: 3 });
            }
        }
    }

    return memberList;
}
