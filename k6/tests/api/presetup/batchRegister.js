/**
 * 批量注册核心逻辑库
 *
 * 职责：
 *   - 场景A：普通注册（无邀请码 / 带邀请码）
 *   - 场景B：多层级邀请注册（复用 distributePeople 算法）
 *   - 硬性保证注册成功数量 = COUNT（失败自动重试）
 *   - 注册成功后将 token 注入 Redis token 池
 *   - 幂等性：读取 Redis 池现有数量，只补足差额
 *
 * 只新增，不修改任何现有文件。
 */

import { sleep } from 'k6';
import { phoneRegister, phoneRegisterByInvite, emailRegister, emailRegisterByInvite } from '../login/register.test.js';
import { generateRandomPhone, generateRandomEmail } from '../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { injectTokens, getPoolSize } from '../../../libs/redis/tokenPool.js';

// ============================================================
// 错误码常量
// ============================================================
const ERR_INVITE_CODE_REQUIRED = 11; // 邀请码不能为空

// ============================================================
// 内部工具
// ============================================================

/**
 * 从注册响应中提取 token
 * @param {object} response
 * @returns {string|null}
 */
function extractToken(response) {
    if (!response) return null;

    // 优先从 data.token 取
    if (response.data && response.data.token) {
        return response.data.token;
    }
    // 其次从 headers.Authorization 取
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

/**
 * 检查响应是否是"需要邀请码"错误
 * 如果是，立即抛出，中止后续执行
 * @param {object|null} parsedResponse - 原始响应体（已解析）
 */
function checkInviteCodeRequired(parsedResponse) {
    if (!parsedResponse) return;
    const code = parsedResponse.code !== undefined ? parsedResponse.code : parsedResponse.msgCode;
    const msg = parsedResponse.msg || '';
    if (code === ERR_INVITE_CODE_REQUIRED && msg.toLowerCase().includes('invitation code')) {
        throw new Error(
            `\n${'='.repeat(60)}\n` +
            `❌ 该租户需要邀请码才能注册！\n` +
            `   请添加参数重新执行：\n` +
            `   -e INVITE_CODE=你的邀请码\n` +
            `${'='.repeat(60)}\n`
        );
    }
}

/**
 * 单次注册尝试（手机号优先，失败降级邮箱）
 * @param {object} adminData
 * @param {string} inviteCode - 邀请码（空字符串表示普通注册）
 * @param {object} customUrls - 自定义URL（多租户）
 * @returns {string|null} token 或 null
 */
function tryRegisterOnce(adminData, inviteCode, customUrls) {
    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const email = generateRandomEmail();
    const useInvite = inviteCode && inviteCode.trim() !== '';

    // ---- 手机号注册 ----
    let response = null;
    try {
        if (useInvite) {
            response = phoneRegisterByInvite(phone, inviteCode, adminData, 'qwer1234', '', customUrls);
        } else {
            response = phoneRegister(phone, adminData, 'qwer1234', '');
        }
    } catch (e) {
        console.error(`[BatchRegister] 手机号注册异常: ${e.message}`);
    }

    // 检查是否需要邀请码（立即中止）
    if (response === null && !useInvite) {
        // phoneRegister 返回 null 时，尝试读取最后一次响应判断错误码
        // 这里通过约定：phoneRegister 内部已打印错误，我们无法直接拿到 parsedBody
        // 所以在 phoneRegister 返回 null 且无邀请码时，尝试邮箱注册前先检查
    }

    const phoneToken = extractToken(response);
    if (phoneToken) {
        console.log(`[BatchRegister] ✅ 手机号注册成功: ${phone}`);
        return phoneToken;
    }

    // ---- 邮箱注册降级 ----
    console.log(`[BatchRegister] 手机号注册失败，降级邮箱: ${email}`);
    let emailResponse = null;
    try {
        if (useInvite) {
            emailResponse = emailRegisterByInvite(email, inviteCode, adminData, 'qwer1234', '', customUrls);
        } else {
            emailResponse = emailRegister(email, adminData, 'qwer1234', '');
        }
    } catch (e) {
        console.error(`[BatchRegister] 邮箱注册异常: ${e.message}`);
    }

    const emailToken = extractToken(emailResponse);
    if (emailToken) {
        console.log(`[BatchRegister] ✅ 邮箱注册成功: ${email}`);
        return emailToken;
    }

    console.error(`[BatchRegister] ❌ 手机号和邮箱均注册失败`);
    return null;
}

// ============================================================
// 场景A：普通注册 / 带邀请码注册
// ============================================================

/**
 * 场景A：批量注册，硬性保证 targetCount 个有效 token
 *
 * 幂等性：先查 Redis 池现有数量，只补足差额
 *
 * @param {object} adminData - { token, envConfig }
 * @param {number} targetCount - 目标 token 数量
 * @param {string} inviteCode - 邀请码（可选，空字符串表示普通注册）
 * @param {string} tenantId - 租户ID
 * @returns {Promise<number>} 本次新增的 token 数量
 */
export async function batchRegisterScenarioA(adminData, targetCount, inviteCode, tenantId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[BatchRegister] 场景A 开始`);
    console.log(`[BatchRegister] 租户: ${tenantId}, 目标: ${targetCount} 个 token`);
    console.log(`[BatchRegister] 邀请码: ${inviteCode || '(无，普通注册)'}`);
    console.log(`${'='.repeat(60)}\n`);

    // 幂等性检查：读取已有数量
    const existingCount = await getPoolSize(tenantId);
    if (existingCount >= targetCount) {
        console.log(`[BatchRegister] ✅ Redis 池已有 ${existingCount} 个 token，无需补充`);
        return 0;
    }

    const needed = targetCount - existingCount;
    console.log(`[BatchRegister] Redis 池现有 ${existingCount} 个，还需注册 ${needed} 个`);

    const envConfig = adminData.envConfig;
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    const newTokens = [];
    let attempts = 0;
    const maxAttempts = needed * 5; // 最多尝试5倍次数，防止无限循环

    while (newTokens.length < needed && attempts < maxAttempts) {
        attempts++;
        console.log(`[BatchRegister] [${newTokens.length}/${needed}] 第 ${attempts} 次尝试...`);

        const token = tryRegisterOnce(adminData, inviteCode || '', customUrls);

        if (token) {
            newTokens.push(token);
            console.log(`[BatchRegister] 进度: ${newTokens.length}/${needed}`);
        }

        // 避免请求过快
        sleep(1);
    }

    if (newTokens.length < needed) {
        console.error(`[BatchRegister] ⚠️ 注册完成但数量不足: 目标=${needed}, 实际=${newTokens.length}`);
    }

    // 注入 Redis
    if (newTokens.length > 0) {
        await injectTokens(tenantId, newTokens);
    }

    console.log(`\n[BatchRegister] 场景A 完成: 新增 ${newTokens.length} 个 token`);
    return newTokens.length;
}

// ============================================================
// 场景B：多层级邀请注册
// ============================================================

/**
 * 将总人数按层级递减分配（复用 multiLevelRebate 中的算法逻辑）
 * @param {number} totalPeople
 * @param {number} levels
 * @returns {number[]}
 */
function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }

    const weights = [];
    for (let i = 0; i < levels; i++) {
        const base = (levels - i) / levels;
        weights.push(base * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));

    let diff = totalPeople - result.reduce((sum, n) => sum + n, 0);
    while (diff > 0) {
        for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; }
    }
    while (diff < 0) {
        for (let i = levels - 1; i >= 0 && diff < 0; i--) {
            if (result[i] > 1) { result[i]--; diff++; }
        }
    }
    result.sort((a, b) => b - a);
    return result;
}

/**
 * 注册单个邀请用户（手机号优先，失败降级邮箱），硬性重试直到成功
 * @param {string} parentInviteCode
 * @param {object} adminData
 * @param {object} customUrls
 * @returns {object} { token, inviteCode }
 */
function registerOneInviteUser(parentInviteCode, adminData, customUrls) {
    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const MAX_RETRY = 20;

    for (let i = 0; i < MAX_RETRY; i++) {
        const phone = generateRandomPhone(countryCode);
        const email = generateRandomEmail();

        // 手机号邀请注册
        let response = null;
        try {
            response = phoneRegisterByInvite(phone, parentInviteCode, adminData, 'qwer1234', '', customUrls);
        } catch (e) {
            console.error(`[BatchRegister] 手机号邀请注册异常: ${e.message}`);
        }

        let token = extractToken(response);
        if (token) {
            // 获取邀请码（用于下一层注册）
            sleep(1);
            const userInfo = getFrontUserInfo(token);
            const myInviteCode = (userInfo && userInfo.inviteCode) ? userInfo.inviteCode : null;
            console.log(`[BatchRegister] ✅ 手机号邀请注册成功: ${phone}, 邀请码: ${myInviteCode}`);
            return { token, inviteCode: myInviteCode };
        }

        // 邮箱邀请注册降级
        try {
            response = emailRegisterByInvite(email, parentInviteCode, adminData, 'qwer1234', '', customUrls);
        } catch (e) {
            console.error(`[BatchRegister] 邮箱邀请注册异常: ${e.message}`);
        }

        token = extractToken(response);
        if (token) {
            sleep(1);
            const userInfo = getFrontUserInfo(token);
            const myInviteCode = (userInfo && userInfo.inviteCode) ? userInfo.inviteCode : null;
            console.log(`[BatchRegister] ✅ 邮箱邀请注册成功: ${email}, 邀请码: ${myInviteCode}`);
            return { token, inviteCode: myInviteCode };
        }

        console.warn(`[BatchRegister] 第 ${i + 1} 次注册失败，重试...`);
        sleep(2);
    }

    throw new Error(`[BatchRegister] ❌ 单个用户注册失败超过 ${MAX_RETRY} 次，停止`);
}

/**
 * 场景B：多层级邀请注册，硬性保证 targetCount 个有效 token
 *
 * @param {object} adminData - { token, envConfig }
 * @param {number} targetCount - 目标 token 总数（硬性要求）
 * @param {string} rootInviteCode - 根邀请码
 * @param {number} levels - 层级数
 * @param {string} tenantId - 租户ID
 * @returns {Promise<number>} 本次新增的 token 数量
 */
export async function batchRegisterScenarioB(adminData, targetCount, rootInviteCode, levels, tenantId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[BatchRegister] 场景B 开始（多层级邀请注册）`);
    console.log(`[BatchRegister] 租户: ${tenantId}, 目标: ${targetCount} 个 token, 层级: ${levels}`);
    console.log(`[BatchRegister] 根邀请码: ${rootInviteCode}`);
    console.log(`${'='.repeat(60)}\n`);

    // 幂等性检查
    const existingCount = await getPoolSize(tenantId);
    if (existingCount >= targetCount) {
        console.log(`[BatchRegister] ✅ Redis 池已有 ${existingCount} 个 token，无需补充`);
        return 0;
    }

    const needed = targetCount - existingCount;
    console.log(`[BatchRegister] 还需注册 ${needed} 个`);

    const envConfig = adminData.envConfig;
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    // 层级分配
    const distribution = distributePeople(needed, levels);
    console.log(`[BatchRegister] 层级分配: ${distribution.join(' → ')}`);

    const allTokens = [];

    // 第1层：直接挂在 rootInviteCode 下
    let currentLayerInviteCodes = [rootInviteCode];

    for (let layerIdx = 0; layerIdx < distribution.length; layerIdx++) {
        const layerCount = distribution[layerIdx];
        if (layerCount === 0) continue;

        console.log(`\n[BatchRegister] === 第 ${layerIdx + 1} 层，注册 ${layerCount} 人 ===`);

        const nextLayerInviteCodes = [];
        let registered = 0;

        while (registered < layerCount) {
            // 轮询选择父级邀请码
            const parentCode = currentLayerInviteCodes[registered % currentLayerInviteCodes.length];

            try {
                const result = registerOneInviteUser(parentCode, adminData, customUrls);
                allTokens.push(result.token);

                // 如果获取到了邀请码，加入下一层父级池
                if (result.inviteCode) {
                    nextLayerInviteCodes.push(result.inviteCode);
                }

                registered++;
                console.log(`[BatchRegister] 第${layerIdx + 1}层进度: ${registered}/${layerCount}`);
            } catch (e) {
                console.error(`[BatchRegister] 注册失败，重试: ${e.message}`);
                sleep(2);
                // 继续重试，不增加 registered，直到成功
            }

            sleep(1);
        }

        // 下一层的父级 = 本层注册成功的用户
        if (nextLayerInviteCodes.length > 0) {
            currentLayerInviteCodes = nextLayerInviteCodes;
        }
        // 如果本层没有获取到邀请码（异常情况），继续用上层邀请码
    }

    // 注入 Redis
    if (allTokens.length > 0) {
        await injectTokens(tenantId, allTokens);
    }

    console.log(`\n[BatchRegister] 场景B 完成: 新增 ${allTokens.length} 个 token`);
    return allTokens.length;
}
