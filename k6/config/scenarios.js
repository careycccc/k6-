/**
 * 测试场景配置
 */
export const scenarios = {
    // 冒烟测试场景
    smoke: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 10,
      maxDuration: '5m',
      gracefulStop: '30s',
      tags: {
        test_type: 'smoke',
        priority: 'critical'
      }
    },
    
    // 负载测试场景
    load: {
      normal: {
        executor: 'ramping-vus',
        startVUs: 1,
        stages: [
          { duration: '30s', target: 10 },   // 预热
          { duration: '2m', target: 50 },    // 正常负载
          { duration: '30s', target: 10 }    // 冷却
        ],
        gracefulRampDown: '30s',
        tags: {
          test_type: 'load',
          load_level: 'normal'
        }
      },
      
      high: {
        executor: 'ramping-vus',
        startVUs: 5,
        stages: [
          { duration: '1m', target: 100 },
          { duration: '3m', target: 300 },
          { duration: '1m', target: 100 },
          { duration: '30s', target: 10 }
        ],
        gracefulRampDown: '1m',
        tags: {
          test_type: 'load',
          load_level: 'high'
        }
      }
    },
    
    // 压力测试场景
    stress: {
      spike: {
        executor: 'ramping-vus',
        startVUs: 10,
        stages: [
          { duration: '30s', target: 100 },   // 快速上升
          { duration: '1m', target: 500 },    // 尖峰负载
          { duration: '30s', target: 100 },   // 快速下降
          { duration: '1m', target: 10 }      // 恢复
        ],
        gracefulRampDown: '30s',
        tags: {
          test_type: 'stress',
          pattern: 'spike'
        }
      },
      
      soak: {
        executor: 'constant-vus',
        vus: 50,
        duration: '30m',
        gracefulStop: '1m',
        tags: {
          test_type: 'stress',
          pattern: 'soak'
        }
      }
    },
    
    // 耐力测试场景
    endurance: {
      short: {
// 执行器配置，指定使用恒定虚拟用户模式
        executor: 'constant-vus',  // 设置执行器类型为恒定虚拟用户，表示在测试过程中保持固定的虚拟用户数不变
        vus: 20,
        duration: '1h',
        gracefulStop: '2m',
        tags: {
// 测试类型配置
          test_type: 'endurance',  // 指定测试类型为耐力测试
          duration: 'short'        // 指定测试持续时间为短
        }
      },
      
      long: {
        executor: 'constant-vus',
        vus: 10,
        duration: '8h',
        startTime: '0s',
        gracefulStop: '5m',
        tags: {
          test_type: 'endurance',
          duration: 'long'
        }
      }
    },
    
    // 容量测试场景
    capacity: {
      find_limits: {
        executor: 'ramping-arrival-rate',
        startRate: 10,
        timeUnit: '1s',
        preAllocatedVUs: 10,
        maxVUs: 1000,
        stages: [
          { target: 50, duration: '5m' },
          { target: 100, duration: '5m' },
          { target: 200, duration: '5m' },
          { target: 400, duration: '5m' }
        ],
        tags: {
          test_type: 'capacity',
          goal: 'find_limits'
        }
      }
    },
    
    // 浏览器测试场景
    browser: {
      chromium: {
        executor: 'constant-vus',
        vus: 3,
        duration: '5m',
        options: {
          browser: {
            type: 'chromium'
          }
        },
        tags: {
          test_type: 'browser',
          browser: 'chromium'
        }
      }
    }
  };
  
  /**
   * 获取场景配置
   */
  export function getScenario(scenarioName, customConfig = {}) {
    const scenarioPath = scenarioName.split('.');
    let config = scenarios;
    
    for (const path of scenarioPath) {
      if (config[path]) {
        config = config[path];
      } else {
        throw new Error(`场景 ${scenarioName} 不存在`);
      }
    }
    
    // 合并自定义配置
    return {
      ...config,
      ...customConfig,
      tags: {
        ...config.tags,
        ...customConfig.tags
      }
    };
  }
  
  /**
   * 根据环境调整场景配置
   */
  export function adaptScenarioForEnvironment(scenarioConfig, environment) {
    const envFactors = {
      local: 0.1,
      dev: 0.5,
      staging: 0.8,
      production: 1.0
    };
    
    const factor = envFactors[environment] || 1.0;
    
    const adapted = { ...scenarioConfig };
    
    // 调整VU数量
    if (adapted.vus) {
      adapted.vus = Math.max(1, Math.floor(adapted.vus * factor));
    }
    
    if (adapted.startVUs) {
      adapted.startVUs = Math.max(1, Math.floor(adapted.startVUs * factor));
    }
    
    if (adapted.maxVUs) {
      adapted.maxVUs = Math.max(1, Math.floor(adapted.maxVUs * factor));
    }
    
    // 调整迭代次数
    if (adapted.iterations) {
      adapted.iterations = Math.max(1, Math.floor(adapted.iterations * factor));
    }
    
    // 调整持续时间
    if (adapted.duration) {
      // 保持持续时间不变，只调整负载
    }
    
    // 调整阶段目标
    if (adapted.stages) {
      adapted.stages = adapted.stages.map(stage => ({
        ...stage,
        target: Math.max(1, Math.floor(stage.target * factor))
      }));
    }
    
    // 调整到达率
    if (adapted.startRate) {
      adapted.startRate = Math.max(1, Math.floor(adapted.startRate * factor));
    }
    
    if (adapted.stages && adapted.executor === 'ramping-arrival-rate') {
      adapted.stages = adapted.stages.map(stage => ({
        ...stage,
        target: Math.max(1, Math.floor(stage.target * factor))
      }));
    }
    
    return adapted;
  }
  
  /**
   * 验证场景配置
   */
  export function validateScenario(scenarioConfig) {
    const errors = [];
    const warnings = [];
    
    // 检查必需字段
    if (!scenarioConfig.executor) {
      errors.push('场景配置缺少 executor 字段');
    }
    
    // 检查VU配置
    if (scenarioConfig.vus !== undefined && scenarioConfig.vus < 0) {
      errors.push('vus 不能为负数');
    }
    
    if (scenarioConfig.startVUs !== undefined && scenarioConfig.startVUs < 0) {
      errors.push('startVUs 不能为负数');
    }
    
    if (scenarioConfig.maxVUs !== undefined && scenarioConfig.maxVUs < 0) {
      errors.push('maxVUs 不能为负数');
    }
    
    // 检查迭代配置
    if (scenarioConfig.iterations !== undefined && scenarioConfig.iterations < 0) {
      errors.push('iterations 不能为负数');
    }
    
    // 检查持续时间配置
    if (scenarioConfig.duration) {
      const durationRegex = /^(\d+)(s|m|h)$/;
      if (!durationRegex.test(scenarioConfig.duration)) {
        errors.push(`duration 格式错误: ${scenarioConfig.duration}`);
      }
    }
    
    // 检查阶段配置
    if (scenarioConfig.stages) {
      if (!Array.isArray(scenarioConfig.stages)) {
        errors.push('stages 必须是数组');
      } else {
        scenarioConfig.stages.forEach((stage, index) => {
          if (!stage.duration || !stage.target) {
            errors.push(`阶段 ${index} 缺少 duration 或 target`);
          }
          
          if (stage.target < 0) {
            errors.push(`阶段 ${index} 的 target 不能为负数`);
          }
        });
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * 生成场景描述
   */
  export function generateScenarioDescription(scenarioConfig) {
    const desc = [];
    
    desc.push(`执行器: ${scenarioConfig.executor}`);
    
    if (scenarioConfig.vus !== undefined) {
      desc.push(`虚拟用户: ${scenarioConfig.vus}`);
    }
    
    if (scenarioConfig.startVUs !== undefined) {
      desc.push(`起始虚拟用户: ${scenarioConfig.startVUs}`);
    }
    
    if (scenarioConfig.maxVUs !== undefined) {
      desc.push(`最大虚拟用户: ${scenarioConfig.maxVUs}`);
    }
    
    if (scenarioConfig.iterations !== undefined) {
      desc.push(`迭代次数: ${scenarioConfig.iterations}`);
    }
    
    if (scenarioConfig.duration) {
      desc.push(`持续时间: ${scenarioConfig.duration}`);
    }
    
    if (scenarioConfig.stages) {
      desc.push('阶段配置:');
      scenarioConfig.stages.forEach((stage, index) => {
        desc.push(`  阶段 ${index + 1}: ${stage.duration} 内达到 ${stage.target} VU`);
      });
    }
    
    if (scenarioConfig.tags) {
      desc.push('标签:');
      Object.entries(scenarioConfig.tags).forEach(([key, value]) => {
        desc.push(`  ${key}: ${value}`);
      });
    }
    
    return desc.join('\n');
  }
  
  export default {
    scenarios,
    getScenario,
    adaptScenarioForEnvironment,
    validateScenario,
    generateScenarioDescription
  };
  