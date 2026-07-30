import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { AdminLogin } from '../login/adminlogin.test.js';
import { querySubAccounts } from '../sixearn/sixearn.test.js';
import { RebateLevel, RebateLevelRate } from '../sixearn/RebateLevel.test.js';
import { logger } from '../../../libs/utils/logger.js';
import { htmlReport } from '../../../libs/vendor/k6-reporter.js';
import { textSummary } from '../../../libs/vendor/k6-summary-0.0.1.js';
import { performDataComparison } from '../formdata/aggregatecalculation.test.js';
import { Dashboardtag, queryDashboardFunc } from '../formdata/Dashboard/Dashboard.test.js';

// 简化的报表配置（替代已删除的 reports.js）
const reportConfigs = [
  {
    name: '报表管理->仪表盘',
    tag: Dashboardtag,
    func: queryDashboardFunc,
    priority: 1,
    description: '查询商户后台仪表盘的数据'
  }
];

function getReportsByPriority() {
  return reportConfigs.sort((a, b) => a.priority - b.priority);
}

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.05'],
    report_duration: ['avg<3000'],
    report_success: ['rate>0.95']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// 自定义检查项目的函数 
export const metrics = {
  reportDuration: new Trend('report_duration', true),
  reportSuccess: new Rate('report_success'),
  reportCount: new Counter('report_count'),
  reportDataSize: new Trend('report_data_size', true)
};

let reportResults = {
  token: '',
  reports: {},
  summary: {},
  comparisons: {}
};

export function setup() {
  try {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║          批量报表查询系统 - 初始化                         ║');
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
  const reportList = getReportsByPriority();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          批量报表查询系统 - 开始执行                         ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  计划查询报表数: ${reportList.length.toString().padEnd(40)}║`);
  console.log(`║  执行方式: 串行查询（按优先级排序）${''.padEnd(27)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < reportList.length; i++) {
    const report = reportList[i];
    const result = executeReport(data, report, i + 1, reportList.length);
    results.push(result);

    if (result.success) {
      successCount++;
    } else {
      failCount++;
    }

    reportResults.reports[report.tag] = result;
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          批量报表查询系统 - 执行完成                         ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  总报表数: ${reportList.length.toString().padEnd(45)}║`);
  console.log(`║  成功: ${successCount.toString().padEnd(50)}║`);
  console.log(`║  失败: ${failCount.toString().padEnd(50)}║`);
  console.log(
    `║  成功率: ${((successCount / reportList.length) * 100).toFixed(2)}%${''.padEnd(45)}║`
  );
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  generateSummary(results);
  performDataComparison(results);
}


/**
 * 主要是记录这个函数的执行状态
 * @data {token: string}
 * @report {object} 查询的报表的元数据对象
 * @current {number} 当前正在执行的报表的索引（从1开始）
 * @total {number} 总报表数
 * @returns {Object} 返回这个函数的执行状态和过程，其中的data表示函数返回结果
 * 
*/
function executeReport(data, report, current, total) {
  const startTime = Date.now();
  const progressBar = generateProgressBar(current, total);

  console.log(`[${current}/${total}] ${progressBar} ${report.name}`);
  console.log('─'.repeat(60));

  try {
    let result;
    let dataSize = 0;

    switch (report.tag) {
      case Dashboardtag:
        result = report.func(data);
        break;
      case 'rebateLevel':
        result = RebateLevel(data);
        break;
      default:
        logger.info(`报表 ${report.tag} 尚未实现，使用模拟数据`);
        result = generateMockData(report.tag);
    }

    const duration = Date.now() - startTime;
    dataSize = JSON.stringify(result).length;

    metrics.reportDuration.add(duration, { report: report.tag, status: 'success' });
    metrics.reportSuccess.add(1, { report: report.tag });
    metrics.reportCount.add(1, { report: report.tag });
    metrics.reportDataSize.add(dataSize, { report: report.tag });

    console.log(`  ✓ 状态: 成功`);
    console.log(`  ⏱ 耗时: ${duration}ms`);
    console.log(`  📦 数据量: ${formatBytes(dataSize)}`);
    console.log(`  📊 记录数: ${countRecords(result)}`);
    console.log('');

    return {
      tag: report.tag,
      name: report.name,
      success: true,
      duration: duration,
      dataSize: dataSize,
      data: result,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    metrics.reportDuration.add(duration, { report: report.tag, status: 'failed' });
    metrics.reportSuccess.add(0, { report: report.tag });
    metrics.reportCount.add(1, { report: report.tag });

    console.log(`  ✗ 状态: 失败`);
    console.log(`  ⏱ 耗时: ${duration}ms`);
    console.log(`  ❌ 错误: ${error.message}`);
    console.log('');

    return {
      tag: report.tag,
      name: report.name,
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

function generateMockData(tag) {
  const mockData = {
    querySubAccounts: {
      list: Array.from({ length: 10 }, (_, i) => ({
        userId: 1000 + i,
        userName: `user${i}`,
        hierarchy: 1,
        registerTime: Date.now() - i * 86400000
      })),
      total: 10
    },
    rebateLevel: {
      list: Array.from({ length: 5 }, (_, i) => ({
        rebateLevel: i + 1,
        rate: (i + 1) * 10
      }))
    },
    rechargeOrder: {
      list: Array.from({ length: 8 }, (_, i) => ({
        orderId: `ORD${i}`,
        amount: 100 * (i + 1),
        status: 'Payed'
      })),
      total: 8
    },
    betRecord: {
      list: Array.from({ length: 20 }, (_, i) => ({
        betId: `BET${i}`,
        amount: 50 * (i + 1),
        gameType: i % 5
      })),
      total: 20
    },
    memberReport: {
      list: Array.from({ length: 15 }, (_, i) => ({
        memberId: i + 1,
        memberName: `member${i}`
      })),
      total: 15
    },
    teamReport: {
      totalMembers: 100,
      activeMembers: 80,
      totalBetAmount: 50000
    }
  };

  return mockData[tag] || { mock: true };
}

function countRecords(data) {
  if (Array.isArray(data)) {
    return data.length;
  } else if (typeof data === 'object' && data !== null) {
    return data.list?.length || data.total || 1;
  }
  return 0;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * 生成查询结果的汇总统计信息
 * @param {Array} results - 查询结果数组，每个元素是一个包含查询信息的对象
 */
function generateSummary(results) {
  // 计算总耗时
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  // 计算平均耗时
  const avgDuration = totalDuration / results.length;
  // 计算总数据量（处理dataSize可能不存在的情况）
  const totalDataSize = results.reduce((sum, r) => sum + (r.dataSize || 0), 0);
  // 找出最小耗时
  const minDuration = Math.min(...results.map((r) => r.duration));
  // 找出最大耗时
  const maxDuration = Math.max(...results.map((r) => r.duration));

  // 将汇总信息存储到reportResults对象中
  reportResults.summary = {
    totalReports: results.length,    // 总报告数
    successCount: results.filter((r) => r.success).length,  // 成功数量
    failCount: results.filter((r) => !r.success).length,    // 失败数量
    totalDuration: totalDuration,     // 总耗时
    avgDuration: avgDuration,         // 平均耗时
    minDuration: minDuration,         // 最小耗时
    maxDuration: maxDuration,         // 最大耗时
    totalDataSize: totalDataSize,     // 总数据量
    timestamp: new Date().toISOString()  // 生成汇总信息的时间戳
  };

  // 打印格式化的汇总信息表格
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    查询汇总统计                               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  总耗时: ${formatDuration(totalDuration).padEnd(45)}║`);
  console.log(`║  平均耗时: ${formatDuration(avgDuration).padEnd(43)}║`);
  console.log(`║  最快: ${formatDuration(minDuration).padEnd(48)}║`);
  console.log(`║  最慢: ${formatDuration(maxDuration).padEnd(48)}║`);
  console.log(`║  总数据量: ${formatBytes(totalDataSize).padEnd(43)}║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');  // 打印空行以增加可读性
}


function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

// export function handleSummary(data) {
//   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

//   return {
//     stdout: textSummary(data, { indent: ' ', enableColors: true }),
//     [`reports/batch-reports-${timestamp}.html`]: htmlReport(data, {
//       title: '批量报表查询报告'
//     }),
//     [`reports/batch-reports-${timestamp}-summary.json`]: JSON.stringify(reportResults, null, 2)
//   };
// }
