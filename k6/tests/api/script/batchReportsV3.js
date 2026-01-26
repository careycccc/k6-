import { BatchReportOperation } from '../../../libs/batch/BatchOperationBase.js';
import { getReportsByPriority } from '../../../config/reports.js';

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
  return reportOperation.execute(data, reportList, executeReport);
}

// 导出handleSummary函数
export function handleSummary(data) {
  return reportOperation.generateHandleSummary(data);
}
