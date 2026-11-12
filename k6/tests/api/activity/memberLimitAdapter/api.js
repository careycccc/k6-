import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { logger } from '../../../../libs/utils/logger.js';

const TAG = 'MemberLimitApi';

/**
 * 获取分组列表
 * @param {boolean} [forceTenant=false] - 强制走商户自己的域名，不套集团路由（2026-11-11
 *   新增，默认false不影响现有调用方）。用 tenantAdminLogin(tenantId, true) 拿到商户token
 *   的调用方必须传true，否则会报"Account type does not match the admin site"；用集团
 *   token 的调用方要么不传、要么传false，保持原有行为。
 */
export function getGroups(adminToken, forceTenant = false) {
    const api = '/api/Groups/GetPageList';
    const payload = { pageNo: 1, pageSize: 50, orderBy: "Desc" };
    return sendQueryRequest(payload, api, TAG, false, adminToken, forceTenant);
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
 * @param {boolean} [forceTenant=false] - 同 getGroups 的 forceTenant
 * 注意：userType 必须是数组(比如 [0])，传标量(0)会报"Error converting value 0 to
 * type System.Collections.Generic.List`1[...UserTypeEnum]"(2026-11-11实测确认，
 * 跟 k6/playwrith/collect-users.js 里的同款坑一致)——这里把默认值从 0 改成 [0]。
 */
export function searchUsers(adminToken, searchParams = {}, forceTenant = false) {
    const api = '/api/Users/GetPageList';
    const payload = {
        pageNo: 1,
        pageSize: 20,
        orderBy: "Desc",
        userType: [0], // 默认查询正式会员；必须是数组
        ...searchParams
    };
    return sendQueryRequest(payload, api, TAG, false, adminToken, forceTenant);
}

/**
 * 获取用户详情（包含 tagCompositeList 等）
 * @param {boolean} [forceTenant=false] - 同 getGroups 的 forceTenant
 */
export function getUserDetail(adminToken, userId, forceTenant = false) {
    const api = '/api/Users/GetUserDetail';
    const payload = { userId: String(userId) };
    return sendQueryRequest(payload, api, TAG, false, adminToken, forceTenant);
}

/**
 * 获取组合标签列表
 * @param {boolean} [forceTenant=false] - 同 getGroups 的 forceTenant
 */
export function getCompositeTags(adminToken, forceTenant = false) {
    const api = '/api/TagConfig/GetCompositeTagPageList';
    const payload = { pageNo: 1, pageSize: 50, orderBy: "Desc" };
    return sendQueryRequest(payload, api, TAG, false, adminToken, forceTenant);
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
