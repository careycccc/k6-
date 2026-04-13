/**
 * 压力测试（Stress Test）- 探测系统极限破坏点
 *
 * 游戏公司标准场景：
 *   - 不断递增并发，寻找系统在哪个 VU 数量下开始劣化（错误率上升、延迟飙高）
 *   - 模拟：黑五促销 / 赛事决赛日 / 全平台双倍充值活动
 *   - 目标：找到 "临界负载点"，为容量规划提供数据依据
 *
 * 阶段设计（递增加压）：
 *   50 → 100 → 200 → 300 → 400 → 500 VU（每阶段3分钟）
 *
 * 运行命令（示例）：
 *   k6 run k6/tests/performance/stress/stress.test.js -e TENANT=3004
 *   k6 run k6/tests/performance/stress/stress.test.js -e TENANT=3004 -e MAX_VUS=500
 *   k6 run k6/tests/performance/stress/stress.test.js -e TENANT=3004 -e ACCOUNTS_CSV=./k6/data/csv/accounts.csv
 */

import http from 'k6/http';
import { sleep, group, check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { getEnvByTenantId } from '../../../config/envconfig.js';
import { httpClient } from '../../../libs/http/client.js';
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { loadAccounts, getAccount } from '../../../data/loader/accountLoader.js';
import { AdminLogin } from '../../api/login/adminlogin.test.js';
import { phoneRegister } from '../../api/login/register.test.js';

// ============ 自定义指标 ============
const stressLoginSuccessRate    = new Rate('stress_login_success_rate');
const stressRegisterSuccessRate = new Rate('stress_register_success_rate');
const stressLoginDuration       = new Trend('stress_login_duration_ms', true);
const stressRegisterDuration    = new Trend('stress_register_duration_ms', true);
const stressTotalReqs           = new Counter('stress_total_requests');
const stressErrorCount          = new Counter('stress_error_count');

// ============ 环境 & 参数 ============
const TENANT      = __ENV.TENANT || '3004';
const ENVIRONMENT = __ENV.ENVIRONMENT || 'local';
const MAX_VUS     = parseInt(__ENV.MAX_VUS || '500', 10);
const envConfig   = getEnvByTenantId(TENANT);

// ============ 从 CSV 加载账号池（SharedArray，跨 VU 共享内存）============
// CSV 路径优先级：-e ACCOUNTS_CSV=xxx > 默认 ./k6/data/csv/accounts.csv
const STRESS_ACCOUNTS = loadAccounts();

export const options = {
  scenarios: {
    // 主场景：阶梯式压力登录（探测服务极限）
    stress_login: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        // === 阶梯递增加压（每阶段先爬升再持续） ===
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.1)  },  // Level 1: 10%
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.1)  },  // 持续观测
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.2)  },  // Level 2: 20%
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.2)  },  // 持续观测
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.4)  },  // Level 3: 40%
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.4)  },  // 持续观测
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.6)  },  // Level 4: 60%
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.6)  },  // 持续观测
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.8)  },  // Level 5: 80%
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.8)  },  // 持续观测
        { duration: '1m',  target: MAX_VUS                    },  // Level 6: 100% 极限
        { duration: '3m',  target: MAX_VUS                    },  // 持续极限压力
        // === 恢复阶段 ===
        { duration: '1m',  target: Math.floor(MAX_VUS * 0.3)  },  // 快速降压
        { duration: '2m',  target: Math.floor(MAX_VUS * 0.3)  },  // 恢复期观测
        { duration: '30s', target: 0                           },  // 归零
      ],
      gracefulRampDown: '1m',
      exec: 'stressLoginScenario',
      tags: { test_type: 'stress', scenario: 'stress_login', service: 'user' }
    },

    // 次场景：压力注册（模拟活动期间新用户涌入）
    stress_register: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',  target: 0  },  // 等待系统达到中等压力
        { duration: '2m',  target: Math.floor(MAX_VUS * 0.05) },  // 5% 峰值做注册
        { duration: '6m',  target: Math.floor(MAX_VUS * 0.05) },  // 持续
        { duration: '4m',  target: Math.floor(MAX_VUS * 0.08) },  // 极限期间的注册
        { duration: '3m',  target: Math.floor(MAX_VUS * 0.08) },  // 持续
        { duration: '3m',  target: 0  },  // 收尾
      ],
      gracefulRampDown: '1m',
      exec: 'stressRegisterScenario',
      tags: { test_type: 'stress', scenario: 'stress_register', service: 'user' }
    }
  },

  thresholds: {
    // 压力测试阈值（比正常负载宽松，重在找极限而非强制通过）
    http_req_failed:                  ['rate<0.10'],          // 全局错误率 < 10%
    http_req_duration:                ['p(95)<10000'],        // p95 < 10s（压力下允许较慢）

    'stress_login_success_rate':      ['rate>0.90'],          // 登录成功率 > 90%
    'stress_login_duration_ms':       ['p(95)<8000'],         // 登录 p95 < 8s
    'stress_register_success_rate':   ['rate>0.85'],          // 注册成功率 > 85%
    'stress_register_duration_ms':    ['p(95)<15000'],        // 注册 p95 < 15s
  },

  tags: {
    environment: ENVIRONMENT,
    tenant: TENANT,
    test_type: 'stress',
    max_vus: String(MAX_VUS)
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ Setup ============
export function setup() {
  console.log(`[Stress] ===== 压力（极限）测试初始化 =====`);
  console.log(`[Stress] 环境: ${ENVIRONMENT}, 租户: ${TENANT}`);
  console.log(`[Stress] 最大VU数: ${MAX_VUS}`);
  console.log(`[Stress] 前台地址: ${envConfig.BASE_DESK_URL}`);
  console.log(`[Stress] ⚠️  压力测试将持续递增至系统极限，请确保已告知后端团队！`);
  console.log(`[Stress] 预计总时长: ~28分钟`);

  const adminToken = AdminLogin();
  if (!adminToken) {
    throw new Error('[Stress] ❌ 获取 AdminToken 失败，无法启动压力测试');
  }
  console.log(`[Stress] ✅ AdminToken 获取成功`);

  return { adminToken, envConfig, startTime: Date.now() };
}

// ============ 阶梯压力登录场景 ============
export function stressLoginScenario(data) {
  // 从 CSV 账号池轮询分配（VU + ITER 双维度，避免并发撞号）
  const account = getAccount(STRESS_ACCOUNTS);
  const timeData = getTimeRandom();

  group('压力-登录', () => {
    const startTime = Date.now();
    stressTotalReqs.add(1);

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

    let resp;
    try {
      resp = httpClient.post('/api/Home/Login', payload, {
        params: { tags: { type: 'stress_login', name: 'stress_login_req' } }
      }, true);
    } catch (e) {
      stressErrorCount.add(1);
      stressLoginSuccessRate.add(false);
      // 压测中偶发超时不打印每一条（降噪）
      return;
    }

    const duration = Date.now() - startTime;
    stressLoginDuration.add(duration);

    const ok = check(resp, {
      '压力登录-HTTP200':  (r) => r && r.status === 200,
      '压力登录-业务成功': (r) => {
        if (!r || !r.body) return false;
        try {
          const body = JSON.parse(r.body);
          return body.msgCode === 0 || body.code === 0;
        } catch { return false; }
      }
    });

    stressLoginSuccessRate.add(ok);

    if (!ok) {
      stressErrorCount.add(1);
      // 高压阶段采样日志（避免 I/O 成为瓶颈）
      if (__ITER % 50 === 0) {
        console.warn(`[Stress][Login] VU=${__VU} ITER=${__ITER} 失败 duration=${duration}ms status=${resp ? resp.status : 'null'}`);
      }
    }

    // 压力测试下减少思考时间，最大化施压
    sleep(Math.random() * 0.3 + 0.1);
  });
}

// ============ 压力注册场景 ============
export function stressRegisterScenario(data) {
  const countryCode = envConfig.COUNTRY_CODE || '91';
  // 高并发下使用 VU+时间戳组合保证唯一性
  const uniqueSuffix = `${__VU}${Date.now() % 100000}`.padStart(10, '0').slice(-10);
  const phoneNum = countryCode + uniqueSuffix;

  group('压力-注册', () => {
    const startTime = Date.now();
    stressTotalReqs.add(1);

    const adminData = {
      token: data.adminToken,
      envConfig: data.envConfig
    };

    let result = null;
    try {
      result = phoneRegister(phoneNum, adminData, 'qwer1234', '');
    } catch (e) {
      stressErrorCount.add(1);
      stressRegisterSuccessRate.add(false);
      sleep(1);
      return;
    }

    const duration = Date.now() - startTime;
    stressRegisterDuration.add(duration);

    const ok = result !== null && result.code === 0;
    stressRegisterSuccessRate.add(ok);

    if (!ok) {
      stressErrorCount.add(1);
    }
  });

  sleep(Math.random() * 0.5 + 0.3);
}

// ============ 报告 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportName = `stress-${ENVIRONMENT}-${TENANT}-max${MAX_VUS}-${timestamp}`;

  const loginRate    = (data.metrics['stress_login_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const registerRate = (data.metrics['stress_register_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const errors       = data.metrics['stress_error_count']?.values?.count || 0;
  const totalReqs    = data.metrics['stress_total_requests']?.values?.count || 0;
  const httpErrRate  = (data.metrics['http_req_failed']?.values?.rate * 100 || 0).toFixed(2);

  console.log(`\n[Stress] ===== 压力测试完成 =====`);
  console.log(`[Stress] 最大VU数: ${MAX_VUS}`);
  console.log(`[Stress] 总请求数: ${totalReqs}`);
  console.log(`[Stress] HTTP错误率: ${httpErrRate}%`);
  console.log(`[Stress] 登录成功率: ${loginRate}%`);
  console.log(`[Stress] 注册成功率: ${registerRate}%`);
  console.log(`[Stress] 总错误次数: ${errors}`);
  console.log(`[Stress] ⚠️  请检查 p95/p99 延迟拐点以确定系统性能临界值`);

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${reportName}-report.html`]: htmlReport(data, {
      title: `压力测试 - ${ENVIRONMENT} - 最大VU:${MAX_VUS}`
    })
  };
}
