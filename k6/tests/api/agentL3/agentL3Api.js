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
