// 检查环境变量是否已定义，如果未定义则使用硬编码值
export const config = {
  environment: __ENV.ENVIRONMENT || 'local',
  apiBaseUrl: __ENV.API_BASE_URL || 'https://arplatsaassit1.club', // 默认值
  apiVersion: __ENV.API_VERSION || '',
  logLevel: __ENV.LOG_LEVEL || 'info'
};

/**
 * 获取完整的API URL
 * @param {string} endpoint - API端点
 * @returns {string} 完整的URL
 */
export function getApiUrl(endpoint) {
  // 确保 endpoint 以斜杠开头
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  
  // 构建URL
  const baseUrl = config.apiBaseUrl;
  const version = config.apiVersion ? `/${config.apiVersion}` : '';
  
  return `${baseUrl}${version}${path}`;
}

/**
 * 获取环境配置
 */
export function getEnvironment() {
  return config.environment;
}

/**
 * 获取API基础URL
 */
export function getApiBaseUrl() {
  return config.apiBaseUrl;
}

/**
 * 打印当前配置（用于调试）
 */
export function printConfig() {
  console.log('当前环境配置:');
  console.log('  环境:', config.environment);
  console.log('  API基础URL:', config.apiBaseUrl);
  console.log('  API版本:', config.apiVersion);
  console.log('  日志级别:', config.logLevel);
}

// 导出默认配置
export default {
  config,
  getApiUrl,
  getEnvironment,
  getApiBaseUrl,
  printConfig
};
