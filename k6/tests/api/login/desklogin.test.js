// import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';
// import { SharedArray } from 'k6/data';
import http from 'k6/http';
import { testCommonRequest } from '../common/request.js';
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

// ============ 高效加载 CSV 用户名（压测必备）============

// const userNames = new SharedArray('accounts', function () {
//   const csvPath = './k6/data/csv/accounts.csv'; // 必要时改为绝对路径，如 'C:/full/path/accounts.csv'

//   const content = open(csvPath);

//   if (!content) {
//     throw new Error(`无法加载文件: ${csvPath}，请检查路径和文件是否存在`);
//   }

//   // 解析CSV，假设有header（username,password）
//   const parsed = papaparse.parse(content, {
//     header: false, // 返回对象数组 [{username: '...', password: '...'}]
//     skipEmptyLines: true // 跳过空行
//   });

//   if (parsed.errors && parsed.errors.length > 0) {
//     logger.error('CSV解析错误:', parsed.errors);
//   }

//   return parsed.data; // 返回数组，SharedArray会共享内存
// });

// if (userNames.length === 0) {
//   throw new Error('accounts.csv 文件为空或加载失败！请检查路径和内容');
// }

// logger.info(`成功加载 ${userNames.length} 个用户名`);

const tag = 'desklogin';

// ============ 压测配置（可自由调整）============
export const options = {
  // 示例：渐进加压
  //   executor: 'ramping-vus',
  //   stages: [
  //     { duration: '2m', target: 50 }, // 2分钟升到50
  //     { duration: '5m', target: 50 }, // 新增：稳定在50 VU 运行5分钟（可调整时长）
  //     { duration: '5m', target: 200 }, // 再用10分钟升到200，并稳定
  //     { duration: '2m', target: 0 } // 降到0
  //   ],

  // 或者简单固定并发
  vus: 1,
  duration: '1s',

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

// ============ 每个 VU 执行（均匀分配用户名）============
export function RunDesklogin() {
  const api = '/api/Home/Login';
  // 均匀分配用户名（高并发下最公平）
  //   const index = (__VU - 1 + __ITER) % userNames.length;
  //   const userName = userNames[index];
  //   //logger.info(`当前用户名：${userName[0]}`);
  const timeData = getTimeRandom();

  const data = {
    userName: '911229893359',
    password: 'qwer1234', // 固定密码
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
