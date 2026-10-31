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
// 2026-10-30：forceTenant=true 时强制走商户自己登录，不走集团默认模式。给后续会调用
// 走商户域名的写接口（如图片上传 libs/http/uploadFactory.js）的脚本用——登录和后续
// 请求必须同步用商户模式，否则 token/域名不同步会报 "Account type does not match
// the admin site"（已实测踩坑）。
export function AdminLogin(forceTenant = false) {
  return tenantAdminLogin(null, forceTenant);
}

// 默认导出函数，用于k6执行
export default function () {
  const token = AdminLogin();
  return token;
}
