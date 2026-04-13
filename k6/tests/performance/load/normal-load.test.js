/**
 * 常规负载测试 - 模拟正常日常流量
 *
 * 游戏公司标准：
 *   - 模拟日常稳定并发玩家登录 + 新用户注册
 *   - 预热 → 正常负载 → 高峰 → 冷却 四阶段
 *   - p95 < 5000ms，错误率 < 1%
 *
 * 账号 CSV 路径：k6/data/csv/accounts.csv（可通过 -e ACCOUNTS_CSV=./path 覆盖）
 *
 * 运行命令（示例）：
 *   k6 run k6/tests/performance/load/normal-load.test.js -e TENANT=3004
 *   k6 run k6/tests/performance/load/normal-load.test.js -e TENANT=3004 -e ENVIRONMENT=staging
 *   k6 run k6/tests/performance/load/normal-load.test.js -e TENANT=3004 -e ACCOUNTS_CSV=./k6/data/csv/accounts.csv
 */

import http from 'k6/http';
import { sleep, group, check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { hanlderThresholds } from '../../../config/thresholds.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';
import { getScenario, adaptScenarioForEnvironment } from '../../../config/scenarios.js';
import { httpClient } from '../../../libs/http/client.js';
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { loadAccounts, getAccount } from '../../../data/loader/accountLoader.js';
import { AdminLogin } from '../../api/login/adminlogin.test.js';
import { mobileAutoLoginFlow } from '../../api/login/MobileAutoLogin.test.js';
import { phoneRegister } from '../../api/login/register.test.js';

// ============ 自定义指标 ============
const loginSuccessRate   = new Rate('load_login_success_rate');
const registerSuccessRate = new Rate('load_register_success_rate');
const loginDuration      = new Trend('load_login_duration_ms', true);
const registerDuration   = new Trend('load_register_duration_ms', true);
const totalRequests      = new Counter('load_total_requests');

// ============ 环境 ============
const TENANT      = __ENV.TENANT || '3004';
const ENVIRONMENT = __ENV.ENVIRONMENT || 'local';
const envConfig   = getEnvByTenantId(TENANT);

// ============ 从 CSV 加载账号池（SharedArray，跨 VU 共享内存）============
// CSV 路径优先级：-e ACCOUNTS_CSV=xxx > 默认 ./k6/data/csv/accounts.csv
const ACCOUNTS = loadAccounts();

// ============ 场景配置 ============
const baseScenario = getScenario('load.normal');
const adaptedScenario = adaptScenarioForEnvironment(baseScenario, ENVIRONMENT);

export const options = {
  scenarios: {
    // 场景一：已注册用户登录（模拟 80% 老玩家）
    normal_login: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },  // 预热：30秒内爬升至10 VU
        { duration: '2m',  target: 40 },  // 正常负载：保持40 VU运行2分钟
        { duration: '1m',  target: 80 },  // 高峰时段：80 VU运行1分钟
        { duration: '30s', target: 10 },  // 冷却：降回10 VU
        { duration: '20s', target: 0  },  // 收尾
      ],
      gracefulRampDown: '30s',
      exec: 'loginScenario',
      tags: { test_type: 'load', scenario: 'normal_login', service: 'user' }
    },

    // 场景二：新用户注册（模拟 20% 新玩家，注册操作比登录慢）
    normal_register: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 0  },  // 等待登录场景先预热
        { duration: '1m',  target: 5  },  // 缓慢增加注册压力
        { duration: '2m',  target: 10 },  // 稳定注册并发
        { duration: '40s', target: 0  },  // 收尾
      ],
      gracefulRampDown: '30s',
      exec: 'registerScenario',
      tags: { test_type: 'load', scenario: 'normal_register', service: 'user' }
    }
  },

  thresholds: {
    // 整体请求阈值
    http_req_failed: ['rate<0.01'],                          // 总错误率 < 1%
    http_req_duration: ['p(95)<5000', 'p(99)<10000'],       // p95 < 5s，p99 < 10s

    // 登录专项
    'load_login_success_rate':  ['rate>0.99'],               // 登录成功率 > 99%
    'load_login_duration_ms':   ['p(95)<3000'],              // 登录 p95 < 3s

    // 注册专项（注册涉及验证码，允许稍慢）
    'load_register_success_rate': ['rate>0.95'],             // 注册成功率 > 95%
    'load_register_duration_ms':  ['p(95)<8000'],            // 注册 p95 < 8s
  },

  tags: {
    environment: ENVIRONMENT,
    tenant: TENANT,
    test_type: 'load',
    test_level: 'normal'
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ Setup：获取公共 AdminToken ============
export function setup() {
  console.log(`[NormalLoad] 环境: ${ENVIRONMENT}, 租户: ${TENANT}`);
  console.log(`[NormalLoad] 前台地址: ${envConfig.BASE_DESK_URL}`);
  console.log(`[NormalLoad] 账号池大小: ${ACCOUNTS.length} 个账号`);
  console.log(`[NormalLoad] 场景配置: ${JSON.stringify(adaptedScenario, null, 2)}`);

  const adminToken = AdminLogin();
  if (!adminToken) {
    throw new Error('[NormalLoad] ❌ 获取 AdminToken 失败，无法启动压测');
  }
  console.log(`[NormalLoad] ✅ AdminToken 获取成功`);

  return {
    adminToken,
    envConfig
  };
}

// ============ 场景一：登录（使用密码登录方式）============
export function loginScenario(data) {
  // 从 CSV 账号池均匀分配账号（VU + ITER 双维度轮询）
  const account = getAccount(ACCOUNTS);
  const timeData = getTimeRandom();

  group('用户登录', () => {
    const startTime = Date.now();
    totalRequests.add(1);

    const payload = {
      userName: account.userName,
      password: account.password,
      loginType: 'Mobile',
      deviceId: '',
      browserId: generateCryptoRandomString(32),
      packageName: '',
      random: timeData.random,
      language: timeData.language,
      signature: '',
      timestamp: timeData.timestamp
    };

    const resp = httpClient.post('/api/Home/Login', payload, {
      params: { tags: { type: 'load_login', name: 'login_request' } }
    }, true);

    const duration = Date.now() - startTime;
    loginDuration.add(duration);

    const ok = check(resp, {
      '登录-状态码200':     (r) => r && r.status === 200,
      '登录-业务码成功':    (r) => {
        if (!r || !r.body) return false;
        try {
          const body = JSON.parse(r.body);
          return body.msgCode === 0 || body.code === 0;
        } catch { return false; }
      },
      '登录-返回token':     (r) => {
        if (!r || !r.body) return false;
        try {
          const body = JSON.parse(r.body);
          return !!(body.data && body.data.token);
        } catch { return false; }
      }
    });

    loginSuccessRate.add(ok);

    if (!ok) {
      console.warn(`[NormalLoad][Login] ⚠️ VU=${__VU} 登录失败, 账号=${account.userName}, 耗时=${duration}ms`);
    }
  });

  // 模拟玩家登录后的短暂停留（1~3秒）
  sleep(Math.random() * 2 + 1);
}

// ============ 场景二：注册新账号 ============
export function registerScenario(data) {
  const countryCode = envConfig.COUNTRY_CODE || '91';
  // 每次生成唯一手机号
  let phoneNum = countryCode;
  for (let i = 0; i < 10; i++) {
    phoneNum += Math.floor(Math.random() * 10);
  }

  group('新用户注册', () => {
    const startTime = Date.now();
    totalRequests.add(1);

    const adminData = {
      token: data.adminToken,
      envConfig: data.envConfig
    };

    const result = phoneRegister(phoneNum, adminData, 'qwer1234', '');
    const duration = Date.now() - startTime;
    registerDuration.add(duration);

    const ok = result !== null && result.code === 0;
    registerSuccessRate.add(ok);

    if (!ok) {
      console.warn(`[NormalLoad][Register] ⚠️ VU=${__VU} 注册失败, 手机号=${phoneNum}, 耗时=${duration}ms`);
    }
  });

  // 注册后停留较长（模拟填写信息、引导流程）
  sleep(Math.random() * 3 + 2);
}

// ============ 报告 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportName = `normal-load-${ENVIRONMENT}-${TENANT}-${timestamp}`;

  console.log(`\n[NormalLoad] ===== 常规负载测试完成 =====`);
  console.log(`[NormalLoad] 登录成功率: ${(data.metrics['load_login_success_rate']?.values?.rate * 100 || 0).toFixed(2)}%`);
  console.log(`[NormalLoad] 注册成功率: ${(data.metrics['load_register_success_rate']?.values?.rate * 100 || 0).toFixed(2)}%`);

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${reportName}-report.html`]: htmlReport(data, { title: `常规负载测试 - ${ENVIRONMENT} - Tenant:${TENANT}` })
  };
}
