import { BatchReportOperation } from '../../../libs/batch/BatchOperationBase.js';
import { performDataComparison } from '../formdata/aggregatecalculation.test.js';

import { reportConfigs } from '../../../config/fromConfig.js';


/**
 * 根据优先级对报告配置进行排序
 * @returns {Array} 排序后的报告配置数组
 */
function getReportsByPriority() {
  // 使用数组的sort方法，按照priority属性进行升序排序
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

  // 执行批量操作 - 串行模式（避免 Token 并发问题）
  const results = reportOperation.execute(data, reportList, executeReport, {
    parallel: false,  // 禁用并行执行，使用串行模式
    batchSize: 5      // 串行模式下此参数无效
  });

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
