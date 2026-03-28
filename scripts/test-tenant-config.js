/**
 * 测试租户配置脚本
 */

import { getEnvByTenantId, ENV_CONFIG } from '../k6/config/envconfig.js';
import { getApiUrl } from '../k6/config/environment.js';

const TENANT = __ENV.TENANT || '3002';

console.log('========================================');
console.log(`测试租户: ${TENANT}`);
console.log(`__ENV.TENANT: ${__ENV.TENANT}`);
console.log(`__ENV.TENANT_ID: ${__ENV.TENANT_ID}`);
console.log('========================================');

const envConfig = getEnvByTenantId(TENANT);
console.log(`\n租户配置:`);
console.log(`  BASE_ADMIN_URL: ${envConfig.BASE_ADMIN_URL}`);
console.log(`  BASE_DESK_URL: ${envConfig.BASE_DESK_URL}`);
console.log(`  ADMIN_USERNAME: ${envConfig.ADMIN_USERNAME}`);
console.log(`  TENANTID: ${envConfig.TENANTID}`);

console.log(`\n默认配置 (ENV_CONFIG):`);
console.log(`  BASE_ADMIN_URL: ${ENV_CONFIG.BASE_ADMIN_URL}`);
console.log(`  BASE_DESK_URL: ${ENV_CONFIG.BASE_DESK_URL}`);
console.log(`  TENANTID: ${ENV_CONFIG.TENANTID}`);

console.log(`\ngetApiUrl 测试:`);
console.log(`  前台登录API: ${getApiUrl('/api/Home/Register', true)}`);
console.log(`  后台登录API: ${getApiUrl('/api/Login/Login', false)}`);

export default function () {
    console.log('\n测试完成');
}

export const options = {
    vus: 1,
    iterations: 1
};
