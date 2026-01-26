import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getActivitiesByPriority } from '../../../config/activities.js';
import { logger } from '../../../libs/utils/logger.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.05'],
    activity_duration: ['avg<3000'],
    activity_success: ['rate>0.95']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

export const metrics = {
  activityDuration: new Trend('activity_duration', true),
  activitySuccess: new Rate('activity_success'),
  activityCount: new Counter('activity_count'),
  activityDataSize: new Trend('activity_data_size', true)
};

let activityResults = {
  token: '',
  activities: {},
  summary: {},
  comparisons: {}
};

export function setup() {
  try {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║          批量活动创建系统 - 初始化                         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('[1/2] 正在获取登录Token...');

    const token = AdminLogin();
    if (!token) {
      throw new Error('Token获取失败');
    }

    console.log('[1/2] ✓ Token获取成功');
    console.log('');

    return { token };
  } catch (error) {
    logger.error('Setup失败:', error.message);
    throw error;
  }
}

export default function (data) {
  const activityList = getActivitiesByPriority();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          批量活动创建系统 - 开始执行                         ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  计划创建活动数: ${activityList.length.toString().padEnd(40)}║`);
  console.log(`║  执行方式: 串行创建（按优先级排序）${''.padEnd(27)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < activityList.length; i++) {
    const activity = activityList[i];
    const result = executeActivity(data, activity, i + 1, activityList.length);
    results.push(result);

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    activityResults.activities[activity.tag] = result;
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          批量活动创建系统 - 执行完成                         ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  总活动数: ${activityList.length.toString().padEnd(45)}║`);
  console.log(`║  成功: ${successCount.toString().padEnd(50)}║`);
  console.log(`║  失败: ${failCount.toString().padEnd(50)}║`);
  console.log(
    `║  成功率: ${((successCount / activityList.length) * 100).toFixed(2)}%${''.padEnd(45)}║`
  );
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  generateSummary(results);
  performActivityComparison(results);
  displayActivityDetails(results);
}

function executeActivity(data, activity, current, total) {
  const startTime = Date.now();
  const progressBar = generateProgressBar(current, total);

  console.log(`[${current}/${total}] ${progressBar} ${activity.name}`);
  console.log('─'.repeat(60));

  try {
    let result;
    let dataSize = 0;

    if (activity.func && typeof activity.func === 'function') {
      result = activity.func(data);
    } else {
      logger.info(`活动 ${activity.tag} 没有配置函数，使用模拟数据`);
      result = generateMockActivity(activity.tag);
    }

    const duration = Date.now() - startTime;
    dataSize = JSON.stringify(result).length;

    metrics.activityDuration.add(duration, { activity: activity.tag, status: 'success' });
    metrics.activitySuccess.add(1, { activity: activity.tag });
    metrics.activityCount.add(1, { activity: activity.tag });
    metrics.activityDataSize.add(dataSize, { activity: activity.tag });

    console.log(`  ✓ 状态: 创建成功`);
    console.log(`  ⏱ 耗时: ${duration}ms`);
    console.log(`  📦 数据量: ${formatBytes(dataSize)}`);
    console.log(`  🆔 活动ID: ${result.activityId || 'N/A'}`);
    console.log(`  📊 活动类型: ${result.type || activity.category}`);
    console.log('');

    return {
      tag: activity.tag,
      name: activity.name,
      category: activity.category,
      success: true,
      duration: duration,
      dataSize: dataSize,
      data: result,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    metrics.activityDuration.add(duration, { activity: activity.tag, status: 'failed' });
    metrics.activitySuccess.add(0, { activity: activity.tag });
    metrics.activityCount.add(1, { activity: activity.tag });

    console.log(`  ✗ 状态: 创建失败`);
    console.log(`  ⏱ 耗时: ${duration}ms`);
    console.log(`  ❌ 错误: ${error.message}`);
    console.log('');

    return {
      tag: activity.tag,
      name: activity.name,
      category: activity.category,
      success: false,
      duration: duration,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function generateProgressBar(current, total, width = 20) {
  const percentage = (current / total) * 100;
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function generateMockActivity(tag) {
  const mockData = {
    coupon_activity: {
      activityId: 'COUPON_' + Date.now(),
      name: '优惠券活动_' + Date.now(),
      type: 'coupon',
      couponCount: 100,
      status: 'created',
      createTime: new Date().toISOString()
    },
    system_activity: {
      activityId: 'SYS_' + Date.now(),
      name: '系统活动_' + Date.now(),
      type: 'system',
      status: 'created',
      createTime: new Date().toISOString()
    },
    recharge_activity: {
      activityId: 'RECHARGE_' + Date.now(),
      name: '充值活动_' + Date.now(),
      type: 'recharge',
      bonusRate: 0.1,
      status: 'created',
      createTime: new Date().toISOString()
    },
    signin_activity: {
      activityId: 'SIGNIN_' + Date.now(),
      name: '签到活动_' + Date.now(),
      type: 'signin',
      rewardDays: 7,
      status: 'created',
      createTime: new Date().toISOString()
    },
    lottery_activity: {
      activityId: 'LOTTERY_' + Date.now(),
      name: '抽奖活动_' + Date.now(),
      type: 'lottery',
      prizePool: 10000,
      status: 'created',
      createTime: new Date().toISOString()
    }
  };

  return (
    mockData[tag] || {
      activityId: 'MOCK_' + Date.now(),
      name: '模拟活动_' + Date.now(),
      type: 'mock',
      status: 'created',
      createTime: new Date().toISOString()
    }
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function generateSummary(results) {
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = totalDuration / results.length;
  const totalDataSize = results.reduce((sum, r) => sum + (r.dataSize || 0), 0);
  const minDuration = Math.min(...results.map((r) => r.duration));
  const maxDuration = Math.max(...results.map((r) => r.duration));

  activityResults.summary = {
    totalActivities: results.length,
    successCount: results.filter((r) => r.success).length,
    failCount: results.filter((r) => !r.success).length,
    totalDuration: totalDuration,
    avgDuration: avgDuration,
    minDuration: minDuration,
    maxDuration: maxDuration,
    totalDataSize: totalDataSize,
    timestamp: new Date().toISOString()
  };

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    创建汇总统计                               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  总耗时: ${formatDuration(totalDuration).padEnd(45)}║`);
  console.log(`║  平均耗时: ${formatDuration(avgDuration).padEnd(43)}║`);
  console.log(`║  最快: ${formatDuration(minDuration).padEnd(48)}║`);
  console.log(`║  最慢: ${formatDuration(maxDuration).padEnd(48)}║`);
  console.log(`║  总数据量: ${formatBytes(totalDataSize).padEnd(43)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
}

function performActivityComparison(results) {
  const successActivities = results.filter((r) => r.success && r.data);

  if (successActivities.length < 2) {
    console.log('💡 需要2个以上成功活动才能进行数据对比分析');
    return;
  }

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    活动对比分析                               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');

  const comparisons = [];

  for (let i = 0; i < successActivities.length; i++) {
    for (let j = i + 1; j < successActivities.length; j++) {
      const a1 = successActivities[i];
      const a2 = successActivities[j];

      const duration1 = a1.duration;
      const duration2 = a2.duration;
      const diff = duration1 - duration2;
      const diffPercent = duration2 > 0 ? ((diff / duration2) * 100).toFixed(2) : 'N/A';

      console.log(
        `║  ${a1.name.substring(0, 15).padEnd(15)} vs ${a2.name.substring(0, 15).padEnd(15)}║`
      );
      console.log(
        `║    耗时: ${duration1.toString().padEnd(10)}ms vs ${duration2.toString().padEnd(10)}ms     ║`
      );
      console.log(`║    差值: ${diff.toString().padEnd(10)}ms (${diffPercent}%)${''.padEnd(15)}║`);
      console.log(`║    类型: ${a1.data.type?.padEnd(10)} vs ${a2.data.type?.padEnd(10)}     ║`);
      console.log('║    ──────────────────────────────────────────────────────║');

      comparisons.push({
        activity1: a1.name,
        activity2: a2.name,
        duration1: duration1,
        duration2: duration2,
        diff: diff,
        diffPercent: diffPercent,
        type1: a1.data.type,
        type2: a2.data.type
      });
    }
  }

  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  activityResults.comparisons = comparisons;
}

function displayActivityDetails(results) {
  const successActivities = results.filter((r) => r.success && r.data);

  if (successActivities.length === 0) {
    console.log('💡 没有成功创建的活动，跳过详情显示');
    return;
  }

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    活动详情展示                               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');

  successActivities.forEach((activity) => {
    const data = activity.data;
    console.log(`║  🎯 ${activity.name}                                      ║`);
    console.log(`║     ID: ${data.activityId?.padEnd(40)}║`);
    console.log(`║     类型: ${data.type?.padEnd(37)}║`);
    console.log(`║     状态: ${data.status?.padEnd(37)}║`);
    console.log(`║     创建时间: ${data.createTime?.substring(0, 19).padEnd(30)}║`);

    // 显示特定类型的详细信息
    if (data.type === 'coupon' && data.couponCount) {
      console.log(`║     优惠券数量: ${data.couponCount.toString().padEnd(30)}║`);
    } else if (data.type === 'recharge' && data.bonusRate) {
      console.log(`║     奖励比例: ${(data.bonusRate * 100).toString() + '%'.padEnd(30)}║`);
    } else if (data.type === 'signin' && data.rewardDays) {
      console.log(`║     奖励天数: ${data.rewardDays.toString().padEnd(30)}║`);
    } else if (data.type === 'lottery' && data.prizePool) {
      console.log(`║     奖池金额: ${data.prizePool.toString().padEnd(30)}║`);
    }

    console.log('║    ──────────────────────────────────────────────────────║');
  });

  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/batch-activities-${timestamp}.html`]: htmlReport(data, {
      title: '批量活动创建报告'
    }),
    [`reports/batch-activities-${timestamp}-summary.json`]: JSON.stringify(activityResults, null, 2)
  };
}
