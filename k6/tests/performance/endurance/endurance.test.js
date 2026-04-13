/**
 * 耐久/浸泡测试（Endurance / Soak Test）- 检测系统长时间运行的健康度
 *
 * 游戏公司标准场景：
 *   - 游戏服务必须 7×24 小时稳定运行
 *   - 检测：内存泄漏、连接池耗尽、数据库慢查询积累、日志磁盘打满
 *   - 短程版（CI/CD 流水线验证）：30分钟，20 VU
 *   - 长程版（上线前回归）：8小时，10 VU（低强度长持续）
 *
 * 关键观测指标：
 *   - 响应时间是否随时间递增（内存泄漏/连接泄漏特征）
 *   - 错误率在长时间运行后是否恶化
 *   - VU 吞吐量是否稳定
 *
 * 运行命令（示例）：
 *   # 短程（30分钟）
 *   k6 run k6/tests/performance/endurance/endurance.test.js -e TENANT=3004 -e SOAK_MODE=short
 *
 *   # 长程（8小时，适合上线前验证）
 *   k6 run k6/tests/performance/endurance/endurance.test.js -e TENANT=3004 -e SOAK_MODE=long
 *
 *   # 指定自定义账号 CSV
 *   k6 run k6/tests/performance/endurance/endurance.test.js -e TENANT=3004 -e ACCOUNTS_CSV=./k6/data/csv/accounts.csv
 */

import http from 'k6/http';
import { sleep, group, check } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

import { getEnvByTenantId } from '../../../config/envconfig.js';
import { httpClient } from '../../../libs/http/client.js';
import { generateCryptoRandomString, getTimeRandom } from '../../utils/utils.js';
import { loadAccounts, getAccount } from '../../../data/loader/accountLoader.js';
import { AdminLogin } from '../../api/login/adminlogin.test.js';
import { phoneRegister } from '../../api/login/register.test.js';

// ============ 自定义指标 ============
const soakLoginSuccessRate    = new Rate('soak_login_success_rate');
const soakRegisterSuccessRate = new Rate('soak_register_success_rate');
const soakLoginDuration       = new Trend('soak_login_duration_ms', true);
const soakRegisterDuration    = new Trend('soak_register_duration_ms', true);
const soakTotalReqs           = new Counter('soak_total_requests');
const soakErrorCount          = new Counter('soak_error_count');
// 用于追踪"时间窗口"内的趋势漂移（内存泄漏特征）
const soakIterCount           = new Counter('soak_iteration_count');

// ============ 环境 & 参数 ============
const TENANT      = __ENV.TENANT || '3004';
const ENVIRONMENT = __ENV.ENVIRONMENT || 'local';
const SOAK_MODE   = __ENV.SOAK_MODE || 'short';  // 'short'(30min) 或 'long'(8h)
const envConfig   = getEnvByTenantId(TENANT);

// 根据模式选择配置
const SOAK_CONFIG = {
  short: {
    loginVUs:    20,
    registerVUs: 3,
    duration:    '30m',
    description: '短程浸泡测试（30分钟）'
  },
  long: {
    loginVUs:    10,
    registerVUs: 2,
    duration:    '8h',
    description: '长程浸泡测试（8小时，上线前验证）'
  }
};

const currentConfig = SOAK_CONFIG[SOAK_MODE] || SOAK_CONFIG.short;

// ============ 从 CSV 加载账号池（SharedArray，跨 VU 共享内存）============
// CSV 路径优先级：-e ACCOUNTS_CSV=xxx > 默认 ./k6/data/csv/accounts.csv
const SOAK_ACCOUNTS = loadAccounts();

export const options = {
  scenarios: {
    // 场景一：持续稳定登录（主力场景）
    soak_login: {
      executor: 'constant-vus',
      vus: currentConfig.loginVUs,
      duration: currentConfig.duration,
      gracefulStop: '2m',
      exec: 'soakLoginScenario',
      tags: {
        test_type: 'endurance',
        scenario: 'soak_login',
        soak_mode: SOAK_MODE,
        service: 'user'
      }
    },

    // 场景二：持续低频注册（模拟长时间内持续有新用户）
    soak_register: {
      executor: 'constant-vus',
      vus: currentConfig.registerVUs,
      duration: currentConfig.duration,
      gracefulStop: '2m',
      exec: 'soakRegisterScenario',
      tags: {
        test_type: 'endurance',
        scenario: 'soak_register',
        soak_mode: SOAK_MODE,
        service: 'user'
      }
    }
  },

  thresholds: {
    // 耐久测试：严格要求响应时间不应随时间漂移
    http_req_failed:                ['rate<0.02'],           // 长时间运行错误率 < 2%
    http_req_duration:              ['p(95)<5000', 'p(99)<10000'],

    'soak_login_success_rate':      ['rate>0.98'],           // 长时间登录成功率 > 98%
    'soak_login_duration_ms':       ['p(95)<3000', 'avg<1500'], // 平均登录延迟 < 1.5s

    'soak_register_success_rate':   ['rate>0.95'],           // 注册成功率 > 95%
    'soak_register_duration_ms':    ['p(95)<8000'],          // 注册 p95 < 8s
  },

  tags: {
    environment: ENVIRONMENT,
    tenant: TENANT,
    test_type: 'endurance',
    soak_mode: SOAK_MODE,
    login_vus: String(currentConfig.loginVUs),
    register_vus: String(currentConfig.registerVUs)
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ Setup ============
export function setup() {
  console.log(`[Endurance] ===== 耐久浸泡测试初始化 =====`);
  console.log(`[Endurance] 模式: ${SOAK_MODE} - ${currentConfig.description}`);
  console.log(`[Endurance] 环境: ${ENVIRONMENT}, 租户: ${TENANT}`);
  console.log(`[Endurance] 登录VU: ${currentConfig.loginVUs}, 注册VU: ${currentConfig.registerVUs}`);
  console.log(`[Endurance] 持续时长: ${currentConfig.duration}`);
  console.log(`[Endurance] 前台地址: ${envConfig.BASE_DESK_URL}`);
  console.log(`[Endurance] 账号池大小: ${SOAK_ACCOUNTS.length} 个账号`);
  console.log(`[Endurance] 🔍 核心观测点：响应时间是否随运行时长持续上升`);
  console.log(`[Endurance] 🔍 核心观测点：内存/连接是否泄漏（建议配合后端 pprof）`);

  const adminToken = AdminLogin();
  if (!adminToken) {
    throw new Error('[Endurance] ❌ 获取 AdminToken 失败，无法启动耐久测试');
  }
  console.log(`[Endurance] ✅ AdminToken 获取成功，开始耐久测试`);

  return {
    adminToken,
    envConfig,
    startTime: Date.now(),
    soakMode: SOAK_MODE
  };
}

// ============ 持续登录场景 ============
export function soakLoginScenario(data) {
  // 从 CSV 账号池轮询分配（VU + ITER 双维度，避免并发撞号）
  const account = getAccount(SOAK_ACCOUNTS);
  const timeData = getTimeRandom();

  soakIterCount.add(1);

  group('耐久-登录', () => {
    const startTime = Date.now();
    soakTotalReqs.add(1);

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
        params: { tags: { type: 'soak_login', name: 'soak_login_req' } }
      }, true);
    } catch (e) {
      soakErrorCount.add(1);
      soakLoginSuccessRate.add(false);
      sleep(2);
      return;
    }

    const duration = Date.now() - startTime;
    soakLoginDuration.add(duration);

    const ok = check(resp, {
      '耐久登录-状态码200':  (r) => r && r.status === 200,
      '耐久登录-业务成功':   (r) => {
        if (!r || !r.body) return false;
        try {
          const body = JSON.parse(r.body);
          return body.msgCode === 0 || body.code === 0;
        } catch { return false; }
      },
      '耐久登录-响应正常':   (r) => r && r.timings && r.timings.duration < 10000  // 单次请求不超过10s
    });

    soakLoginSuccessRate.add(ok);

    if (!ok) {
      soakErrorCount.add(1);
      // 耐久测试：记录时间戳以便分析"从什么时候开始劣化"
      if (__ITER % 100 === 0 || duration > 5000) {
        const runningMinutes = Math.floor((Date.now() - data.startTime) / 60000);
        console.warn(`[Endurance][Login] ⚠️ 运行${runningMinutes}分钟后出现失败: VU=${__VU} duration=${duration}ms status=${resp ? resp.status : 'null'}`);
      }
    }

    // 耐久测试模拟真实用户思考时间（较长，减少对系统的冲击）
    // 短程浸泡：1~3s，长程浸泡：2~5s
    const thinkTime = SOAK_MODE === 'long'
      ? Math.random() * 3 + 2
      : Math.random() * 2 + 1;
    sleep(thinkTime);
  });
}

// ============ 持续注册场景 ============
export function soakRegisterScenario(data) {
  const countryCode = envConfig.COUNTRY_CODE || '91';
  // 耐久测试中号码池可能耗尽，加入运行时间戳确保唯一
  const uniqueSuffix = `${Math.floor(Date.now() / 1000) % 10000}${__VU}`.padStart(10, '0').slice(-10);
  const phoneNum = countryCode + uniqueSuffix;

  group('耐久-注册', () => {
    const startTime = Date.now();
    soakTotalReqs.add(1);

    const adminData = {
      token: data.adminToken,
      envConfig: data.envConfig
    };

    let result = null;
    try {
      result = phoneRegister(phoneNum, adminData, 'qwer1234', '');
    } catch (e) {
      soakErrorCount.add(1);
      soakRegisterSuccessRate.add(false);
      sleep(3);
      return;
    }

    const duration = Date.now() - startTime;
    soakRegisterDuration.add(duration);

    const ok = result !== null && result.code === 0;
    soakRegisterSuccessRate.add(ok);

    if (!ok) {
      soakErrorCount.add(1);
      if (__ITER % 20 === 0) {
        const runningMinutes = Math.floor((Date.now() - data.startTime) / 60000);
        console.warn(`[Endurance][Register] ⚠️ 运行${runningMinutes}分钟后注册失败: VU=${__VU} duration=${duration}ms`);
      }
    }

    // 注册操作本身就较慢，加上思考时间避免重复注册同号
    const thinkTime = SOAK_MODE === 'long'
      ? Math.random() * 10 + 5
      : Math.random() * 5 + 3;
    sleep(thinkTime);
  });
}

// ============ Teardown：打印关键劣化分析 ============
export function teardown(data) {
  const totalMinutes = Math.floor((Date.now() - data.startTime) / 60000);
  console.log(`\n[Endurance] ===== 耐久测试结束 =====`);
  console.log(`[Endurance] 实际运行时长: ${totalMinutes} 分钟`);
  console.log(`[Endurance] 模式: ${data.soakMode}`);
  console.log(`[Endurance] ===== 分析建议 =====`);
  console.log(`[Endurance] 1. 对比测试开始和结束的 p95 延迟，是否有显著漂移？`);
  console.log(`[Endurance] 2. 查看后端服务内存使用趋势，是否持续增长？`);
  console.log(`[Endurance] 3. 检查数据库连接池使用情况，是否接近上限？`);
  console.log(`[Endurance] 4. 查看磁盘日志文件增长速度，是否有异常写入？`);
}

// ============ 报告 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportName = `endurance-${SOAK_MODE}-${ENVIRONMENT}-${TENANT}-${timestamp}`;

  const loginRate    = (data.metrics['soak_login_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const registerRate = (data.metrics['soak_register_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const errors       = data.metrics['soak_error_count']?.values?.count || 0;
  const totalReqs    = data.metrics['soak_total_requests']?.values?.count || 0;
  const avgLogin     = (data.metrics['soak_login_duration_ms']?.values?.avg || 0).toFixed(0);
  const p95Login     = (data.metrics['soak_login_duration_ms']?.values?.['p(95)'] || 0).toFixed(0);

  console.log(`\n[Endurance] ===== 耐久测试报告 =====`);
  console.log(`[Endurance] 模式: ${SOAK_MODE} - ${currentConfig.description}`);
  console.log(`[Endurance] 总请求数: ${totalReqs}`);
  console.log(`[Endurance] 登录成功率: ${loginRate}%`);
  console.log(`[Endurance] 注册成功率: ${registerRate}%`);
  console.log(`[Endurance] 登录平均延迟: ${avgLogin}ms`);
  console.log(`[Endurance] 登录 p95 延迟: ${p95Login}ms`);
  console.log(`[Endurance] 总错误次数: ${errors}`);
  console.log(`[Endurance] ⚠️  如发现 p95 延迟随时间上升，请检查内存泄漏或连接池耗尽`);

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${reportName}-report.html`]: htmlReport(data, {
      title: `耐久浸泡测试 [${SOAK_MODE}] - ${ENVIRONMENT} - Tenant:${TENANT}`
    })
  };
}
