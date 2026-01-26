import { BatchActivityOperation } from '../../../libs/batch/BatchOperationBase.js';
import { getActivitiesByPriority } from '../../../config/activities.js';

// 创建活动创建操作实例
const activityOperation = new BatchActivityOperation();

// 导出配置选项
export const options = activityOperation.getOptions();

// 导出指标
export const metrics = activityOperation.metrics;

// 导出setup函数
export function setup() {
  return activityOperation.setup();
}

// 导出主执行函数
export default function (data) {
  const activityList = getActivitiesByPriority();

  // 定义执行函数
  function executeActivity(activity, data) {
    return activity.func(data);
  }

  // 执行批量操作
  const results = activityOperation.execute(data, activityList, executeActivity);

  // 显示活动详情（仅活动创建需要）
  if (activityOperation.displayActivityDetails) {
    activityOperation.displayActivityDetails(results);
  }

  return results;
}

// 导出handleSummary函数
export function handleSummary(data) {
  return activityOperation.generateHandleSummary(data);
}
