/**
 * 纯前台充值压测脚本
 *
 * 特性：
 *   - 从 Redis token 池获取 token（轮询复用，支持分布式）
 *   - 只走前台充值，不做后台兜底
 *   - 充值通道按 VU 编号取模隔离，避免通道竞争
 *   - 自定义业务指标（recharge_success_rate / recharge_duration）
 *   - 思考时间模拟真实用户行为
 *   - 5套预设压测方案，通过 -e SCENARIO= 切换
 *   - 支持多租户并行压测，通过 -e TENANTS=3001,3002 指定
 *
 * 使用方法：
 *
 *   # 冒烟测试（验证脚本）
 *   k6 run -e TENANT_ID=3001 -e SCENARIO=smoke frontendOnlyRecharge.test.js
 *
 *   # 基准测试
 *   k6 run -e TENANT_ID=3001 -e SCENARIO=baseline frontendOnlyRecharge.test.js
 *
 *   # 负载测试（主力）
 *   k6 run -e TENANT_ID=3001 -e SCENARIO=load frontendOnlyRecharge.test.js
 *
 *   # 压力测试（找极限）
 *   k6 run -e TENANT_ID=3001 -e SCENARIO=stress frontendOnlyRecharge.test.js
 *
 *   # 尖刺测试（模拟活动开始瞬间）
 *   k6 run -e TENANT_ID=3001 -e SCENARIO=spike frontendOnlyRecharge.test.js
 *
 *   # 多租户并行
 *   k6 run -e TENANTS=3001,3002,3003 -e SCENARIO=load frontendOnlyRecharge.test.js
 */

import { sleep, check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { acquireToken, getPoolSize, closeRedis } from '../../../libs/redis/tokenPool.js';
import { getRechargeCategoryList, depositRecharge } from './frontendRechargeApi.js';
import { getConfigRechargeAmount } from './rechargeService.js';
import { getRechargeOrderPageList, manualAuditRechargeOrder,
         getLocalRechargeOrderPageList, manualAuditLocalRechargeOrder } from './backendRechargeApi.js';
import { submitCertificate } from './frontendRechargeApi.js';

// ============================================================
// 自定义业务指标
// ============================================================
const rechargeSuccessCount  = new Counter('recharge_success_total');   // 充值成功总次数
const rechargeFailCount     = new Counter('recharge_fail_total');       // 充值失败总次数
const rechargeSuccessRate   = new Rate('recharge_success_rate');        // 充值成功率
const rechargeDuration      = new Trend('recharge_duration_ms', true);  // 充值耗时（ms）
const tokenExpiredCount     = new Counter('token_expired_total');       // 过期token跳过次数

// ============================================================
// 压测方案配置
// ============================================================
const SCENARIOS_CONFIG = {
    // 方案1：冒烟测试 - 验证脚本本身无误
    smoke: {
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 1,
        maxDuration: '2m'
    },

    // 方案2：基准测试 - 摸清正常负载下的性能基线
    baseline: {
        executor: 'constant-vus',
        vus: 10,
        duration: '5m'
    },

    // 方案3：负载测试 - 模拟真实业务高峰（阶梯爬坡）
    // 0→50VU(2min) → 保持50VU(5min) → 50→100VU(2min) → 保持100VU(10min) → 归零
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '2m', target: 50  },
            { duration: '5m', target: 50  },
            { duration: '2m', target: 100 },
            { duration: '10m', target: 100 },
            { duration: '1m', target: 0   }
        ],
        gracefulRampDown: '30s'
    },

    // 方案4：压力测试 - 持续加压找系统极限
    // 0→200VU(5min) → 保持200VU(10min) → 200→500VU(5min) → 保持500VU(10min) → 归零
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '5m',  target: 200 },
            { duration: '10m', target: 200 },
            { duration: '5m',  target: 500 },
            { duration: '10m', target: 500 },
            { duration: '2m',  target: 0   }
        ],
        gracefulRampDown: '60s'
    },

    // 方案5：尖刺测试 - 模拟活动开始瞬间流量洪峰
    // 0→500VU(30s) → 保持500VU(1min) → 归零(30s)
    spike: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 500 },
            { duration: '1m',  target: 500 },
            { duration: '30s', target: 0   }
        ],
        gracefulRampDown: '10s'
    }
};

// ============================================================
// 动态构建 options（支持多租户并行）
// ============================================================
function buildOptions() {
    const scenarioName = __ENV.SCENARIO || 'load';
    const scenarioCfg  = SCENARIOS_CONFIG[scenarioName] || SCENARIOS_CONFIG.load;
    const tenantsStr   = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants      = tenantsStr.split(',').map(t => t.trim());

    const scenarios = {};

    if (tenants.length === 1) {
        // 单租户
        scenarios['recharge'] = {
            ...scenarioCfg,
            env: { TENANT_ID: tenants[0] },
            tags: { tenant: tenants[0], scenario: scenarioName }
        };
    } else {
        // 多租户并行：每个租户独立 scenario
        for (const tenantId of tenants) {
            scenarios[`recharge_${tenantId}`] = {
                ...scenarioCfg,
                env: { TENANT_ID: tenantId },
                tags: { tenant: tenantId, scenario: scenarioName }
            };
        }
    }

    return {
        scenarios,
        thresholds: {
            // HTTP 层：95% 请求在 5s 内完成
            http_req_duration: ['p(95)<5000'],
            // 业务层：充值成功率 > 80%
            recharge_success_rate: ['rate>0.8'],
            // 失败次数告警（可根据实际调整）
            recharge_fail_total: ['count<100']
        },
        tags: {
            test_type: 'frontend_recharge',
            scenario: __ENV.SCENARIO || 'load'
        }
    };
}

export const options = buildOptions();

// ============================================================
// Setup：管理员登录（用于审核充值订单）
// ============================================================
export function setup() {
    const tenantsStr = __ENV.TENANTS || __ENV.TENANT_ID || '3004';
    const tenants    = tenantsStr.split(',').map(t => t.trim());

    const adminTokens = {};

    for (const tenantId of tenants) {
        console.log(`[Setup] 租户 ${tenantId} 管理员登录...`);

        // 检查 token 池
        // 注意：setup 是同步的，getPoolSize 是 async，这里用 console 提示
        console.log(`[Setup] ⚠️ 请确保已运行 batchRegister.test.js 预先注入 token`);

        const adminToken = tenantAdminLogin(tenantId);
        if (!adminToken) {
            throw new Error(`[Setup] ❌ 租户 ${tenantId} 管理员登录失败`);
        }

        adminTokens[tenantId] = adminToken;
        console.log(`[Setup] ✅ 租户 ${tenantId} 管理员登录成功`);
    }

    return { adminTokens };
}

// ============================================================
// 纯前台充值（不含后台兜底）
// 充值通道按 VU 编号取模隔离，避免高并发通道竞争
// ============================================================

/**
 * 执行纯前台充值
 * @param {string} userToken  - 用户 token
 * @param {string} adminToken - 管理员 token（用于审核）
 * @param {string} tenantId   - 租户ID
 * @returns {{ success: boolean, amount: number, message: string }}
 */
function frontendOnlyRecharge(userToken, adminToken, tenantId) {
    const envConfig   = getEnvByTenantId(tenantId);
    const targetAmount = getConfigRechargeAmount();

    // 获取充值通道列表
    const categories = getRechargeCategoryList(userToken);
    if (!categories || categories.length === 0) {
        return { success: false, amount: 0, message: '获取充值通道失败' };
    }

    // 排序：优先三方通道，LocalEWallet 排后
    categories.sort((a, b) => {
        if (a.rechargeType === 'LocalEWallet' && b.rechargeType !== 'LocalEWallet') return 1;
        if (a.rechargeType !== 'LocalEWallet' && b.rechargeType === 'LocalEWallet') return -1;
        return 0;
    });

    // ⭐ 充值通道隔离：按 VU 编号取模，每个 VU 固定打一个通道
    // 避免高并发下多 VU 同时打同一通道触发频率限制
    const vuIndex     = (__VU - 1) % categories.length;
    const category    = categories[vuIndex];
    const categoryId  = category.id;
    const rechargeType = category.rechargeType;
    const name        = category.name;

    let minAmt = category.minAmount || 100;
    let maxAmt = category.maxAmount || 100000;
    if (rechargeType !== 'LocalEWallet') {
        minAmt = Math.max(minAmt, 1000);
    }
    const amount = Math.min(targetAmount, Math.max(minAmt, Math.min(maxAmt, targetAmount)));

    console.log(`[FrontOnlyRecharge] VU${__VU} 使用通道[${vuIndex}]: ${name}(${rechargeType}), 金额: ${amount}`);

    const payload = { rechargeCategoryId: categoryId, amount };
    if (rechargeType === 'LocalEWallet') {
        payload.customerInfo = { accountNo: '467687777878978', holderName: 'tester' };
    }

    const rechargeRequestTime = Date.now();
    const response = depositRecharge(userToken, payload);

    if (!response) {
        return { success: false, amount: 0, message: '充值请求无响应' };
    }

    const code    = response.code;
    const msgCode = response.msgCode;
    const msg     = response.msg || '';
    const isApiSuccess = (code === 0 || msg.includes('code: 10003'));

    if (!isApiSuccess) {
        return { success: false, amount: 0, message: `充值受理失败: code=${code}, msg=${msg}` };
    }

    // LocalEWallet 提交凭证
    if (rechargeType === 'LocalEWallet') {
        const orderNo = response.data && response.data.orderNo;
        const orderCreateTime = response.data && response.data.createTime;
        if (orderNo && orderCreateTime) {
            sleep(1);
            const certResult = submitCertificate(userToken, orderNo, orderCreateTime, '', 2);
            if (!certResult || (certResult.code !== 0 && certResult.msgCode !== 0)) {
                return { success: false, amount: 0, message: '凭证提交失败' };
            }
        }
    }

    // 后台审核轮询（纯前台充值仍需审核，但不做后台充值兜底）
    for (let retry = 0; retry < 5; retry++) {
        sleep(3);

        if (rechargeType === 'LocalEWallet') {
            const startTime = rechargeRequestTime - 60000;
            const endTime   = Date.now() + 60000;
            const orders    = getLocalRechargeOrderPageList(adminToken, null, startTime, endTime);

            if (orders && orders.length > 0) {
                orders.sort((a, b) => b.createTime - a.createTime);
                const target = orders.find(o =>
                    o.amount === amount &&
                    o.createTime >= rechargeRequestTime - 120000 &&
                    (o.rechargeState === 'Wait' || o.rechargeState === 'PendingReview')
                );
                if (target) {
                    const auditRes = manualAuditLocalRechargeOrder(adminToken, target.orderNo, null, target.createTime, amount);
                    if (auditRes) return { success: true, amount, message: `通道: ${name}` };
                }
            }
        } else {
            const orders = getRechargeOrderPageList(adminToken, null, 'ThirdRecharge');
            if (orders && orders.length > 0) {
                orders.sort((a, b) => b.createTime - a.createTime);
                const target = orders.find(o =>
                    o.amount === amount &&
                    o.createTime >= rechargeRequestTime - 120000
                );
                if (target) {
                    const auditRes = manualAuditRechargeOrder(adminToken, target.orderNo, null, target.createTime, amount);
                    if (auditRes) return { success: true, amount, message: `通道: ${name}` };
                }
            }
        }
    }

    // ⭐ 纯前台：审核失败直接返回失败，不切换后台充值
    return { success: false, amount: 0, message: '后台审核超时，不做后台兜底' };
}

// ============================================================
// 主函数
// ============================================================
export default async function (data) {
    const tenantId   = __ENV.TENANT_ID || '3004';
    const adminToken = data.adminTokens[tenantId];

    if (!adminToken) {
        console.error(`[Main] ❌ 未找到租户 ${tenantId} 的管理员 token`);
        return;
    }

    // ⭐ 从 Redis token 池获取用户 token（原子操作，分布式安全）
    let userToken;
    try {
        userToken = await acquireToken(tenantId);
    } catch (e) {
        console.error(`[Main] ❌ 获取 token 失败: ${e.message}`);
        tokenExpiredCount.add(1);
        return;
    }

    // ⭐ 思考时间：模拟真实用户操作间隔（1~3秒）
    sleep(randomIntBetween(1, 3));

    // 执行充值并计时
    const startTime = Date.now();
    const result    = frontendOnlyRecharge(userToken, adminToken, tenantId);
    const elapsed   = Date.now() - startTime;

    // 记录业务指标
    rechargeDuration.add(elapsed);
    rechargeSuccessRate.add(result.success);

    if (result.success) {
        rechargeSuccessCount.add(1);
        console.log(`[Main] ✅ VU${__VU} 充值成功: ${result.amount}, 耗时: ${elapsed}ms`);
    } else {
        rechargeFailCount.add(1);
        console.error(`[Main] ❌ VU${__VU} 充值失败: ${result.message}, 耗时: ${elapsed}ms`);
    }

    check(result, {
        '充值成功': (r) => r.success === true
    });
}

// ============================================================
// Teardown
// ============================================================
export function teardown(data) {
    closeRedis();
    console.log('[Teardown] Redis 连接已关闭');
}
