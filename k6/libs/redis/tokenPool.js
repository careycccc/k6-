/**
 * Redis Token 池管理器
 *
 * 架构说明：
 *   - 使用 Redis List 存储 token，key 格式：token_pool:{tenantId}
 *   - RPUSH 注入 token，LPOP 原子消费（分布式安全）
 *   - 轮询模式：消费后立即 RPUSH 回队尾，实现循环复用
 *   - 支持 JWT 过期检测，自动跳过失效 token
 *
 * 依赖：k6/x/redis（xk6-redis 扩展，已内置于项目）
 *
 * Redis Key 规范：
 *   token_pool:3001   → 租户3001的token池
 *   token_pool:3002   → 租户3002的token池
 */

import redis from 'k6/x/redis';

// ============================================================
// Redis 客户端（从环境变量读取连接地址，支持生产/测试环境切换）
// ============================================================
const REDIS_URL = __ENV.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new redis.Client(REDIS_URL);

// Token 池 key 前缀
const TOKEN_POOL_PREFIX = 'token_pool';

// 最大跳过次数（防止池内全是过期 token 时死循环）
const MAX_SKIP = 200;

// ============================================================
// JWT 工具函数
// ============================================================

/**
 * 解析 JWT payload（不验签，仅读取过期时间）
 * @param {string} token
 * @returns {object|null} payload 对象
 */
function parseJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        // k6 环境没有 atob，手动 base64 解码
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        // 补齐 padding
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
        const decoded = String.fromCharCode(
            ...Array.from({ length: Math.ceil(padded.length * 3 / 4) }, (_, i) => {
                // 简化版 base64 decode，适用于 ASCII JSON
                return 0;
            })
        );

        // k6 内置 encoding 模块可用
        // 使用 JSON.parse 直接解析 base64url
        const jsonStr = decodeBase64Url(padded);
        return JSON.parse(jsonStr);
    } catch (e) {
        return null;
    }
}

/**
 * base64url 解码为字符串
 * @param {string} str
 * @returns {string}
 */
function decodeBase64Url(str) {
    // k6 运行时支持 globalThis.atob（v0.42+）
    try {
        return atob(str);
    } catch (e) {
        // 降级：逐字符解码
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        let result = '';
        let i = 0;
        while (i < str.length) {
            const a = chars.indexOf(str[i++]);
            const b = chars.indexOf(str[i++]);
            const c = chars.indexOf(str[i++]);
            const d = chars.indexOf(str[i++]);
            const n = (a << 18) | (b << 12) | (c << 6) | d;
            result += String.fromCharCode((n >> 16) & 0xff);
            if (c !== 64) result += String.fromCharCode((n >> 8) & 0xff);
            if (d !== 64) result += String.fromCharCode(n & 0xff);
        }
        return result;
    }
}

/**
 * 检查 token 是否有效（未过期）
 * 提前 60 秒判定为过期，留出缓冲时间
 * @param {string} token
 * @returns {boolean}
 */
export function isTokenValid(token) {
    if (!token || token.trim() === '') return false;

    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            // 非标准 JWT，无法判断，默认有效
            return true;
        }

        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
        const jsonStr = decodeBase64Url(padded);
        const payload = JSON.parse(jsonStr);

        if (!payload.exp) {
            // 无过期字段，默认有效
            return true;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const valid = payload.exp > nowSec + 60; // 提前60秒判定过期

        if (!valid) {
            console.warn(`[TokenPool] ⚠️ Token 已过期或即将过期: exp=${payload.exp}, now=${nowSec}`);
        }

        return valid;
    } catch (e) {
        // 解析失败，默认有效（避免误杀非 JWT token）
        return true;
    }
}

// ============================================================
// Token 池核心操作
// ============================================================

/**
 * 获取租户的 Redis key
 * @param {string} tenantId
 * @returns {string}
 */
function getPoolKey(tenantId) {
    return `${TOKEN_POOL_PREFIX}:${tenantId}`;
}

/**
 * 向 Redis token 池注入 token 列表
 * 用于 batchRegister 注册完成后批量写入
 * @param {string} tenantId - 租户ID
 * @param {string[]} tokens - token 数组
 * @returns {Promise<number>} 注入成功数量
 */
export async function injectTokens(tenantId, tokens) {
    const key = getPoolKey(tenantId);
    let count = 0;

    for (const token of tokens) {
        if (!token || token.trim() === '') continue;
        await redisClient.rpush(key, token.trim());
        count++;
    }

    console.log(`[TokenPool] ✅ 租户 ${tenantId} 注入 ${count} 个 token → Redis key: ${key}`);
    return count;
}

/**
 * 从 Redis token 池原子获取一个有效 token（轮询模式）
 *
 * 策略：
 *   1. LPOP 取出队头 token
 *   2. 检查是否过期
 *   3. 有效 → RPUSH 回队尾（循环复用）+ 返回
 *   4. 过期 → 丢弃，继续取下一个
 *   5. 超过 MAX_SKIP 次仍无有效 token → 抛出错误
 *
 * @param {string} tenantId - 租户ID
 * @returns {Promise<string>} 有效的 token
 */
export async function acquireToken(tenantId) {
    const key = getPoolKey(tenantId);
    let skipped = 0;

    while (skipped < MAX_SKIP) {
        let token;
        try {
            token = await redisClient.lpop(key);
        } catch (e) {
            throw new Error(`[TokenPool] Redis LPOP 失败: ${e.message}`);
        }

        if (!token) {
            throw new Error(`[TokenPool] ❌ 租户 ${tenantId} 的 token 池已空，请先运行 batchRegister`);
        }

        if (isTokenValid(token)) {
            // 有效：推回队尾，实现轮询复用
            await redisClient.rpush(key, token);
            return token;
        }

        // 过期：丢弃，不推回
        skipped++;
        console.warn(`[TokenPool] 跳过过期 token（第 ${skipped} 个），继续获取...`);
    }

    throw new Error(`[TokenPool] ❌ 连续跳过 ${MAX_SKIP} 个过期 token，池内 token 全部失效，请重新注册`);
}

/**
 * 查询 token 池当前数量
 * @param {string} tenantId
 * @returns {Promise<number>}
 */
export async function getPoolSize(tenantId) {
    const key = getPoolKey(tenantId);
    try {
        const size = await redisClient.llen(key);
        console.log(`[TokenPool] 租户 ${tenantId} 当前 token 池大小: ${size}`);
        return size;
    } catch (e) {
        console.error(`[TokenPool] 查询池大小失败: ${e.message}`);
        return 0;
    }
}

/**
 * 清空指定租户的 token 池
 * @param {string} tenantId
 * @returns {Promise<void>}
 */
export async function clearPool(tenantId) {
    const key = getPoolKey(tenantId);
    await redisClient.del(key);
    console.log(`[TokenPool] 🗑️ 已清空租户 ${tenantId} 的 token 池`);
}

/**
 * 关闭 Redis 连接（在 teardown 中调用）
 */
export function closeRedis() {
    redisClient.close();
}
