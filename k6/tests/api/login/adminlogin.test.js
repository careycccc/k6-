import { hanlderThresholds } from '../../../config/thresholds.js';
import { loadConfigFromFile } from '../../../config/load.js';
import { sendRequest } from '../../api/common/request.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

export const adminTag = 'adminlogin';
const loader = loadConfigFromFile();

export const options = {
  // 或者简单固定并发
  vus: 1,
  // 只发一次
  iterations: 1,

  thresholds: hanlderThresholds(adminTag),

  // 定义标签对象，用于标识和分类测试数据
  tags: {
    // 环境标识，从环境变量中获取，若未设置则默认为'local'
    environment: loader.local.env,
    // 测试类型标识，表明这是API测试
    test_type: 'adminapi',
    // 服务标识，表明这是用户服务相关的测试
    service: 'user',
    // 操作标识，使用传入的tag参数来具体标识测试的操作类型
    operation: adminTag
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};
// 后台登录
export function AdminLogin() {
  const api = '/api/Login/Login';
  const data = {
    userName: ENV_CONFIG.ADMIN_USERNAME,
    pwd: ENV_CONFIG.ADMIN_PASSWORD
  };
  const token = sendRequest(data, api, adminTag, false);
  // console.log('setup: 后台登录获取 token', token);
  return token;
}
