/**
 * safetest/lib/guest.js
 * 游客 token —— 模拟"未登录"用户（一对一客服聊天在登录前会静默把访客注册成游客）
 *
 * 复用现有 guestRegister(/api/Home/AutoLogin)。packageName 按租户推断 com.ar<tenant>.fb.app，
 * 可用 -e PACKAGE_NAME=... 覆盖。
 */
import { guestRegister } from '../../tests/api/login/register.test.js';

export function getGuestToken(tenant) {
    const pkg = __ENV.PACKAGE_NAME || `com.ar${tenant}.fb.app`;
    const g = guestRegister({ packageName: pkg });
    const token = g && g.data && g.data.token ? g.data.token : '';
    if (!token) {
        console.error(`[guest] 游客注册失败（packageName=${pkg}）。可用 -e PACKAGE_NAME=... 指定正确包名`);
    }
    return token;
}
