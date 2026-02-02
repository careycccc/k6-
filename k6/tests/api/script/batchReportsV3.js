import { BatchReportOperation } from '../../../libs/batch/BatchOperationBase.js';
import { performDataComparison } from '../formdata/aggregatecalculation.test.js';
import { Dashboardtag, queryDashboardFunc } from '../formdata/Dashboard/Dashboard.test.js';
import { Statisticstag, queryStatisticsFunc } from '../formdata/Statistics/Statistics.test.js';
import { DailySummaryTag, queryDailySummaryReportFunc } from '../formdata/DailySummaryReport/DailySummaryReport.test.js';
import { memberTag, queryMemberReportFunc } from '../formdata/memberReport/memberReport.test.js';

// 简化的报表配置（替代已删除的 reports.js）
const reportConfigs = [
  {
    name: '报表管理->仪表盘',
    tag: Dashboardtag,
    func: queryDashboardFunc,
    priority: 1,
    description: '查询商户后台仪表盘的数据'
  },
  {
    name: '报表管理->数据统计',
    tag: Statisticstag,
    func: queryStatisticsFunc,
    priority: 2,
    description: '查询商户后台数据统计的数据'
  },
  {
    name: '报表管理->平台报表',
    tag: DailySummaryTag,
    func: queryDailySummaryReportFunc,
    priority: 3,
    description: '查询商户后台平台报表的数据'
  },
  {
    name: '报表管理->会员报表',
    tag: memberTag,
    func: queryMemberReportFunc,
    priority: 4,
    description: '查询商户后台会员报表的数据'
  }
];

function getReportsByPriority() {
  return reportConfigs.sort((a, b) => a.priority - b.priority);
}

// 创建报表查询操作实例
const reportOperation = new BatchReportOperation();

// 导出配置选项
export const options = reportOperation.getOptions();

// 导出指标
export const metrics = reportOperation.metrics;

// 导出setup函数
export function setup() {
  return reportOperation.setup();
}

// 导出主执行函数
export default function (data) {
  const reportList = getReportsByPriority();

  // 定义执行函数
  function executeReport(report, data) {
    return report.func(data);
  }

  // 执行批量操作
  const results = reportOperation.execute(data, reportList, executeReport);
  // 调试日志：记录结果长度，帮助定位 performDataComparison 调用路径
  try {
    console.log(
      '[DEBUG] batchReportsV3: 执行完成，结果长度 =',
      Array.isArray(results) ? results.length : 'not-array'
    );
    performDataComparison(results);
  } catch (e) {
    console.error('[DEBUG] batchReportsV3: 打印结果长度失败', e.message);
  }
  return results;
}

// 导出handleSummary函数
export function handleSummary(data) {
  return reportOperation.generateHandleSummary(data);
}
