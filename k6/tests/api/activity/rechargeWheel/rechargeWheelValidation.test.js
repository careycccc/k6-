/**
 * 充值转盘执行测试 (重构版)-充值转盘，增加数据统计页 
 * 流程:
 * 1. setup 阶段获取后台开关和充值条件(0-3)
 * 2. default 阶段分配 VU 并执行该条件下的完整流程
 * 
 * k6 run -e TENANT_ID=3004 -e VUS=1 -e ITER=1 rechargeWheelValidation.test.js
 * 
 * // 10个vu，每个vu迭代3次，总计15个用户
 * k6 run -e TENANT_ID=3101 -e VUS=2 -e ITER=5 rechargeWheelValidation.test.js    
 * 
 * VUS 表示线程数
 * ITER 表示每个线程迭代次数
 * CONDITION 表示强制指定条件后台的那个充值转盘的需不需要进行首充或者二充（0-3），不指定则查询后台配置
 */


import { sleep } from "k6";
import { logger } from "../../../../libs/utils/logger.js";
import { AdminLogin } from "../../login/adminlogin.test.js";
import { getEnvByTenantId, ENV_CONFIG } from "../../../../config/envconfig.js";
import { getBackendConfig } from "./rechargeWheelExecution.js";
import { runRechargeWheelCondition } from "./rechargeWheelValidation.js";

export const rechargeWheelValidationTestTag = "RechargeWheelValidationTest";

/**
 * K6 配置选项
 * 支持通过环境变量动态控制并发
 */
export const options = {
    scenarios: {
        recharge_wheel_validation: {
            executor: "per-vu-iterations",
            vus: __ENV.VUS ? parseInt(__ENV.VUS, 10) : 3,
            iterations: __ENV.ITER ? parseInt(__ENV.ITER, 10) : 7, // 每VU迭代7次，总计21个用户
            maxDuration: "30m"
        },
    },
};

/**
 * 存放测试结果，供 teardown 打印
 */
let testResults = {
    total: 0,
    success: 0,
    failed: 0,
    details: []
};

/**
 * K6 setup: 在所有 VU 启动前执行一次
 */
export function setup() {
    logger.info("[" + rechargeWheelValidationTestTag + "] ========== Setup 开始 ==========");

    const tenantId = __ENV.TENANT_ID || "3004";
    logger.info("[" + rechargeWheelValidationTestTag + "] 目标租户: " + tenantId);

    if (tenantId !== "3004") {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
        } else {
            logger.warn("[" + rechargeWheelValidationTestTag + "] 未找到租户 " + tenantId + " 的配置，使用默认配置。");
        }
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error("管理员登录失败");
    }

    // 尝试读取环境变量中强制指定的 condition
    let condition = __ENV.CONDITION !== undefined ? parseInt(__ENV.CONDITION, 10) : null;

    // 如果没有强制指定，则查询后台当前配置
    if (condition === null) {
        const backendConf = getBackendConfig(adminToken);
        if (!backendConf) {
            throw new Error("获取后台配置失败，无法确定充值条件");
        }
        if (!backendConf.isOpen) {
            throw new Error("后台未开启充值转盘活动 (RechargeWheelSwitch=0)");
        }
        condition = backendConf.condition;
    }

    logger.info("[" + rechargeWheelValidationTestTag + "] 本次测试确定的充值条件: " + condition);
    logger.info("[" + rechargeWheelValidationTestTag + "] ========== Setup 完成 ==========");

    return { token: adminToken, tenantId: tenantId, condition: condition };
}

/**
 * K6 default: 每个 VU 每次迭代执行的主函数
 * 每次迭代代表一个完整的用户充值->抽奖流程
 */
export default function (data) {
    // VU 中重新应用环境配置
    if (data.tenantId !== "3004") {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    const conditionNames = { 0: "无需首充", 1: "需首充", 2: "二充", 3: "三充" };
    const condName = conditionNames[data.condition] || ("未知(" + data.condition + ")");

    logger.info("[" + rechargeWheelValidationTestTag + "] =============================================");
    logger.info("[" + rechargeWheelValidationTestTag + "] 开始用户级验证流程 -> " + condName);
    logger.info("[" + rechargeWheelValidationTestTag + "] =============================================");

    const result = runRechargeWheelCondition(data, data.condition);

    // K6 运行中无法直接跨 VU 收集数据到外层变量，这里先输出日志
    if (result.success) {
        logger.info("[" + rechargeWheelValidationTestTag + "] ✅ 测试成功: userId=" + result.userId + " | " + result.message);
    } else {
        logger.error("[" + rechargeWheelValidationTestTag + "] ❌ 测试失败: userId=" + result.userId + " | " + result.message);
    }

    // VU 之间避免过于拥挤
    sleep(1);
}

/**
 * K6 teardown 函数
 */
export function teardown(data) {
    logger.info("[" + rechargeWheelValidationTestTag + "] ========== 所有测试结束 ==========");
}
