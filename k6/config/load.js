import { ENV_CONFIG } from './envconfig.js';
export function loadConfigFromFile() {
  // 检查是否在特定环境中运行，加载不同配置
  const configs = {
    local: {
      API_BASE_URL: ENV_CONFIG.BASE_DESK_URL, // 前台地址
      API_VERSION: '',
      API_ADMIN_URL: ENV_CONFIG.BASE_ADMIN_URL, // 管理后台地址
      env: 'local'
    },
    dev: {
      API_BASE_URL: 'https://dev-api.com',
      API_VERSION: 'v1'
    },
    prod: {
      API_BASE_URL: 'https://prod-api.com',
      API_VERSION: 'v1'
    }
  };

  return configs || configs.local;
}
