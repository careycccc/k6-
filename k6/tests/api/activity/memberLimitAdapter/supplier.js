import { logger } from '../../../../libs/utils/logger.js';
import * as api from './api.js';
import { phoneRegister } from '../../login/register.test.js';
import { generateRandomPhone } from '../../../utils/accountGenerator.js';
import { ENV_CONFIG } from '../../../../config/envconfig.js';

const TAG = 'MemberLimitSupplier';

function extractList(response) {
    if (!response) return [];
    if (response.data && Array.isArray(response.data.list)) return response.data.list;
    if (Array.isArray(response.list)) return response.list;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response)) return response;
    return [];
}

/**
 * 随机取一个元素
 */
function randomPick(list) {
    if (!list || list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
}

/**
 * 找一个没有任何分组和标签的纯净新账号
 */
export function createNewCleanUser(adminToken) {
    const countryCode = ENV_CONFIG.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const adminData = { token: adminToken, envConfig: ENV_CONFIG };
    
    logger.info(`[${TAG}] 正在注册全新测试账号: ${phone}`);
    const regRes = phoneRegister(phone, adminData);
    if (regRes && regRes.code === 0 && regRes.data?.userId) {
        return { userId: regRes.data.userId, isNew: true };
    }
    logger.error(`[${TAG}] 注册全新测试账号失败`);
    return null;
}

/**
 * 分组测试：寻号
 */
export function supplyForGroup(adminToken, options = {}) {
    const { targetGroupId } = options;
    const groupRes = api.getGroups(adminToken);
    const groups = extractList(groupRes);
    if (groups.length === 0) {
        logger.warn(`[${TAG}] 当前环境无任何分组数据，无法执行分组测试`);
        return null;
    }

    let targetGroup = null;
    if (targetGroupId) {
        targetGroup = groups.find(g => String(g.id) === String(targetGroupId));
    }
    if (!targetGroup) {
        targetGroup = randomPick(groups);
    }
    
    const groupId = targetGroup.id;
    logger.info(`[${TAG}] 选中测试分组: ${targetGroup.groupName} (ID: ${groupId})`);

    let posUser = null;
    let negUser = null;
    let isForced = false;

    // 找正向
    const posRes = api.searchUsers(adminToken, { groupId });
    const posList = extractList(posRes);
    
    if (posList.length > 0) {
        posUser = randomPick(posList);
    } else {
        // 降级：随机拉一个账号强行划入
        logger.warn(`[${TAG}] 分组 ${groupId} 无账号，启动降级强制注入`);
        const anyUsers = extractList(api.searchUsers(adminToken, {}));
        if (anyUsers.length > 0) {
            posUser = randomPick(anyUsers);
            api.updateUserGroup(adminToken, posUser.id || posUser.userId, groupId);
            isForced = true;
            logger.info(`[${TAG}] 强制将用户 ${posUser.id || posUser.userId} 划入分组 ${groupId}`);
        }
    }

    // 找反向：找一个不在该分组的
    const anyUsersRes = extractList(api.searchUsers(adminToken, {}));
    const negUsers = anyUsersRes.filter(u => String(u.groupId) !== String(groupId) && (u.id || u.userId) !== (posUser?.id || posUser?.userId));
    if (negUsers.length > 0) {
        negUser = randomPick(negUsers);
    } else {
        // 造一个
        negUser = createNewCleanUser(adminToken);
    }

    if (!posUser || !negUser) return null;

    return {
        config: { type: 'group', groupId },
        positive: { userId: posUser.id || posUser.userId, isForced, originalGroupId: posUser.groupId },
        negative: { userId: negUser.id || negUser.userId }
    };
}

/**
 * 注册时间测试（新老会员）：寻号
 */
export function supplyForTime(adminToken) {
    const posUser = createNewCleanUser(adminToken);
    
    // 拉取老账号 (简单的假设：直接查最后一页或者就查前20个找昨天以前的)
    // 为稳定，取列表里存在的最早的号
    const anyUsers = extractList(api.searchUsers(adminToken, { pageNo: 5 })); // 随便取后面一点的页
    let negUser = null;
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const u of anyUsers) {
        if (u.registerTime) {
            const rt = new Date(u.registerTime.replace(/-/g, '/'));
            if (rt < oneDayAgo) {
                negUser = u;
                break;
            }
        }
    }
    // fallback
    if (!negUser && anyUsers.length > 0) negUser = anyUsers[anyUsers.length - 1];

    if (!posUser || !negUser) return null;

    return {
        config: { type: 'new_member' },
        positive: { userId: posUser.userId },
        negative: { userId: negUser.id || negUser.userId }
    };
}

/**
 * VIP 等级测试：寻号
 */
export function supplyForVip(adminToken) {
    const vipPool = [1, 2, 3, 4];
    let posUser = null;
    let targetVip = 0;

    // 熔断轮询
    const shuffledVips = vipPool.sort(() => Math.random() - 0.5);
    for (const v of shuffledVips) {
        const users = extractList(api.searchUsers(adminToken, { vipLevel: v }));
        if (users.length > 0) {
            posUser = randomPick(users);
            targetVip = v;
            break;
        }
    }

    if (!posUser) {
        logger.warn(`[${TAG}] VIP 1-4 均无账号，跳过 VIP 测试`);
        return null;
    }

    // 反向寻号
    let negVip = targetVip > 1 ? targetVip - 1 : targetVip + 1;
    let negUser = null;
    const negUsers = extractList(api.searchUsers(adminToken, { vipLevel: negVip }));
    if (negUsers.length > 0) {
        negUser = randomPick(negUsers);
    } else {
        const fallbackUsers = extractList(api.searchUsers(adminToken, { vipLevel: 0 }));
        if (fallbackUsers.length > 0) negUser = randomPick(fallbackUsers);
    }

    if (!negUser) return null;

    return {
        config: { type: 'vip', vipLevel: targetVip },
        positive: { userId: posUser.id || posUser.userId },
        negative: { userId: negUser.id || negUser.userId }
    };
}

/**
 * 渠道测试：寻号
 */
export function supplyForChannel(adminToken) {
    const channels = ['Facebook', 'Adjust', 'TikTok'];
    const targetChannel = randomPick(channels);
    
    const channelList = extractList(api.getChannels(adminToken, targetChannel));
    if (channelList.length === 0) {
        logger.warn(`[${TAG}] 渠道 ${targetChannel} 列表为空，跳过渠道测试`);
        return null;
    }

    const targetPackageId = randomPick(channelList).id;
    const posUsers = extractList(api.searchUsers(adminToken, { packageId: targetPackageId }));
    
    if (posUsers.length === 0) {
        logger.warn(`[${TAG}] 渠道包 ${targetPackageId} 下无用户，跳过`);
        return null;
    }

    const posUser = randomPick(posUsers);
    
    // 反向
    const allUsers = extractList(api.searchUsers(adminToken, {}));
    const negUsers = allUsers.filter(u => String(u.packageId) !== String(targetPackageId));
    let negUser = negUsers.length > 0 ? randomPick(negUsers) : createNewCleanUser(adminToken);

    if (!negUser) return null;

    return {
        config: { type: 'channel', packageId: targetPackageId },
        positive: { userId: posUser.id || posUser.userId },
        negative: { userId: negUser.id || negUser.userId }
    };
}

/**
 * 剔除测试（分组和组合标签）：寻找最难的账号
 */
export function supplyForExclude(adminToken, options = {}) {
    const { excludeGroupId, excludeTagId } = options;
    const tags = extractList(api.getCompositeTags(adminToken));
    const groups = extractList(api.getGroups(adminToken));

    if (tags.length === 0 || groups.length === 0) {
        logger.warn(`[${TAG}] 标签或分组为空，无法执行剔除测试`);
        return null;
    }

    // 为了找到 逆向2（不在G，有T），我们先查一批用户详情
    const recentUsers = extractList(api.searchUsers(adminToken, { pageSize: 50 }));
    let negUser2 = null;
    let targetTagId = null;
    let targetGroupId = null;

    for (const u of recentUsers) {
        const detailRes = api.getUserDetail(adminToken, u.id || u.userId);
        const detail = detailRes?.data || detailRes;
        
        // 假设组合标签字段是 tagCompositeList
        const tList = detail?.tagCompositeList || detail?.compositeTagList || []; 
        
        let hasTag = false;
        let foundTagId = null;
        
        if (excludeTagId) {
            const matchTag = tList.find(t => String(t.id || t) === String(excludeTagId));
            if (matchTag) {
                hasTag = true;
                foundTagId = excludeTagId;
            }
        } else if (tList.length > 0) {
            hasTag = true;
            foundTagId = tList[0].id || tList[0];
        }

        if (hasTag) {
            negUser2 = u;
            targetTagId = foundTagId; 
            
            // 组的逻辑
            const myGroupId = String(u.groupId || '');
            if (excludeGroupId) {
                targetGroupId = excludeGroupId;
                // 注意：如果指定了排除组，那么 negUser2（有标签但不在该组）必须满足他真的不在该组
                if (myGroupId === String(excludeGroupId)) {
                    // 他在这个组里！不符合 negUser2 (不在G，有T) 的定义，跳过
                    negUser2 = null;
                    continue;
                }
            } else {
                const otherGroups = groups.filter(g => String(g.id) !== myGroupId);
                if (otherGroups.length > 0) {
                    targetGroupId = otherGroups[0].id;
                }
            }
            if (negUser2) break; // 找到了
        }
    }

    if (!negUser2 || !targetTagId || !targetGroupId) {
        logger.warn(`[${TAG}] 无法找到带有组合标签的用户，剔除测试跳过`);
        return null;
    }

    // 找正向（不在 G，也没 T） -> 新账号肯定满足
    const posUser = createNewCleanUser(adminToken);

    // 找反向1（在 G，没 T）
    let negUser1 = null;
    const gUsers = extractList(api.searchUsers(adminToken, { groupId: targetGroupId }));
    if (gUsers.length > 0) {
        // 简单假设列表里第一个人没那个T标签
        negUser1 = gUsers[0];
    } else {
        // 强行把新账号塞进去
        const tmpUser = createNewCleanUser(adminToken);
        api.updateUserGroup(adminToken, tmpUser.userId, targetGroupId);
        negUser1 = { id: tmpUser.userId, isForced: true };
    }

    return {
        config: { type: 'exclude', excludeGroup: targetGroupId, excludeTag: targetTagId },
        positive: { userId: posUser.userId },
        negative1: { userId: negUser1.id || negUser1.userId, isForced: negUser1.isForced },
        negative2: { userId: negUser2.id || negUser2.userId }
    };
}

/**
 * 组合标签准入：寻号
 */
export function supplyForTag(adminToken, options = {}) {
    const { targetTagId } = options;
    const tags = extractList(api.getCompositeTags(adminToken));
    if (tags.length === 0) {
        logger.warn(`[${TAG}] 当前环境无任何组合标签数据，跳过`);
        return null;
    }

    let targetTag = null;
    if (targetTagId) {
        targetTag = tags.find(t => String(t.id) === String(targetTagId));
    }
    if (!targetTag) {
        targetTag = randomPick(tags);
    }
    const tagId = targetTag.id;

    // 找拥有该标签的用户
    const recentUsers = extractList(api.searchUsers(adminToken, { pageSize: 50 }));
    let posUser = null;
    for (const u of recentUsers) {
        const detailRes = api.getUserDetail(adminToken, u.id || u.userId);
        const detail = detailRes?.data || detailRes;
        const tList = detail?.tagCompositeList || detail?.compositeTagList || [];
        if (tList.some(t => String(t.id || t) === String(tagId))) {
            posUser = u;
            break;
        }
    }

    if (!posUser) {
        logger.warn(`[${TAG}] 找不到拥有标签 ${tagId} 的用户，跳过`);
        return null;
    }

    // 反向：找没有的
    const negUser = createNewCleanUser(adminToken);

    return {
        config: { type: 'tag', tagId: tagId },
        positive: { userId: posUser.id || posUser.userId },
        negative: { userId: negUser.userId }
    };
}
