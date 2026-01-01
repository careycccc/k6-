/**
 * 性能测试阈值配置
 */
const thresholds = {
  THRESHOLD_P95: 1000, // 95% 的请求必须在 1000 毫秒内完成
  THRESHOLD_P99: 2000, // 99% 的请求必须在 2000 毫秒内完成
  THRESHOLD_ERROR_RATE: 0.01, // 错误率不能超过 1%
  THRESHOLD_REQUEST_DURATION: 1000, // 请求持续时间不能超过 1000 毫秒
  THRESHOLD_CHECK_SUCEES_RATE: 0.99 // 检查成功率不能低于 99%
};

// 导出阈值配置
export function hanlderThresholds(tag) {
  return {
    // HTTP请求相关的性能阈值配置
    http_reqs: [`rate>${thresholds.THRESHOLD_CHECK_SUCEES_RATE}`], // HTTP请求成功率阈值
    [`http_req_duration{type:${tag}}`]: [
      // HTTP请求持续时间阈值，根据标签类型区分
      `p(95)<${thresholds.THRESHOLD_P95}`, // 95%分位数的请求持续时间阈值
      `p(99)<${thresholds.THRESHOLD_P99}` // 99%分位数的请求持续时间阈值
    ],
    http_req_failed: [`rate<${thresholds.THRESHOLD_ERROR_RATE}`], // HTTP请求失败率阈值
    checks: [`rate>${thresholds.THRESHOLD_CHECK_SUCEES_RATE}`] // 检查项成功率阈值
  };
}
