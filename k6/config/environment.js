/**
 * 环境配置管理
 */
export const environments = {
    local: {
      baseUrl: 'http://localhost:3000',
      apiVersion: 'v1',
      timeout: 30000,
// 速率限制配置对象
      rateLimit: {
  // 允许的最大请求数量
        requests: 100,
  // 时间窗口，单位为分钟
        window: '1m'
      }
    },
    dev: {
      baseUrl: 'https://dev-api.example.com',
      apiVersion: 'v1',
      timeout: 30000,
      rateLimit: {
        requests: 1000,
        window: '1m'
      }
    },
    staging: {
      baseUrl: 'https://staging-api.example.com',
      apiVersion: 'v1',
      timeout: 60000,
      rateLimit: {
        requests: 5000,
        window: '1m'
      }
    },
    production: {
      baseUrl: 'https://api.example.com',
      apiVersion: 'v1',
      timeout: 60000,
      rateLimit: {
        requests: 10000,
        window: '1m'
      }
    }
  };
  
  /**
   * 获取当前环境配置
   */
  export function getEnvironment() {
// 获取环境变量，如果未设置则默认使用 'local'
    const env = __ENV.ENVIRONMENT || 'local';
    return {
      ...environments[env],
      name: env,
      isProduction: env === 'production',
      isDevelopment: env === 'dev' || env === 'local'
    };
  }
  
  /**
   * 获取API完整路径
   */
  export function getApiUrl(endpoint) {
    const env = getEnvironment();
// 拼接完整的API URL地址
// 通过模板字符串将基础URL、API版本和端点路径组合在一起
// env.baseUrl: 基础URL地址
// env.apiVersion: API版本号
// endpoint: 具体的API端点路径
    return `${env.baseUrl}/${env.apiVersion}${endpoint}`;
  }
  
  export default {
    environments,
    getEnvironment,
    getApiUrl
  };
  