/**
 * 突刺（Spike）压测 - 模拟游戏公司活动上线、节假日流量爆发
 *
 * 游戏公司标准场景：
 *   - 充值活动开启 / 限时赛事上线 / 节假日红包雨 → 瞬间涌入大量用户
 *   - 从基线 10 VU 在 30s 内爆升到 500 VU（50倍突刺）
 *   - 验证系统在突刺压力下的 响应时间、错误率、恢复能力
 *
 * 运行命令（示例）：
 *   k6 run k6/tests/performance/load/spike.test.js -e TENANT=3004
 *   k6 run k6/tests/performance/load/spike.test.js -e TENANT=3004 -e SPIKE_VUS=300
 *   k6 run k6/tests/performance/load/spike.test.js -e TENANT=3004 -e ACCOUNTS_CSV=./k6/data/csv/accounts.csv
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
import { mobileAutoLoginFlow } from '../../api/login/MobileAutoLogin.test.js';
import { phoneRegister } from '../../api/login/register.test.js';

// ============ 自定义指标 ============
const spikeLoginSuccessRate    = new Rate('spike_login_success_rate');
const spikeRegisterSuccessRate = new Rate('spike_register_success_rate');
const spikeLoginDuration       = new Trend('spike_login_duration_ms', true);
const spikeRegisterDuration    = new Trend('spike_register_duration_ms', true);
const spikeTotalLoginReqs      = new Counter('spike_login_total');
const spikeTotalRegisterReqs   = new Counter('spike_register_total');
const spikeErrors              = new Counter('spike_error_count');

// ============ 环境 & 参数 ============
const TENANT      = __ENV.TENANT || '3004';
const ENVIRONMENT = __ENV.ENVIRONMENT || 'local';
const SPIKE_VUS   = parseInt(__ENV.SPIKE_VUS || '200', 10);  // 峰值VU数，可覆盖
const envConfig   = getEnvByTenantId(TENANT);

// ============ 从 CSV 加载账号池（SharedArray，跨 VU 共享内存）============
// CSV 路径优先级：-e ACCOUNTS_CSV=xxx > 默认 ./k6/data/csv/accounts.csv
const SPIKE_ACCOUNTS = loadAccounts();

export const options = {
  scenarios: {
    // 主场景：突刺登录（90% 流量）
    spike_login: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '20s', target: 5           },  // 基线：少量正常用户
        { duration: '30s', target: SPIKE_VUS   },  // 💥 突刺：活动上线，瞬间爆量
        { duration: '1m',  target: SPIKE_VUS   },  // 持续高压：活动高峰期
        { duration: '30s', target: 20          },  // 消退：活动热度下降
        { duration: '1m',  target: 20          },  // 恢复期：验证系统恢复能力
        { duration: '20s', target: 0           },  // 收尾
      ],
      gracefulRampDown: '30s',
      exec: 'spikeLoginScenario',
      tags: { test_type: 'spike', scenario: 'spike_login', service: 'user' }
    },

    // 次场景：突刺注册（10% 新用户，活动吸引新人）
    spike_register: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '50s', target: 0                          },  // 等待突刺开始
        { duration: '30s', target: Math.floor(SPIKE_VUS * 0.1) }, // 注册高峰（峰值的10%）
        { duration: '1m',  target: Math.floor(SPIKE_VUS * 0.1) }, // 持续
        { duration: '40s', target: 0                          },  // 收尾
      ],
      gracefulRampDown: '30s',
      exec: 'spikeRegisterScenario',
      tags: { test_type: 'spike', scenario: 'spike_register', service: 'user' }
    }
  },

  thresholds: {
    // 突刺期间允许容错范围比正常负载宽松
    http_req_failed:                ['rate<0.05'],           // 错误率 < 5%（突刺期间适当放宽）
    http_req_duration:              ['p(95)<8000', 'p(99)<15000'], // 突刺下 p95 < 8s

    'spike_login_success_rate':     ['rate>0.95'],           // 登录成功率 > 95%
    'spike_login_duration_ms':      ['p(95)<6000'],          // 登录 p95 < 6s

    'spike_register_success_rate':  ['rate>0.90'],           // 注册成功率 > 90%
    'spike_register_duration_ms':   ['p(95)<12000'],         // 注册 p95 < 12s（突刺时验证码可能较慢）
  },

  tags: {
    environment: ENVIRONMENT,
    tenant: TENANT,
    test_type: 'spike',
    peak_vus: String(SPIKE_VUS)
  },

  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// ============ Setup ============
export function setup() {
  console.log(`[Spike] ===== 突刺压测初始化 =====`);
  console.log(`[Spike] 环境: ${ENVIRONMENT}, 租户: ${TENANT}`);
  console.log(`[Spike] 峰值VU数: ${SPIKE_VUS}`);
  console.log(`[Spike] 前台地址: ${envConfig.BASE_DESK_URL}`);
  console.log(`[Spike] 账号池大小: ${SPIKE_ACCOUNTS.length} 个账号`);
  console.log(`[Spike] ⚠️  突刺测试会产生极高瞬间流量，请确认目标环境已通知！`);

  const adminToken = AdminLogin();
  if (!adminToken) {
    throw new Error('[Spike] ❌ 获取 AdminToken 失败，无法启动突刺测试');
  }
  console.log(`[Spike] ✅ AdminToken 获取成功，开始突刺测试`);

  return { adminToken, envConfig };
}

// ============ 突刺登录场景 ============
export function spikeLoginScenario(data) {
  // 从 CSV 账号池均匀分配（支持大规模账号池）
  const account = getAccount(SPIKE_ACCOUNTS);
  const timeData = getTimeRandom();

  group('突刺-用户登录', () => {
    const startTime = Date.now();
    spikeTotalLoginReqs.add(1);

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
        params: { tags: { type: 'spike_login', name: 'spike_login_request' } }
      }, true);
    } catch (e) {
      spikeErrors.add(1);
      spikeLoginSuccessRate.add(false);
      console.error(`[Spike][Login] VU=${__VU} 请求异常: ${e.message}`);
      return;
    }

    const duration = Date.now() - startTime;
    spikeLoginDuration.add(duration);

    const ok = check(resp, {
      '突刺登录-状态码200':  (r) => r && r.status === 200,
      '突刺登录-业务成功':   (r) => {
        if (!r || !r.body) return false;
        try {
          const body = JSON.parse(r.body);
          return body.msgCode === 0 || body.code === 0;
        } catch { return false; }
      }
    });

    spikeLoginSuccessRate.add(ok);

    if (!ok) {
      spikeErrors.add(1);
      // 突刺期间只打关键警告，避免日志洪水
      if (Math.random() < 0.1) {  // 采样 10% 打印
        console.warn(`[Spike][Login] ⚠️ VU=${__VU} ITER=${__ITER} 登录失败, 耗时=${duration}ms, 状态=${resp ? resp.status : 'null'}`);
      }
    }

    // 突刺场景下模拟用户快速操作，停留时间短
    sleep(Math.random() * 0.5 + 0.2);
  });
}

// ============ 突刺注册场景 ============
export function spikeRegisterScenario(data) {
  const countryCode = envConfig.COUNTRY_CODE || '91';
  let phoneNum = countryCode;
  // 增加 VU 和时间戳前缀，最大程度避免号码冲突
  const suffix = `${Date.now()}${__VU}`.slice(-8);
  for (let i = suffix.length; i < 10; i++) {
    phoneNum += Math.floor(Math.random() * 10);
  }
  phoneNum += suffix;

  group('突刺-新用户注册', () => {
    const startTime = Date.now();
    spikeTotalRegisterReqs.add(1);

    const adminData = {
      token: data.adminToken,
      envConfig: data.envConfig
    };

    let result = null;
    try {
      result = phoneRegister(phoneNum, adminData, 'qwer1234', '');
    } catch (e) {
      spikeErrors.add(1);
      spikeRegisterSuccessRate.add(false);
      console.error(`[Spike][Register] VU=${__VU} 注册异常: ${e.message}`);
      sleep(1);
      return;
    }

    const duration = Date.now() - startTime;
    spikeRegisterDuration.add(duration);

    const ok = result !== null && result.code === 0;
    spikeRegisterSuccessRate.add(ok);

    if (!ok) {
      spikeErrors.add(1);
    }
  });

  sleep(Math.random() * 1 + 0.5);
}

// ============ 报告 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportName = `spike-${ENVIRONMENT}-${TENANT}-peak${SPIKE_VUS}-${timestamp}`;

  const loginRate    = (data.metrics['spike_login_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const registerRate = (data.metrics['spike_register_success_rate']?.values?.rate * 100 || 0).toFixed(2);
  const errors       = data.metrics['spike_error_count']?.values?.count || 0;

  console.log(`\n[Spike] ===== 突刺压测完成 =====`);
  console.log(`[Spike] 峰值VU数: ${SPIKE_VUS}`);
  console.log(`[Spike] 登录成功率: ${loginRate}%`);
  console.log(`[Spike] 注册成功率: ${registerRate}%`);
  console.log(`[Spike] 总错误数: ${errors}`);

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${reportName}-report.html`]: htmlReport(data, { title: `突刺压测 - ${ENVIRONMENT} - 峰值VU:${SPIKE_VUS}` })
  };
}
