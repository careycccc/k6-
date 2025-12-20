import { check } from 'k6';
import { logger } from '../utils/logger.js';

/**
 * API检查工具
 */
export class ApiChecks {
  /**
   * 基础HTTP检查
   */
  static httpChecks(response, options = {}) {
    const {
/**
 * 期望的HTTP状态码数组
 * 这些状态码表示请求成功
 */
      expectedStatus = [200, 201, 204],  // 200:OK, 201:Created, 204:No Content
      maxDuration = 5000,
      checkHeaders = true,
      checkBody = true
    } = options;

    const checks = {};

    // 状态码检查
    if (Array.isArray(expectedStatus)) {
      checks['状态码正确'] = (r) => expectedStatus.includes(r.status);
    } else {
      checks['状态码正确'] = (r) => r.status === expectedStatus;
    }

    // 响应时间检查
    checks['响应时间'] = (r) => r.timings.duration < maxDuration;

    // 响应头检查
    if (checkHeaders) {
      checks['有Content-Type头'] = (r) => r.headers['Content-Type'] !== undefined;
      checks['Content-Type包含json'] = (r) => 
        r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json');
    }

    // 响应体检查
    if (checkBody && response.body) {
      checks['响应体不为空'] = (r) => r.body && r.body.length > 0;
      
      try {
        const json = response.json();
        checks['响应体为有效JSON'] = (r) => true;
        
        // 检查JSON结构
        if (json) {
          checks['JSON包含success字段'] = () => json.success !== undefined;
          checks['JSON包含message字段'] = () => json.message !== undefined;
        }
      } catch {
        checks['响应体为有效JSON'] = (r) => false;
      }
    }

    return check(response, checks);
  }

  /**
   * 业务逻辑检查
   */
  static businessChecks(response, businessRules = {}) {
    const checks = {};

    try {
      const data = response.json();

      // 检查业务状态码
      if (businessRules.expectedCode !== undefined) {
        checks['业务状态码正确'] = () => data.code === businessRules.expectedCode;
      }

      // 检查业务消息
      if (businessRules.expectedMessage) {
        checks['业务消息匹配'] = () => data.msg === businessRules.expectedMessage;
      }

      // 检查数据字段
      if (businessRules.requiredFields) {
        businessRules.requiredFields.forEach(field => {
          checks[`包含字段: ${field}`] = () => data[field] !== undefined;
        });
      }

      // 自定义检查函数
      if (businessRules.customChecks) {
        Object.entries(businessRules.customChecks).forEach(([name, checkFn]) => {
          checks[name] = () => checkFn(data);
        });
      }

    } catch (error) {
      checks['响应体解析'] = () => false;
      logger.error('响应体解析失败', error.message);
    }

    return check(response, checks);
  }

  /**
   * 性能检查
   */
  static performanceChecks(response, thresholds = {}) {
    const {
      // 响应时间，单位为毫秒
      responseTime = 1000,
      // 字节传输时间，单位为毫秒
      ttfB = 500,
      // 请求传输时间，单位为毫秒
      ttfR = 500,
      // 等待时间，单位为毫秒
      waiting = 300
    } = thresholds;

    const checks = {};

    checks['总响应时间'] = (r) => r.timings.duration < responseTime;
    checks['等待时间'] = (r) => r.timings.waiting < waiting;
    checks['接收时间'] = (r) => r.timings.receiving < ttfR;
    
    if (r.timings.sending !== undefined) {
      checks['发送时间'] = (r) => r.timings.sending < ttfB;
    }

    return check(response, checks);
  }

  /**
   * 数据一致性检查
   */
  static dataConsistencyChecks(originalData, responseData, fieldsToCompare = []) {
    const checks = {};

    if (fieldsToCompare.length === 0) {
      fieldsToCompare = Object.keys(originalData);
    }

    fieldsToCompare.forEach(field => {
      checks[`字段 ${field} 一致`] = () => 
        JSON.stringify(originalData[field]) === JSON.stringify(responseData[field]);
    });

    return check(null, checks);
  }

  /**
   * 批量检查
   */
  static batchChecks(responses, checkConfigs) {
    const allResults = [];

    responses.forEach((response, index) => {
      const config = checkConfigs[index] || {};
      
      const results = {
        http: this.httpChecks(response, config.http),
        business: this.businessChecks(response, config.business),
        performance: this.performanceChecks(response, config.performance)
      };

      allResults.push({
        index,
        url: response.url,
        status: response.status,
        results,
        allPassed: Object.values(results).every(r => r)
      });
    });

    return allResults;
  }

  /**
   * 生成检查报告
   */
  static generateCheckReport(checkResults) {
    const totalChecks = Object.keys(checkResults).length;
    const passedChecks = Object.values(checkResults).filter(Boolean).length;
    const passRate = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0;

    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalChecks,
        passedChecks,
        failedChecks: totalChecks - passedChecks,
        passRate: `${passRate.toFixed(2)}%`
      },
      details: checkResults,
      status: passRate === 100 ? 'PASS' : passRate >= 80 ? 'WARNING' : 'FAIL'
    };
  }
}

export default ApiChecks;
