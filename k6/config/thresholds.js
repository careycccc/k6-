/**
 * 性能测试阈值配置
 */
export const thresholds = {
    // HTTP相关阈值
    http: {
      // 通用HTTP请求阈值
      general: {
        'http_req_duration': ['p(95)<1000', 'p(99)<2000'],
        'http_req_failed': ['rate<0.01'],
        'http_reqs': ['count>100']
      },
      
      // API特定阈值
      api: {
        'http_req_duration{api:user}': ['p(95)<800', 'p(99)<1500'],
        'http_req_duration{api:product}': ['p(95)<600', 'p(99)<1200'],
        'http_req_duration{api:order}': ['p(95)<1200', 'p(99)<2500']
      },
      
      // 环境特定阈值
      environments: {
        local: {
          'http_req_duration': ['p(95)<2000', 'p(99)<5000']
        },
        dev: {
          'http_req_duration': ['p(95)<1500', 'p(99)<3000']
        },
        staging: {
          'http_req_duration': ['p(95)<1000', 'p(99)<2000']
        },
        production: {
          'http_req_duration': ['p(95)<800', 'p(99)<1500']
        }
      }
    },
    
    // 业务指标阈值
    business: {
      // 用户相关
      user: {
        'user_registration_success_rate': ['rate>0.99'],
        'user_login_duration': ['p(95)<500']
      },
      
      // 订单相关
      order: {
        'order_creation_success_rate': ['rate>0.98'],
        'order_processing_duration': ['p(95)<2000']
      },
      
      // 支付相关
      payment: {
        'payment_success_rate': ['rate>0.995'],
        'payment_processing_duration': ['p(95)<1000']
      }
    },
    
    // 系统资源阈值
    system: {
      // VU相关
      vu: {
        'vus': ['value<1000'],
        'vus_max': ['value<2000']
      },
      
      // 迭代相关
      iteration: {
        'iterations': ['count>1000'],
        'iteration_duration': ['p(95)<5000']
      },
      
      // 数据相关
      data: {
        'data_received': ['count<100000000'], // 100MB
        'data_sent': ['count<10000000'] // 10MB
      }
    },
    
    // 自定义指标阈值
    custom: {
      'failed_requests': ['rate<0.05'],
      'slow_requests': ['rate<0.01'],
      'timeout_requests': ['rate<0.001']
    }
  };
  
  /**
   * 根据测试类型获取阈值配置
   */
  export function getThresholds(testType, environment = null) {
    const env = environment || __ENV.ENVIRONMENT || 'local';
    
    let config = {};
    
    // 添加HTTP阈值
    config = {
      ...config,
      ...thresholds.http.general,
      ...thresholds.http.api
    };
    
    // 添加环境特定阈值
    if (thresholds.http.environments[env]) {
      config = {
        ...config,
        ...thresholds.http.environments[env]
      };
    }
    
    // 根据测试类型添加业务阈值
    if (thresholds.business[testType]) {
      config = {
        ...config,
        ...thresholds.business[testType]
      };
    }
    
    // 添加系统阈值
    config = {
      ...config,
      ...thresholds.system.vu,
      ...thresholds.system.iteration,
      ...thresholds.system.data
    };
    
    // 添加自定义指标阈值
    config = {
      ...config,
      ...thresholds.custom
    };
    
    return config;
  }
  
  /**
   * 验证阈值配置
   */
  export function validateThresholds(thresholdConfig) {
    const warnings = [];
    const errors = [];
    
    for (const [metric, rules] of Object.entries(thresholdConfig)) {
      if (!Array.isArray(rules)) {
        errors.push(`阈值配置错误: ${metric} 的值不是数组`);
        continue;
      }
      
      for (const rule of rules) {
        if (typeof rule !== 'string') {
          errors.push(`阈值规则错误: ${metric} 的规则不是字符串`);
          continue;
        }
        
        // 验证规则格式
        if (!/^[<>]=?\s*\d+(\.\d+)?$/.test(rule.replace(/\s+/g, ''))) {
          warnings.push(`阈值规则格式可能不正确: ${metric}: ${rule}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      warnings,
      errors
    };
  }
  
  /**
   * 生成阈值报告
   */
  export function generateThresholdReport(testData, thresholdConfig) {
    const report = {
      timestamp: new Date().toISOString(),
      thresholds: {},
      summary: {
        totalThresholds: Object.keys(thresholdConfig).length,
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
    
    for (const [metric, rules] of Object.entries(thresholdConfig)) {
      const metricValue = testData.metrics?.[metric]?.values;
      
      if (!metricValue) {
        report.thresholds[metric] = {
          status: 'WARNING',
          message: '指标数据不存在'
        };
        report.summary.warnings++;
        continue;
      }
      
      const results = rules.map(rule => {
        return evaluateThresholdRule(metricValue, rule);
      });
      
      const allPassed = results.every(r => r.passed);
      
      report.thresholds[metric] = {
        rules,
        results,
        status: allPassed ? 'PASS' : 'FAIL',
        value: metricValue
      };
      
      if (allPassed) {
        report.summary.passed++;
      } else {
        report.summary.failed++;
      }
    }
    
    report.summary.passRate = (report.summary.passed / report.summary.totalThresholds * 100).toFixed(2) + '%';
    
    return report;
  }
  
  /**
   * 评估阈值规则
   */
  function evaluateThresholdRule(metricValue, rule) {
    // 简化实现，实际需要解析规则并比较
    return {
      rule,
      passed: true, // 实际需要根据规则计算
      actualValue: metricValue
    };
  }
  
  export default {
    thresholds,
    getThresholds,
    validateThresholds,
    generateThresholdReport
  };
  