import http from 'k6/http';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';
import { SharedArray } from 'k6/data';
import { testLoginteUser } from './k6/tests/api/login/desklogin.test.js';
import { generateCryptoRandomString, getTimeRandom } from './k6/tests/utils/utils.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ============ 高效加载 CSV 用户名（压测必备）============

const userNames = new SharedArray('accounts', function () {
  const csvPath = './k6/data/csv/accounts.csv'; // 必要时改为绝对路径，如 'C:/full/path/accounts.csv'

  const content = open(csvPath);

  if (!content) {
    throw new Error(`无法加载文件: ${csvPath}，请检查路径和文件是否存在`);
  }

  // 解析CSV，假设有header（username,password）
  const parsed = papaparse.parse(content, {
    header: false, // 返回对象数组 [{username: '...', password: '...'}]
    skipEmptyLines: true // 跳过空行
  });

  if (parsed.errors && parsed.errors.length > 0) {
    console.error('CSV解析错误:', parsed.errors);
  }

  return parsed.data; // 返回数组，SharedArray会共享内存
});

if (userNames.length === 0) {
  throw new Error('accounts.csv 文件为空或加载失败！请检查路径和内容');
}

console.log(`成功加载 ${userNames.length} 个用户名`);

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }));

// ============ 压测配置（可自由调整）============
export const options = {
  // 示例：渐进加压
  executor: 'ramping-vus',
  stages: [
    { duration: '2m', target: 50 }, // 2分钟升到50
    { duration: '5m', target: 50 }, // 新增：稳定在50 VU 运行5分钟（可调整时长）
    { duration: '10m', target: 200 }, // 再用10分钟升到200，并稳定
    { duration: '2m', target: 0 } // 降到0
  ],

  // 或者简单固定并发
  // vus: 200,
  // duration: '4s',

  thresholds: {
    login_success_requests: ['rate>0.99'],
    'http_req_duration{type:"login"}': ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99']
  },

  tags: {
    environment: __ENV.ENVIRONMENT || 'local',
    test_type: 'api',
    service: 'user',
    operation: 'login'
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ 每个 VU 执行（均匀分配用户名）============
export default function () {
  // 均匀分配用户名（高并发下最公平）
  const index = (__VU - 1 + __ITER) % userNames.length;
  const userName = userNames[index];
  //console.log(`当前用户名：${userName[0]}`);
  const timeData = getTimeRandom();

  const data = {
    userName: userName[0],
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

  testLoginteUser(data);
}

// ============ 报告生成 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testName = '登录压测';
  const environment = __ENV.ENVIRONMENT || 'local';

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),

    [`reports/${testName}-${environment}-${timestamp}-report.html`]: htmlReport(data, {
      title: `${testName} - ${environment}`
    })
  };
}
