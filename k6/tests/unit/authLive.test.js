/**
 * 统一登录入口实测（会真实登录，不写业务数据）
 *   k6 run -e TENANT_ID=3101 -e PWD_ACCOUNT=919028199762 -e CODE_ACCOUNT=919028199762 k6/tests/unit/authLive.test.js
 */
import { adminLogin, loginByPassword, loginByPasswordRetry, loginByCode } from '../api/common/auth.js';

export const options = { vus: 1, iterations: 1 };
export default function () {
    const t = __ENV.TENANT_ID;
    const admin = adminLogin(t);
    const pwd = loginByPassword(__ENV.PWD_ACCOUNT);
    const retry = loginByPasswordRetry(__ENV.PWD_ACCOUNT, 'qwer1234', 2);
    const code = loginByCode(__ENV.CODE_ACCOUNT, admin);
    const ok = v => (v && typeof v === 'string' && v.length > 20 ? '✅' : '❌');
    console.log(`RESULT 后台管理员 ${ok(admin)} | 前台密码 ${ok(pwd)} | 密码重试 ${ok(retry)} | 验证码免密 ${ok(code)}`);
}
