/**
 * 统一的会话管理模块
 * 提供给需要登录/注册后才能操作的业务流程使用
 */

import { AdminLogin } from '../login/adminlogin.test.js';
import { mobileAutoLoginFlow } from '../login/MobileAutoLogin.test.js';
import { emailAutoLoginFlow } from '../login/EmailAutoLogin.test.js';
import { phoneRegister, emailRegister } from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getEnvByTenantId } from '../../../config/envconfig.js';

/**
 * 生成随机账号
 * @param {string} type - 'phone' 或 'email'
 * @param {string} countryCode - 国家区号（仅用于手机号）
 * @returns {string} 随机账号
 */
function generateRandomAccount(type = 'phone', countryCode = '91') {
    if (type === 'email') {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let str = '';
        for (let i = 0; i < 8; i++) {
            str += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `${str}@gmail.com`;
    } else {
        // 使用传入的区号，后面跟10位随机数字
        let numStr = countryCode;
        for (let i = 0; i < 10; i++) {
            numStr += Math.floor(Math.random() * 10);
        }
        return numStr;
    }
}

/**
 * 获取或创建一个测试会话
 * 如果传入了 userName，则默认尝试登录。
 * 如果 userName 为空，则自动生成一个随机账号并强制走注册流程。
 *
 * @param {string|null} userName - 指定要登录/注册的账号。为空则随机生成。
 * @param {boolean} isRegister - 是否强制走注册流程
 * @param {string} accountType - 'phone' 或 'email'（当随机生成时使用）
 * @returns {object|null} { userToken, adminToken, userId, userName }
 */
export function getTestSession(userName, isRegister = false, accountType = 'phone') {
    const tag = 'SessionManager';

    // 获取租户ID并加载环境配置
    const tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    const envConfig = getEnvByTenantId(tenantId);
    const countryCode = envConfig.COUNTRY_CODE || '91';

    console.log(`[${tag}] 租户ID: ${tenantId}, 区号: ${countryCode}, 前台地址: ${envConfig.BASE_DESK_URL}`);

    // 智能决策：如果没有提供账号，随机生成并强制注册
    if (!userName || userName.trim() === '') {
        userName = generateRandomAccount(accountType, countryCode);
        isRegister = true;
        console.log(`[${tag}] 未提供账号，随机生成并执行注册: ${userName}`);
    } else {
        console.log(`[${tag}] 使用指定账号: ${userName}，执行${isRegister ? '注册' : '登录'}流程`);
    }

    // 1. 获取后台管理员Token（为了获取验证码）
    console.log(`[${tag}] 准备获取AdminToken...`);
    const adminToken = AdminLogin();
    if (!adminToken) {
        console.error(`[${tag}] 后台管理员登录失败，无法继续流程`);
        return null;
    }

    // 我们约定验证码请求接口入参通常把adminToken包在 data.token 中
    const adminData = {
        token: adminToken,
        envConfig: envConfig  // 添加环境配置，包含 BASE_DESK_URL 等信息
    };
    let userToken = null;

    // 自动识别是否为邮箱账号
    const isEmail = userName.includes('@');

    // 默认密码
    const password = 'qwer1234';

    if (isRegister) {
        console.log(`[${tag}] 执行注册流程: ${userName}, 密码: ${password}`);

        // 执行注册
        let registerRes = isEmail ? emailRegister(userName, adminData, password) : phoneRegister(userName, adminData, password);

        // 解析注册结果返回的 token
        if (registerRes && registerRes.headers && registerRes.headers.Authorization) {
            const authHeader = registerRes.headers.Authorization;
            userToken = authHeader.replace('Bearer ', '').trim();
            console.log(`[${tag}] ${isEmail ? '邮箱' : '手机号'}注册成功，提取到 userToken (from headers)`);
        } else if (registerRes && registerRes.data && registerRes.data.token) {
            userToken = registerRes.data.token;
            console.log(`[${tag}] ${isEmail ? '邮箱' : '手机号'}注册成功，提取到 userToken (from data.token)`);
        } else {
            // 如果是手机号注册失败，尝试邮箱注册
            if (!isEmail) {
                console.warn(`[${tag}] 手机号注册失败，尝试使用邮箱注册...`);

                // 生成随机邮箱账号
                const emailAccount = generateRandomAccount('email');
                console.log(`[${tag}] 生成邮箱账号: ${emailAccount}`);

                registerRes = emailRegister(emailAccount, adminData, password);

                if (registerRes && registerRes.headers && registerRes.headers.Authorization) {
                    const authHeader = registerRes.headers.Authorization;
                    userToken = authHeader.replace('Bearer ', '').trim();
                    userName = emailAccount; // 更新为邮箱账号
                    console.log(`[${tag}] 邮箱注册成功，提取到 userToken (from headers)`);
                } else if (registerRes && registerRes.data && registerRes.data.token) {
                    userToken = registerRes.data.token;
                    userName = emailAccount; // 更新为邮箱账号
                    console.log(`[${tag}] 邮箱注册成功，提取到 userToken (from data.token)`);
                } else {
                    // 手机号和邮箱注册都失败
                    console.error(`[${tag}] ❌ 注册失败：手机号和邮箱注册都失败了`);
                    return null;
                }
            } else {
                // 邮箱注册失败，直接报错
                console.error(`[${tag}] ❌ 邮箱注册失败`);
                return null;
            }
        }
    } else {
        console.log(`[${tag}] 执行${isEmail ? '邮箱' : '手机号'}自动登录流程: ${userName}`);
        userToken = isEmail ? emailAutoLoginFlow(userName, adminData) : mobileAutoLoginFlow(userName, adminData);
    }

    if (!userToken) {
        console.error(`[${tag}] 无法获取用户Token，会话建立失败`);
        return null;
    }

    // 2. 获取用户基本信息 (得到真实的 userId 等)
    console.log(`[${tag}] 正在获取用户信息 (UserId)...`);
    const userInfo = getFrontUserInfo(userToken);

    if (!userInfo || !userInfo.userId) {
        console.error(`[${tag}] 获取用户信息失败，无法确认UserId`);
        return null;
    }

    console.log(`[${tag}] ✅ 会话建立成功! 账号: ${userName}, 密码: qwer1234, UserId: ${userInfo.userId}`);

    return {
        userToken: userToken,
        adminToken: adminToken,
        userId: userInfo.userId,
        userName: userName,
        password: 'qwer1234',  // 添加密码字段
        inviteCode: userInfo.inviteCode
    };
}
