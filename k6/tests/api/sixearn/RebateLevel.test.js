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

// 投注金额统计的验证函数
export function VerifyBetAmountStatistics(data) {
  const startTime = dateStringToTimestamp(ENV_CONFIG.START_TIME);
  const endTime = dateStringToTimestamp(ENV_CONFIG.END_TIME);
  const payload = {
    beginTimeUnix: startTime,
    endTimeUnix: endTime,
    pageSize: 2000,
    sortField: 'BetTime',
    queryTimeType: 'BetTime',
    categoryType: 3
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
  let betAmountSum = 0; // 投注金额总和

  if (result && result.list.length > 0) {
    result.list.forEach((item) => {
      betAmountSum += item.betAmount;
    });
    console.log(`投注金额总和为：${betAmountSum}`);
  }
  //console.log('result*********', result);
}
