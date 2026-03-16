import { loadConfigFromFile } from './load.js';
import { ENV_CONFIG, getEnvByTenantId } from './envconfig.js';

const config = loadConfigFromFile();

/**
 * 获取当前环境信息
 * @returns {Object} 环境信息对象
 */
export function getEnvironment() {
  return {
    name: config.environment,
    baseUrl: config.local.API_BASE_URL,
    adminUrl: config.local.API_ADMIN_URL,
    version: config.apiVersion
  };
}

/**
 * 根据端点获取完整的API URL
 * @param {string} endpoint - API端点
 * @param {boolean} isDesk - 是否是前台请求，true前台，false后台
 * @returns {string} 完整的API URL
 */
export function getApiUrl(endpoint, isDesk = true) {
  let baseUrl = '';
  const tenantIdStr = __ENV.TENANT_ID || ENV_CONFIG.TENANTID;
  const currentEnv = getEnvByTenantId(tenantIdStr);
  
  if (isDesk) {
    baseUrl = currentEnv.BASE_DESK_URL || config.local.API_BASE_URL;
  } else {
    baseUrl = currentEnv.BASE_ADMIN_URL || config.local.API_ADMIN_URL;
  }
  // 确保 endpoint 是字符串并以斜杠开头
  const path = String(endpoint || '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  // 构建URL
  const version = config.apiVersion ? `/${config.apiVersion}` : '';

  return `${baseUrl}${version}${normalizedPath}`;
}
