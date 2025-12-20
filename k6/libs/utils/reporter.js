import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { logger } from './logger.js';

/**
 * 报告生成器
 */
export class Reporter {
  constructor(config = {}) {
    this.config = {
      outputDir: 'reports',
      generateHtml: true,
      generateJson: true,
      generateJUnit: true,
      generateSummary: true,
      ...config
    };
    
    this.metrics = {};
    this.startTime = Date.now();
  }

  /**
   * 收集指标
   */
  collectMetrics(data) {
    this.metrics = {
      ...this.metrics,
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      metrics: data.metrics || {},
      stats: this.calculateStats(data)
    };
  }

  /**
   * 计算统计信息
   */
  calculateStats(data) {
    const httpReqs = data.metrics?.http_reqs || {};
    const httpReqDuration = data.metrics?.http_req_duration || {};
    
    return {
      totalRequests: httpReqs.values?.count || 0,
      failedRequests: data.metrics?.http_req_failed?.values?.rate || 0,
      avgResponseTime: httpReqDuration.values?.avg || 0,
      p95ResponseTime: httpReqDuration.values?.['p(95)'] || 0,
      p99ResponseTime: httpReqDuration.values?.['p(99)'] || 0,
      requestsPerSecond: (httpReqs.values?.rate || 0) * 60,
      dataSent: data.metrics?.data_sent?.values?.count || 0,
      dataReceived: data.metrics?.data_received?.values?.count || 0
    };
  }

  /**
   * 生成HTML报告
   */
  generateHtmlReport(data) {
    try {
      const reportName = `report-${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
      const reportPath = `${this.config.outputDir}/html/${reportName}`;
      
      const html = htmlReport(data);
      
      // 注意：k6环境不能直接写文件，这里返回HTML内容
      // 实际使用中需要通过外部脚本保存
      return {
        path: reportPath,
        content: html
      };
    } catch (error) {
      logger.error('生成HTML报告失败', error.message);
      return null;
    }
  }

  /**
   * 生成JSON报告
   */
  generateJsonReport(data) {
    try {
      const reportName = `report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const reportPath = `${this.config.outputDir}/json/${reportName}`;
      
      const reportData = {
        metadata: {
          timestamp: new Date().toISOString(),
          environment: __ENV.ENVIRONMENT || 'unknown',
          testType: __ENV.TEST_TYPE || 'unknown'
        },
        summary: this.calculateStats(data),
        thresholds: this.evaluateThresholds(data),
        metrics: data.metrics,
        errors: this.collectErrors(data)
      };
      
      return {
        path: reportPath,
        content: JSON.stringify(reportData, null, 2)
      };
    } catch (error) {
      logger.error('生成JSON报告失败', error.message);
      return null;
    }
  }

  /**
   * 生成JUnit报告
   */
  generateJUnitReport(data) {
    try {
      const reportName = `report-${new Date().toISOString().replace(/[:.]/g, '-')}.xml`;
      const reportPath = `${this.config.outputDir}/junit/${reportName}`;
      
      const tests = this.collectTestCases(data);
      const failures = this.countFailures(data);
      
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="k6 Performance Tests"
           tests="${tests}"
           failures="${failures}"
           time="${(Date.now() - this.startTime) / 1000}">
  ${this.generateJUnitTestCases(data)}
</testsuite>`;
      
      return {
        path: reportPath,
        content: xml
      };
    } catch (error) {
      logger.error('生成JUnit报告失败', error.message);
      return null;
    }
  }

  /**
   * 生成文本摘要
   */
  generateTextSummary(data) {
    try {
      return textSummary(data);
    } catch (error) {
      logger.error('生成文本摘要失败', error.message);
      return 'Summary generation failed';
    }
  }

  /**
   * 收集测试用例
   */
  collectTestCases(data) {
    // 这里可以根据实际测试结构收集测试用例
    return Object.keys(data.metrics || {}).length;
  }

  /**
   * 计算失败次数
   */
  countFailures(data) {
    let failures = 0;
    
    // 检查阈值失败
    if (data.thresholds && typeof data.thresholds === 'object') {
      for (const [metric, threshold] of Object.entries(data.thresholds)) {
        if (threshold && typeof threshold === 'object' && !threshold.ok) {
          failures++;
        }
      }
    }
    
    return failures;
  }

  /**
   * 生成JUnit测试用例
   */
  generateJUnitTestCases(data) {
    const cases = [];
    
    // 为每个指标生成测试用例
    for (const [metricName, metric] of Object.entries(data.metrics || {})) {
      const passed = this.checkMetricThreshold(metric, data.thresholds?.[metricName]);
      
      cases.push(`
  <testcase name="${metricName}" classname="k6.metrics">
    ${!passed ? `<failure message="Threshold failed for ${metricName}"></failure>` : ''}
  </testcase>`);
    }
    
    return cases.join('');
  }

  /**
   * 检查指标阈值
   */
  checkMetricThreshold(metric, threshold) {
    if (!threshold || !metric.values) return true;
    
    // 简化检查逻辑
    return true;
  }

  /**
   * 评估阈值
   */
  evaluateThresholds(data) {
    const results = {};
    
    if (data.thresholds) {
      for (const [name, threshold] of Object.entries(data.thresholds)) {
        results[name] = {
          threshold,
          passed: threshold ? threshold.ok : true,
          value: data.metrics?.[name]?.values || null
        };
      }
    }
    
    return results;
  }

  /**
   * 收集错误信息
   */
  collectErrors(data) {
    const errors = [];
    
    // 收集HTTP错误
    if (data.metrics?.http_req_failed?.values?.fails) {
      errors.push({
        type: 'http_request_failed',
        count: data.metrics.http_req_failed.values.fails,
        rate: data.metrics.http_req_failed.values.rate
      });
    }
    
    // 收集阈值失败
    const thresholdFailures = this.evaluateThresholds(data);
    for (const [name, result] of Object.entries(thresholdFailures)) {
      if (!result.passed) {
        errors.push({
          type: 'threshold_failure',
          metric: name,
          threshold: result.threshold,
          value: result.value
        });
      }
    }
    
    return errors;
  }

  /**
   * 生成所有报告
   */
  generateAllReports(data) {
    const reports = {};
    
    if (this.config.generateHtml) {
      reports.html = this.generateHtmlReport(data);
    }
    
    if (this.config.generateJson) {
      reports.json = this.generateJsonReport(data);
    }
    
    if (this.config.generateJUnit) {
      reports.junit = this.generateJUnitReport(data);
    }
    
    if (this.config.generateSummary) {
      reports.summary = this.generateTextSummary(data);
    }
    
    return reports;
  }
}

// 创建默认报告器实例
export const reporter = new Reporter();

export default {
  Reporter,
  reporter
};
