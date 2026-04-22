/**
 * 压测框架核心 - 通用 Token 池压测运行器
 *
 * 提供三个工厂函数，让任意功能的压测只需 3 行即可完成接入：
 *
 *   export const options  = buildLoadOptions({ vus: 100, tag: 'recharge_load' });
 *   export const setup    = buildSetup(TENANT_ID, VU_COUNT);
 *   export default         buildVuHandler((userToken, userId, adminToken, envConfig) => {
 *     // 在这里写业务逻辑...
 *   });
 *
 * ─────────────────────────────────────────────────────────
 * setup 阶段执行顺序（全部失败时 throw → k6 自动终止压测）：
 *   1. Redis 连通性检查
 *   2. 管理员登录（获取 adminToken）
 *   3. 批量取 token（1/5 公式，最小5，最大400）
 *   4. 返回 data 给所有 VU
 *
 * VU 阶段 token 分配策略：
 *   - token 数组由 setup 传入，所有 VU 共享
 *   - 每个 VU 用 (__VU - 1) % tokens.length 取模拿到自己的 token
 *   - 100 VU / 20 token → VU1-20 各拿一个，VU21 从 VU1 的 token 开始轮转
 * ─────────────────────────────────────────────────────────
 */

import { checkRedisConnection, batchAcquireTokens, closeRedis } from '../redis/tokenPool.js';
import { tenantAdminLogin } from '../http/tenantRequest.js';
import { getEnvByTenantId } from '../../config/envconfig.js';
import { hanlderThresholds } from '../../config/thresholds.js';

// ============================================================
// 工厂函数 1：buildLoadOptions
// ============================================================

/**
 * 生成标准 k6 options 对象
 *
 * @param {object}  cfg
 * @param {number}  cfg.vus          - 并发 VU 数（必填）
 * @param {string}  cfg.tag          - 压测标签，用于 thresholds 区分（必填）
 * @param {string}  [cfg.duration='10m']      - 持续执行时长
 * @param {string}  [cfg.scenarioName]        - scenario 名称，默认取 tag
 * @param {object}  [cfg.extraTags]           - 额外的全局 tag（会合并到 options.tags）
 * @returns {object} k6 options
 */
export function buildLoadOptions(cfg) {
    const {
        vus,
        tag,
        duration = '10m',
        scenarioName,
        extraTags = {}
    } = cfg;

    if (!vus || !tag) {
        throw new Error('[LoadTestRunner] buildLoadOptions: vus 和 tag 为必填项');
    }

    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'constant-vus',
                vus: vus,
                duration: duration
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: {
            environment: __ENV.ENVIRONMENT || 'local',
            test_type: 'load',
            tenant: __ENV.TENANT_ID || 'unknown',
            operation: tag,
            ...extraTags
        }
    };
}

// ============================================================
// 工厂函数 2：buildSetup
// ============================================================

/**
 * 生成 setup 函数
 *
 * 返回的函数执行时会依次：
 *   1. 检查 Redis 连接（失败直接 throw → 压测终止）
 *   2. 管理员登录（失败直接 throw）
 *   3. 批量取 token（失败直接 throw）
 *   4. 返回 { tokens, adminToken, envConfig, tenantId } 给所有 VU
 *
 * @param {string} tenantId  - 租户ID（如 '3004'）
 * @param {number} vuCount   - VU 并发数（用于计算 token 批量大小）
 * @returns {Function} k6 setup 函数
 */
export function buildSetup(tenantId, vuCount) {
    return async function setup() {
        const line = '═'.repeat(55);
        console.log(`\n${line}`);
        console.log(`  🚀 压测准备阶段 | 租户: ${tenantId} | VU: ${vuCount}`);
        console.log(`${line}`);

        // ── Step 1: Redis 连通性检查 ──────────────────────────
        console.log(`\n[Setup] Step 1/3 → 检查 Redis 连接...`);
        await checkRedisConnection(tenantId);

        // ── Step 2: 管理员登录 ────────────────────────────────
        console.log(`\n[Setup] Step 2/3 → 管理员登录...`);
        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) {
            throw new Error(
                `[Setup] ❌ 租户 ${tenantId} 管理员登录失败，请检查账号密码配置`
            );
        }
        console.log(`[Setup] ✅ 管理员登录成功`);

        // ── Step 3: 批量取 token ──────────────────────────────
        console.log(`\n[Setup] Step 3/3 → 从 Redis 批量取 token...`);
        const tokens = await batchAcquireTokens(tenantId, vuCount);
        console.log(`[Setup] ✅ 取出 ${tokens.length} 个有效 token`);

        // ── 完成 ──────────────────────────────────────────────
        const envConfig = getEnvByTenantId(tenantId);
        console.log(`\n${line}`);
        console.log(`  ✅ 压测准备完成，即将启动 ${vuCount} 个 VU`);
        console.log(`  📦 Token 池: ${tokens.length} 个可用`);
        console.log(`  🌐 前台地址: ${envConfig.BASE_DESK_URL}`);
        console.log(`${line}\n`);

        return { tokens, adminToken, envConfig, tenantId };
    };
}

// ============================================================
// 工厂函数 3：buildVuHandler
// ============================================================

/**
 * 生成 VU 执行函数（default export）
 *
 * 自动完成 token 分配 —— 每个 VU 从 tokens 数组通过取模获得自己的 token，
 * 支持 VU 数 > token 数的情况（循环复用）。
 *
 * @param {Function} scenarioFn - 业务逻辑函数
 *   签名：(userToken: string, userId: string, adminToken: string, envConfig: object) => void
 *   参数说明：
 *     - userToken  : 当前 VU 分配到的前台用户 token
 *     - userId     : 对应用户的 ID（从 token 池 userId|token 解析）
 *     - adminToken : 管理员 token（setup 阶段登录获取）
 *     - envConfig  : 当前租户的环境配置
 *
 * @returns {Function} k6 default export 函数
 *
 * @example
 * export default buildVuHandler(function(userToken, userId, adminToken, envConfig) {
 *   // 直接写业务逻辑，无需关心 token 来源
 *   frontendRecharge(userToken, adminToken, userId, getConfigRechargeAmount());
 * });
 */
export function buildVuHandler(scenarioFn) {
    return function (data) {
        const { tokens, adminToken, envConfig, tenantId } = data;

        if (!tokens || tokens.length === 0) {
            console.error(`[VU${__VU}] ❌ token 列表为空，跳过本次执行`);
            return;
        }

        // 取模分配：VU1 → index 0，VU2 → index 1，……循环
        const idx = (__VU - 1) % tokens.length;
        const { token: userToken, userId } = tokens[idx];

        console.log(
            `[VU${__VU}] 分配 token #${idx + 1} | userId: ${userId} | 租户: ${tenantId}`
        );

        scenarioFn(userToken, userId, adminToken, envConfig);
    };
}

// ============================================================
// teardown 工具（可选直接导出使用）
// ============================================================

/**
 * 标准 teardown 函数（关闭 Redis 连接）
 * 直接在测试文件中 export { standardTeardown as teardown }
 */
export function standardTeardown(data) {
    console.log(`[Teardown] 压测结束，关闭 Redis 连接`);
    closeRedis();
}

// ============================================================
// 压测场景模板（Scenario Templates）
//
// 用法：将 buildLoadOptions 替换为对应模板函数即可
//
//   模板一：恒定并发   buildConstantLoad({ vus: 50, duration: '10m', tag: 'recharge' })
//   模板二：阶梯递增   buildRampUpLoad({ startVus: 0, targetVus: 100, rampDuration: '5m', holdDuration: '10m', tag: 'recharge' })
//   模板三：峰值冲击   buildSpikeLoad({ baseVus: 10, spikeVus: 200, tag: 'recharge' })
//   模板四：阶梯递减   buildRampDownLoad({ startVus: 100, targetVus: 0, rampDuration: '5m', holdDuration: '10m', tag: 'recharge' })
//   模板五：分阶段混合  buildStagesLoad({ stages: [...], tag: 'recharge' })
// ============================================================

/**
 * 模板一：恒定并发（Constant VUs）
 * N 个 VU 持续跑 X 分钟，适合稳定性/基准测试
 *
 * @example
 * export const options = buildConstantLoad({ vus: 50, duration: '10m', tag: 'recharge' });
 *
 * @param {object} cfg
 * @param {number} cfg.vus           - 并发 VU 数
 * @param {string} [cfg.duration='10m'] - 持续时长
 * @param {string} cfg.tag           - 压测标签
 * @param {string} [cfg.scenarioName]
 * @param {object} [cfg.extraTags]
 */
export function buildConstantLoad({ vus, duration = '10m', tag, scenarioName, extraTags = {} }) {
    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'constant-vus',
                vus,
                duration
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'constant', tenant: __ENV.TENANT_ID || 'unknown', operation: tag, ...extraTags }
    };
}

/**
 * 模板二：阶梯递增（Ramp-Up）
 * 从 startVus 线性爬升到 targetVus，再保持 holdDuration，适合容量探测
 *
 * @example
 * export const options = buildRampUpLoad({ startVus: 0, targetVus: 100, rampDuration: '5m', holdDuration: '10m', tag: 'recharge' });
 *
 * @param {object} cfg
 * @param {number} [cfg.startVus=0]       - 起始 VU 数
 * @param {number} cfg.targetVus          - 目标 VU 数
 * @param {string} [cfg.rampDuration='5m'] - 爬升时长
 * @param {string} [cfg.holdDuration='10m'] - 保持时长
 * @param {string} cfg.tag
 * @param {string} [cfg.scenarioName]
 * @param {object} [cfg.extraTags]
 */
export function buildRampUpLoad({ startVus = 0, targetVus, rampDuration = '5m', holdDuration = '10m', tag, scenarioName, extraTags = {} }) {
    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'ramping-vus',
                startVUs: startVus,
                stages: [
                    { duration: rampDuration, target: targetVus },  // 爬升
                    { duration: holdDuration, target: targetVus }   // 保持
                ]
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'ramp_up', tenant: __ENV.TENANT_ID || 'unknown', operation: tag, ...extraTags }
    };
}

/**
 * 模板三：峰值冲击（Spike）
 * 先跑基准流量，瞬间拉到峰值，再降回基准，适合测试系统抗冲击能力
 *
 * @example
 * export const options = buildSpikeLoad({ baseVus: 10, spikeVus: 200, tag: 'recharge' });
 *
 * @param {object} cfg
 * @param {number} [cfg.baseVus=10]          - 基准 VU 数
 * @param {number} cfg.spikeVus              - 峰值 VU 数
 * @param {string} [cfg.warmDuration='2m']   - 预热时长
 * @param {string} [cfg.spikeDuration='1m']  - 峰值持续时长
 * @param {string} [cfg.coolDuration='3m']   - 冷却时长
 * @param {string} cfg.tag
 * @param {string} [cfg.scenarioName]
 * @param {object} [cfg.extraTags]
 */
export function buildSpikeLoad({ baseVus = 10, spikeVus, warmDuration = '2m', spikeDuration = '1m', coolDuration = '3m', tag, scenarioName, extraTags = {} }) {
    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'ramping-vus',
                startVUs: baseVus,
                stages: [
                    { duration: warmDuration,  target: baseVus  },  // 预热：维持基准
                    { duration: '30s',         target: spikeVus },  // 冲刺：瞬间拉高
                    { duration: spikeDuration, target: spikeVus },  // 峰值：保持
                    { duration: '30s',         target: baseVus  },  // 回落：瞬间降回
                    { duration: coolDuration,  target: baseVus  }   // 冷却：维持基准
                ]
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'spike', tenant: __ENV.TENANT_ID || 'unknown', operation: tag, ...extraTags }
    };
}

/**
 * 模板四：阶梯递减（Ramp-Down）
 * 从高并发线性降到低并发，适合测试系统恢复能力
 *
 * @example
 * export const options = buildRampDownLoad({ startVus: 100, targetVus: 0, rampDuration: '5m', holdDuration: '10m', tag: 'recharge' });
 *
 * @param {object} cfg
 * @param {number} cfg.startVus             - 起始 VU 数（高并发）
 * @param {number} [cfg.targetVus=0]        - 目标 VU 数（低并发）
 * @param {string} [cfg.holdDuration='10m'] - 高并发保持时长
 * @param {string} [cfg.rampDuration='5m']  - 递减时长
 * @param {string} cfg.tag
 * @param {string} [cfg.scenarioName]
 * @param {object} [cfg.extraTags]
 */
export function buildRampDownLoad({ startVus, targetVus = 0, holdDuration = '10m', rampDuration = '5m', tag, scenarioName, extraTags = {} }) {
    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'ramping-vus',
                startVUs: startVus,
                stages: [
                    { duration: holdDuration, target: startVus  },  // 保持高并发
                    { duration: rampDuration, target: targetVus }   // 线性递减
                ]
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'ramp_down', tenant: __ENV.TENANT_ID || 'unknown', operation: tag, ...extraTags }
    };
}

/**
 * 模板五：分阶段混合（Stages）
 * 完全自定义阶段，适合复杂的多阶段压测场景
 *
 * @example
 * export const options = buildStagesLoad({
 *   tag: 'recharge',
 *   stages: [
 *     { duration: '2m', target: 10  },  // 预热
 *     { duration: '5m', target: 50  },  // 爬升
 *     { duration: '10m', target: 50 },  // 稳定
 *     { duration: '2m', target: 100 },  // 冲刺
 *     { duration: '3m', target: 0   },  // 冷却
 *   ]
 * });
 *
 * @param {object}   cfg
 * @param {Array}    cfg.stages        - k6 stages 数组 [{ duration, target }]
 * @param {number}   [cfg.startVus=0]  - 起始 VU 数
 * @param {string}   cfg.tag
 * @param {string}   [cfg.scenarioName]
 * @param {object}   [cfg.extraTags]
 */
export function buildStagesLoad({ stages, startVus = 0, tag, scenarioName, extraTags = {} }) {
    return {
        scenarios: {
            [scenarioName || tag]: {
                executor: 'ramping-vus',
                startVUs: startVus,
                stages
            }
        },
        thresholds: hanlderThresholds(tag),
        tags: { environment: __ENV.ENVIRONMENT || 'local', test_type: 'stages', tenant: __ENV.TENANT_ID || 'unknown', operation: tag, ...extraTags }
    };
}
