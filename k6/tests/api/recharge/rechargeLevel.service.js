/**
 * 充值大类（可见等级）& 充值通道（适用等级）API 服务封装
 *
 * 涵盖接口：
 *   后台 - 充值大类:
 *     GET  /api/RechargeCategory/GetPageList       获取充值大类列表
 *     POST /api/RechargeCategory/UpdateCommon      更新充值大类可见等级
 *   后台 - 充值通道:
 *     GET  /api/RechargeChannel/GetPageList        获取充值通道列表
 *     POST /api/RechargeChannel/UpdateRemark       更新充值通道适用等级
 *   前台:
 *     POST /api/User/GetUserInfo                   获取前台用户信息（含rechargeLevel）
 *     POST /api/Recharge/GetRechargeBasicInfo      获取充值基础信息（含supportCategories）
 */

import { sendRequest, sendQueryRequest } from '../common/request.js';
import { generateCryptoRandomString } from '../../utils/utils.js';

// ================================================================
// ■ 后台 - 充值大类接口
// ================================================================

/**
 * 获取后台充值大类列表（只返回 state===1 的开启项）
 * @param {string} adminToken - 管理员 token
 * @returns {Array} 开启的充值大类数组，字段包含 id, name, rechargeType, rechargeLevel, ...
 */
export function getActiveCategoryList(adminToken) {
    const api = '/api/RechargeCategory/GetPageList';
    const tag = 'GetRechargeCategoryPageList';

    const payload = {
        pageNo: 1,
        pageSize: 200
    };

    const response = sendQueryRequest(payload, api, tag, false, adminToken);

    if (!response) {
        console.error(`[${tag}] 获取充值大类列表失败: 响应为空`);
        return [];
    }

    // sendQueryRequest 返回的是 data 对象
    const list = (response.list) || (response.data && response.data.list) || [];

    if (!Array.isArray(list) || list.length === 0) {
        console.warn(`[${tag}] 充值大类列表为空`);
        return [];
    }

    // 过滤 state===1 的开启项
    const activeList = list.filter(item => item.state === 1);
    console.log(`[${tag}] 共 ${list.length} 条大类，其中开启(state=1): ${activeList.length} 条`);
    activeList.forEach(c => {
        const levels = c.rechargeLevel ? c.rechargeLevel : '(全部)';
        console.log(`  大类 id=${c.id} name=${c.name} type=${c.rechargeType} 当前可见等级=${levels}`);
    });

    return activeList;
}

/**
 * 更新充值大类的可见等级（rechargeLevelList）
 * @param {string} adminToken - 管理员 token
 * @param {object} category   - getActiveCategoryList 返回的大类对象
 * @param {number[]} rechargeLevelList - 可见等级列表，[] 表示全部可见
 * @returns {boolean}
 */
export function updateCategoryVisibleLevel(adminToken, category, rechargeLevelList) {
    const api = '/api/RechargeCategory/UpdateCommon';
    const tag = 'UpdateCategoryVisibleLevel';

    // 解析 quickConfigList（兼容对象或字符串格式）
    let configList = [];
    if (Array.isArray(category.quickConfigList)) {
        configList = category.quickConfigList.map(c => ({
            rechargeAmount: c.rechargeAmount,
            gifType: c.gifType,
            giftAmount: c.giftAmount
        }));
    } else if (typeof category.quickConfig === 'string' && category.quickConfig) {
        try {
            const parsed = JSON.parse(category.quickConfig);
            configList = parsed.map(c => ({
                rechargeAmount: c.RechargeAmount,
                gifType: c.GifType,
                giftAmount: c.GiftAmount
            }));
        } catch (e) {
            console.warn(`[${tag}] quickConfig 解析失败: ${e.message}`);
        }
    }

    const payload = {
        id: category.id,
        rechargeLevelList: rechargeLevelList,
        discountLevelList: [],
        sort: category.sort,
        minAmount: category.minAmount,
        maxAmount: category.maxAmount,
        giftRatioType: category.giftRatioType,
        scaleType: category.scaleType,
        rechargeGiftRatio: category.rechargeGiftRatioInfo || {
            giftRatioType: category.giftRatioType,
            scaleType: category.scaleType,
            uniformRatioData: null,
            intervalRatioList: null
        },
        configList: configList
    };

    const response = sendRequest(payload, api, tag, false, adminToken);

    if (!response) {
        console.error(`[${tag}] 更新大类 ${category.id}(${category.name}) 可见等级失败`);
        return false;
    }

    const code = response.msgCode !== undefined ? response.msgCode : (response.code !== undefined ? response.code : -1);
    if (code !== 0) {
        console.error(`[${tag}] 更新大类 ${category.id} 失败: code=${code}, msg=${response.msg}`);
        return false;
    }

    const levelDesc = rechargeLevelList.length === 0 ? '全部' : rechargeLevelList.join(',');
    console.log(`[${tag}] ✅ 大类 id=${category.id}(${category.name}) 可见等级更新为 [${levelDesc}]`);
    return true;
}

// ================================================================
// ■ 后台 - 充值通道接口
// ================================================================

/**
 * 获取后台充值通道列表（只返回 state===1 的开启项）
 * @param {string} adminToken - 管理员 token
 * @returns {Array} 开启的充值通道数组，字段包含 channelId, name, rechargeLevel, rechargeCategoryIds, ...
 */
export function getActiveChannelList(adminToken) {
    const api = '/api/RechargeChannel/GetPageList';
    const tag = 'GetRechargeChannelPageList';

    const payload = {
        sortField: 'id',
        pageNo: 1,
        pageSize: 200
    };

    const response = sendQueryRequest(payload, api, tag, false, adminToken);

    if (!response) {
        console.error(`[${tag}] 获取充值通道列表失败: 响应为空`);
        return [];
    }

    const list = (response.list) || (response.data && response.data.list) || [];

    if (!Array.isArray(list) || list.length === 0) {
        console.warn(`[${tag}] 充值通道列表为空`);
        return [];
    }

    // 过滤 state===1 的开启项
    const activeList = list.filter(item => item.state === 1);
    console.log(`[${tag}] 共 ${list.length} 条通道，其中开启(state=1): ${activeList.length} 条`);
    activeList.forEach(ch => {
        const levels = ch.rechargeLevel ? ch.rechargeLevel : '(全部)';
        console.log(`  通道 channelId=${ch.channelId} name=${ch.name} 当前适用等级=${levels}`);
    });

    return activeList;
}

/**
 * 更新充值通道的适用等级（rechargeLevelList）
 * @param {string} adminToken  - 管理员 token
 * @param {object} channel     - getActiveChannelList 返回的通道对象
 * @param {number[]} rechargeLevelList - 适用等级列表，[] 表示全部适用
 * @returns {boolean}
 */
export function updateChannelApplicableLevel(adminToken, channel, rechargeLevelList) {
    const api = '/api/RechargeChannel/UpdateRemark';
    const tag = 'UpdateChannelApplicableLevel';

    const payload = {
        name: channel.name,
        remark: channel.remark || '',
        channelId: channel.channelId,
        minAmount: channel.minAmount,
        maxAmount: channel.maxAmount,
        rechargeLevelList: rechargeLevelList
    };

    const response = sendRequest(payload, api, tag, false, adminToken);

    if (!response) {
        console.error(`[${tag}] 更新通道 ${channel.channelId}(${channel.name}) 适用等级失败`);
        return false;
    }

    const code = response.msgCode !== undefined ? response.msgCode : (response.code !== undefined ? response.code : -1);
    if (code !== 0) {
        console.error(`[${tag}] 更新通道 ${channel.channelId} 失败: code=${code}, msg=${response.msg}`);
        return false;
    }

    const levelDesc = rechargeLevelList.length === 0 ? '全部' : rechargeLevelList.join(',');
    console.log(`[${tag}] ✅ 通道 channelId=${channel.channelId}(${channel.name}) 适用等级更新为 [${levelDesc}]`);
    return true;
}

// ================================================================
// ■ 前台接口
// ================================================================

/**
 * 获取前台用户信息（包含 rechargeLevel 充值等级）
 * @param {string} userToken - 前台用户 token
 * @returns {object|null}    - 包含 userId, rechargeLevel 等字段的用户信息
 */
export function getFrontUserInfoWithLevel(userToken) {
    const api = '/api/User/GetUserInfo';
    const tag = 'GetFrontUserInfo';

    const response = sendRequest({}, api, tag, true, userToken);

    if (!response) {
        console.error(`[${tag}] 获取前台用户信息失败`);
        return null;
    }

    // response 可能是 data 对象（sendRequest 成功时返回 data）
    const userInfo = response.userId !== undefined ? response : (response.data || null);

    if (!userInfo || userInfo.userId === undefined) {
        console.error(`[${tag}] 响应格式异常: ${JSON.stringify(response)}`);
        return null;
    }

    console.log(`[${tag}] ✅ 用户 userId=${userInfo.userId} rechargeLevel=${userInfo.rechargeLevel}`);
    return userInfo;
}

/**
 * 获取前台充值基础信息（goodsList 含 supportCategories）
 * @param {string} userToken - 前台用户 token
 * @returns {object|null}    - 包含 goodsList 的充值基础信息
 */
export function getRechargeBasicInfo(userToken) {
    const api = '/api/Recharge/GetRechargeBasicInfo';
    const tag = 'GetRechargeBasicInfo';

    const response = sendRequest({}, api, tag, true, userToken);

    if (!response) {
        console.error(`[${tag}] 获取充值基础信息失败`);
        return null;
    }

    const data = response.goodsList !== undefined ? response : (response.data || null);

    if (!data || !Array.isArray(data.goodsList)) {
        console.error(`[${tag}] 响应缺少 goodsList: ${JSON.stringify(response)}`);
        return null;
    }

    console.log(`[${tag}] ✅ 获取充值基础信息成功，goodsList 共 ${data.goodsList.length} 条`);
    return data;
}

// ================================================================
// ■ 用户列表 & 密码登录 工具
// ================================================================

/**
 * 从后台获取普通会员列表（/api/Users/GetPageList）
 * 用于在 setup 阶段筛选具有特定 rechargeLevel 的账号
 * @param {string} adminToken  - 管理员 token
 * @param {object} filter      - 过滤条件，如 { rechargeLevel: 2 }
 * @returns {Array}            - 用户列表
 */
export function getUserPageList(adminToken, filter = {}) {
    const api = '/api/Users/GetPageList';
    const tag = 'GetUserPageList';

    const payload = {
        pageNo: 1,
        pageSize: 50,
        ...filter
    };

    const response = sendQueryRequest(payload, api, tag, false, adminToken);

    if (!response) {
        console.error(`[${tag}] 获取用户列表失败`);
        return [];
    }

    const list = (response.list) || (response.data && response.data.list) || [];
    console.log(`[${tag}] 查询到 ${list.length} 个用户 (filter=${JSON.stringify(filter)})`);
    return list;
}

/**
 * 使用密码登录前台（/api/Home/Login）
 * @param {string} userName - 手机号账号
 * @param {string} password - 密码（默认 qwer1234）
 * @returns {string|null}   - 登录成功返回 token，否则返回 null
 */
export function loginWithPassword(userName, password = 'qwer1234') {
    const api = '/api/Home/Login';
    const tag = 'FrontLoginWithPassword';

    const payload = {
        userName: userName,
        password: password,
        loginType: 'Mobile',
        deviceId: '',
        browserId: generateCryptoRandomString(32),
        packageName: ''
    };

    const response = sendRequest(payload, api, tag, true);

    // sendRequest 登录成功返回 token 字符串
    if (response && typeof response === 'string' && response.length > 10) {
        console.log(`[${tag}] ✅ 密码登录成功: ${userName}`);
        return response;
    }

    // 可能返回的是 data 对象
    if (response && response.token) {
        console.log(`[${tag}] ✅ 密码登录成功: ${userName}`);
        return response.token;
    }

    console.warn(`[${tag}] ⚠️ 密码登录失败: ${userName}, 响应: ${JSON.stringify(response)}`);
    return null;
}

/**
 * 遍历用户列表尝试密码登录，找到第一个成功的账号
 * 若密码错误（msgCode 对应错误码）则换下一个账号
 * @param {Array} userList - 用户列表（含 userName 或 phone 字段）
 * @param {string} password - 默认密码
 * @returns {{ token: string, user: object }|null}
 */
export function findLoginableUser(userList, password = 'qwer1234') {
    const tag = 'FindLoginableUser';

    for (let i = 0; i < userList.length; i++) {
        const user = userList[i];
        // 兼容不同字段名：userName / phone / account
        const account = user.userName || user.phone || user.account || '';

        if (!account) {
            console.warn(`[${tag}] 用户 index=${i} 无可用账号字段，跳过`);
            continue;
        }

        console.log(`[${tag}] [${i + 1}/${userList.length}] 尝试登录账号: ${account}`);
        const token = loginWithPassword(account, password);

        if (token) {
            console.log(`[${tag}] ✅ 成功登录账号: ${account}`);
            return { token, user };
        }

        console.log(`[${tag}] ❌ 账号 ${account} 登录失败，尝试下一个...`);
    }

    console.error(`[${tag}] 所有账号均登录失败`);
    return null;
}
