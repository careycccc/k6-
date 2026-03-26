/**
 * 充值转盘验证测试
 * 对应 Golang 的充值转盘验证逻辑
 * 支持多租户环境
 */

import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    runRechargeWheelCondition,
    RechargeCondition,
    setRechargeWheelCondition
} from './rechargeWheelValidation.js';

/**
 * 充值转盘验证测试标签
 */
export const rechargeWheelValidationTestTag = 'RechargeWheelValidationTest';

/**
 * 测试结果统计
 */
let testResults = {
    total: 0,
    success: 0,
    failed: 0,
    details: []
};

/**
 * 重置测试结果
 */
function resetTestResults() {
    testResults = {
        total: 0,
        success: 0,
        failed: 0,
        details: []
    };
}

/**
 * 记录测试结果
 * @param {string} testName - 测试名称
 * @param {boolean} success - 是否成功
 * @param {string} message - 消息
 * @param {number} userId - 用户ID
 */
function recordTestResult(testName, success, message, userId) {
    testResults.total++;

    if (success) {
        testResults.success++;
        logger.info(`[${rechargeWheelValidationTestTag}] ✅ ${testName} 成功: userId=${userId}, message=${message}`);
    } else {
        testResults.failed++;
        logger.error(`[${rechargeWheelValidationTestTag}] ❌ ${testName} 失败: userId=${userId}, message=${message}`);
    }

    testResults.details.push({
        testName: testName,
        success: success,
        message: message,
        userId: userId
    });
}

/**
 * 打印测试结果汇总
 */
function printTestSummary() {
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试结果汇总 ==========`);
    logger.info(`[${rechargeWheelValidationTestTag}] 总测试数: ${testResults.total}`);
    logger.info(`[${rechargeWheelValidationTestTag}] 成功: ${testResults.success}`);
    logger.info(`[${rechargeWheelValidationTestTag}] 失败: ${testResults.failed}`);
    logger.info(`[${rechargeWheelValidationTestTag}] 成功率: ${testResults.total > 0 ? ((testResults.success / testResults.total) * 100).toFixed(2) : 0}%`);

    if (testResults.failed > 0) {
        logger.error(`[${rechargeWheelValidationTestTag}] ========== 失败详情 ==========`);
        testResults.details.forEach(detail => {
            if (!detail.success) {
                logger.error(`[${rechargeWheelValidationTestTag}] 测试: ${detail.testName}, 用户ID: ${detail.userId}, 错误: ${detail.message}`);
            }
        });
    }

    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试完成 ==========`);
}

/**
 * 运行充值转盘验证测试
 * @param {object} data - 包含 envConfig 的数据对象
 * @returns {object} 测试结果
 */
export function runRechargeWheelValidationTest(data) {
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 开始充值转盘验证测试 ==========`);

    // 重置测试结果
    resetTestResults();

    const adminData = {
        token: data.token,
        envConfig: ENV_CONFIG
    };

    // 首先设置后台为"无需首充"，防止有默认配置
    logger.info(`[${rechargeWheelValidationTestTag}] 初始化：设置后台为无需首充`);
    if (!setRechargeWheelCondition(adminData.token, RechargeCondition.NO_FIRST_RECHARGE)) {
        logger.error(`[${rechargeWheelValidationTestTag}] 初始化失败：无法设置后台为无需首充`);
        return {
            success: false,
            message: '初始化失败'
        };
    }

    sleep(1);

    // 测试1：无需首充
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试1：无需首充 ==========`);
    const result1 = runRechargeWheelCondition(adminData, RechargeCondition.NO_FIRST_RECHARGE);
    recordTestResult(
        '无需首充',
        result1.success,
        result1.message,
        result1.userId
    );

    sleep(2);

    // 测试2：需首充
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试2：需首充 ==========`);
    const result2 = runRechargeWheelCondition(adminData, RechargeCondition.NEED_FIRST_RECHARGE);
    recordTestResult(
        '需首充',
        result2.success,
        result2.message,
        result2.userId
    );

    sleep(2);

    // 测试3：二充
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试3：二充 ==========`);
    const result3 = runRechargeWheelCondition(adminData, RechargeCondition.SECOND_RECHARGE);
    recordTestResult(
        '二充',
        result3.success,
        result3.message,
        result3.userId
    );

    sleep(2);

    // 测试4：三充
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试4：三充 ==========`);
    const result4 = runRechargeWheelCondition(adminData, RechargeCondition.THIRD_RECHARGE);
    recordTestResult(
        '三充',
        result4.success,
        result4.message,
        result4.userId
    );

    // 打印测试结果汇总
    printTestSummary();

    // 返回测试结果
    const allSuccess = testResults.failed === 0;

    return {
        success: allSuccess,
        message: allSuccess ? '所有测试通过' : '部分测试失败',
        testResults: testResults
    };
}

/**
 * 运行单个充值转盘验证测试
 * @param {object} data - 包含 envConfig 的数据对象
 * @param {number} condition - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {object} 测试结果
 */
export function runSingleRechargeWheelValidationTest(data, condition) {
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 开始单个充值转盘验证测试: condition=${condition} ==========`);

    const adminData = {
        token: data.token,
        envConfig: ENV_CONFIG
    };

    // 首先设置后台为"无需首充"，防止有默认配置
    logger.info(`[${rechargeWheelValidationTestTag}] 初始化：设置后台为无需首充`);
    if (!setRechargeWheelCondition(adminData.token, RechargeCondition.NO_FIRST_RECHARGE)) {
        logger.error(`[${rechargeWheelValidationTestTag}] 初始化失败：无法设置后台为无需首充`);
        return {
            success: false,
            message: '初始化失败'
        };
    }

    sleep(1);

    // 运行测试
    const result = runRechargeWheelCondition(adminData, condition);

    // 记录结果
    const conditionNames = {
        0: '无需首充',
        1: '需首充',
        2: '二充',
        3: '三充'
    };

    const testName = conditionNames[condition] || `未知条件(${condition})`;

    if (result.success) {
        logger.info(`[${rechargeWheelValidationTestTag}] ✅ ${testName} 测试成功: userId=${result.userId}, message=${result.message}`);
    } else {
        logger.error(`[${rechargeWheelValidationTestTag}] ❌ ${testName} 测试失败: userId=${result.userId}, message=${result.message}`);
    }

    return result;
}

/**
 * K6 配置选项
 */
export const options = {
    scenarios: {
        recharge_wheel_validation: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '10m'
        },
    },
};

/**
 * K6 setup 函数
 * 在测试开始前执行一次，初始化配置和登录
 */
export function setup() {
    logger.info(`[${rechargeWheelValidationTestTag}] ========== Setup 开始 ==========`);

    const tenantId = __ENV.TENANT_ID || '3004';
    logger.info(`[${rechargeWheelValidationTestTag}] 目标租户: ${tenantId}`);

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) {
            Object.assign(ENV_CONFIG, targetEnv);
        } else {
            logger.warn(`[${rechargeWheelValidationTestTag}] 未找到租户 ${tenantId} 的配置，使用默认配置。`);
        }
    }

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    logger.info(`[${rechargeWheelValidationTestTag}] ========== Setup 完成 ==========`);
    return { token: adminToken, tenantId };
}

/**
 * K6 测试入口函数
 * 运行充值转盘验证流
 */
export default function (data) {
    // VU中重新应用环境配置
    if (data.tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(data.tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    logger.info(`[${rechargeWheelValidationTestTag}] ==============================`);
    logger.info(`[${rechargeWheelValidationTestTag}] 启动充值转盘自动化验证`);
    logger.info(`[${rechargeWheelValidationTestTag}] 租户: ${data.tenantId}`);
    logger.info(`[${rechargeWheelValidationTestTag}] ==============================`);

    // 如果指定了 CONDITION 环境变量，则只跑单个测试
    if (__ENV.CONDITION !== undefined) {
        const cond = parseInt(__ENV.CONDITION, 10);
        runSingleRechargeWheelValidationTest(data, cond);
    } else {
        // 跑所有条件
        runRechargeWheelValidationTest(data);
    }
}

/**
 * K6 teardown 函数
 */
export function teardown(data) {
    logger.info(`[${rechargeWheelValidationTestTag}] ========== 测试结束 ==========`);
}
