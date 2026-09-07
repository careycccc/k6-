/**
 * 充值转盘 - 执行层
 * 职责: 后台配置查询、用户注册、充值、转盘旋转、历史验证
 * 不含任何断言/验证逻辑，只负责纯粹的执行动作
 */

import { sleep } from "k6";
import { logger } from "../../../../libs/utils/logger.js";
import { httpClient } from "../../../../libs/http/client.js";
import { hybridRecharge } from "../../recharge/rechargeService.js";
import { phoneRegister, emailRegister } from "../../login/register.test.js";
import { getTimeRandom } from "../../../utils/utils.js";
import { generateRandomPhone, generateRandomEmail } from "../../../utils/accountGeneratorFaker.js";
import { getEnvByTenantId } from "../../../../config/envconfig.js";

export const rechargeWheelExecTag = "RechargeWheelExec";

// ============================================================
// 常量定义
// ============================================================

/** 充值条件枚举 */
export const RechargeCondition = {
    NO_FIRST_RECHARGE: 0,   // 无需首充
    NEED_FIRST_RECHARGE: 1, // 需首充
    SECOND_RECHARGE: 2,     // 二充
    THIRD_RECHARGE: 3       // 三充
};

/** 转盘类型枚举 */
export const WheelType = {
    SILVER: 1,   // 白银
    GOLD: 2,     // 黄金
    DIAMOND: 3,  // 钻石
    SPECIAL: 4   // 特殊
};

const WHEEL_NAMES = { 1: "白银", 2: "黄金", 3: "钻石", 4: "特殊" };

// ============================================================
// API 层
// ============================================================

/**
 * 查询后台充值转盘配置
 * 接口: /api/RechargeWheel/GetConfig
 * 用于获取: 活动是否开启 + 当前充值条件(0-3)
 *
 * @param {string} adminToken
 * @returns {{ isOpen: boolean, condition: number } | null}
 */
export function getBackendConfig(adminToken) {
    logger.info("[" + rechargeWheelExecTag + "] 查询后台充值转盘配置");

    const api = "/api/RechargeWheel/GetConfig";
    const timeData = getTimeRandom();
    const payload = {
        random: timeData.random,
        language: timeData.language,
        signature: "",
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(
            api, payload,
            { params: { tags: { type: rechargeWheelExecTag, name: "GetConfig" } } },
            false
        );

        const body = _parseBody(response);
        if (!body || body.msgCode !== 0) {
            logger.error("[" + rechargeWheelExecTag + "] 查询后台配置失败: " + (body && body.msg ? body.msg : "未知错误"));
            return null;
        }

        const data = body.data;
        const isOpen = data.rechargeWheelSwitch && data.rechargeWheelSwitch.value1 === "1";
        const rawCondition = data.rechargeWheelNeedFirstRechargeSwitch && data.rechargeWheelNeedFirstRechargeSwitch.value1;
        const condition = parseInt(rawCondition || "0", 10);

        logger.info("[" + rechargeWheelExecTag + "] 后台配置: 开关=" + (isOpen ? "开启" : "关闭") + ", 充值条件=" + condition + "(" + _conditionName(condition) + ")");
        return { isOpen: isOpen, condition: condition };

    } catch (e) {
        logger.error("[" + rechargeWheelExecTag + "] 查询后台配置异常: " + e.message);
        return null;
    }
}

/**
 * 获取用户充值转盘信息（前台）
 * 接口: /api/Activity/GetUserRechargeWheelInfo
 *
 * @param {string} userToken
 * @returns {object | null}  data 对象: isOpen / silverWheelInfo / goldWheelInfo / diamondWheelInfo / specialWheelInfo
 */
export function getUserWheelInfo(userToken) {
    logger.info("[" + rechargeWheelExecTag + "] 获取用户转盘信息");

    const api = "/api/Activity/GetUserRechargeWheelInfo";
    const timeData = getTimeRandom();
    const payload = {
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api, payload,
            { params: { tags: { type: rechargeWheelExecTag, name: "GetUserWheelInfo" } } },
            true  // isDesk = true（前台接口）
        );

        const body = _parseBody(response);
        if (!body || body.msgCode !== 0) {
            logger.error("[" + rechargeWheelExecTag + "] 获取用户转盘信息失败: " + (body && body.msg ? body.msg : "未知错误"));
            return null;
        }

        const d = body.data;
        logger.info(
            "[" + rechargeWheelExecTag + "] 转盘状态: isOpen=" + d.isOpen +
            ", 白银剩余=" + (d.silverWheelInfo ? d.silverWheelInfo.remainSpinCount : 0) +
            ", 黄金剩余=" + (d.goldWheelInfo ? d.goldWheelInfo.remainSpinCount : 0) +
            ", 钻石剩余=" + (d.diamondWheelInfo ? d.diamondWheelInfo.remainSpinCount : 0) +
            ", 特殊剩余=" + (d.specialWheelInfo ? d.specialWheelInfo.remainSpinCount : 0)
        );
        return d;

    } catch (e) {
        logger.error("[" + rechargeWheelExecTag + "] 获取用户转盘信息异常: " + e.message);
        return null;
    }
}

/**
 * 旋转指定转盘
 * 接口: /api/Activity/SpinRechargeWheel
 *
 * @param {string} userToken
 * @param {number} wheelType  1=白银, 2=黄金, 3=钻石, 4=特殊
 * @returns {{ success, rechargeWheelType, rewardType, rewardAmount, id } | { success: false, msg }}
 *   rewardType=1 -> 金额奖励（rewardAmount=奖励金额）
 *   rewardType!=1 -> 转盘次数奖励（rewardAmount=获得次数）
 */
export function spinWheel(userToken, wheelType) {
    logger.info("[" + rechargeWheelExecTag + "] 旋转 " + (WHEEL_NAMES[wheelType] || wheelType) + " 转盘");

    const api = "/api/Activity/SpinRechargeWheel";
    const timeData = getTimeRandom();
    const payload = {
        rechargeWheelType: wheelType,
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api, payload,
            { params: { tags: { type: rechargeWheelExecTag, name: "SpinWheel" } } },
            true  // isDesk = true（前台接口）
        );

        const body = _parseBody(response);
        if (!body || body.msgCode !== 0) {
            logger.error("[" + rechargeWheelExecTag + "] 旋转失败: " + (body && body.msg ? body.msg : "未知错误"));
            return { success: false, msg: body && body.msg ? body.msg : "未知错误" };
        }

        const result = {
            success: true,
            rechargeWheelType: wheelType,
            id: body.data.id,
            rewardType: body.data.rewardType,
            rewardAmount: body.data.rewardAmount
        };

        const rewardDesc = result.rewardType === 1
            ? ("金额奖励 " + result.rewardAmount)
            : ("转盘次数 " + result.rewardAmount + " 次 (rewardType=" + result.rewardType + ")");
        logger.info("[" + rechargeWheelExecTag + "] 旋转结果: " + WHEEL_NAMES[wheelType] + "转盘 -> " + rewardDesc);

        return result;

    } catch (e) {
        logger.error("[" + rechargeWheelExecTag + "] 旋转异常: " + e.message);
        return { success: false, msg: e.message };
    }
}

/**
 * 查询旋转历史记录（前台）
 * 接口: /api/Activity/GetPageListRechargeWheelRewardRecord
 *
 * @param {string} userToken
 * @param {number} pageSize  查询条数（默认20）
 * @returns {Array | null}
 */
export function getSpinHistory(userToken, pageSize) {
    pageSize = pageSize || 20;
    logger.info("[" + rechargeWheelExecTag + "] 查询旋转历史记录 (pageSize=" + pageSize + ")");

    const api = "/api/Activity/GetPageListRechargeWheelRewardRecord";
    const timeData = getTimeRandom();
    const payload = {
        pageNo: 1,
        pageSize: pageSize,
        language: timeData.language,
        random: timeData.random,
        signature: "",
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api, payload,
            { params: { tags: { type: rechargeWheelExecTag, name: "GetSpinHistory" } } },
            true  // isDesk = true（前台接口）
        );

        const body = _parseBody(response);
        if (!body || body.msgCode !== 0) {
            logger.error("[" + rechargeWheelExecTag + "] 查询历史失败: " + (body && body.msg ? body.msg : "未知错误"));
            return null;
        }

        const list = (body.data && body.data.list) ? body.data.list : [];
        logger.info("[" + rechargeWheelExecTag + "] 获取到 " + list.length + " 条历史记录");
        return list;

    } catch (e) {
        logger.error("[" + rechargeWheelExecTag + "] 查询历史异常: " + e.message);
        return null;
    }
}

// ============================================================
// 辅助计算层
// ============================================================

/**
 * 从 taskList / taskConfig 中取中间档位的充值金额
 *   0个 -> 0（跳过该转盘）
 *   1个 -> index 0
 *   2个 -> index 0  (Math.floor((2-1)/2) = 0)
 *   3个 -> index 1  (中间值)
 *   4个 -> index 1  (中间偏左)
 *
 * @param {Array} taskList
 * @returns {number}
 */
function getMiddleTaskAmount(taskList) {
    if (!taskList || taskList.length === 0) return 0;
    const idx = Math.floor((taskList.length - 1) / 2);
    return parseFloat(taskList[idx].rechargeAmount) || 0;
}

/**
 * 从后台逐一查询4个转盘的 taskConfig，取各自中间档位金额，累加为总充值金额
 * 接口: /api/RechargeWheel/Get (后台)
 *
 * @param {string} adminToken
 * @returns {number} 总金额
 */
export function calculateTotalRechargeAmountFromBackend(adminToken) {
    logger.info("[" + rechargeWheelExecTag + "] 计算4个转盘的总充值金额");

    const api = "/api/RechargeWheel/Get";
    let total = 0;
    const breakdown = {};
    const wheelTypes = [WheelType.SILVER, WheelType.GOLD, WheelType.DIAMOND, WheelType.SPECIAL];

    for (let i = 0; i < wheelTypes.length; i++) {
        const wType = wheelTypes[i];
        const wName = WHEEL_NAMES[wType];
        try {
            const timeData = getTimeRandom();
            httpClient.setAuthToken(adminToken);
            const resp = httpClient.post(
                api,
                {
                    rechargeWheelType: wType,
                    random: timeData.random,
                    language: timeData.language,
                    signature: "",
                    timestamp: timeData.timestamp
                },
                { params: { tags: { type: rechargeWheelExecTag, name: "GetWheelConfig" } } },
                false  // 后台接口
            );

            const body = _parseBody(resp);
            if (body && body.msgCode === 0) {
                const taskConfig = (body.data && body.data.taskConfig) ? body.data.taskConfig : [];
                const amount = getMiddleTaskAmount(taskConfig);
                breakdown[wName] = amount;
                total += amount;
            } else {
                logger.warn("[" + rechargeWheelExecTag + "] 转盘type=" + wType + " 配置获取失败，跳过");
                breakdown[wName] = 0;
            }
        } catch (e) {
            logger.error("[" + rechargeWheelExecTag + "] 查询转盘type=" + wType + " 异常: " + e.message);
            breakdown[wName] = 0;
        }
        sleep(0.2);
    }

    logger.info(
        "[" + rechargeWheelExecTag + "] 充值金额明细: 白银=" + breakdown["白银"] +
        ", 黄金=" + breakdown["黄金"] +
        ", 钻石=" + breakdown["钻石"] +
        ", 特殊=" + breakdown["特殊"] +
        ", 合计=" + total
    );
    return total;
}

/**
 * 加权随机分配旋转次数
 * 分布: 1次(10%), 2次(20%), 3次(30%), 4次(40%)
 *
 * @returns {number} 1 ~ 4
 */
export function assignSpinCount() {
    const r = Math.random() * 10;
    let count;
    if (r < 1) count = 1;
    else if (r < 3) count = 2;
    else if (r < 6) count = 3;
    else count = 4;
    logger.info("[" + rechargeWheelExecTag + "] 分配旋转次数: " + count);
    return count;
}

/**
 * 获取有剩余次数的转盘列表（固定顺序: 白银→黄金→钻石→特殊）
 *
 * @param {object} wheelData  getUserWheelInfo 返回的 data 对象
 * @returns {Array<{ type: number, name: string, remainSpinCount: number }>}
 */
export function getAvailableWheels(wheelData) {
    const wheelDefs = [
        { type: WheelType.SILVER,  name: "白银",  info: wheelData && wheelData.silverWheelInfo },
        { type: WheelType.GOLD,    name: "黄金",  info: wheelData && wheelData.goldWheelInfo },
        { type: WheelType.DIAMOND, name: "钻石",  info: wheelData && wheelData.diamondWheelInfo },
        { type: WheelType.SPECIAL, name: "特殊",  info: wheelData && wheelData.specialWheelInfo }
    ];

    return wheelDefs
        .filter(function(w) { return w.info && (w.info.remainSpinCount || 0) > 0; })
        .map(function(w) { return { type: w.type, name: w.name, remainSpinCount: w.info.remainSpinCount }; });
}

// ============================================================
// 执行层
// ============================================================

/**
 * 随机注册用户（手机号优先，失败则邮箱）
 *
 * @param {object} data
 * @returns {{ userId: number, userToken: string } | null}
 */
export function randomRegisterUser(data) {
    logger.info("[" + rechargeWheelExecTag + "] 注册随机用户");

    const tenantId = __ENV.TENANT || __ENV.TENANT_ID || "3004";
    const env = getEnvByTenantId(tenantId);
    const countryCode = (env && env.COUNTRY_CODE) ? env.COUNTRY_CODE : "91";
    const phone = generateRandomPhone(countryCode);

    let reg = phoneRegister(phone, data);
    if (!reg) {
        logger.warn("[" + rechargeWheelExecTag + "] 手机号注册失败，尝试邮箱注册");
        reg = emailRegister(generateRandomEmail(), data);
    }

    if (!reg) {
        logger.error("[" + rechargeWheelExecTag + "] 用户注册失败");
        return null;
    }

    const userId = (reg.data && reg.data.userId) || (reg.data && reg.data.userID);
    const userToken = (reg.data && reg.data.token) ||
        (reg.headers && reg.headers.Authorization && reg.headers.Authorization.replace("Bearer ", ""));

    if (!userId || !userToken) {
        logger.error("[" + rechargeWheelExecTag + "] 注册成功但无法提取 userId/token");
        return null;
    }

    logger.info("[" + rechargeWheelExecTag + "] 用户注册成功: userId=" + userId);
    return { userId: userId, userToken: userToken };
}

/**
 * 带重试的人工充值（遇到频率限制自动等待3秒重试）
 *
 * @param {string} adminToken
 * @param {number} userId
 * @param {number} amount
 * @param {number} maxRetries  默认3次
 * @returns {object} 充值结果
 */
export function manualRechargeWithRetry(userToken, adminToken, userId, amount, maxRetries) {
    maxRetries = maxRetries || 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = hybridRecharge({
            userToken: userToken,
            adminToken: adminToken,
            userId: userId,
            amount: amount,
            frontendFirst: true,
            remark: "Recharge Wheel"
        });

        if (result && result.success) return result;

        const msg = result && result.message ? result.message : "";
        const isTooFrequent = msg.indexOf("Too frequent") >= 0 || msg.indexOf("please try again later") >= 0 || msg.indexOf("频繁") >= 0;

        if (isTooFrequent && attempt < maxRetries) {
            logger.warn("[" + rechargeWheelExecTag + "] 充值频率限制，等待3秒重试 (" + attempt + "/" + maxRetries + ")");
            sleep(3);
            continue;
        }

        logger.error("[" + rechargeWheelExecTag + "] 充值失败: " + (msg || "未知错误") + " (尝试" + attempt + "/" + maxRetries + ")");
        return result;
    }
    return { success: false, msg: "已达到最大重试次数" };
}

/**
 * 执行旋转流程并验证历史
 * 调用前保证: 主充值已完成并已等待3秒
 *
 * 流程:
 *  1. 查询用户转盘状态 (GetUserRechargeWheelInfo)
 *  2. 获取有次数的转盘列表（白银→黄金→钻石→特殊）
 *  3. 加权随机分配旋转次数（1/2/3/4次）
 *  4. 按顺序循环旋转，每次间隔2秒
 *  5. 查询历史并逐条验证匹配
 *
 * @param {string} userToken
 * @returns {{ success, message, spinCount, spinResults, verifyResult }}
 */
export function executeSpinAndVerify(userToken) {
    logger.info("[" + rechargeWheelExecTag + "] ===== 开始旋转流程 =====");

    // Step 1: 查询转盘状态
    const wheelData = getUserWheelInfo(userToken);
    if (!wheelData) {
        return { success: false, message: "获取转盘信息失败", spinCount: 0, spinResults: [], verifyResult: null };
    }
    if (!wheelData.isOpen) {
        return { success: false, message: "充值后转盘未开启(isOpen=false)", spinCount: 0, spinResults: [], verifyResult: null };
    }

    // Step 2: 获取有次数的转盘
    const availableWheels = getAvailableWheels(wheelData);
    if (availableWheels.length === 0) {
        return { success: false, message: "充值后没有可旋转的转盘（所有 remainSpinCount=0）", spinCount: 0, spinResults: [], verifyResult: null };
    }
    const wheelsDesc = availableWheels.map(function(w) { return w.name + "(剩余" + w.remainSpinCount + "次)"; }).join(", ");
    logger.info("[" + rechargeWheelExecTag + "] 可用转盘: " + wheelsDesc);

    // Step 3: 分配旋转次数
    const spinCount = assignSpinCount();
    logger.info("[" + rechargeWheelExecTag + "] 本次旋转次数: " + spinCount);

    // Step 4: 循环旋转
    const spinResults = [];
    for (let i = 0; i < spinCount; i++) {
        const wheel = availableWheels[i % availableWheels.length];
        logger.info("[" + rechargeWheelExecTag + "] 第" + (i + 1) + "/" + spinCount + "次旋转 -> " + wheel.name + "转盘");

        const result = spinWheel(userToken, wheel.type);
        if (result && result.success) {
            spinResults.push(result);
        } else {
            const errMsg = result && result.msg ? result.msg : "未知";
            logger.error("[" + rechargeWheelExecTag + "] 第" + (i + 1) + "次旋转失败: " + errMsg);
            spinResults.push({ success: false, rechargeWheelType: wheel.type, msg: errMsg });
        }

        // 旋转间隔2秒（最后一次不等待）
        if (i < spinCount - 1) {
            sleep(2);
        }
    }

    // Step 5: 验证历史
    const successfulSpins = spinResults.filter(function(r) { return r.success; });
    const verifyResult = verifySpinHistory(userToken, successfulSpins);

    const failedSpins = spinResults.filter(function(r) { return !r.success; }).length;
    const allOk = verifyResult.failed === 0 && failedSpins === 0;

    logger.info(
        "[" + rechargeWheelExecTag + "] ===== 旋转流程完成: 旋转=" + spinCount + "次" +
        ", 历史验证通过=" + verifyResult.passed + "/" + verifyResult.total + " ====="
    );

    return {
        success: allOk,
        message: allOk
            ? "旋转及历史验证全部通过"
            : ("失败: 旋转失败" + failedSpins + "次, 历史未匹配" + verifyResult.failed + "条"),
        spinCount: spinCount,
        spinResults: spinResults,
        verifyResult: verifyResult
    };
}

/**
 * 验证旋转结果是否都能在历史记录中找到
 *
 * @param {string} userToken
 * @param {Array} spinResults  [{ rechargeWheelType, rewardType, rewardAmount }]
 * @returns {{ passed: number, failed: number, total: number }}
 */
export function verifySpinHistory(userToken, spinResults) {
    logger.info("[" + rechargeWheelExecTag + "] ===== 验证旋转历史 (共" + spinResults.length + "条) =====");

    if (!spinResults || spinResults.length === 0) {
        logger.warn("[" + rechargeWheelExecTag + "] 没有成功的旋转记录，跳过历史验证");
        return { passed: 0, failed: 0, total: 0 };
    }

    const pageSize = Math.max(spinResults.length + 5, 20);
    const history = getSpinHistory(userToken, pageSize);

    if (!history) {
        logger.error("[" + rechargeWheelExecTag + "] 无法获取历史记录，验证中止");
        return { passed: 0, failed: spinResults.length, total: spinResults.length };
    }

    // 用副本做匹配，防止同一条历史被多次消费
    const pool = history.slice();
    let passed = 0;
    let failed = 0;

    for (let i = 0; i < spinResults.length; i++) {
        const spin = spinResults[i];
        let matchIdx = -1;

        for (let j = 0; j < pool.length; j++) {
            const h = pool[j];
            if (h.rechargeWheelType === spin.rechargeWheelType &&
                h.rewardType === spin.rewardType &&
                Math.abs(parseFloat(h.rewardAmount) - parseFloat(spin.rewardAmount)) < 0.001) {
                matchIdx = j;
                break;
            }
        }

        if (matchIdx >= 0) {
            pool.splice(matchIdx, 1);
            passed++;
            logger.info(
                "[" + rechargeWheelExecTag + "] ✅ 历史匹配: " +
                (WHEEL_NAMES[spin.rechargeWheelType] || spin.rechargeWheelType) + "转盘 | " +
                "rewardType=" + spin.rewardType + " | rewardAmount=" + spin.rewardAmount
            );
        } else {
            failed++;
            const historySnapshot = JSON.stringify(history.map(function(h) {
                return {
                    wheel: WHEEL_NAMES[h.rechargeWheelType] || h.rechargeWheelType,
                    rewardType: h.rewardType,
                    rewardAmount: h.rewardAmount
                };
            }));
            logger.error(
                "[" + rechargeWheelExecTag + "] ❌ 历史未找到匹配!\n" +
                "   期望: wheelType=" + spin.rechargeWheelType + "(" + (WHEEL_NAMES[spin.rechargeWheelType] || "?") + ")" +
                ", rewardType=" + spin.rewardType + ", rewardAmount=" + spin.rewardAmount + "\n" +
                "   历史记录(前" + history.length + "条): " + historySnapshot
            );
        }
    }

    logger.info(
        "[" + rechargeWheelExecTag + "] 历史验证结果: 通过=" + passed +
        ", 失败=" + failed + ", 合计=" + spinResults.length
    );
    return { passed: passed, failed: failed, total: spinResults.length };
}

// ============================================================
// 私有工具函数
// ============================================================

function _parseBody(response) {
    try {
        if (typeof response.body === "string") {
            return JSON.parse(response.body);
        }
        return response.body || null;
    } catch (e) {
        logger.error("[" + rechargeWheelExecTag + "] 响应体解析失败: " + e.message);
        return null;
    }
}

function _conditionName(condition) {
    const names = { 0: "无需首充", 1: "需首充", 2: "二充", 3: "三充" };
    return names[condition] || ("未知(" + condition + ")");
}
