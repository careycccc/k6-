/**
 * 登录统一入口 —— 新脚本请只从这里 import 登录相关函数
 *
 *   后台：
 *     adminLogin(tenantId?)                    主管理员登录（带 Google 验证码，多窗口重试）
 *     backendLogin(userName, pwd, secret, tenantId?)  任意后台账号（受限账号/客服）
 *   前台（会员）：
 *     loginByPassword(account, password?)      密码登录，默认密码 qwer1234
 *     loginByPasswordRetry(account, password?, tries?)  密码登录失败退避重试（并发/防重提交时用）
 *     loginByCode(account, adminToken)         验证码免密登录（含 @ 走邮箱，否则走手机号）
 *     autoLoginByAccount / autoLoginByUserId   同上（userAccountApi 原实现，账号类型校验更严格）
 *
 * 注意：会员 token 约 55 秒失效，长流程后段要重新登录。
 */

import { sleep } from 'k6';
import { tenantAdminLogin, backendLogin } from '../../../libs/http/tenantRequest.js';
import { loginWithPassword } from '../recharge/rechargeLevel.service.js';
import { autoLoginByAccount, autoLoginByUserId } from '../user/userAccountApi.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';

export { tenantAdminLogin as adminLogin, backendLogin };
export { loginWithPassword as loginByPassword };
export { autoLoginByAccount, autoLoginByUserId };

/** 验证码免密登录：账号含 @ 走邮箱，否则一律走手机号 */
export function loginByCode(account, adminToken) {
    const adminData = { token: adminToken };
    if (account.includes('@')) return emailAutoLoginFlow(account, adminData);
    return mobileAutoLoginFlow(account, adminData);
}

/**
 * 密码登录，失败后依次等待 4s、6s、8s… 再试（每次失败后都会等待）
 * @returns {string|null} token
 */
export function loginByPasswordRetry(account, password = 'qwer1234', tries = 3) {
    for (let a = 1; a <= tries; a++) {
        const t = loginWithPassword(account, password);
        if (t) return t;
        sleep(2 + a * 2);
    }
    return null;
}
