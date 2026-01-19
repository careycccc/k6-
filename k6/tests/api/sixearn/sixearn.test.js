import { sendQueryRequest } from '../common/request.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { dateStringToTimestamp, isNonEmptyArray } from '../../utils/utils.js';
import { logger } from '../../../libs/utils/logger.js';
import { RebateLevel, RebateLevelRate, getNowMasterHierarchy } from './RebateLevel.test.js';
import { sleep } from 'k6';

export const sixearnTag = 'sixearn';
// 返佣费率配置
let rebateConfigs = [];
// 6级代理
//直属一级的账号：
const firstLevelAccounts = [];
// 团队的所有账号信息
const allTeamAccounts = [];


// 层级一到六级的返佣统计
let levelOneRebate = 0,
    levelTowRebate = 0,
    levelThreeRebate = 0,
    levelFourRebate = 0,
    levelFiveRebate = 0,
    levelSixRebate = 0;

// 直属一级的汇总
const firstLevelSummary = {
    registerUsers: 0, // 直属一级的注册用户数
    firstTotalNumber: 0, // 直属一级的总人数
    depUsers: 0, // 直属一级的充值用户数
    depAmount: 0, // 直属一级的总充值金额
    firstDepUsers: 0, // 直属一级的首充用户数
    betAmountSum: 0 // 直属一级的总投注金额
};

// 整个团队的汇总
const teamSummary = {
    registerUsers: 0, // 团队的注册用户数
    teamTotalNumber: 0, // 团队的总人数
    depUsers: 0, // 团队的充值用户数
    depAmount: 0, // 团队的总充值金额
    firstDepUsers: 0, // 团队的首充用户数
    betAmountSum: 0, // 团队的总投注金额
    earnLevel: 0 // 团队的返佣等级
};

// 查询该账号的下级账号
export function querySubAccounts(data) {
    // 必须接收 data 参数来拿 token
    const token = data.token;
    // 模拟查询下级账号的逻辑
    const api = '/api/Agent/GetPageListAgentList';
    // 这里输入要查询的团队的返佣，总代的id
    const accountId = 5944782;
    const payload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: false,
        pageSize: 500
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }

    // 清空数组，避免多次调用时数据累积
    firstLevelAccounts.length = 0;
    allTeamAccounts.length = 0;

    if (result && result.list && result.list.length > 0) {
        // 处理获取到的账号列表
        result.list.forEach((item) => {
            allTeamAccounts.push(item);
        });
    }
    const startTime = dateStringToTimestamp(ENV_CONFIG.START_TIME);
    const endTime = dateStringToTimestamp(ENV_CONFIG.END_TIME);
    // 找出当前总代的层级
    const nowMasterHierarchy = getNowMasterHierarchy(data, accountId);
    if (allTeamAccounts.length > 0) {
        // 动态的创建下级信息
        allTeamAccounts.forEach((account) => {
            sleep(1);
            // 自定义用户信息
            let customUserInfo = {
                userId: 0,
                registerTime: 0, // 注册时间
                isRegistered: false, // 是否在当前时间段注册的
                rebateState: 1, // 是否领取返佣状态 1，表示领取 0表示不领取
                electronicGame: [],    // 电子游戏（修正拼写）
                liveCasino: [],        // 真人娱乐（修正拼写）
                Sports: [],            // 体育（统一存数字）
                Lottery: [],           // 彩票
                ChessCard: [],         // 棋牌
                isFirstCharge: false, // 是否首充
                betAmountSum: 0, // 总投注金额
                totalRechargeAmount: 0, // 总充值金额
                hierarchy: -2, // 当前用户的绝对层级
                isNormalCommission: false, // 是否正常返佣
                lockearn: 0, // 锁定返佣
                specialRebate: 0 // 特殊返佣
            };
            if (typeof account !== 'object') {
                logger.error('账号信息格式错误,预期为Object类型,实际的类型:', typeof account);
                return;
            }
            // 团队不包括总代的这个会员
            if (account.userId != accountId) {
                // 获取当前用户的信息,uid,注册时间，层级，是否有特殊返佣设置
                customUserInfo.userId = account.userId;
                customUserInfo.hierarchy = account.hierarchy;
                customUserInfo.registerTime = account.registerTime;
                // account.rebateMode == 0 表示正常返佣,1,锁定返佣，2，特殊返佣
                if (account.rebateMode == 0) {
                    //customUserInfo.isNormalCommission = -8; // 正常返佣
                } else if (account.rebateMode == 1) {
                    // 锁定返佣
                    customUserInfo.lockearn = account.rebateLevel;
                    // 特殊返佣
                } else if (account.rebateMode == 2) {
                    customUserInfo.specialRebate = account.rebateLevel;
                }
                // 查询会员的充值信息
                // 查询会员的投注信息
                const userResult = getUserCurrentInfo(data, startTime, endTime, customUserInfo);
                // 记录首充状态
                if (userResult.totalRechargeAmount > 0) {
                    userResult.isFirstCharge = true;
                }
                // 记录注册人数
                if (userResult.registerTime >= startTime && userResult.registerTime <= endTime) {
                    userResult.isRegistered = true;
                }

                // 更新原数组中的账号信息，而不是添加新元素
                const index = allTeamAccounts.findIndex(item => item.userId === account.userId);
                if (index !== -1) {
                    allTeamAccounts[index] = userResult;
                }
            }
        });
        if (allTeamAccounts.length == 0) {
            logger.error('当前总代没有任何的下级账号信息');
            return;
        }
        let firstToupAmount = 0; // 统计团队的首充人数
        let registeredUsers = 0; // 统计注册人数
        // 团队的充值人数，充值金额，投注金额等信息进行汇总
        allTeamAccounts.forEach((item) => {
            if (item.totalRechargeAmount > 0) {
                teamSummary.depUsers++;
            }
            // 计算充值总金额
            teamSummary.depAmount += Number(item.totalRechargeAmount || 0);
            // 确保betAmountSum是数字类型后再累加
            // 统计投注金额
            const currentBetAmount = Number(item.betAmountSum || 0);
            teamSummary.betAmountSum += currentBetAmount;
            // 统计首充人数
            if (item.isFirstCharge) {
                firstToupAmount++;
            }
            //统计注册人数
            if (item.isRegistered) {
                registeredUsers++;
            }
            //统计直属下级的
            if (item.hierarchy == nowMasterHierarchy + 1) {
                firstLevelAccounts.push(item);
            }
        });
        const level = GetTeamRechargeUserCount(teamSummary.depUsers, teamSummary.depAmount, teamSummary.betAmountSum, data);
        teamSummary.earnLevel = level;
        // 统计团队的首充人数
        teamSummary.firstDepUsers = firstToupAmount; // 首充人数
        // 统计团队的注册人数
        teamSummary.registerUsers = registeredUsers; // 注册人数
        // 统计团队的总人数
        teamSummary.teamTotalNumber = allTeamAccounts.length; // 团队总人数
        // 统计直属一级的汇总信息
        firstLevelAccounts.forEach((item) => {
            // 统计直属一级的充值人数
            if (item.totalRechargeAmount > 0) {
                firstLevelSummary.depUsers++; // 直属一级的充值人数
            }
            // 计算直属一级的汇总信息
            firstLevelSummary.depAmount += Number(item.totalRechargeAmount || 0);
            // 确保betAmountSum是数字类型后再累加
            const currentBetAmount = Number(item.betAmountSum || 0);
            firstLevelSummary.betAmountSum += currentBetAmount;


        });
        // 统计直属一级的总人数
        firstLevelSummary.firstTotalNumber = firstLevelAccounts.length;
        // 计算直属一级的首充人数   
        firstLevelSummary.firstDepUsers = firstLevelAccounts.filter(item => item.isFirstCharge).length;
        // 计算直属一级的注册人数
        firstLevelSummary.registerUsers = firstLevelAccounts.filter(item => item.isRegistered).length;

        allTeamAccounts.forEach((account) => {
            sleep(1);
            // 1. 如果有锁定返佣（lockearn != 0），直接使用锁定值
            // 2. 否则取 specialRebate 和 teamSummary.earnLevel 的较大值（即 max）
            //    - 这自然覆盖了“无特殊返佣（specialRebate == 0）时使用团队返佣”的情况
            let earnlevel = account.lockearn != 0 ? account.lockearn : Math.max(account.specialRebate, teamSummary.earnLevel);
            console.log(`用户ID: ${account.userId} 的返佣等级为:`, earnlevel);
            const earnconfig = GetRebateLevelRate(earnlevel, data);
            // 计算单人的返佣信息
            const thisAmounteraninfo = GetRebateLevelRateByLevel(account, earnconfig);
            // 进行返佣统计到1-6级
            rebateStatistics(thisAmounteraninfo);
        });


        console.log('团队当前的返佣等级为:', teamSummary.earnLevel);
        // 输出各层级的返佣统计
        console.log('=================返佣统计结果====================');
        console.log(`层级一返佣总金额: ${levelOneRebate}`);
        console.log(`层级二返佣总金额: ${levelTowRebate}`);
        console.log(`层级三返佣总金额: ${levelThreeRebate}`);
        console.log(`层级四返佣总金额: ${levelFourRebate}`);
        console.log(`层级五返佣总金额: ${levelFiveRebate}`);
        console.log(`层级六返佣总金额: ${levelSixRebate}`);
        console.log(`总返佣金额: ${levelOneRebate + levelTowRebate + levelThreeRebate + levelFourRebate + levelFiveRebate + levelSixRebate}`);
        console.log('直属一级的汇总信息', firstLevelSummary);
        console.log('团队的汇总信息', teamSummary);
    } else {
        logger.error('当前总代没有任何的下级账号信息');
    }
}


/**
 * 获取用户的当前信息
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {Object} customUserInfo - 自定义用户信息对象，用于存储查询结果
 * @returns {Object}  - 用户的当前信息
 */
export function getUserCurrentInfo(data, startTime, endTime, customUserInfo) {
    // 1.查询账号的昨日的充值
    const toUpInfo = GetRechargeOrderPageList(data, customUserInfo.userId, 'Payed', startTime, endTime);
    let totalRechargeAmount = 0;
    // 获取这个用户的当前的所有充值金额
    if (isNonEmptyArray(toUpInfo)) {
        // 使用更精确的大数相加方法
        for (const item of toUpInfo) {
            const amount = Number(item.actualAmount || 0);
            if (!isNaN(amount)) {
                totalRechargeAmount = (totalRechargeAmount * 100 + amount * 100) / 100;
            }
        }
    }
    customUserInfo.totalRechargeAmount = totalRechargeAmount;

    // 2.查询账号的投注
    GetBetRecordPageList(data, customUserInfo, startTime, endTime, 'BetTime', 'BetTime');
    // 3.查询账号的的首充信息
    const userRptRechargeInfo = GetUserRptRechargePageList(
        data,
        customUserInfo.userId,
        1,
        ENV_CONFIG.START_TIME,
        ENV_CONFIG.END_TIME
    );
    // 判断这个为一个列表
    if (isNonEmptyArray(userRptRechargeInfo)) {
        // 判断这个用户在当前时间内是否首充
        const isFirstCharge = userRptRechargeInfo.every((item) => item.rechargeType === 'R1');
        if (isFirstCharge) {
            customUserInfo.isFirstCharge = true;
        }
    }

    return {
        ...customUserInfo
    };
}

/** 
查询账号的昨日的充值
@param {Object} data - 前置数据里面有token
@param {number} userId - 用户ID
@param {string} rechargeState - 充值状态
@param {number} startTime - 开始时间
@param {number} endTime - 结束时间
@returns {Array}  - 充值订单列表，或者响应信息
*/
export function GetRechargeOrderPageList(data, userId, rechargeState, startTime, endTime) {
    const api = '/api/RechargeOrder/GetRechargeOrderPageList';
    const token = data.token;
    const payload = {
        rechargeState,
        userId,
        startTime,
        endTime
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的充值订单列表
        return result.list;
    }
    return result;
}

/**
 * 查询账号的昨日的投注,默认查询200条
 * @param {Object} data - 前置数据里面有token
 * @param {number} customUserInfo - 用户信息
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {string} queryTimeType - 查询时间类型
 * @param {string} sortField - 排序字段

 * @returns {object}  - 个人信息，或者响应信息
 */
export function GetBetRecordPageList(
    data,
    customUserInfo,
    startTime,
    endTime,
    queryTimeType,
    sortField
) {
    if (JSON.stringify(customUserInfo) === '{}') {
        logger.error('用户信息不能为空');
        return;
    }
    const api = '/api/ThirdGame/GetBetRecordPageList';
    const token = data.token;
    // categoryType 0表示电子游戏，1真人视讯，2体育，3，彩票，4棋牌
    for (let j = 0; j < 5; j++) {
        const payload = {
            categoryType: j,
            queryTimeType,
            userId: customUserInfo.userId,
            beginTimeUnix: startTime,
            endTimeUnix: endTime,
            pageSize: 200,
            sortField
        };
        let result = sendQueryRequest(payload, api, sixearnTag, false, token);
        if (typeof result !== 'object') {
            result = JSON.parse(result);
        }
        if (result && result.list.length > 0) {
            // 统一push betAmount（数字），Sports也一样
            // betAmount 投注金额  validAmount 有效金额
            result.list.forEach((item) => {
                const betAmount = parseFloat(item.betAmount) || 0; // 防止字符串或null
                if (j === 0) {
                    customUserInfo.electronicGame.push(betAmount);
                } else if (j === 1) {
                    customUserInfo.liveCasino.push(betAmount);
                } else if (j === 2) {
                    customUserInfo.Sports.push(betAmount);
                } else if (j === 3) {
                    customUserInfo.Lottery.push(betAmount);
                } else if (j === 4) {
                    customUserInfo.ChessCard.push(betAmount);
                }
            });

            // 所有类别查询完后再计算总和（关键！）
            customUserInfo.betAmountSum =
                customUserInfo.electronicGame.reduce((sum, val) => sum + val, 0) +
                customUserInfo.liveCasino.reduce((sum, val) => sum + val, 0) +
                customUserInfo.Sports.reduce((sum, val) => sum + val, 0) +
                customUserInfo.Lottery.reduce((sum, val) => sum + val, 0) +
                customUserInfo.ChessCard.reduce((sum, val) => sum + val, 0);
        }
    }

    return customUserInfo;
}

/**
 在某个时间段内为首充,二充,三充
 * @param {Object} data - 前置数据里面有token
 * @param {number} userId - 用户ID
 * @param {number} memberIdType - 会员ID类型,默认 1
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @returns {Array}  - 充值信息列表，或者响应信息
*/
export function GetUserRptRechargePageList(data, userId, memberIdType, startTime, endTime) {
    const api = '/api/RptUserInfo/GetUserRptRechargePageList';
    const token = data.token;
    const payload = {
        memberIdType,
        memberId: userId,
        startTime,
        endTime
    };
    let result = sendQueryRequest(payload, api, sixearnTag, false, token);
    if (typeof result !== 'object') {
        result = JSON.parse(result);
    }
    if (result && result.list && result.list.length > 0) {
        // 处理获取到的充值信息
        return result.list;
    }
    return result;
}

/**
 定位是返佣等级
 * @param {int} depAmount  充值人数
 * @param {float} toupMoney 充值金额
 * @param {float} betAmountSum 投注金额
 * @returns {int}  返佣等级
*/
export function GetTeamRechargeUserCount(depAmount, toupMoney, betAmountSum, data) {
    if (depAmount == 0 && toupMoney == 0 && betAmountSum == 0) {
        return -1;
    }
    const result = RebateLevel(data);
    if (result.length == 0) {
        return -3;
    }
    for (let i = result.length - 1; i >= 0; i--) {
        if (typeof result[i] != 'object') {
            result[i] = JSON.parse(result[i]);
        }
        //判断人数是否在当前列
        if (
            result[i].childrenRechargeCount < depAmount &&
            result[i].childrenRechargeAmount < toupMoney &&
            result[i].childrenLotteryAmount < betAmountSum
        ) {
            // 判断 是否满足下一层
            return result[i].rebateLevel;
        }
    }
}


// 根据返佣等级找出返佣比例
/**
 * @param {*} rebateLevel 返佣等级
 * @returns  返回返佣配置
*/
export function GetRebateLevelRate(rebateLevel, data) {
    rebateConfigs = RebateLevelRate(data);
    // 搜集当前返佣等级的返佣比例
    const rateLotterylist = [];
    rebateConfigs.forEach((item) => {
        if (item.rebateLevel == rebateLevel) {

            if (typeof item.list != 'object') {
                item.list = JSON.parse(item.list);
            }
            rateLotterylist.push(...item.list);
        }
    });

    // 去掉总计的那一项
    const newRateLotterylist = rateLotterylist.slice(0, -1);
    logger.info('当前返佣等级的返佣比例', newRateLotterylist);
    return newRateLotterylist;
}

/**
传入userinfo的相对层级进行计算返佣,进行层级的计算
 * @param {*} level 传入userinfo的相对层级
 * @param {*} rateLotterylist 返佣配置列表
 * @returns {object} id ,用户层级，返佣金额
*/
export function GetRebateLevelRateByLevel(userInfo, rateLotterylist) {
    if (JSON.stringify(userInfo) === '{}' || rateLotterylist.length < 0) {
        logger.error('层级不能小于0或者返佣比例的列表不能为空');
        return;
    }

    if (userInfo.isNormalCommission == 0) {
        // 正常的返佣
        const matchedItem = rateLotterylist.find((item) => userInfo.hierarchy == item.hierarchy);
        const rate = calculateTotalRebate(matchedItem, userInfo);
        return {
            id: userInfo.userId,
            hierarchy: userInfo.hierarchy,
            rate
        }

    } else {
        // 特殊返佣根据当前会员信息的层级和特殊返佣的层级进行匹配返佣费率配置
        const matchedItem = rateLotterylist.find((item) => userInfo.isNormalCommission == item.hierarchy);
        const rate = calculateTotalRebate(matchedItem, userInfo);
        return {
            id: userInfo.userId,
            hierarchy: userInfo.hierarchy,
            rate
        }
    }
}




// 根据用户的返佣计算的结果进行对于的返佣层级统计
export function rebateStatistics(rebetUserinfo) {
    // 判断rebetUserinfo是否为空
    if (rebetUserinfo === null || rebetUserinfo === undefined) {
        logger.error('rebetUserinfo为空');
        return;
    }
    switch (rebetUserinfo.hierarchy) {
        case 1:
            const rate1 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate1)) {
                levelOneRebate = (levelOneRebate * 100 + rate1 * 100) / 100;
            }
            break;
        case 2:
            const rate2 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate2)) {
                levelTowRebate = (levelTowRebate * 100 + rate2 * 100) / 100;
            }
            break;
        case 3:
            const rate3 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate3)) {
                levelThreeRebate = (levelThreeRebate * 100 + rate3 * 100) / 100;
            }
            break;
        case 4:
            const rate4 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate4)) {
                levelFourRebate = (levelFourRebate * 100 + rate4 * 100) / 100;
            }
            break;
        case 5:
            const rate5 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate5)) {
                levelFiveRebate = (levelFiveRebate * 100 + rate5 * 100) / 100;
            }
            break;
        case 6:
            const rate6 = Number(rebetUserinfo.rate || 0);
            if (!isNaN(rate6)) {
                levelSixRebate = (levelSixRebate * 100 + rate6 * 100) / 100;
            }
            break;
    }
}


/**
 辅助函数计算返佣总额
 * 
 * @param {object} matchedItem 返佣比例配置项
 * @param {object} userInfo 用户的投注信息
 * @returns {number} - 返回计算的总返佣金额
*/
export function calculateTotalRebate(matchedItem, userInfo) {
    let electronearn = 0;
    let liveCasinoearn = 0;
    let sportsearn = 0;
    let lotteryearn = 0;
    let chessCardearn = 0;
    if (matchedItem) {
        // 找到了对于的层级，就取出这个会员的投注金额，进行对于层级的返佣计算
        if (userInfo.electronicGame.length > 0) {
            // 计算电子游戏的返佣
            userInfo.electronicGame.forEach((betAmount) => {
                electronearn += (Number(betAmount || 0) * matchedItem.rateElectronicGame) / 100;
            });
        }
        if (userInfo.liveCasino.length > 0) {
            // 计算真人娱乐的返佣
            userInfo.liveCasino.forEach((betAmount) => {
                liveCasinoearn += (Number(betAmount || 0) * matchedItem.rateLiveCasino) / 100;
            });
        }
        if (userInfo.Sports.length > 0) {
            // 计算体育的返佣
            userInfo.Sports.forEach((betAmount) => {
                sportsearn += (Number(betAmount || 0) * matchedItem.rateSports) / 100;
            });
        }
        if (userInfo.Lottery.length > 0) {
            // 计算彩票的返佣
            userInfo.Lottery.forEach((betAmount) => {
                lotteryearn += (Number(betAmount || 0) * matchedItem.rateLottery) / 100;
            });
        }
        if (userInfo.ChessCard.length > 0) {
            // 计算棋牌的返佣
            (userInfo.ChessCard || []).forEach((betAmount) => {
                chessCardearn += (Number(betAmount || 0) * matchedItem.rateChessCard) / 100;
            });
        }
        // 计算总返佣金额
        let totalRebate = 0;
        totalRebate += electronearn || 0;
        totalRebate += liveCasinoearn || 0;
        totalRebate += sportsearn || 0;
        totalRebate += lotteryearn || 0;
        totalRebate += chessCardearn || 0;
        console.log('\n');
        console.log(`用户${userInfo.userId}的返佣总金额为: ${totalRebate},用户绝对层级为: ${userInfo.hierarchy}`);
        console.log(`电子投注金额:${userInfo.electronicGame},电子返佣: ${electronearn}, 真人投注金额:${userInfo.liveCasino},真人返佣: ${liveCasinoearn}, 体育投注金额:${userInfo.Sports}，体育返佣: ${sportsearn}, 彩票投注金额:${userInfo.Lottery}，彩票返佣: ${lotteryearn}, 棋牌投注:${userInfo.ChessCard}棋牌返佣: ${chessCardearn}`);
        if (userInfo.lockearn) {
            console.log(`用户${userInfo.userId}为锁定返佣，锁定汇率等级为LV: ${userInfo.lockearn},返佣比例:${JSON.stringify(matchedItem)}`);
        } else if (userInfo.specialRebate) {
            console.log(`用户${userInfo.userId}为特殊返佣，特殊汇率等级为LV: ${userInfo.specialRebate},返佣比例:${JSON.stringify(matchedItem)}`);
        } else {
            console.log(`用户${userInfo.userId}为正常返佣，正常汇率等级为LV: ${teamSummary.earnLevel},返佣比例:${JSON.stringify(matchedItem)}`);
        }
        console.log('\n');
        return totalRebate;
    }
    return 0;
}
