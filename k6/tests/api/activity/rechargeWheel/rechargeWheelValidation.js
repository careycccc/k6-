/**
 * 充值转盘验证逻辑
 * 对应 Golang 的 rechargewheel 包
 * 支持多租户环境
 */

import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { httpClient } from '../../../../libs/http/client.js';
import { manualRecharge } from '../../recharge/manualRecharge.js';
import { phoneRegister, emailRegister } from '../../login/register.test.js';
import { getTimeRandom } from '../../../utils/utils.js';
import { generateRandomPhone, generateRandomEmail } from '../../../utils/accountGenerator.js';

/**
 * 充值转盘验证标签
 */
export const rechargeWheelValidationTag = 'RechargeWheelValidation';

/**
 * 充值条件枚举
 */
export const RechargeCondition = {
    NO_FIRST_RECHARGE: 0,  // 无需首充
    NEED_FIRST_RECHARGE: 1, // 需首充
    SECOND_RECHARGE: 2,     // 二充
    THIRD_RECHARGE: 3       // 三充
};

/**
 * 带重试的手动充值函数
 * 当遇到 "Too frequent access" 错误时，等待3秒后重试
 * @param {string} adminToken - 管理员token
 * @param {number} userId - 用户ID
 * @param {number} amount - 充值金额
 * @param {number} rechargeType - 充值类型
 * @param {number} maxRetries - 最大重试次数，默认3次
 * @returns {object} 充值结果
 */
function manualRechargeWithRetry(adminToken, userId, amount, rechargeType, maxRetries = 3) {
    let attempt = 0;

    while (attempt < maxRetries) {
        attempt++;

        const result = manualRecharge(adminToken, userId, amount, rechargeType);

        // 检查是否成功
        if (result && result.success) {
            return result;
        }

        // 检查是否是频率限制错误
        const isTooFrequent = result && result.msg &&
            (result.msg.includes('Too frequent access') ||
                result.msg.includes('please try again later'));

        if (isTooFrequent && attempt < maxRetries) {
            logger.warn(`[${rechargeWheelValidationTag}] 充值频率限制，等待3秒后重试 (尝试 ${attempt}/${maxRetries})`);
            sleep(3);
            continue;
        }

        // 其他错误或已达到最大重试次数，直接返回
        return result;
    }

    return {
        success: false,
        msg: '充值失败：已达到最大重试次数'
    };
}

/**
 * 用户充值转盘信息
 */
export class UserRechargeWheelInfo {
    constructor(isOpenRechargeWheel, rechargeWheelRemainSpinCount) {
        this.isOpenRechargeWheel = isOpenRechargeWheel;
        this.rechargeWheelRemainSpinCount = rechargeWheelRemainSpinCount;
    }
}

/**
 * 获取当前用户充值转盘信息
 * 对应 Golang 的 GetUserRechargeWheelInfo
 * @param {string} userToken - 用户token
 * @returns {UserRechargeWheelInfo|null} 用户充值转盘信息
 */
export function getUserRechargeWheelInfo(userToken) {
    logger.info(`[${rechargeWheelValidationTag}] 获取用户充值转盘信息`);

    const api = '/api/Home/GetGiftInfo';
    const timeData = getTimeRandom();

    const payload = {
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: rechargeWheelValidationTag, name: `${rechargeWheelValidationTag}_request` }
                }
            },
            true  // isDesk = true (前台接口)
        );

        // 解析响应
        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${rechargeWheelValidationTag}] 获取充值转盘信息失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }

        const data = parsedBody.data;
        const info = new UserRechargeWheelInfo(
            data.isOpenRechargeWheel || false,
            data.rechargeWheelRemainSpinCount || 0
        );

        logger.info(`[${rechargeWheelValidationTag}] 充值转盘信息: 开启=${info.isOpenRechargeWheel}, 剩余次数=${info.rechargeWheelRemainSpinCount}`);

        return info;

    } catch (error) {
        logger.error(`[${rechargeWheelValidationTag}] 获取充值转盘信息异常: ${error.message}`);
        return null;
    }
}

/**
 * 设置充值转盘条件
 * 对应 Golang 的 SetRechargeWheelCondition
 * @param {string} adminToken - 管理员token
 * @param {number} value1 - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {boolean} 是否设置成功
 */
export function setRechargeWheelCondition(adminToken, value1) {
    logger.info(`[${rechargeWheelValidationTag}] 设置充值转盘条件: value1=${value1}`);

    const api = '/api/RechargeWheel/UpdateConfig';
    const timeData = getTimeRandom();

    const payload = {
        settingKey: 'RechargeWheelNeedFirstRechargeSwitch',
        value1: String(value1),
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: rechargeWheelValidationTag, name: `${rechargeWheelValidationTag}_request` }
                }
            },
            false  // isDesk = false (后台接口)
        );

        // 解析响应
        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${rechargeWheelValidationTag}] 设置充值转盘条件失败: ${parsedBody?.msg || '未知错误'}`);
            return false;
        }

        logger.info(`[${rechargeWheelValidationTag}] 充值转盘条件设置成功: value1=${value1}`);
        return true;

    } catch (error) {
        logger.error(`[${rechargeWheelValidationTag}] 设置充值转盘条件异常: ${error.message}`);
        return false;
    }
}

/**
 * 获取充值转盘第一个转盘的充值配置
 * 对应 Golang 的 GetFirstRechargeWheelInfo
 * @param {string} adminToken - 管理员token
 * @returns {Array|null} 任务配置列表
 */
export function getFirstRechargeWheelInfo(adminToken) {
    logger.info(`[${rechargeWheelValidationTag}] 获取第一个转盘的充值配置`);

    const api = '/api/RechargeWheel/Get';
    const timeData = getTimeRandom();

    const payload = {
        rechargeWheelType: 1,
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(adminToken);
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: rechargeWheelValidationTag, name: `${rechargeWheelValidationTag}_request` }
                }
            },
            false  // isDesk = false (后台接口)
        );

        // 解析响应
        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody || parsedBody.msgCode !== 0) {
            logger.error(`[${rechargeWheelValidationTag}] 获取充值转盘配置失败: ${parsedBody?.msg || '未知错误'}`);
            return null;
        }

        const taskConfig = parsedBody.data?.taskConfig || [];
        logger.info(`[${rechargeWheelValidationTag}] 获取到 ${taskConfig.length} 个充值任务配置`);

        return taskConfig;

    } catch (error) {
        logger.error(`[${rechargeWheelValidationTag}] 获取充值转盘配置异常: ${error.message}`);
        return null;
    }
}

/**
 * 返回充值金额
 * 对应 Golang 的 ReturnRechargeAmount
 * 确保充值的金额至少要满足有充值保存有旋转的次数产生
 * @param {string} adminToken - 管理员token
 * @returns {number} 充值金额
 */
export function returnRechargeAmount(adminToken) {
    logger.info(`[${rechargeWheelValidationTag}] 计算充值金额`);

    const taskConfig = getFirstRechargeWheelInfo(adminToken);

    if (!taskConfig || taskConfig.length === 0) {
        logger.error(`[${rechargeWheelValidationTag}] 没有获取到充值转盘的配置项`);
        return 0;
    }

    let amount = 0;

    if (taskConfig.length > 1) {
        // 找出最大的充值金额
        for (let i = 0; i < taskConfig.length; i++) {
            const currentAmount = parseFloat(taskConfig[i].rechargeAmount) || 0;
            if (currentAmount > amount) {
                amount = currentAmount;
            }
        }
    } else if (taskConfig.length === 1) {
        amount = parseFloat(taskConfig[0].rechargeAmount) || 0;
    }

    logger.info(`[${rechargeWheelValidationTag}] 计算的充值金额: ${amount}`);
    return amount;
}

/**
 * 旋转充值转盘
 * 对应 Golang 的 SpinRechargeWheelApi
 * @param {string} userToken - 用户token
 * @param {number} rechargeWheelType - 充值转盘类型
 * @returns {object|null} 旋转结果
 */
export function spinRechargeWheel(userToken, rechargeWheelType = 1) {
    logger.info(`[${rechargeWheelValidationTag}] 旋转充值转盘: type=${rechargeWheelType}`);

    const api = '/api/Activity/SpinRechargeWheel';
    const timeData = getTimeRandom();

    const payload = {
        rechargeWheelType: rechargeWheelType,
        random: timeData.random,
        language: timeData.language,
        signature: '',
        timestamp: timeData.timestamp
    };

    try {
        httpClient.setAuthToken(userToken);
        const response = httpClient.post(
            api,
            payload,
            {
                params: {
                    tags: { type: rechargeWheelValidationTag, name: `${rechargeWheelValidationTag}_request` }
                }
            },
            true  // isDesk = true (前台接口)
        );

        // 解析响应
        let parsedBody;
        if (typeof response.body === 'string') {
            parsedBody = JSON.parse(response.body);
        } else {
            parsedBody = response.body;
        }

        if (!parsedBody) {
            logger.error(`[${rechargeWheelValidationTag}] 旋转充值转盘失败: 响应为空`);
            return null;
        }

        // 检查是否成功
        const isSuccess = parsedBody.msgCode === 0 || parsedBody.code === 0;

        if (isSuccess) {
            logger.info(`[${rechargeWheelValidationTag}] 旋转充值转盘成功`);
            return {
                success: true,
                data: parsedBody.data
            };
        } else {
            logger.error(`[${rechargeWheelValidationTag}] 旋转充值转盘失败: ${parsedBody.msg || '未知错误'}`);
            return {
                success: false,
                msgCode: parsedBody.msgCode || parsedBody.code,
                msg: parsedBody.msg
            };
        }

    } catch (error) {
        logger.error(`[${rechargeWheelValidationTag}] 旋转充值转盘异常: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 随机注册一个账号
 * 对应 Golang 的 GeneralAgentRegister
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @returns {object|null} 注册结果 { userId, userToken, userName }
 */
export function randomRegisterUser(data) {
    logger.info(`[${rechargeWheelValidationTag}] 开始随机注册用户`);

    // 先尝试手机号注册
    const phone = generateRandomPhone();
    logger.info(`[${rechargeWheelValidationTag}] 尝试手机号注册: ${phone}`);

    let registerResult = phoneRegister(phone, data);

    // 如果手机号注册失败，尝试邮箱注册
    if (!registerResult) {
        logger.warn(`[${rechargeWheelValidationTag}] 手机号注册失败，尝试邮箱注册`);
        const email = generateRandomEmail();
        logger.info(`[${rechargeWheelValidationTag}] 尝试邮箱注册: ${email}`);
        registerResult = emailRegister(email, data);
    }

    if (!registerResult) {
        logger.error(`[${rechargeWheelValidationTag}] 用户注册失败`);
        return null;
    }

    // 提取用户ID和token
    const userId = registerResult.data?.userId || registerResult.data?.userID;
    const userToken = registerResult.data?.token || registerResult.headers?.Authorization?.replace('Bearer ', '');

    if (!userId || !userToken) {
        logger.error(`[${rechargeWheelValidationTag}] 注册成功但无法获取用户ID或token`);
        return null;
    }

    logger.info(`[${rechargeWheelValidationTag}] 用户注册成功: userId=${userId}`);

    return {
        userId: userId,
        userToken: userToken,
        userName: registerResult.data?.userName || registerResult.data?.username
    };
}

/**
 * 充值转盘信息结构
 */
export class RechargeWheelInfo {
    constructor(isShow, wheelNumber, amount, userToken, userId) {
        this.isShow = isShow;
        this.wheelNumber = wheelNumber;
        this.amount = amount;
        this.userToken = userToken;
        this.userId = userId;
    }
}

/**
 * 调用充值转盘条件
 * 对应 Golang 的 CallRechargeWheelCondition
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @param {number} value1 - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {RechargeWheelInfo|null} 充值转盘信息
 */
export function callRechargeWheelCondition(data, value1) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 调用充值转盘条件: value1=${value1} ==========`);

    const adminToken = data.token;

    // 获取需要充值的金额
    const amount = returnRechargeAmount(adminToken);
    if (amount <= 0) {
        logger.error(`[${rechargeWheelValidationTag}] 无法获取充值金额`);
        return null;
    }

    // 随机生成一个用户
    const userResult = randomRegisterUser(data);
    if (!userResult) {
        logger.error(`[${rechargeWheelValidationTag}] 随机生成用户失败`);
        return null;
    }

    const { userId, userToken } = userResult;

    // 设置充值转盘的条件
    if (!setRechargeWheelCondition(adminToken, value1)) {
        logger.error(`[${rechargeWheelValidationTag}] 设置充值转盘条件失败`);
        return null;
    }

    // 等待1秒，确保后台处理完成
    sleep(1);

    // 进行充值
    const rechargeResult = manualRechargeWithRetry(adminToken, userId, amount, 2);
    if (!rechargeResult || !rechargeResult.success) {
        logger.error(`[${rechargeWheelValidationTag}] 充值失败: ${rechargeResult?.msg || '未知错误'}`);
        return null;
    }

    logger.info(`[${rechargeWheelValidationTag}] 充值成功: userId=${userId}, amount=${amount}`);

    // 等待1秒，确保后台处理完成
    sleep(1);

    // 获取用户的充值转盘信息
    const wheelInfo = getUserRechargeWheelInfo(userToken);
    if (!wheelInfo) {
        logger.error(`[${rechargeWheelValidationTag}] 获取用户充值转盘信息失败`);
        return null;
    }

    const info = new RechargeWheelInfo(
        wheelInfo.isOpenRechargeWheel,
        wheelInfo.rechargeWheelRemainSpinCount,
        amount,
        userToken,
        userId
    );

    logger.info(`[${rechargeWheelValidationTag}] 充值转盘信息: 开启=${info.isShow}, 剩余次数=${info.wheelNumber}, 金额=${info.amount}`);

    return info;
}

/**
 * 执行充值转盘的逻辑
 * 对应 Golang 的 execRechargeWheel
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @param {number} value1 - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {object} 验证结果 { success, message, userId, userName }
 */
export function execRechargeWheel(data, value1) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 执行充值转盘逻辑: value1=${value1} ==========`);

    const rechargeWheelInfo = callRechargeWheelCondition(data, value1);

    if (!rechargeWheelInfo) {
        return {
            success: false,
            message: '调用充值转盘条件失败',
            userId: null,
            userName: null
        };
    }

    if (!rechargeWheelInfo.isShow) {
        return {
            success: false,
            message: '充值转盘未开启',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 充值转盘已开启`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 旋转充值转盘
    const spinResult = spinRechargeWheel(rechargeWheelInfo.userToken, 1);

    if (!spinResult || !spinResult.success) {
        return {
            success: false,
            message: `旋转充值转盘失败: ${spinResult?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 旋转充值转盘成功`);

    return {
        success: true,
        message: '充值转盘验证成功',
        userId: rechargeWheelInfo.userId,
        userName: null
    };
}

/**
 * 运行充值转盘的任务
 * 对应 Golang 的 RunRechargeWheelCondition
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @param {number} value1 - 充值条件 (0=无需首充, 1=需首充, 2=二充, 3=三充)
 * @returns {object} 验证结果 { success, message, userId, userName }
 */
export function runRechargeWheelCondition(data, value1) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 运行充值转盘任务: value1=${value1} ==========`);

    switch (value1) {
        case RechargeCondition.NO_FIRST_RECHARGE:
            return validateNoFirstRecharge(data);
        case RechargeCondition.NEED_FIRST_RECHARGE:
            return validateNeedFirstRecharge(data);
        case RechargeCondition.SECOND_RECHARGE:
            return validateSecondRecharge(data);
        case RechargeCondition.THIRD_RECHARGE:
            return validateThirdRecharge(data);
        default:
            logger.error(`[${rechargeWheelValidationTag}] 输入的参数不正确，只能是0,1,2,3`);
            return {
                success: false,
                message: '参数不正确，只能是0,1,2,3',
                userId: null,
                userName: null
            };
    }
}

/**
 * 验证无需首充
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @returns {object} 验证结果
 */
function validateNoFirstRecharge(data) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 验证无需首充 ==========`);

    const rechargeWheelInfo = callRechargeWheelCondition(data, RechargeCondition.NO_FIRST_RECHARGE);

    if (!rechargeWheelInfo) {
        return {
            success: false,
            message: '调用充值转盘条件失败',
            userId: null,
            userName: null
        };
    }

    if (!rechargeWheelInfo.isShow) {
        return {
            success: false,
            message: '充值转盘未开启',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 充值转盘已开启`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 旋转充值转盘
    const spinResult = spinRechargeWheel(rechargeWheelInfo.userToken, 1);

    if (!spinResult || !spinResult.success) {
        return {
            success: false,
            message: `旋转充值转盘失败: ${spinResult?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] ✅ 无需首充验证成功`);

    return {
        success: true,
        message: '无需首充验证成功',
        userId: rechargeWheelInfo.userId,
        userName: null
    };
}

/**
 * 验证需首充
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @returns {object} 验证结果
 */
function validateNeedFirstRecharge(data) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 验证需首充 ==========`);

    const rechargeWheelInfo = callRechargeWheelCondition(data, RechargeCondition.NEED_FIRST_RECHARGE);

    if (!rechargeWheelInfo) {
        return {
            success: false,
            message: '调用充值转盘条件失败',
            userId: null,
            userName: null
        };
    }

    if (!rechargeWheelInfo.isShow) {
        return {
            success: false,
            message: '充值转盘未开启',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 充值转盘已开启`);

    // 判断是否有剩余的旋转次数
    if (rechargeWheelInfo.wheelNumber > 0) {
        logger.error(`[${rechargeWheelValidationTag}] 需首充判断，只进行了首充却有了旋转次数`);
        return {
            success: false,
            message: '需首充判断，只进行了首充却有了旋转次数',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 进行第二次充值
    const rechargeResult = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
    if (!rechargeResult || !rechargeResult.success) {
        return {
            success: false,
            message: `第二次充值失败: ${rechargeResult?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 第二次充值成功`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 旋转充值转盘
    const spinResult = spinRechargeWheel(rechargeWheelInfo.userToken, 1);

    if (!spinResult || !spinResult.success) {
        return {
            success: false,
            message: `旋转充值转盘失败: ${spinResult?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] ✅ 需首充验证成功`);

    return {
        success: true,
        message: '需首充验证成功',
        userId: rechargeWheelInfo.userId,
        userName: null
    };
}

/**
 * 验证二充
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @returns {object} 验证结果
 */
function validateSecondRecharge(data) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 验证二充 ==========`);

    // 第一次充值
    const rechargeWheelInfo = callRechargeWheelCondition(data, RechargeCondition.SECOND_RECHARGE);

    if (!rechargeWheelInfo) {
        return {
            success: false,
            message: '调用充值转盘条件失败',
            userId: null,
            userName: null
        };
    }

    if (rechargeWheelInfo.isShow) {
        logger.error(`[${rechargeWheelValidationTag}] 二充，第一次充值就开启了充值转盘`);
        return {
            success: false,
            message: '二充，第一次充值就开启了充值转盘',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    // 第二次充值
    const rechargeResult2 = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
    if (!rechargeResult2 || !rechargeResult2.success) {
        return {
            success: false,
            message: `第二次充值失败: ${rechargeResult2?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 第二次充值成功`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 查看是否有旋转次数
    const wheelInfo2 = getUserRechargeWheelInfo(rechargeWheelInfo.userToken);
    if (!wheelInfo2) {
        return {
            success: false,
            message: '获取用户充值转盘信息失败',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    if (wheelInfo2.isOpenRechargeWheel) {
        logger.info(`[${rechargeWheelValidationTag}] 二充第二次充值转盘已开启`);

        // 第三次充值
        const rechargeResult3 = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
        if (!rechargeResult3 || !rechargeResult3.success) {
            return {
                success: false,
                message: `第三次充值失败: ${rechargeResult3?.msg || '未知错误'}`,
                userId: rechargeWheelInfo.userId,
                userName: null
            };
        }

        logger.info(`[${rechargeWheelValidationTag}] 第三次充值成功`);

        // 等待5秒，确保后台处理完成
        sleep(5);

        // 旋转充值转盘
        const spinResult = spinRechargeWheel(rechargeWheelInfo.userToken, 1);

        if (!spinResult || !spinResult.success) {
            return {
                success: false,
                message: `旋转充值转盘失败: ${spinResult?.msg || '未知错误'}`,
                userId: rechargeWheelInfo.userId,
                userName: null
            };
        }

        logger.info(`[${rechargeWheelValidationTag}] ✅ 二充验证成功`);

        return {
            success: true,
            message: '二充验证成功',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    } else {
        logger.error(`[${rechargeWheelValidationTag}] 二充第二次充值转盘没有开启`);
        return {
            success: false,
            message: '二充第二次充值转盘没有开启',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }
}

/**
 * 验证三充
 * @param {object} data - 包含 adminToken 和 envConfig 的数据对象
 * @returns {object} 验证结果
 */
function validateThirdRecharge(data) {
    logger.info(`[${rechargeWheelValidationTag}] ========== 验证三充 ==========`);

    // 第一次充值
    const rechargeWheelInfo = callRechargeWheelCondition(data, RechargeCondition.THIRD_RECHARGE);

    if (!rechargeWheelInfo) {
        return {
            success: false,
            message: '调用充值转盘条件失败',
            userId: null,
            userName: null
        };
    }

    if (rechargeWheelInfo.isShow) {
        logger.error(`[${rechargeWheelValidationTag}] 三充，第一次充值就开启了充值转盘`);
        return {
            success: false,
            message: '三充，第一次充值就开启了充值转盘',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    // 第二次充值
    const rechargeResult2 = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
    if (!rechargeResult2 || !rechargeResult2.success) {
        return {
            success: false,
            message: `第二次充值失败: ${rechargeResult2?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 第二次充值成功`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 查看前台是否开启了充值转盘
    const wheelInfo2 = getUserRechargeWheelInfo(rechargeWheelInfo.userToken);
    if (!wheelInfo2) {
        return {
            success: false,
            message: '获取用户充值转盘信息失败',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    if (wheelInfo2.isOpenRechargeWheel) {
        logger.error(`[${rechargeWheelValidationTag}] 三充，第二次充值就开启了充值转盘`);
        return {
            success: false,
            message: '三充，第二次充值就开启了充值转盘',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    // 第三次充值
    const rechargeResult3 = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
    if (!rechargeResult3 || !rechargeResult3.success) {
        return {
            success: false,
            message: `第三次充值失败: ${rechargeResult3?.msg || '未知错误'}`,
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    logger.info(`[${rechargeWheelValidationTag}] 第三次充值成功`);

    // 等待5秒，确保后台处理完成
    sleep(5);

    // 查看前台是否开启了充值转盘
    const wheelInfo3 = getUserRechargeWheelInfo(rechargeWheelInfo.userToken);
    if (!wheelInfo3) {
        return {
            success: false,
            message: '获取用户充值转盘信息失败',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }

    if (wheelInfo3.isOpenRechargeWheel) {
        logger.info(`[${rechargeWheelValidationTag}] 三充第三次充值转盘已开启`);

        // 第四次充值
        const rechargeResult4 = manualRechargeWithRetry(data.token, rechargeWheelInfo.userId, rechargeWheelInfo.amount, 2);
        if (!rechargeResult4 || !rechargeResult4.success) {
            return {
                success: false,
                message: `第四次充值失败: ${rechargeResult4?.msg || '未知错误'}`,
                userId: rechargeWheelInfo.userId,
                userName: null
            };
        }

        logger.info(`[${rechargeWheelValidationTag}] 第四次充值成功`);

        // 等待5秒，确保后台处理完成
        sleep(5);

        // 旋转充值转盘
        const spinResult = spinRechargeWheel(rechargeWheelInfo.userToken, 1);

        if (!spinResult || !spinResult.success) {
            return {
                success: false,
                message: `旋转充值转盘失败: ${spinResult?.msg || '未知错误'}`,
                userId: rechargeWheelInfo.userId,
                userName: null
            };
        }

        logger.info(`[${rechargeWheelValidationTag}] ✅ 三充验证成功`);

        return {
            success: true,
            message: '三充验证成功',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    } else {
        logger.error(`[${rechargeWheelValidationTag}] 三充第三次充值转盘没有开启`);
        return {
            success: false,
            message: '三充第三次充值转盘没有开启',
            userId: rechargeWheelInfo.userId,
            userName: null
        };
    }
}
