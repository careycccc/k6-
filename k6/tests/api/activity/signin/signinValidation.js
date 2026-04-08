/**
 * 每日签到验证逻辑
 */

import { sleep } from 'k6';
import { logger } from '../../../../libs/utils/logger.js';
import { ENV_CONFIG } from '../../../../config/envconfig.js';
import {
    getDailyCheckInList,
    getDailyCheckInInfoById,
    receiveDailyCheckInReward,
    getDailyCheckInUserList
} from './signinApi.js';
import { phoneRegister, emailRegister } from '../../login/register.test.js';
import { mobileAutoLoginFlow } from '../../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../../login/EmailAutoLogin.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { hybridRecharge } from '../../recharge/rechargeService.js';
import { generateRandomPhone, generateRandomEmail } from '../../../utils/accountGenerator.js';

const TAG = 'SignInValidation';

/**
 * 解析targetDetail，获取允许参与的VIP等级列表
 * @param {string} targetDetail - 目标详情字符串，如 "0" 或 "1,2,3,4"
 * @returns {number[]} VIP等级数组
 */
function parseTargetVipLevels(targetDetail) {
    if (!targetDetail || targetDetail === '') {
        return []; // 空表示所有等级都可以
    }

    return targetDetail.split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v));
}

/**
 * 检查用户VIP等级是否符合活动要求
 * @param {number} userVipLevel - 用户VIP等级
 * @param {number[]} targetVipLevels - 允许的VIP等级列表
 * @returns {boolean} 是否符合要求
 */
function checkVipLevelMatch(userVipLevel, targetVipLevels) {
    if (targetVipLevels.length === 0) {
        return true; // 空表示所有等级都可以
    }
    return targetVipLevels.includes(userVipLevel);
}

/**
 * 获取最大充值金额
 * @param {array} rewardDetail - 奖励详情数组
 * @returns {number} 最大充值金额
 */
function getMaxRechargeAmount(rewardDetail) {
    if (!rewardDetail || rewardDetail.length === 0) {
        return 0;
    }

    let maxAmount = 0;
    rewardDetail.forEach(reward => {
        if (reward.rechargeAmount > maxAmount) {
            maxAmount = reward.rechargeAmount;
        }
    });

    return maxAmount;
}

/**
 * 获取今日日期范围
 * @returns {object} {startDate, endDate}
 */
function getTodayDateRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return {
        startDate: `${year}-${month}-${day} 00:00:00`,
        endDate: `${year}-${month}-${day} 23:59:59`
    };
}

/**
 * 注册或登录用户
 * @param {object} options - 选项
 * @param {string} options.mode - 模式: 'random' 或 'specified'
 * @param {string} options.account - 指定账号（mode为specified时使用）
 * @param {string} options.accountType - 账号类型: 'phone' 或 'email'
 * @param {string} options.password - 密码（仅用于random模式注册）
 * @param {string} options.adminToken - 管理员token（用于获取验证码）
 * @returns {object} {success, userId, userToken, userName, accountType}
 */
function registerOrLoginUser(options) {
    const { mode, account, accountType, password = 'qwer1234', adminToken } = options;

    if (mode === 'random') {
        // 随机注册
        logger.info(`[${TAG}] 随机注册新用户`);

        // 构建 data 对象（phoneRegister 和 emailRegister 需要）
        const registerData = {
            token: adminToken,
            envConfig: ENV_CONFIG
        };

        // 先尝试手机注册
        const countryCode = ENV_CONFIG.COUNTRY_CODE || '91';
        const phone = generateRandomPhone(countryCode);
        logger.info(`[${TAG}] 尝试手机注册: ${phone}`);

        const phoneResult = phoneRegister(phone, registerData, password);
        if (phoneResult && phoneResult.code === 0) {
            // token 在 data.token 中，userId 在 data.userId 中
            const token = phoneResult.data?.token;
            const userId = phoneResult.data?.userId;

            if (token && userId) {
                logger.info(`[${TAG}] 手机注册成功: userId=${userId}`);
                return {
                    success: true,
                    userId: userId,
                    userToken: token,
                    userName: phone,
                    accountType: 'phone'
                };
            }
        }

        // 手机注册失败，尝试邮箱注册
        const email = generateRandomEmail();
        logger.info(`[${TAG}] 手机注册失败，尝试邮箱注册: ${email}`);

        const emailResult = emailRegister(email, registerData, password);
        if (emailResult && emailResult.code === 0) {
            // token 在 data.token 中，userId 在 data.userId 中
            const token = emailResult.data?.token;
            const userId = emailResult.data?.userId;

            if (token && userId) {
                logger.info(`[${TAG}] 邮箱注册成功: userId=${userId}`);
                return {
                    success: true,
                    userId: userId,
                    userToken: token,
                    userName: email,
                    accountType: 'email'
                };
            }
        }

        logger.error(`[${TAG}] 注册失败`);
        return { success: false };

    } else {
        // 指定账号登录（使用验证码方式）
        logger.info(`[${TAG}] 使用指定账号登录: ${account}`);

        let token;
        if (accountType === 'phone') {
            // 使用手机号验证码登录
            token = mobileAutoLoginFlow(account, { token: adminToken });
        } else {
            // 使用邮箱验证码登录
            token = emailAutoLoginFlow(account, { token: adminToken });
        }

        if (!token) {
            logger.error(`[${TAG}] 登录失败: 未获取到token`);
            return { success: false };
        }

        logger.info(`[${TAG}] 登录成功，获取用户信息`);

        // 使用token获取用户信息来得到userId
        const userInfo = getFrontUserInfo(token);
        if (!userInfo || !userInfo.userId) {
            logger.error(`[${TAG}] 获取用户信息失败`);
            return { success: false };
        }

        logger.info(`[${TAG}] 用户信息获取成功: userId=${userInfo.userId}`);
        return {
            success: true,
            userId: userInfo.userId,
            userToken: token,
            userName: account,
            accountType: accountType
        };
    }
}

/**
 * 验证单个活动（使用已注册的用户）
 * @param {object} params - 参数
 * @param {string} params.adminToken - 管理员token
 * @param {object} params.activity - 活动信息
 * @param {object} params.userResult - 已注册的用户信息 {userId, userToken, userName, accountType}
 * @param {number} params.userVipLevel - 用户VIP等级
 * @param {boolean} params.manualReceive - 是否手动领取
 * @returns {object} 验证结果
 */
function validateSingleActivityWithUser(params) {
    const { adminToken, activity, userResult, userVipLevel, manualReceive = true } = params;

    logger.info(`[${TAG}] ========== 开始验证活动: ${activity.activityName} (ID: ${activity.id}) ==========`);

    const result = {
        activityId: activity.id,
        activityName: activity.activityName,
        userId: userResult.userId,
        userName: userResult.userName,
        userVipLevel: userVipLevel,
        targetVipLevels: [],
        vipMatch: false,
        manualReceive: manualReceive,
        receiveSuccess: false,
        verifySuccess: false,
        receiveAmount: 0,
        errorMessage: null
    };

    // 1. 获取活动详情
    const activityDetail = getDailyCheckInInfoById(adminToken, activity.id);
    if (!activityDetail) {
        result.errorMessage = '获取活动详情失败';
        return result;
    }

    // 解析目标VIP等级
    result.targetVipLevels = parseTargetVipLevels(activityDetail.targetDetail);
    result.vipMatch = checkVipLevelMatch(userVipLevel, result.targetVipLevels);
    logger.info(`[${TAG}] 活动允许的VIP等级: ${result.targetVipLevels.length === 0 ? '所有等级' : result.targetVipLevels.join(',')}`);
    logger.info(`[${TAG}] 用户VIP等级: ${userVipLevel}, 是否匹配: ${result.vipMatch}`);

    // 2. 充值
    const maxRechargeAmount = getMaxRechargeAmount(activityDetail.rewardDetail);
    logger.info(`[${TAG}] 需要充值金额: ${maxRechargeAmount}`);

    if (maxRechargeAmount > 0) {
        const rechargeResult = hybridRecharge({
            adminToken: adminToken,
            userId: userResult.userId,
            amount: maxRechargeAmount,
            userToken: userResult.userToken
        });
        if (!rechargeResult || !rechargeResult.success) {
            result.errorMessage = `充值失败: ${rechargeResult?.message || '未知错误'}`;
            return result;
        }
        logger.info(`[${TAG}] 充值成功`);
    }

    // 3. 等待10秒
    logger.info(`[${TAG}] 等待10秒...`);
    sleep(10);

    // 4. 手动领取（如果需要）
    if (manualReceive) {
        logger.info(`[${TAG}] 手动领取签到奖励`);
        const receiveResult = receiveDailyCheckInReward(userResult.userToken, activity.id, 0);
        result.receiveSuccess = receiveResult.success;

        if (!receiveResult.success) {
            result.errorMessage = `手动领取失败: ${receiveResult.msg || receiveResult.error || '未知错误'}`;
        }
    } else {
        logger.info(`[${TAG}] 跳过手动领取`);
        result.receiveSuccess = true; // 不手动领取时标记为成功
    }

    // 5. 等待5秒后验证
    logger.info(`[${TAG}] 等待5秒后验证...`);
    sleep(5);

    // 6. 查询签到记录
    const dateRange = getTodayDateRange();
    const userList = getDailyCheckInUserList(
        adminToken,
        userResult.userId,
        dateRange.startDate,
        dateRange.endDate
    );

    if (userList && userList.list && userList.list.length > 0) {
        // 查找匹配的活动记录
        const record = userList.list.find(r => r.activityId === activity.id);
        if (record) {
            result.verifySuccess = true;
            result.receiveAmount = record.receiveAmount || 0;
            logger.info(`[${TAG}] ✅ 验证成功: 领取金额=${result.receiveAmount}`);
        } else {
            // 有签到记录但没有匹配当前活动 → 标记为自动领取
            result.verifySuccess = true;
            result.receiveAmount = 0;
            result.errorMessage = '自动领取';
            logger.info(`[${TAG}] ℹ️ 查询到签到记录但未匹配当前活动，标记为自动领取`);
        }
    } else {
        // 完全没有查询到任何签到记录 → 验证失败
        result.verifySuccess = false;
        result.errorMessage = '未查询到任何签到记录';
        logger.error(`[${TAG}] ❌ 验证失败: 未查询到任何签到记录`);
    }

    logger.info(`[${TAG}] ========== 活动验证完成 ==========`);
    return result;
}

/**
 * 验证单个活动
 * @param {object} params - 参数
 * @param {string} params.adminToken - 管理员token
 * @param {object} params.activity - 活动信息
 * @param {object} params.userOptions - 用户选项
 * @param {boolean} params.manualReceive - 是否手动领取
 * @returns {object} 验证结果
 */
export function validateSingleActivity(params) {
    const { adminToken, activity, userOptions, manualReceive = true } = params;

    logger.info(`[${TAG}] ========== 开始验证活动: ${activity.activityName} (ID: ${activity.id}) ==========`);

    const result = {
        activityId: activity.id,
        activityName: activity.activityName,
        userId: null,
        userName: null,
        userVipLevel: null,
        targetVipLevels: [],
        vipMatch: false,
        manualReceive: manualReceive,
        receiveSuccess: false,
        verifySuccess: false,
        receiveAmount: 0,
        errorMessage: null
    };

    // 1. 获取活动详情
    const activityDetail = getDailyCheckInInfoById(adminToken, activity.id);
    if (!activityDetail) {
        result.errorMessage = '获取活动详情失败';
        return result;
    }

    // 解析目标VIP等级
    result.targetVipLevels = parseTargetVipLevels(activityDetail.targetDetail);
    logger.info(`[${TAG}] 活动允许的VIP等级: ${result.targetVipLevels.length === 0 ? '所有等级' : result.targetVipLevels.join(',')}`);

    // 2. 注册或登录用户
    const userResult = registerOrLoginUser({
        ...userOptions,
        adminToken: adminToken
    });
    if (!userResult.success) {
        result.errorMessage = '注册或登录失败';
        return result;
    }

    result.userId = userResult.userId;
    result.userName = userResult.userName;

    // 3. 获取用户信息，检查VIP等级
    const userInfo = getFrontUserInfo(userResult.userToken);
    if (!userInfo) {
        result.errorMessage = '获取用户信息失败';
        return result;
    }

    result.userVipLevel = userInfo.vipLevel || 0;
    result.vipMatch = checkVipLevelMatch(result.userVipLevel, result.targetVipLevels);

    logger.info(`[${TAG}] 用户VIP等级: ${result.userVipLevel}, 是否匹配: ${result.vipMatch}`);

    // 4. 充值
    const maxRechargeAmount = getMaxRechargeAmount(activityDetail.rewardDetail);
    logger.info(`[${TAG}] 需要充值金额: ${maxRechargeAmount}`);

    if (maxRechargeAmount > 0) {
        const rechargeResult = hybridRecharge({
            adminToken: adminToken,
            userId: userResult.userId,
            amount: maxRechargeAmount,
            userToken: userResult.userToken
        });
        if (!rechargeResult || !rechargeResult.success) {
            result.errorMessage = `充值失败: ${rechargeResult?.message || '未知错误'}`;
            return result;
        }
        logger.info(`[${TAG}] 充值成功`);
    }

    // 5. 等待10秒
    logger.info(`[${TAG}] 等待10秒...`);
    sleep(10);

    // 6. 手动领取（如果需要）
    if (manualReceive) {
        logger.info(`[${TAG}] 手动领取签到奖励`);
        const receiveResult = receiveDailyCheckInReward(userResult.userToken, activity.id, 0);
        result.receiveSuccess = receiveResult.success;

        if (!receiveResult.success) {
            result.errorMessage = `手动领取失败: ${receiveResult.msg || receiveResult.error || '未知错误'}`;
        }
    } else {
        logger.info(`[${TAG}] 跳过手动领取`);
        result.receiveSuccess = true; // 不手动领取时标记为成功
    }

    // 7. 等待5秒后验证
    logger.info(`[${TAG}] 等待5秒后验证...`);
    sleep(5);

    // 8. 查询签到记录
    const dateRange = getTodayDateRange();
    const userList = getDailyCheckInUserList(
        adminToken,
        userResult.userId,
        dateRange.startDate,
        dateRange.endDate
    );

    if (userList && userList.list && userList.list.length > 0) {
        // 查找匹配的活动记录
        const record = userList.list.find(r => r.activityId === activity.id);
        if (record) {
            result.verifySuccess = true;
            result.receiveAmount = record.receiveAmount || 0;
            logger.info(`[${TAG}] ✅ 验证成功: 领取金额=${result.receiveAmount}`);
        } else {
            // 有签到记录但没有匹配当前活动 → 标记为自动领取
            result.verifySuccess = true;
            result.receiveAmount = 0;
            result.errorMessage = '自动领取';
            logger.info(`[${TAG}] ℹ️ 查询到签到记录但未匹配当前活动，标记为自动领取`);
        }
    } else {
        // 完全没有查询到任何签到记录 → 验证失败
        result.verifySuccess = false;
        result.errorMessage = '未查询到任何签到记录';
        logger.error(`[${TAG}] ❌ 验证失败: 未查询到任何签到记录`);
    }

    logger.info(`[${TAG}] ========== 活动验证完成 ==========`);
    return result;
}


/**
 * 批量验证每日签到活动
 * @param {object} params - 参数
 * @param {string} params.adminToken - 管理员token
 * @param {string} params.mode - 模式: 'random' 或 'specified'
 * @param {number} params.userCount - 用户数量（random模式）
 * @param {array} params.accounts - 账号列表（specified模式）[{account, accountType, password}]
 * @param {number} params.manualReceiveRate - 手动领取比例 (0-1)，默认0.8表示80%的用户手动领取
 * @returns {object} 验证结果汇总
 */
export async function validateDailySignIn(params) {
    const {
        adminToken,
        mode = 'random',
        userCount = 1,
        accounts = [],
        manualReceiveRate = 0.8
    } = params;

    logger.info(`[${TAG}] ========== 开始每日签到验证 ==========`);
    logger.info(`[${TAG}] 模式: ${mode}`);
    logger.info(`[${TAG}] 用户数量: ${mode === 'random' ? userCount : accounts.length}`);
    logger.info(`[${TAG}] 手动领取比例: ${(manualReceiveRate * 100).toFixed(0)}%`);

    // 1. 获取活动列表
    const activityList = getDailyCheckInList(adminToken);
    if (!activityList || !activityList.list || activityList.list.length === 0) {
        logger.error(`[${TAG}] 未找到任何活动`);
        return {
            success: false,
            message: '未找到任何活动',
            results: []
        };
    }

    logger.info(`[${TAG}] 获取到 ${activityList.list.length} 个活动`);

    // 调试：打印所有活动的状态
    activityList.list.forEach((activity, index) => {
        logger.info(`[${TAG}] 活动${index + 1}: ID=${activity.id}, Name="${activity.activityName}", activityStatus=${activity.activityStatus}, state=${activity.state}`);
    });

    // 2. 筛选符合条件的活动（activityStatus=1 且 state=1）
    let activeActivities = activityList.list.filter(
        activity => activity.activityStatus === 1 && activity.state === 1
    );

    logger.info(`[${TAG}] 筛选后的活跃活动数量: ${activeActivities.length}`);

    // 3. 如果没有找到活跃的活动，尝试创建
    if (activeActivities.length === 0) {
        logger.warn(`[${TAG}] 未找到进行中的活动，尝试创建新活动`);

        // 动态导入 createSignin，避免模块级代码执行
        const { createSignin } = await import('./createSignin.js');
        const createResult = createSignin({ token: adminToken });

        if (!createResult.success) {
            logger.error(`[${TAG}] 创建活动失败: ${createResult.message}`);
            logger.error(`[${TAG}] 当前没有活跃的每日签到活动`);
            return {
                success: false,
                message: '当前没有活跃的每日签到活动',
                results: []
            };
        }

        logger.info(`[${TAG}] 活动创建成功，等待5秒后重新查询`);
        sleep(5);

        // 重新查询活动列表
        const newActivityList = getDailyCheckInList(adminToken);
        if (!newActivityList || !newActivityList.list || newActivityList.list.length === 0) {
            logger.error(`[${TAG}] 创建后仍未找到任何活动`);
            logger.error(`[${TAG}] 当前没有活跃的每日签到活动`);
            return {
                success: false,
                message: '当前没有活跃的每日签到活动',
                results: []
            };
        }

        // 再次筛选活跃活动
        activeActivities = newActivityList.list.filter(
            activity => activity.activityStatus === 1 && activity.state === 1
        );

        if (activeActivities.length === 0) {
            logger.error(`[${TAG}] 创建后仍未找到进行中的活动`);
            logger.error(`[${TAG}] 当前没有活跃的每日签到活动`);
            return {
                success: false,
                message: '当前没有活跃的每日签到活动',
                results: []
            };
        }

        logger.info(`[${TAG}] 创建后找到 ${activeActivities.length} 个进行中的活动`);
    } else {
        logger.info(`[${TAG}] 找到 ${activeActivities.length} 个进行中的活动，无需创建`);
    }

    // 4. 准备用户列表
    let userOptionsList = [];

    if (mode === 'random') {
        // 随机模式：生成指定数量的用户
        for (let i = 0; i < userCount; i++) {
            const manualReceive = Math.random() < manualReceiveRate;
            userOptionsList.push({
                mode: 'random',
                manualReceive: manualReceive
            });
        }
    } else {
        // 指定账号模式
        accounts.forEach((acc) => {
            const manualReceive = Math.random() < manualReceiveRate;
            userOptionsList.push({
                mode: 'specified',
                account: acc.account,
                accountType: acc.accountType || 'phone',
                password: acc.password || 'qwer1234',
                manualReceive: manualReceive
            });
        });
    }

    // 5. 为每个用户找到匹配的活动并执行验证
    const allResults = [];

    for (let i = 0; i < userOptionsList.length; i++) {
        const userOptions = userOptionsList[i];

        logger.info(`[${TAG}] `);
        logger.info(`[${TAG}] ========================================`);
        logger.info(`[${TAG}] 验证用户 ${i + 1}/${userOptionsList.length}`);
        logger.info(`[${TAG}] ========================================`);

        // 先注册或登录用户，获取VIP等级
        const userResult = registerOrLoginUser({
            ...userOptions,
            adminToken: adminToken
        });

        if (!userResult.success) {
            logger.error(`[${TAG}] 用户注册或登录失败，跳过`);
            allResults.push({
                activityId: null,
                activityName: 'N/A',
                userId: null,
                userName: null,
                userVipLevel: null,
                targetVipLevels: [],
                vipMatch: false,
                manualReceive: userOptions.manualReceive,
                receiveSuccess: false,
                verifySuccess: false,
                receiveAmount: 0,
                errorMessage: '注册或登录失败'
            });
            continue;
        }

        // 获取用户VIP等级
        const userInfo = getFrontUserInfo(userResult.userToken);
        if (!userInfo) {
            logger.error(`[${TAG}] 获取用户信息失败，跳过`);
            allResults.push({
                activityId: null,
                activityName: 'N/A',
                userId: userResult.userId,
                userName: userResult.userName,
                userVipLevel: null,
                targetVipLevels: [],
                vipMatch: false,
                manualReceive: userOptions.manualReceive,
                receiveSuccess: false,
                verifySuccess: false,
                receiveAmount: 0,
                errorMessage: '获取用户信息失败'
            });
            continue;
        }

        const userVipLevel = userInfo.vipLevel || 0;
        logger.info(`[${TAG}] 用户VIP等级: ${userVipLevel}`);

        // 找到匹配用户VIP等级的活动
        let matchedActivity = null;
        for (const activity of activeActivities) {
            const activityDetail = getDailyCheckInInfoById(adminToken, activity.id);
            if (!activityDetail) {
                continue;
            }

            const targetVipLevels = parseTargetVipLevels(activityDetail.targetDetail);
            const isMatch = checkVipLevelMatch(userVipLevel, targetVipLevels);

            if (isMatch) {
                matchedActivity = activity;
                logger.info(`[${TAG}] 找到匹配的活动: ${activity.activityName} (ID: ${activity.id})`);
                break;
            }
        }

        if (!matchedActivity) {
            logger.warn(`[${TAG}] 未找到匹配用户VIP等级 ${userVipLevel} 的活动`);
            allResults.push({
                activityId: null,
                activityName: 'N/A',
                userId: userResult.userId,
                userName: userResult.userName,
                userVipLevel: userVipLevel,
                targetVipLevels: [],
                vipMatch: false,
                manualReceive: userOptions.manualReceive,
                receiveSuccess: false,
                verifySuccess: true, // 标记为成功，但在错误信息中说明原因
                receiveAmount: 0,
                errorMessage: '没有匹配的活动'
            });
            continue;
        }

        // 执行活动验证（传入已注册的用户信息）
        const result = validateSingleActivityWithUser({
            adminToken: adminToken,
            activity: matchedActivity,
            userResult: userResult,
            userVipLevel: userVipLevel,
            manualReceive: userOptions.manualReceive
        });

        allResults.push(result);

        // 每个用户之间等待2秒
        if (i < userOptionsList.length - 1) {
            sleep(2);
        }
    }

    // 6. 生成报表
    printValidationReport(allResults);

    return {
        success: true,
        results: allResults
    };
}

/**
 * 打印验证报表
 * @param {array} results - 验证结果数组
 */
function printValidationReport(results) {
    logger.info(`[${TAG}] `);
    logger.info(`[${TAG}] ========================================`);
    logger.info(`[${TAG}] 每日签到验证报表`);
    logger.info(`[${TAG}] ========================================`);
    logger.info(`[${TAG}] `);

    // 表头
    logger.info(`[${TAG}] ┌──────────┬────────────┬──────────────┬──────────────┬──────────────┬──────────────┐`);
    logger.info(`[${TAG}] │ 用户ID   │ 活动ID     │ 是否手动领取 │ 验证是否成功 │ VIP是否匹配  │ 领取金额     │`);
    logger.info(`[${TAG}] ├──────────┼────────────┼──────────────┼──────────────┼──────────────┼──────────────┤`);

    let totalUsers = 0;
    let totalAmount = 0;
    let successCount = 0;
    let failCount = 0;

    results.forEach(result => {
        const userId = (result.userId || 'N/A').toString().padEnd(8, ' ');
        const activityId = (result.activityId || 'N/A').toString().padEnd(10, ' ');
        const manualReceive = result.manualReceive ? '是' : '否';
        const manualReceiveStr = manualReceive.padEnd(12, ' ');

        // 根据错误信息决定显示内容
        let verifyStr;
        if (!result.verifySuccess) {
            verifyStr = '❌ 失败'.padEnd(12, ' ');
        } else if (result.errorMessage === '自动领取') {
            verifyStr = '自动领取'.padEnd(12, ' ');
        } else if (result.errorMessage === '没有匹配的活动') {
            verifyStr = '没有匹配的活动'.padEnd(12, ' ');
        } else {
            verifyStr = '✅ 成功'.padEnd(12, ' ');
        }

        const vipMatch = result.vipMatch ? '✅ 匹配' : '❌ 不匹配';
        const vipStr = vipMatch.padEnd(12, ' ');
        const amount = result.receiveAmount.toFixed(2).padEnd(12, ' ');

        logger.info(`[${TAG}] │ ${userId} │ ${activityId} │ ${manualReceiveStr} │ ${verifyStr} │ ${vipStr} │ ${amount} │`);

        if (result.userId) {
            totalUsers++;
        }
        totalAmount += result.receiveAmount;

        if (result.verifySuccess) {
            successCount++;
        } else {
            failCount++;
        }
    });

    logger.info(`[${TAG}] └──────────┴────────────┴──────────────┴──────────────┴──────────────┴──────────────┘`);

    // 统计信息
    logger.info(`[${TAG}] `);
    logger.info(`[${TAG}] ========== 统计信息 ==========`);
    logger.info(`[${TAG}] 总用户数: ${totalUsers}`);
    logger.info(`[${TAG}] 成功验证: ${successCount}`);
    logger.info(`[${TAG}] 失败验证: ${failCount}`);
    logger.info(`[${TAG}] 成功率: ${totalUsers > 0 ? ((successCount / totalUsers) * 100).toFixed(2) : 0}%`);
    logger.info(`[${TAG}] 总领取金额: ${totalAmount.toFixed(2)}`);
    logger.info(`[${TAG}] 平均领取金额: ${totalUsers > 0 ? (totalAmount / totalUsers).toFixed(2) : 0}`);

    // 失败详情
    if (failCount > 0) {
        logger.info(`[${TAG}] `);
        logger.error(`[${TAG}] ========== 失败详情 ==========`);
        results.forEach(result => {
            if (!result.verifySuccess) {
                logger.error(`[${TAG}] 用户ID: ${result.userId || 'N/A'}`);
                logger.error(`[${TAG}] 活动ID: ${result.activityId}`);
                logger.error(`[${TAG}] 活动名称: ${result.activityName}`);
                logger.error(`[${TAG}] 用户VIP: ${result.userVipLevel}`);
                logger.error(`[${TAG}] 目标VIP: ${result.targetVipLevels.join(',') || '所有'}`);
                logger.error(`[${TAG}] 错误信息: ${result.errorMessage || '未知错误'}`);
                logger.error(`[${TAG}] ---`);
            }
        });
    }

    logger.info(`[${TAG}] ========================================`);
}
