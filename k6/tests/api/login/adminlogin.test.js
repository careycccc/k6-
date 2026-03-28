import { hanlderThresholds } from '../../../config/thresholds.js';
import { loadConfigFromFile } from '../../../config/load.js';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';

export const adminTag = 'adminlogin';
const loader = loadConfigFromFile();

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: hanlderThresholds(adminTag),
  tags: {
    environment: loader.local.env,
    test_type: 'adminapi',
    service: 'user',
    operation: adminTag
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  summaryTimeUnit: 'ms'
};

// 后台登录
export function AdminLogin() {
  return tenantAdminLogin();
}

// 默认导出函数，用于k6执行
export default function () {
  const token = AdminLogin();
  return token;
}
