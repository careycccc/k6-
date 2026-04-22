/**
 * Redis Token 池管理器
 *
 * 架构说明：
 *   - 使用 Redis List 存储 token，key 格式：token_pool:{tenantId}
 *   - 存储格式：{userId}|{token}（方案A，零额外请求获取 userId）
 *   - RPUSH 注入 token，LPOP 原子消费（分布式安全）
 *   - 轮询模式：消费后立即 RPUSH 回队尾，实现循环复用
 *   - 支持 JWT 过期检测，自动跳过失效 token
 *
 * 依赖：k6/x/redis（xk6-redis 扩展，已内置于项目）
 *
 * Redis Key 规范：
 *   token_pool:3001   → 租户3001的token池
 *   token_pool:3002   → 租户3002的token池
 *
 * 批量取 token 公式（batchAcquireTokens）：
 *   基础值 = ceil(vuCount / 5)
 *   - 基础值 < 5          → 取 min(5, poolSize)（小并发全取）
 *   - 基础值 > 400         → 取 400（上限保护）
 *   - 其他                → 取基础值
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

// 批量取出上限 / 最小触发全取阈值
const BATCH_MAX = 400;
const BATCH_MIN = 5;

// ============================================================
// Redis 连通性检查（setup 第一步调用，失败直接中止压测）
// ============================================================

/**
 * 检测 Redis 连接是否正常。
 * 失败时输出友好错误信息并抛出异常 —— k6 在 setup() 中 throw 会
 * 自动中止整个压测，所有 VU 均不会启动。
 *
 * @param {string} tenantId - 租户ID（仅用于日志）
 * @returns {Promise<void>}
 * @throws {Error} Redis 不可达时抛出，携带详细提示
 */
export async function checkRedisConnection(tenantId) {
    try {
        // 用一个实际的 key 操作探测连通性（比 PING 更可靠）
        await redisClient.llen(`${TOKEN_POOL_PREFIX}:health_check`);
        console.log(`[TokenPool] ✅ Redis 连接正常 → ${REDIS_URL}`);
    } catch (e) {
        const line = '─'.repeat(50);
        throw new Error(
            `\n[TokenPool] ❌ Redis 连接失败，压测已终止！\n` +
            `${line}\n` +
            ` 连接地址 : ${REDIS_URL}\n` +
            ` 目标租户 : ${tenantId}\n` +
            ` 错误信息 : ${e.message}\n` +
            `${line}\n` +
            ` 请检查：\n` +
            `   1. Redis 服务是否已启动（redis-server）\n` +
            `   2. 使用自动启动脚本: k6/tests/load/run-seed.bat\n` +
            `      示例: run-seed.bat 3004 flat 10 YOUR_INVITE_CODE\n` +
            `   3. 或手动指定地址: -e REDIS_URL=redis://127.0.0.1:6379\n` +
            `   4. 网络/防火墙是否放行对应端口\n` +
            `${line}`
        );
    }
}

// ============================================================
// 批量取 token（供 setup 调用，一次性预取，避免 VU 阶段频繁访问 Redis）
// ============================================================

/**
 * 根据 VU 数量计算本次应取的 token 数
 * @param {number} vuCount  - 并发 VU 数
 * @param {number} poolSize - 当前池大小
 * @returns {number}
 */
function calcBatchSize(vuCount, poolSize) {
    const base = Math.ceil(vuCount / 5);
    if (base < BATCH_MIN) {
        // 计算值不足5个时，直接尝试全部取出（上限为池大小）
        return Math.min(BATCH_MIN, poolSize);
    }
    // 超过上限时截断到 BATCH_MAX
    return Math.min(base, BATCH_MAX);
}

/**
 * 从 Redis token 池批量取出有效 token（方案A：存储格式 `userId|token`）
 *
 * 策略：
 *   1. 查询池大小，计算本次应取数量（1/5 公式）
 *   2. 循环 LPOP：有效 → 推回队尾 + 加入结果；过期 → 丢弃
 *   3. 达到目标数量或池耗尽时返回
 *   4. 结果为空时抛出错误（setup 中抛出 = 压测终止）
 *
 * @param {string} tenantId - 租户ID
 * @param {number} vuCount  - VU 并发数（用于计算批量大小）
 * @returns {Promise<Array<{userId: string, token: string}>>}
 * @throws {Error} 池为空或全部过期时抛出
 */
export async function batchAcquireTokens(tenantId, vuCount) {
    const key = getPoolKey(tenantId);

    // Step1: 查询池大小
    let poolSize;
    try {
        poolSize = await redisClient.llen(key);
    } catch (e) {
        throw new Error(`[TokenPool] Redis LLEN 失败: ${e.message}`);
    }

    if (poolSize === 0) {
        throw new Error(
            `[TokenPool] ❌ 租户 ${tenantId} 的 token 池为空！\n` +
            `   Key    : ${key}\n` +
            `   请先运行批量注册脚本向 Redis 注入 token，再执行压测。`
        );
    }

    // Step2: 计算取出数量
    const batchSize = calcBatchSize(vuCount, poolSize);
    console.log(
        `[TokenPool] 租户 ${tenantId} | 池大小: ${poolSize} | ` +
        `VU数: ${vuCount} | 计划取出: ${batchSize}`
    );

    // Step3: 循环取 token
    const result = [];
    let skipped = 0;
    // 最多尝试次数 = 目标数量 + 最大跳过数（防无限循环）
    const maxAttempts = Math.min(poolSize, batchSize + MAX_SKIP);

    while (result.length < batchSize && (result.length + skipped) < maxAttempts) {
        let raw;
        try {
            raw = await redisClient.lpop(key);
        } catch (e) {
            throw new Error(`[TokenPool] Redis LPOP 失败: ${e.message}`);
        }

        if (!raw) break; // 池已空

        const parsed = parsePoolEntry(raw);
        if (!parsed) {
            // 格式非法（可能是旧版纯 token 格式），丢弃并警告
            skipped++;
            console.warn(
                `[TokenPool] ⚠️ 条目格式非法（不含 userId），已丢弃。\n` +
                `   原始值: ${raw.substring(0, 40)}...\n` +
                `   旧格式 token 请重新运行注册脚本以注入新格式（userId|token）`
            );
            continue;
        }

        if (!isTokenValid(parsed.token)) {
            // 过期：丢弃，不推回
            skipped++;
            console.warn(`[TokenPool] ⚠️ 丢弃过期 token (userId: ${parsed.userId})`);
            continue;
        }

        // 有效：推回队尾（轮询复用）
        await redisClient.rpush(key, raw);
        result.push(parsed);
    }

    if (result.length === 0) {
        throw new Error(
            `[TokenPool] ❌ 租户 ${tenantId} 未能取出任何有效 token！\n` +
            `   已跳过 ${skipped} 个无效/过期条目\n` +
            `   请重新运行批量注册脚本更新 token`
        );
    }

    if (result.length < batchSize) {
        console.warn(
            `[TokenPool] ⚠️ 租户 ${tenantId} 仅取出 ${result.length} 个 token` +
            `（目标 ${batchSize}），池内有效 token 数量不足`
        );
    } else {
        console.log(`[TokenPool] ✅ 租户 ${tenantId} 成功取出 ${result.length} 个有效 token`);
    }

    return result;
}

// ============================================================
// 存储格式工具：userId|token
// ============================================================

/**
 * 序列化为压测池存储格式
 * @param {string|number} userId
 * @param {string} token
 * @returns {string} `userId|token`
 */
function serializeEntry(userId, token) {
    return `${userId}|${token}`;
}

/**
 * 解析存储格式 `userId|token` → {userId, token}
 * @param {string} raw
 * @returns {{userId: string, token: string}|null}
 *   - 新格式（含 userId）→ {userId, token}
 *   - 旧格式（纯 JWT，无 `|`）→ null（由调用方决定如何处理）
 */
function parsePoolEntry(raw) {
    if (!raw) return null;
    const sep = raw.indexOf('|');
    if (sep === -1) return null; // 旧格式（纯 token 字符串），不含 userId
    return {
        userId: raw.substring(0, sep),
        token: raw.substring(sep + 1)
    };
}

// ============================================================
// JWT 工具函数
// ============================================================

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
 * 【原有接口，保持不变】向 Redis token 池注入纯 token 字符串列表
 *
 * 供现有注册脚本调用，行为与重构前完全一致。
 * 注意：以此方式注入的 token 不含 userId，只能被 acquireToken 单次消费，
 *       无法被压测专用的 batchAcquireTokens 识别（会因格式校验被跳过）。
 *
 * @param {string}   tenantId - 租户ID
 * @param {string[]} tokens   - token 字符串数组
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
 * 【压测专用】向 Redis token 池注入 userId|token 格式条目
 *
 * 仅供压测预热脚本调用，与原有 injectTokens 完全隔离，不影响任何现有代码。
 * 注入后可被 batchAcquireTokens 批量读取，VU 阶段无需额外 API 调用即可拿到 userId。
 *
 * @param {string} tenantId - 租户ID
 * @param {Array<{userId: string|number, token: string}>} entries - 用户列表
 * @returns {Promise<number>} 注入成功数量
 *
 * @example
 * import { injectUserTokens } from '../../libs/redis/tokenPool.js';
 *
 * // 批量注册完成后，将结果写入压测 token 池
 * await injectUserTokens('3004', [
 *   { userId: '10001', token: 'eyJhbGci...' },
 *   { userId: '10002', token: 'eyJhbGci...' },
 * ]);
 */
export async function injectUserTokens(tenantId, entries) {
    const key = getPoolKey(tenantId);
    let count = 0;

    for (const entry of entries) {
        if (!entry || !entry.token || entry.token.trim() === '') continue;
        const userId = String(entry.userId || '');
        if (!userId) {
            console.warn(
                `[TokenPool] ⚠️ injectUserTokens: 跳过缺少 userId 的条目` +
                `（token: ${entry.token.substring(0, 20)}...）`
            );
            continue;
        }
        const raw = serializeEntry(userId, entry.token.trim());
        await redisClient.rpush(key, raw);
        count++;
    }

    console.log(`[TokenPool] ✅ 租户 ${tenantId} 注入 ${count} 个压测 token → Redis key: ${key}`);
    return count;
}

/**
 * 从 Redis token 池原子获取一个有效 token（单次轮询，供单 VU 按需调用）
 *
 * 注意：压测场景推荐使用 batchAcquireTokens 在 setup 阶段批量预取，
 * 此函数适合少量/调试场景。
 *
 * @param {string} tenantId - 租户ID
 * @returns {Promise<{userId: string, token: string}>} 有效的用户信息
 */
export async function acquireToken(tenantId) {
    const key = getPoolKey(tenantId);
    let skipped = 0;

    while (skipped < MAX_SKIP) {
        let raw;
        try {
            raw = await redisClient.lpop(key);
        } catch (e) {
            throw new Error(`[TokenPool] Redis LPOP 失败: ${e.message}`);
        }

        if (!raw) {
            throw new Error(`[TokenPool] ❌ 租户 ${tenantId} 的 token 池已空，请先运行 batchRegister`);
        }

        const parsed = parsePoolEntry(raw);
        if (!parsed) {
            skipped++;
            console.warn(`[TokenPool] ⚠️ 格式非法条目已跳过（第 ${skipped} 个）`);
            continue;
        }

        if (isTokenValid(parsed.token)) {
            // 有效：推回队尾，实现轮询复用
            await redisClient.rpush(key, raw);
            return parsed;
        }

        // 过期：丢弃，不推回
        skipped++;
        console.warn(`[TokenPool] 跳过过期 token（第 ${skipped} 个，userId: ${parsed.userId}）`);
    }

    throw new Error(`[TokenPool] ❌ 连续跳过 ${MAX_SKIP} 个无效 token，池内 token 全部失效，请重新注册`);
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
 * 注意：k6/x/redis 的 Client 在脚本结束时会自动清理，无需手动关闭
 */
export function closeRedis() {
    // k6/x/redis Client 没有 close() 方法，连接会自动释放
    console.log(`[TokenPool] ✅ Redis 连接将在脚本结束时自动释放`);
}
