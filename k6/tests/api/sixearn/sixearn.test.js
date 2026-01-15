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
// 团队的所有账号
const allTeamAccounts = [];
// 自定义用户信息
const customUserInfo = {
  userId: 0,
  isFirstCharge: false, // 是否首充
  betAmountSum: 0, // 总投注金额
  totalRechargeAmount: 0, // 总充值金额
  hierarchy: -2, // 当前用户的绝对层级
  isNormalCommission: -8 // 是否正常返佣
};

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
  betAmountSum: 0 // 团队的总投注金额
};

// 查询该账号的下级账号
export function querySubAccounts(data) {
  // 必须接收 data 参数来拿 token
  const token = data.token;
  // 模拟查询下级账号的逻辑
  const api = '/api/Agent/GetPageListAgentList';
  // 这里输入要查询的团队的返佣，总代的id
  const accountId = 5944453;
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

  if (result && result.list && result.list.length > 0) {
    // 处理获取到的账号列表
    result.list.forEach((item) => {
      allTeamAccounts.push(item);
    });
  }
  const startTime = dateStringToTimestamp(ENV_CONFIG.START_TIME);
  const endTime = dateStringToTimestamp(ENV_CONFIG.END_TIME);
  // 团队总人数和信息
  const totalcustomUserInfo = [];
  // 找出当前总代的层级
  const nowMasterHierarchy = getNowMasterHierarchy(data, accountId);
  if (allTeamAccounts.length > 0) {
    if (typeof nowMasterHierarchy != 'number' || nowMasterHierarchy < 0) {
      logger.error('当前总代层级获取失败', nowMasterHierarchy);
      return;
    }
    allTeamAccounts.forEach((account) => {
      sleep(0.5);
      // 团队不包括总代的这个会员
      if (account.userId != accountId) {
        const userInfo = getUserCurrentInfo(
          data,
          account.userId,
          account.hierarchy,
          startTime,
          endTime
        );
        //console.log('当前用户的信息userInfo>>>>>', userInfo);
        if (userInfo.hierarchy >= nowMasterHierarchy) {
          userInfo.registerTime = account.registerTime;
          totalcustomUserInfo.push(userInfo);
        }
      }
    });
  }

  // 找出直属一级的用户信息
  totalcustomUserInfo.forEach((item) => {
    if (item.hierarchy == nowMasterHierarchy + 1) {
      firstLevelAccounts.push(item);
    }
  });
  if (firstLevelAccounts.length == 0) {
    logger.error('当前总代没有直属一级的账号');
    return;
  }
  // 计算直属一级的汇总信息
  firstLevelSummary.firstTotalNumber = firstLevelAccounts.length;
  firstLevelSummary.betAmountSum = 0; // 重置为0
  let betUsersCount = 0; // 统计投注金额不为0的用户数
  firstLevelAccounts.forEach((info, index) => {
    if (info.totalRechargeAmount > 0) {
      firstLevelSummary.depUsers++;
      firstLevelSummary.totalRechargeAmount += Number(info.totalRechargeAmount || 0);
    }
    firstLevelSummary.depAmount += Number(info.totalRechargeAmount || 0);
    // 确保betAmountSum是数字类型后再累加
    const currentBetAmount = Number(info.betAmountSum || 0);
    console.log(`第${index + 1}个用户投注金额: ${currentBetAmount}`);

    // 统计投注金额不为0的用户
    if (currentBetAmount > 0) {
      betUsersCount++;
    }

    firstLevelSummary.betAmountSum += currentBetAmount;
    console.log(`累加后总投注金额: ${firstLevelSummary.betAmountSum}`);
    if (isNaN(firstLevelSummary.betAmountSum)) {
      console.log(
        `检测到NaN! info.betAmountSum=${info.betAmountSum}, currentBetAmount=${currentBetAmount}`
      );
    }
    if (info.isFirstCharge) {
      firstLevelSummary.firstDepUsers++;
    }
    // 记录注册人数
    if (info.registerTime >= startTime && info.registerTime <= endTime) {
      firstLevelSummary.registerUsers++;
    }
  });

  console.log(`投注金额不为0的直属一级用户数量: ${betUsersCount}`);

  // 计算团队的汇总信息
  teamSummary.teamTotalNumber = totalcustomUserInfo.length;
  let teamBetUsersCount = 0; // 统计团队中投注金额不为0的用户数
  totalcustomUserInfo.forEach((info) => {
    if (info.totalRechargeAmount > 0) {
      teamSummary.depUsers++;
      teamSummary.totalRechargeAmount += Number(info.totalRechargeAmount || 0);
    }
    teamSummary.depAmount += Number(info.totalRechargeAmount || 0);
    // 确保betAmountSum是数字类型后再累加
    const currentBetAmount = Number(info.betAmountSum || 0);
    // 统计投注金额不为0的用户
    if (currentBetAmount > 0) {
      teamBetUsersCount++;
    }
    teamSummary.betAmountSum += currentBetAmount;
    if (info.isFirstCharge) {
      teamSummary.firstDepUsers++;
    }
    // 记录注册人数
    if (info.registerTime >= startTime && info.registerTime <= endTime) {
      teamSummary.registerUsers++;
    }
  });

  console.log(`团队中投注金额不为0的用户数量: ${teamBetUsersCount}`);
  // 找出团队当日的充值人数根据充值人数定位是返佣等级
  const rebateLevel = GetTeamRechargeUserCount(
    teamSummary.depUsers,
    teamSummary.depAmount,
    teamSummary.betAmountSum,
    data
  );
  if (rebateLevel < 0) {
    logger.error('当前团队没有任何的获取返佣等级', rebateLevel);
    return;
  }
  console.log(`当前团队返佣等级为:${rebateLevel}`);
  // 根据返佣等级找出返佣比例
  const rateLotterylist = GetRebateLevelRate(rebateLevel, data);
  if (isNonEmptyArray(rateLotterylist) && rateLotterylist.length <= 6) {
    totalcustomUserInfo.forEach((userInfo) => {
      // 传入userinfo的相对层级进行计算返佣,进行层级的计算
      const rebetUserinfo = GetRebateLevelRateByLevel(userInfo, rateLotterylist);
      // 根据返回的结果进行对于的返佣层级统计
      rebateStatistics(rebetUserinfo);
    });
    let levelOneRebatefiexd = Number(levelOneRebate).toFixed(2);
    let levelTowRebatefiexd = Number(levelTowRebate).toFixed(2);
    let levelThreeRebatefiexd = Number(levelThreeRebate).toFixed(2);
    let levelFourRebatefiexd = Number(levelFourRebate).toFixed(2);
    let levelFiveRebatefiexd = Number(levelFiveRebate).toFixed(2);
    let levelSixRebatefiexd = Number(levelSixRebate).toFixed(2);
    let totalRebatefiexd = (
      parseFloat(levelOneRebate) +
      parseFloat(levelTowRebate) +
      parseFloat(levelThreeRebate) +
      parseFloat(levelFourRebate) +
      parseFloat(levelFiveRebate) +
      parseFloat(levelSixRebate)
    ).toFixed(2);
    logger.info(`一级返佣:${levelOneRebatefiexd}`);
    logger.info(`二级返佣:${levelTowRebatefiexd}`);
    logger.info(`三级返佣:${levelThreeRebatefiexd}`);
    logger.info(`四级返佣:${levelFourRebatefiexd}`);
    logger.info(`五级返佣:${levelFiveRebatefiexd}`);
    logger.info(`六级返佣:${levelSixRebatefiexd}`);
    logger.info(`总返佣:${totalRebatefiexd}`);
    console.log(
      `直属一级的汇总信息:注册人数：${firstLevelSummary.registerUsers},直属总一级人数：${firstLevelSummary.firstTotalNumber},充值人数：${firstLevelSummary.depUsers},充值金额：${firstLevelSummary.depAmount},首充人数：${firstLevelSummary.firstDepUsers},总投注金额：${firstLevelSummary.betAmountSum}`
    );
    console.log(
      `团队的汇总信息:注册人数：${teamSummary.registerUsers},团队总人数：${teamSummary.teamTotalNumber},充值人数：${teamSummary.depUsers},充值金额：${teamSummary.depAmount},首充人数：${teamSummary.firstDepUsers},总投注金额：${teamSummary.betAmountSum}`
    );
  } else {
    logger.error('当前团队没有任何的获取返佣比例,或者返佣比例不等于6', rateLotterylist);
  }
}

/**
 * 获取用户的当前信息
 * @param {number} userId - 用户ID
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param { number } hierarchy - 当前用户的绝对层级
 * @returns {Object}  - 用户的当前信息
 */
export function getUserCurrentInfo(data, userId, hierarchy, startTime, endTime) {
  customUserInfo.userId = userId;
  customUserInfo.hierarchy = hierarchy;
  // 1.查询账号的昨日的充值
  const toUpInfo = GetRechargeOrderPageList(data, userId, 'Payed', startTime, endTime);
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
  const betInfo = GetBetRecordPageList(data, userId, 3, startTime, endTime, 'BetTime', 'BetTime');
  // 投注金额，不是有效投注
  if (isNonEmptyArray(betInfo)) {
    // 使用更精确的大数相加方法
    let betAmountSum = 0;
    for (const item of betInfo) {
      const amount = Number(item.betAmount || 0);
      if (!isNaN(amount)) {
        betAmountSum = (betAmountSum * 100 + amount * 100) / 100;
      }
    }
    customUserInfo.betAmountSum = betAmountSum;
  }
  // 3.查询账号的的首充信息
  const userRptRechargeInfo = GetUserRptRechargePageList(
    data,
    userId,
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
 * @param {number} userId - 用户ID
 * @param {number} startTime - 开始时间
 * @param {number} endTime - 结束时间
 * @param {string} queryTimeType - 查询时间类型
 * @param {string} sortField - 排序字段
 * @param {int} categoryType - 0表示电子游戏，1真人视讯，2体育，3，彩票，4棋牌
 * @returns {object}  - 投注订单[]{投注金额betAmountSum,有效投注validAmountSum,派奖金额 winAmountSum,盈亏winLoseAmount,税收feeAmountSum}，或者响应信息
 */
export function GetBetRecordPageList(
  data,
  userId,
  categoryType,
  startTime,
  endTime,
  queryTimeType,
  sortField
) {
  const api = '/api/ThirdGame/GetBetRecordPageList';
  const token = data.token;
  const payload = {
    categoryType,
    queryTimeType,
    userId,
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
    // 处理获取到的投注信息
    return result.list;
  }
  //console.log('投注信息：', result);
  return result;
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

/**
 定位是返佣等级
 * @param {int
            // 判断 是否满足下一层
            return result[i].rebateLevel
        }

    }
}

// 根据返佣等级找出返佣比例
/**
 * @param {*} rebateLevel 返佣等级
 * @returns 
*/
export function GetRebateLevelRate(rebateLevel, data) {
  rebateConfigs = RebateLevelRate(data);
  // 搜集当前返佣等级的返佣比例
  const rateLotterylist = [];
  rebateConfigs.forEach((item) => {
    if (item.rebateLevel == rebateLevel) {
      // 找到了对于的等级的,因为只进行了彩票投注所以已彩票投注为例
      if (isNonEmptyArray(item.list)) {
        item.list.forEach((it) => {
          rateLotterylist.push({
            rateLottery: it.rateLottery,
            hierarchy: it.hierarchy
          });
        });
      }
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
 * @param {*} rateLotterylist 返佣比例
 * @returns {object} id ,用户层级，返佣金额
*/
export function GetRebateLevelRateByLevel(userInfo, rateLotterylist) {
  if (JSON.stringify(userInfo) === '{}' || rateLotterylist.length < 0) {
    logger.error('层级不能小于0或者返佣比例的列表不能为空');
    return;
  }
  if (userInfo.isNormalCommission == -8) {
    // 正常的返佣
    const matchedItem = rateLotterylist.find((item) => userInfo.hierarchy == item.hierarchy);
    if (matchedItem) {
      // 找到了对于的层级，就取出这个会员的投注金额，进行对于层级的返佣计算
      const userinfoRate = (Number(userInfo.betAmountSum || 0) * matchedItem.rateLottery) / 100;
      return {
        id: userInfo.userId,
        hierarchy: matchedItem.hierarchy,
        rate: userinfoRate
      };
    }
  } else {
    console.log(`这个会员为${userInfo.userId}特殊返佣`);
    // 特殊返佣根据当前会员信息的层级和特殊返佣的层级进行匹配返佣费率配置
    if (rebateConfigs.length == 0) {
      logger.error('返佣配置比例的列表不能为空');
      return {};
    }
    // 当前特殊返佣的层级 **************************************
    let NormalCommissionLevel = [];
    for (let i = 0; i < rebateConfigs.length; i++) {
      const result = rebateConfigs[userInfo.isNormalCommission];
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
          NormalCommissionLevel = result[i].rebateLevel;
        }
      }
    }
  }

  return {};
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
