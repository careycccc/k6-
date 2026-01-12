import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
//import { loadConfigFromFile } from '../../../config/load.js';
import { querySubAccounts as sixearnFunc, sixearnTag } from '../sixearn/sixearn.test.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { logger } from '../../../libs/utils/logger.js';
import {
  RebateLevel as RebateLevelFunc,
  RebateLevelRate as RebateLevelRateFunc
} from '../sixearn/RebateLevel.test.js';

//优惠券的创建和启用
// const loader = loadConfigFromFile();

// ==================== setup：全局登录一次 ====================
export function setup() {
  try {
    const token = AdminLogin();
    console.log('token----', token);
    if (!token) {
      logger.error('AdminLogin 返回空值，登录失败');
      throw new Error('AdminLogin 返回空 token');
    }
    return { token };
  } catch (error) {
    logger.error('AdminLogin 发生异常:', error.message);
    throw new Error(`登录失败: ${error.message}`);
  }
}

export function querySubAccounts(data) {
  return sixearnFunc(data);
}

export function RebateLevel(data) {
  return RebateLevelFunc(data);
}

export function RebateLevelRate(data) {
  return RebateLevelRateFunc(data);
}

const thresholds = {
  // 合并所有场景的阈值
  ...hanlderThresholds(adminTag),
  ...hanlderThresholds(sixearnTag)
  //...hanlderThresholds(adminsixearnTag)
};

// 场景配置
export const options = {
  scenarios: {
    // 场景1：后台登录
    login: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1, // 只运行一次
      maxDuration: '10s'
    },
    // // 场景2：查询下级账号
    querySubAccounts: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1, // 只运行一次
      exec: 'querySubAccounts',
      startTime: '2s',
      maxDuration: '10s'
    }
    // 场景3: 查询后台的配置
    // RebateLevel: {
    //     executor: 'shared-iterations',
    //     vus: 1,
    //     iterations: 1, // 只运行一次
    //     exec: 'RebateLevel',
    //     startTime: '2s'
    // }
  },
  thresholds: thresholds // 或按 tag 分开
};

export default function () {}
