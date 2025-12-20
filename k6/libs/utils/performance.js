import { logger } from './logger.js';

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.histogram = new Map();
  }

  /**
   * 开始计时
   */
  startTimer(name) {
    const startTime = performance.now();
    this.metrics.set(name, { startTime });
    return startTime;
  }

  /**
   * 结束计时
   */
  endTimer(name) {
    const endTime = performance.now();
    const metric = this.metrics.get(name);
    
    if (!metric || !metric.startTime) {
      logger.warn(`计时器 ${name} 未开始`);
      return null;
    }
    
    const duration = endTime - metric.startTime;
    
    // 记录到直方图
    if (!this.histogram.has(name)) {
      this.histogram.set(name, []);
    }
    this.histogram.get(name).push(duration);
    
    // 更新指标
    this.metrics.set(name, {
      ...metric,
      endTime,
      duration,
      count: (metric.count || 0) + 1,
      totalDuration: (metric.totalDuration || 0) + duration,
      avgDuration: ((metric.totalDuration || 0) + duration) / ((metric.count || 0) + 1)
    });
    
    // 记录日志
    logger.performance(name, duration);
    
    return duration;
  }

  /**
   * 获取指标
   */
  getMetric(name) {
    return this.metrics.get(name);
  }

  /**
   * 获取所有指标
   */
  getAllMetrics() {
    const result = {};
    for (const [name, metric] of this.metrics.entries()) {
      result[name] = { ...metric };
    }
    return result;
  }

  /**
   * 计算百分位数
   */
  calculatePercentile(name, percentile) {
    const durations = this.histogram.get(name);
    if (!durations || durations.length === 0) {
      return null;
    }
    
    const sorted = [...durations].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    
    return sorted[Math.max(0, index)];
  }

  /**
   * 生成性能报告
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      metrics: {},
      percentiles: {},
      recommendations: []
    };
    
    for (const [name, metric] of this.metrics.entries()) {
      report.metrics[name] = {
        count: metric.count || 0,
        totalDuration: metric.totalDuration || 0,
        avgDuration: metric.avgDuration || 0,
        minDuration: Math.min(...(this.histogram.get(name) || [])),
        maxDuration: Math.max(...(this.histogram.get(name) || []))
      };
      
      // 计算百分位数
      report.percentiles[name] = {
        p50: this.calculatePercentile(name, 50),
        p95: this.calculatePercentile(name, 95),
        p99: this.calculatePercentile(name, 99)
      };
      
      // 生成建议
      if (metric.avgDuration > 1000) {
        report.recommendations.push({
          metric: name,
          issue: '响应时间过长',
          suggestion: '考虑优化API性能或增加缓存'
        });
      }
    }
    
    return report;
  }

  /**
   * 重置监控器
   */
  reset() {
    this.metrics.clear();
    this.histogram.clear();
  }

  /**
   * 异步执行并监控性能
   */
  async monitor(name, asyncFn) {
    this.startTimer(name);
    try {
      const result = await asyncFn();
      this.endTimer(name);
      return result;
    } catch (error) {
      this.endTimer(name);
      throw error;
    }
  }
}

// 创建默认性能监控器实例
export const performanceMonitor = new PerformanceMonitor();

/**
 * 性能监控装饰器
 */
export function monitorPerformance(name) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      performanceMonitor.startTimer(name);
      try {
        const result = await originalMethod.apply(this, args);
        performanceMonitor.endTimer(name);
        return result;
      } catch (error) {
        performanceMonitor.endTimer(name);
        throw error;
      }
    };
    
    return descriptor;
  };
}

export default {
  PerformanceMonitor,
  performanceMonitor,
  monitorPerformance
};
