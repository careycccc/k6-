import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { logger } from '../../../../libs/utils/logger.js';

const TAG = 'MemberLimitApi';

/**
 * 获取分组列表
 */
export function getGroups(adminToken) {
    const api = '/api/Groups/GetPageList';
    const payload = { pageNo: 1, pageSize: 50, orderBy: "Desc" };
    return sendQueryRequest(payload, api, TAG, false, adminToken);
}

/**
 * 更新用户分组（强行划组）
 */
export function updateUserGroup(adminToken, userId, groupId) {
    // 假设接口为 /api/Users/UpdateGroup，通常接收单个或者多个 userIds
    // 如果是确切的后台接口，可能叫 groupId, userId。这里做兼容处理
    const api = '/api/Users/UpdateGroup';
    const payload = { 
        userId: userId, 
        userIds: [userId], 
        groupId: groupId 
    };
    return sendRequest(payload, api, TAG, false, adminToken);
}

/**
 * 搜索用户列表
 * 支持参数: groupId, vipLevel, packageId, userType, state
 */
export function searchUsers(adminToken, searchParams = {}) {
    const api = '/api/Users/GetPageList';
    const payload = {
        pageNo: 1,
        pageSize: 20,
        orderBy: "Desc",
        userType: 0, // 默认查询正式会员
        ...searchParams
    };
    return sendQueryRequest(payload, api, TAG, false, adminToken);
}

/**
 * 获取用户详情（包含 tagCompositeList 等）
 */
export function getUserDetail(adminToken, userId) {
    const api = '/api/Users/GetUserDetail';
    const payload = { userId: String(userId) };
    return sendQueryRequest(payload, api, TAG, false, adminToken);
}

/**
 * 获取组合标签列表
 */
export function getCompositeTags(adminToken) {
    const api = '/api/TagConfig/GetCompositeTagPageList';
    const payload = { pageNo: 1, pageSize: 50, orderBy: "Desc" };
    return sendQueryRequest(payload, api, TAG, false, adminToken);
}

/**
 * 获取渠道来源列表
 * @param channelType 'Facebook' | 'Adjust' | 'TikTok'
 */
export function getChannels(adminToken, channelType) {
    const api = `/api/${channelType}/GetList`;
    const payload = { pageNo: 1, pageSize: 50, orderBy: "Desc" };
    return sendQueryRequest(payload, api, TAG, false, adminToken);
}

/**
 * 通用活动配置更新
 */
export function updateActivityConfig(adminToken, updateApi, payload) {
    return sendRequest(payload, updateApi, TAG, false, adminToken);
}
