import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { testCommonRequest } from '../common/request.js';
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { getScenario } from '../../../config/scenarios.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

// ============ 账号池（压测必备：避免所有 VU 共用同一账号并发登录）============
// 这个系统是单点登录——同一账号被第二个会话登录会把第一个踢下线。如果 100 个
// VU 都用同一账号并发登录，会互相踢，压测数据完全失真。
// 用 collect-users.js 采集一批账号写到 firebase/2.txt（密码统一是 qwer1234），
// SharedArray 保证多 VU 间共享同一份数组、不重复占内存：
//   cd k6/playwrith && TENANT=3004 TARGET=100 SETPWD=true node collect-users.js
const userNames = new SharedArray('accounts', function () {
  const txtPath = '../activity/firebase/2.txt'; // account 列表，每行一个手机号(含国家码)
  const content = open(txtPath);

  if (!content) {
    throw new Error(`无法加载账号池文件: ${txtPath}，请先运行 collect-users.js 采集账号`);
  }

  const accounts = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (accounts.length === 0) {
    throw new Error(`账号池文件 ${txtPath} 为空，请先运行 collect-users.js 采集账号`);
  }
  return accounts;
});

const tag = 'desklogin';

// ============ 压测配置（通过 -e SCENARIO= 切换 config/scenarios.js 的标准场景，默认 smoke）============
export const options = {
  scenarios: {
    desklogin: getScenario(__ENV.SCENARIO || 'smoke')
  },

  thresholds: hanlderThresholds(tag),

  // 定义标签对象，用于标识和分类测试数据
  tags: {
    // 环境标识，从环境变量中获取，若未设置则默认为'local'
    environment: __ENV.ENVIRONMENT || 'local',
    // 测试类型标识，表明这是API测试
    test_type: 'api',
    // 服务标识，表明这是用户服务相关的测试
    service: 'user',
    // 操作标识，使用传入的tag参数来具体标识测试的操作类型
    operation: tag
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ 每个 VU 执行（均匀分配账号，避免同账号并发互踢）============
export default function () {
  const api = '/api/Home/Login';
  // 均匀分配账号（高并发下最公平），VU 和迭代次数共同决定取到哪个账号
  const index = (__VU - 1 + __ITER) % userNames.length;
  const userName = userNames[index];
  const timeData = getTimeRandom();

  const data = {
    userName: userName,
    password: 'qwer1234', // collect-users.js 采集时统一重置的密码
    loginType: 'Mobile',
    deviceId: '',
    browserId: generateCryptoRandomString(32),
    packageName: '',
    random: timeData.random,
    language: timeData.language,
    signature: '',
    timestamp: timeData.timestamp
  };

  testCommonRequest(data, api, tag);
}
