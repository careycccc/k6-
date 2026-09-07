/**
 * 充值转盘 - 验证层 (重构精简版)
 * 职责: 控制不同条件下的前置充值逻辑，然后委托给执行层处理后续的旋转和验证
 */

import { sleep } from "k6";
import { logger } from "../../../../libs/utils/logger.js";
import {
    rechargeWheelExecTag,
    RechargeCondition,
    randomRegisterUser,
    manualRechargeWithRetry,
    getUserWheelInfo,
    calculateTotalRechargeAmountFromBackend,
    executeSpinAndVerify
} from "./rechargeWheelExecution.js";

export const rechargeWheelValidationTag = "RechargeWheelValidation";
const PRE_RECHARGE_AMOUNT = 100; // 前置"随便充"的小额金额

/**
 * 运行充值转盘的任务
 * 根据充值条件进行不同的前置控制，最终执行并验证
 *
 * @param {object} data - 包含 adminToken 的数据对象
 * @param {number} condition - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {object} 验证结果 { success, message, userId }
 */
export function runRechargeWheelCondition(data, condition) {
    logger.info("[" + rechargeWheelValidationTag + "] ========== 运行充值转盘任务: condition=" + condition + " ==========");

    switch (condition) {
        case RechargeCondition.NO_FIRST_RECHARGE:
            return validateNoFirstRecharge(data);
        case RechargeCondition.NEED_FIRST_RECHARGE:
            return validateNeedFirstRecharge(data);
        case RechargeCondition.SECOND_RECHARGE:
            return validateSecondRecharge(data);
        case RechargeCondition.THIRD_RECHARGE:
            return validateThirdRecharge(data);
        default:
            logger.error("[" + rechargeWheelValidationTag + "] 未知的充值条件: " + condition);
            return { success: false, message: "未知的充值条件", userId: null };
    }
}

/**
 * 条件: 0 无需首充
 * 流程:
 * 1. 注册用户
 * 2. 查总金额 -> 一次性充值
 * 3. 旋转 + 验证
 */
function validateNoFirstRecharge(data) {
    logger.info("[" + rechargeWheelValidationTag + "] --- 验证无需首充 ---");

    const adminToken = data.token;
    const user = randomRegisterUser(data);
    if (!user) return { success: false, message: "用户注册失败", userId: null };

    // 1. 获取总充值金额
    const totalAmount = calculateTotalRechargeAmountFromBackend(adminToken);
    if (totalAmount <= 0) {
        logger.error("[" + rechargeWheelValidationTag + "] 计算得到的总充值金额无效");
        return { success: false, message: "总充值金额无效", userId: user.userId };
    }

    // 2. 主充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行主充值: " + totalAmount);
    const rechargeRes = manualRechargeWithRetry(user.userToken, adminToken, user.userId, totalAmount, 3);
    if (!rechargeRes.success) {
        return { success: false, message: "主充值失败: " + (rechargeRes.msg || ""), userId: user.userId };
    }
    sleep(3);

    // 3. 执行旋转与验证
    const execResult = executeSpinAndVerify(user.userToken);
    return {
        success: execResult.success,
        message: execResult.message,
        userId: user.userId
    };
}

/**
 * 条件: 1 需首充
 * 流程:
 * 1. 注册用户
 * 2. 第一次前置充值 (验证充值后还没旋转次数)
 * 3. 查总金额 -> 第二次主充值
 * 4. 旋转 + 验证
 */
function validateNeedFirstRecharge(data) {
    logger.info("[" + rechargeWheelValidationTag + "] --- 验证需首充 ---");

    const adminToken = data.token;
    const user = randomRegisterUser(data);
    if (!user) return { success: false, message: "用户注册失败", userId: null };

    // 1. 第一次充值 (前置)
    logger.info("[" + rechargeWheelValidationTag + "] 执行第一次充值(前置)");
    const preRes = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes.success) return { success: false, message: "第一次充值失败", userId: user.userId };
    sleep(3);

    // 验证状态: 不该有剩余次数
    const wheelData = getUserWheelInfo(user.userToken);
    if (wheelData && wheelData.silverWheelInfo && wheelData.silverWheelInfo.remainSpinCount > 0) {
        const msg = "需首充验证失败: 只进行了第一次充值却有了旋转次数";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 2. 获取总充值金额
    const totalAmount = calculateTotalRechargeAmountFromBackend(adminToken);

    // 3. 第二次充值 (主充值)
    logger.info("[" + rechargeWheelValidationTag + "] 执行第二次充值(主充值): " + totalAmount);
    const mainRes = manualRechargeWithRetry(user.userToken, adminToken, user.userId, totalAmount, 3);
    if (!mainRes.success) return { success: false, message: "第二次充值失败", userId: user.userId };
    sleep(3);

    // 4. 执行旋转与验证
    const execResult = executeSpinAndVerify(user.userToken);
    return {
        success: execResult.success,
        message: execResult.message,
        userId: user.userId
    };
}

/**
 * 条件: 2 二充
 * 流程:
 * 1. 注册用户
 * 2. 第一次前置充值 (验证转盘未开启)
 * 3. 第二次前置充值 (验证转盘开启)
 * 4. 查总金额 -> 第三次主充值
 * 5. 旋转 + 验证
 */
function validateSecondRecharge(data) {
    logger.info("[" + rechargeWheelValidationTag + "] --- 验证二充 ---");

    const adminToken = data.token;
    const user = randomRegisterUser(data);
    if (!user) return { success: false, message: "用户注册失败", userId: null };

    // 1. 第一次充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行第一次充值");
    const preRes1 = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes1.success) return { success: false, message: "第一次充值失败", userId: user.userId };
    sleep(3);

    // 验证状态: 转盘不应开启
    let wheelData = getUserWheelInfo(user.userToken);
    if (wheelData && wheelData.isOpen) {
        const msg = "二充验证失败: 第一次充值就开启了转盘";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 2. 第二次充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行第二次充值");
    const preRes2 = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes2.success) return { success: false, message: "第二次充值失败", userId: user.userId };
    sleep(3);

    // 验证状态: 转盘应已开启
    wheelData = getUserWheelInfo(user.userToken);
    if (!wheelData || !wheelData.isOpen) {
        const msg = "二充验证失败: 第二次充值后转盘未开启";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 3. 获取总充值金额
    const totalAmount = calculateTotalRechargeAmountFromBackend(adminToken);

    // 4. 第三次充值 (主充值)
    logger.info("[" + rechargeWheelValidationTag + "] 执行第三次充值(主充值): " + totalAmount);
    const mainRes = manualRechargeWithRetry(user.userToken, adminToken, user.userId, totalAmount, 3);
    if (!mainRes.success) return { success: false, message: "第三次充值失败", userId: user.userId };
    sleep(3);

    // 5. 执行旋转与验证
    const execResult = executeSpinAndVerify(user.userToken);
    return {
        success: execResult.success,
        message: execResult.message,
        userId: user.userId
    };
}

/**
 * 条件: 3 三充
 * 流程:
 * 1. 注册用户
 * 2. 第一次前置充值 (验证未开启)
 * 3. 第二次前置充值 (验证未开启)
 * 4. 第三次前置充值 (验证开启)
 * 5. 查总金额 -> 第四次主充值
 * 6. 旋转 + 验证
 */
function validateThirdRecharge(data) {
    logger.info("[" + rechargeWheelValidationTag + "] --- 验证三充 ---");

    const adminToken = data.token;
    const user = randomRegisterUser(data);
    if (!user) return { success: false, message: "用户注册失败", userId: null };

    // 1. 第一次充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行第一次充值");
    const preRes1 = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes1.success) return { success: false, message: "第一次充值失败", userId: user.userId };
    sleep(3);

    let wheelData = getUserWheelInfo(user.userToken);
    if (wheelData && wheelData.isOpen) {
        const msg = "三充验证失败: 第一次充值就开启了转盘";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 2. 第二次充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行第二次充值");
    const preRes2 = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes2.success) return { success: false, message: "第二次充值失败", userId: user.userId };
    sleep(3);

    wheelData = getUserWheelInfo(user.userToken);
    if (wheelData && wheelData.isOpen) {
        const msg = "三充验证失败: 第二次充值就开启了转盘";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 3. 第三次充值
    logger.info("[" + rechargeWheelValidationTag + "] 执行第三次充值");
    const preRes3 = manualRechargeWithRetry(user.userToken, adminToken, user.userId, PRE_RECHARGE_AMOUNT, 3);
    if (!preRes3.success) return { success: false, message: "第三次充值失败", userId: user.userId };
    sleep(3);

    wheelData = getUserWheelInfo(user.userToken);
    if (!wheelData || !wheelData.isOpen) {
        const msg = "三充验证失败: 第三次充值后转盘仍未开启";
        logger.error("[" + rechargeWheelValidationTag + "] " + msg);
        return { success: false, message: msg, userId: user.userId };
    }

    // 4. 获取总充值金额
    const totalAmount = calculateTotalRechargeAmountFromBackend(adminToken);

    // 5. 第四次充值 (主充值)
    logger.info("[" + rechargeWheelValidationTag + "] 执行第四次充值(主充值): " + totalAmount);
    const mainRes = manualRechargeWithRetry(user.userToken, adminToken, user.userId, totalAmount, 3);
    if (!mainRes.success) return { success: false, message: "第四次充值失败", userId: user.userId };
    sleep(3);

    // 6. 执行旋转与验证
    const execResult = executeSpinAndVerify(user.userToken);
    return {
        success: execResult.success,
        message: execResult.message,
        userId: user.userId
    };
}
