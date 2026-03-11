import { betRun } from '../runbet/betRun.js';
import { AdminLogin } from '../login/adminlogin.test.js';
import { emailRegister } from '../login/register.test.js';
import { generateRandomEmail } from '../../utils/accountGenerator.js';

export function setup() {
    // 使用现有的 AdminLogin 函数
    console.log('[Setup] 开始后台登录...');
    const adminToken = AdminLogin();
    if (!adminToken) {
        console.error('后台登录失败');
        throw new Error('后台登录失败');
    }

    // 安全地处理 token 显示，避免 substring 错误
    const tokenDisplay = adminToken && typeof adminToken === 'string' && adminToken.length > 20
        ? adminToken.substring(0, 20) + '...'
        : adminToken;
    console.log('[Setup] 后台登录成功，token:', tokenDisplay);
    return { token: adminToken };
}

export const options = {
    scenarios: {
        my_scenario: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            maxDuration: '10s'
        },
    },
};

export default function (data) {
    // 1. 生成随机邮箱账号并注册
    const userName = generateRandomEmail();
    console.log('[Test] 使用随机邮箱账号:', userName);

    console.log('[Test] 开始注册账号...');
    const registerResult = emailRegister(userName, data);

    console.log('[Test] 注册响应类型:', typeof registerResult);
    console.log('[Test] 注册响应:', JSON.stringify(registerResult));

    // 处理不同的返回格式
    let userToken = null;
    if (typeof registerResult === 'string') {
        // 如果返回的是字符串，直接作为 token
        userToken = registerResult;
    } else if (registerResult && registerResult.token) {
        // 如果返回的是对象且包含 token
        userToken = registerResult.token;
    } else if (registerResult && registerResult.data && registerResult.data.token) {
        // 如果返回的是嵌套对象
        userToken = registerResult.data.token;
    }

    if (!userToken) {
        console.error('[Test] 注册失败，无法获取 token');
        return;
    }

    const tokenDisplay = userToken && typeof userToken === 'string' && userToken.length > 20
        ? userToken.substring(0, 20) + '...'
        : userToken;
    console.log('[Test] 注册成功，获得前台 token:', tokenDisplay);

    // 2. 使用前台 token 进行投注
    console.log('[Test] 开始投注...');
    const betSuccess = betRun(userToken, userName);

    if (betSuccess) {
        console.log('[Test] ✅ 投注流程完成');
    } else {
        console.log('[Test] ❌ 投注流程失败');
    }
}
