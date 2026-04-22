/**
 * 前台充值压测脚本（Token 池版 + 多模板支持）
 *
 * ════════════════════════════════════════════════════════════
 * 前置条件
 * ════════════════════════════════════════════════════════════
 *   Redis 中必须已有该租户的 token 池，先运行注册脚本注入 token：
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=10 seed.tokenPool.js
 *
 * ════════════════════════════════════════════════════════════
 * 公共参数（所有模板均支持）
 * ════════════════════════════════════════════════════════════
 *   TENANT_ID      租户ID                        默认: 3004
 *   USER_COUNT     并发VU数 / 最大VU数            默认: 10
 *   LOAD_MODE      压测模板                       默认: constant
 *   REDIS_URL      Redis 地址                     默认: redis://localhost:6379
 *   RECHARGE_MIN   充值金额下限                   默认: 2000
 *   RECHARGE_MAX   充值金额上限                   默认: 5000
 *
 * ════════════════════════════════════════════════════════════
 * 模板一：constant（恒定并发）
 * ════════════════════════════════════════════════════════════
 *   N 个 VU 持续跑 X 分钟，适合稳定性/基准测试
 *
 *   参数：
 *     DURATION     持续时长    默认: 10m
 *
 *   示例：
 *     # 默认：3个VU跑10分钟
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=3 recharge.load.test.js
 *
 *     # 自定义时长：50个VU跑30分钟
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=50 -e LOAD_MODE=constant -e DURATION=30m recharge.load.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 模板二：ramp_up（阶梯递增）
 * ════════════════════════════════════════════════════════════
 *   从 0 线性爬升到 USER_COUNT，再保持，适合容量探测
 *
 *   参数：
 *     RAMP_DURATION  爬升时长    默认: 5m
 *     HOLD_DURATION  保持时长    默认: 10m
 *
 *   示例：
 *     # 5分钟爬升到100VU，再保持10分钟
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=100 -e LOAD_MODE=ramp_up recharge.load.test.js
 *
 *     # 自定义时长：3分钟爬升，20分钟保持
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=100 -e LOAD_MODE=ramp_up -e RAMP_DURATION=3m -e HOLD_DURATION=20m recharge.load.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 模板三：spike（峰值冲击）
 * ════════════════════════════════════════════════════════════
 *   基准 USER_COUNT，瞬间冲到 SPIKE_VUS，再降回，适合抗冲击测试
 *
 *   参数：
 *     SPIKE_VUS      峰值VU数    默认: USER_COUNT × 5
 *     WARM_DURATION  预热时长    默认: 2m
 *     SPIKE_DURATION 峰值持续    默认: 1m
 *     COOL_DURATION  冷却时长    默认: 3m
 *
 *   示例：
 *     # 基准10VU，冲到200VU
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e LOAD_MODE=spike -e SPIKE_VUS=200 recharge.load.test.js
 *
 *     # 自定义各阶段时长
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e LOAD_MODE=spike -e SPIKE_VUS=200 -e WARM_DURATION=3m -e SPIKE_DURATION=2m -e COOL_DURATION=5m recharge.load.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 模板四：ramp_down（阶梯递减）
 * ════════════════════════════════════════════════════════════
 *   从 USER_COUNT 高并发保持后线性降到 0，适合测试系统恢复能力
 *
 *   参数：
 *     HOLD_DURATION  高并发保持时长    默认: 10m
 *     RAMP_DURATION  递减时长          默认: 5m
 *
 *   示例：
 *     # 100VU保持10分钟，再5分钟降到0
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=100 -e LOAD_MODE=ramp_down recharge.load.test.js
 *
 *     # 自定义时长
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=100 -e LOAD_MODE=ramp_down -e HOLD_DURATION=20m -e RAMP_DURATION=10m recharge.load.test.js
 *
 * ════════════════════════════════════════════════════════════
 * 模板五：stages（完全自定义阶段）
 * ════════════════════════════════════════════════════════════
 *   通过 STAGES_JSON 传入完整阶段配置，适合复杂多阶段场景
 *
 *   参数：
 *     STAGES_JSON    JSON字符串，格式: [{"duration":"Xm","target":N}, ...]
 *                    默认: 5m爬升 → 10m保持 → 2m冷却
 *
 *   示例：
 *     k6 run -e TENANT_ID=3004 -e USER_COUNT=50 -e LOAD_MODE=stages \
 *       -e STAGES_JSON='[{"duration":"2m","target":10},{"duration":"5m","target":50},{"duration":"10m","target":50},{"duration":"3m","target":0}]' \
 *       recharge.load.test.js
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
    buildConstantLoad,
    buildRampUpLoad,
    buildSpikeLoad,
    buildRampDownLoad,
    buildStagesLoad,
    buildSetup,
    buildVuHandler,
    standardTeardown
} from '../../libs/load/loadTestRunner.js';
import { frontendRecharge } from '../api/recharge/rechargeService.js';
import { getEnvByTenantId } from '../../config/envconfig.js';

// ============================================================
// 压测参数（通过环境变量传入）
// ============================================================
const TENANT_ID  = __ENV.TENANT_ID  || '3004';
const VU_COUNT   = parseInt(__ENV.USER_COUNT || '10');
const LOAD_MODE  = __ENV.LOAD_MODE  || 'constant';  // constant | ramp_up | spike | ramp_down | stages
const TAG        = 'frontend_recharge_load';

// ============================================================
// 自定义指标
// ============================================================
const rechargeSuccessCounter = new Counter('load_recharge_success');
const rechargeFailCounter    = new Counter('load_recharge_fail');

// ============================================================
// k6 配置：根据 LOAD_MODE 选择压测模板
// ============================================================
function buildOptions() {
    const base = { vus: VU_COUNT, tag: TAG, scenarioName: 'frontend_recharge', extraTags: { tenant: TENANT_ID } };
    switch (LOAD_MODE) {
        case 'ramp_up':
            // 从0爬升到 VU_COUNT，再保持
            // 可通过 RAMP_DURATION / HOLD_DURATION 覆盖
            return buildRampUpLoad({
                ...base,
                startVus: 0,
                targetVus: VU_COUNT,
                rampDuration: __ENV.RAMP_DURATION || '5m',
                holdDuration: __ENV.HOLD_DURATION || '10m'
            });
        case 'spike':
            // 基准 VU_COUNT，峰值 SPIKE_VUS
            return buildSpikeLoad({
                ...base,
                baseVus: VU_COUNT,
                spikeVus: parseInt(__ENV.SPIKE_VUS || VU_COUNT * 5),
                warmDuration:  __ENV.WARM_DURATION  || '2m',
                spikeDuration: __ENV.SPIKE_DURATION || '1m',
                coolDuration:  __ENV.COOL_DURATION  || '3m'
            });
        case 'ramp_down':
            // 从 VU_COUNT 降到 0
            return buildRampDownLoad({
                ...base,
                startVus: VU_COUNT,
                targetVus: 0,
                holdDuration: __ENV.HOLD_DURATION || '10m',
                rampDuration: __ENV.RAMP_DURATION || '5m'
            });
        case 'stages':
            // 完全自定义，通过 STAGES_JSON 传入 JSON 字符串
            // 示例: -e STAGES_JSON='[{"duration":"2m","target":10},{"duration":"5m","target":50}]'
            const stagesJson = __ENV.STAGES_JSON || `[{"duration":"5m","target":${VU_COUNT}},{"duration":"10m","target":${VU_COUNT}},{"duration":"2m","target":0}]`;
            return buildStagesLoad({ ...base, stages: JSON.parse(stagesJson) });
        case 'constant':
        default:
            return buildConstantLoad({
                ...base,
                duration: __ENV.DURATION || '10m'
            });
    }
}

export const options = buildOptions();

// ============================================================
// Setup：Redis 检测 → 管理员登录 → 批量取 token
//   任何步骤失败均会 throw，k6 自动终止压测
// ============================================================
export const setup = buildSetup(TENANT_ID, VU_COUNT);

// ============================================================
// 充值金额配置
// ============================================================
function getRechargeAmount(envConfig) {
    // 支持通过环境变量临时覆盖，否则使用租户配置
    const min = parseInt(__ENV.RECHARGE_MIN) || envConfig.RECHARGE_AMOUNT_MIN || 2000;
    const max = parseInt(__ENV.RECHARGE_MAX) || envConfig.RECHARGE_AMOUNT_MAX || 5000;
    const minCeil  = Math.ceil(min);
    const maxFloor = Math.floor(max);
    return Math.floor(Math.random() * (maxFloor - minCeil + 1)) + minCeil;
}

// ============================================================
// 业务逻辑：前台充值
// ============================================================

/**
 * 单次前台充值场景
 *
 * @param {string} userToken  - 前台用户 token（从 token 池分配）
 * @param {string} userId     - 用户 ID（从 token 池解析）
 * @param {string} adminToken - 管理员 token（用于审核订单）
 * @param {object} envConfig  - 租户环境配置
 */
function rechargeScenario(userToken, userId, adminToken, envConfig) {
    const amount = getRechargeAmount(envConfig);

    console.log(
        `[VU${__VU}] 开始前台充值 | userId: ${userId} | 金额: ${amount}`
    );

    // 随机小延迟（0.5~2s），打散请求，模拟真实用户行为
    sleep(0.5 + Math.random() * 1.5);

    // 仅前台充值（frontendRecharge 内部含：获取通道 → 提交充值 → 审核订单）
    // 注意：adminToken 只用于审核，不会触发后台人工充值
    const result = frontendRecharge(userToken, adminToken, userId, amount);

    if (result && result.success) {
        console.log(
            `[VU${__VU}] ✅ 充值成功 | userId: ${userId} | 金额: ${result.amount} | 通道: ${result.message}`
        );
        rechargeSuccessCounter.add(1, { tenant: TENANT_ID });
    } else {
        console.error(
            `[VU${__VU}] ❌ 充值失败 | userId: ${userId} | 原因: ${result ? result.message : '无响应'}`
        );
        rechargeFailCounter.add(1, { tenant: TENANT_ID });
    }
}

// ============================================================
// VU 执行函数（自动从 token 池分配账号，无需手动处理 token）
// ============================================================
export default buildVuHandler(rechargeScenario);

// ============================================================
// Teardown（关闭 Redis 连接）
// ============================================================
export const teardown = standardTeardown;

// ============================================================
// 自定义摘要报告
// ============================================================
export function handleSummary(data) {
    const success = data.metrics.load_recharge_success?.values?.count || 0;
    const fail    = data.metrics.load_recharge_fail?.values?.count    || 0;
    const total   = success + fail;
    const rate    = total > 0 ? ((success / total) * 100).toFixed(2) : '0.00';

    const p95 = data.metrics[`http_req_duration{type:${TAG}}`]?.values?.['p(95)']?.toFixed(0) || 'N/A';
    const p99 = data.metrics[`http_req_duration{type:${TAG}}`]?.values?.['p(99)']?.toFixed(0) || 'N/A';

    const envConfig = getEnvByTenantId(TENANT_ID);

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃              📊 前台充值压测结果汇总报告                      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🏢 目标租户                      ┃ ${String(TENANT_ID).padEnd(25)} ┃
┃ 🌐 前台地址                      ┃ ${String(envConfig.BASE_DESK_URL || '').substring(0, 25).padEnd(25)} ┃
┃ 👥 并发 VU 数                    ┃ ${String(VU_COUNT).padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ✅ 充值成功次数                  ┃ ${String(success).padEnd(25)} ┃
┃ ❌ 充值失败次数                  ┃ ${String(fail).padEnd(25)} ┃
┃ 📊 充值成功率                    ┃ ${(rate + '%').padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ⚡ P95 响应时间                  ┃ ${(p95 + ' ms').padEnd(25)} ┃
┃ ⚡ P99 响应时间                  ┃ ${(p99 + ' ms').padEnd(25)} ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;
    return { stdout: table };
}
