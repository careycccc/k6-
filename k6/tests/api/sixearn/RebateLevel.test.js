import { sendRequest, sendQueryRequest } from '../common/request.js';
import { isNonEmptyArray, dateStringToTimestamp } from '../../utils/utils.js';
import { logger } from '../../../libs/utils/logger.js';
import { sixearnTag } from './sixearn.test.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
// 查询后台六级代理配置

export const adminsixearnTag = 'adminsixearn';

/**
 * 查询返佣等级配置
 * @returns {Array} 返佣等级配置
 */
export function RebateLevel(data) {
  const api = '/api/RebateLevel/GetList';
  const result = LevelCommon(data, api);
  if (isNonEmptyArray(result)) {
    return result;
  } else {
    logger.error('返佣等级配置没有查询到结果', result);
  }
}

/**
 * 返佣汇率配置
 * @returns {Array} 返佣汇率配置
 */
export function RebateLevelRate(data) {
  const api = '/api/RebateLevelRate/GetList';
  const result = LevelCommon(data, api);
  if (isNonEmptyArray(result)) {
    return result;
  } else {
    logger.error('返佣等级配置没有查询到结果', result);
  }
}

/**
 * @param {*} userId 用户id
 * @param {*} data token
 * @returns 当前用户的当前的层级和下级的信息
 */
export function getNowMasterHierarchy(data, userId) {
  const api = '/api/Agent/GetPageListAgentList';
  const payload = {
    isAll: false,
    isIncludeSelfAndParent: false,
    userId
  };
  let result = sendQueryRequest(payload, api, adminsixearnTag, false, data.token);
  if (typeof result != 'object') {
    result = JSON.parse(result);
  }
  if (result && result.list) {
    return result.list[0].hierarchy;
  }
  return result;
}

// 辅助函数用于抽离公共查询逻辑
export function LevelCommon(data, api) {
  const token = data.token;
  const payload = {};
  let result = sendRequest(payload, api, adminsixearnTag, false, token);
  if (typeof result != 'object') {
    result = JSON.parse(result);
  }

  if (result && result.data) {
    return result.data;
  }
  return result;
}



let UserBetAmount = {
  userId: 0,
  electoroncicGame: [], // 电子游戏
  liveCasion: [], // 真人娱乐
  Sports: [], // 体育
  Lottery: [], // 彩票
  ChessCard: [], // 棋牌
  betAmountSum: 0.0 // 投注金额总和
};
let totalUserBetAmount = [];

// 投注金额统计的验证函数
// 投注金额统计的验证函数（修正版）
export function VerifyBetAmountStatistics(data) {
  let start = '2026-01-15';
  let end = '2026-01-15';
  const startTime = dateStringToTimestamp(ENV_CONFIG.START_TIME);
  const endTime = dateStringToTimestamp(ENV_CONFIG.END_TIME);
  //let listUser = [5944638, 5944637, 5944512, 5944511, 5944510, 5944509, 5944508, 5944507, 5944506, 5944505, 5944504, 5944503, 5944502, 5944501, 5944500, 5944499, 5944498];
  const hierarchyLevel = 1; // 指定相对层级
  let listUser = querySubAccounts(data, 5944540, 1, start, end, hierarchyLevel); // 查询5级下级账号
  //console.log(`查询到相对层级${hierarchyLevel}的用户列表:`, listUser);
  let totalUserBetAmount = [];

  for (let i = 0; i < listUser.length; i++) {
    // 每个用户都新建一个干净的对象，避免数据污染
    let UserBetAmount = {
      userId: listUser[i],
      electronicGame: [],    // 电子游戏（修正拼写）
      liveCasino: [],        // 真人娱乐（修正拼写）
      Sports: [],            // 体育（统一存数字）
      Lottery: [],           // 彩票
      ChessCard: [],         // 棋牌
      betAmountSum: 0.0
    };

    // 查询5个游戏类别
    for (let j = 0; j < 5; j++) {
      const payload = {
        beginTimeUnix: startTime,
        endTimeUnix: endTime,
        pageSize: 2000,
        sortField: 'BetTime',
        queryTimeType: 'BetTime',
        userId: listUser[i],
        categoryType: j
      };


      let result = sendQueryRequest(
        payload,
        '/api/ThirdGame/GetBetRecordPageList',
        sixearnTag,
        false,
        data.token
      );


      if (typeof result !== 'object') {
        result = JSON.parse(result);
      }

      if (result && result.list && result.list.length > 0) {
        // 统一push betAmount（数字），Sports也一样
        result.list.forEach((item) => {

          const betAmount = parseFloat(item.betAmount) || 0; // 防止字符串或null
          if (j === 0) {
            UserBetAmount.electronicGame.push(betAmount);
          } else if (j === 1) {
            UserBetAmount.liveCasino.push(betAmount);
          } else if (j === 2) {
            UserBetAmount.Sports.push(betAmount);
          } else if (j === 3) {
            UserBetAmount.Lottery.push(betAmount);
          } else if (j === 4) {
            UserBetAmount.ChessCard.push(betAmount);
          }
        });
      } else {
        // 即使没有数据，也初始化为空数组
        console.log('result--->>>>', result);
      }
    }

    // 所有类别查询完后再计算总和（关键！）
    UserBetAmount.betAmountSum =
      UserBetAmount.electronicGame.reduce((sum, val) => sum + val, 0) +
      UserBetAmount.liveCasino.reduce((sum, val) => sum + val, 0) +
      UserBetAmount.Sports.reduce((sum, val) => sum + val, 0) +
      UserBetAmount.Lottery.reduce((sum, val) => sum + val, 0) +
      UserBetAmount.ChessCard.reduce((sum, val) => sum + val, 0);

    totalUserBetAmount.push(UserBetAmount);
  }
  let totalBetAmount = 0.0;
  let userCount = 0;
  const numUsers = totalUserBetAmount.length;
  // 最终输出
  totalUserBetAmount.forEach((userBet) => {
    if (userBet.betAmountSum > 0) {
      userCount++;
      totalBetAmount += userBet.betAmountSum;
    }
    console.log(`用户ID: ${userBet.userId}, ` +
      `电子游戏投注金额: ${userBet.electronicGame.reduce((s, v) => s + v, 0)}, ` +
      `真人娱乐投注金额: ${userBet.liveCasino.reduce((s, v) => s + v, 0)}, ` +
      `体育投注金额: ${userBet.Sports.reduce((s, v) => s + v, 0)}, ` +
      `彩票投注金额: ${userBet.Lottery.reduce((s, v) => s + v, 0)}, ` +
      `棋牌投注金额: ${userBet.ChessCard.reduce((s, v) => s + v, 0)}, ` +
      `总投注金额: ${userBet.betAmountSum}`);
  });
  console.log(`当前相对层级${hierarchyLevel},层级用户${numUsers}投总共有${userCount}个用户, 总投注金额为: ${totalBetAmount}`);
}



/** 
代理报表
@param {*} userId 账号ID
@param {*} userIdType 账号类型 1,会员id,2，上级id,3总代id
@param {*} reportDateFrom 报表开始时间
@param {*} reportDateTo 报表结束时间
@param {*} hierarchyLevel 相对层级
**/
export function querySubAccounts(data, userId, userIdType, reportDateFrom, reportDateTo, hierarchyLevel) {
  const api = '/api/Agent/GetPageListAgentDayReport';
  const token = data.token;
  const payload = {
    userId: userId,
    userIdType,
    isAll: true,
    reportDateFrom,
    reportDateTo,
    hierarchy: hierarchyLevel,
  }
  let result = sendQueryRequest(payload, api, adminsixearnTag, false, token);
  if (typeof result != 'object') {
    result = JSON.parse(result);
  }
  if (result && result.list) {
    // 提取账号ID列表
    const accountIds = result.list.map(account => account.userId);
    return accountIds;
  } else {
    console.error('查询下级账号失败或无结果', result);
    return [];
  }
}