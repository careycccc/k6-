import { logger } from '../../../../libs/utils/logger.js';
import { runMemberLimitAdapter } from './adapter.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { autoLoginByUserId } from '../../user/userAccountApi.js';
import { receiveDailyCheckInReward } from '../signin/signinApi.js';

// k6 的基本配置
export const options = {
    scenarios: {
        member_limit_test: {
            executor: 'per-vu-iterations',
            vus: 1, // 必须为 1，保证串行执行活动配置更新
            iterations: 1,
            maxDuration: '4h'
        },
    },
};

export function setup() {
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');
    return { adminToken };
}

export default function(data) {
    const adminToken = data.adminToken;
    
    // 假设以签到活动为例
    const ACTIVITY_ID = 1001; 
    
    // 1. 定义修改活动的接口
    const updateApi = '/api/DailyCheckIn/SaveConfig'; // 替换为真实的更新接口
    
    // 2. 定义活动基础配置 Payload
    const basePayload = {
        id: ACTIVITY_ID,
        activityName: "测试每日签到",
        userLimit: 1,
        // ... 其他签到活动需要的固定参数 ...
    };

    // 3. 定义如何触发活动以及如何断言结果
    // 参数说明：
    // userId: 适配器分配的账号
    // expectedSuccess: 是否期望成功 (true代表正向测试，false代表逆向会被拦截)
    // testName: 测试环节名称（打印日志用）
    const triggerActivity = (userId, expectedSuccess, testName) => {
        logger.info(`[Test: ${testName}] 准备验证用户: ${userId}`);
        
        // 使用分配的号自动登录
        const userToken = autoLoginByUserId(adminToken, userId);
        if (!userToken) {
            logger.error(`[Test: ${testName}] 登录失败，终止触发`);
            return false;
        }

        // 这里可能还需要调用 hybridRecharge 或者执行特定的前置操作...
        // ...
        
        // 触发领取
        const res = receiveDailyCheckInReward(userToken, ACTIVITY_ID, 0);
        const actualSuccess = res && res.success === true;
        
        // 断言
        if (actualSuccess === expectedSuccess) {
            logger.info(`[Test: ${testName}] ✅ 验证通过 (期望=${expectedSuccess}, 实际=${actualSuccess})`);
            return true;
        } else {
            logger.error(`[Test: ${testName}] ❌ 验证失败 (期望=${expectedSuccess}, 实际=${actualSuccess}, 拦截信息: ${res?.msg || res?.error})`);
            return false;
        }
    };

    // 4. (可选) 自定义 payload 组装逻辑。如果默认的不适用，可以自己写：
    const patchPayload = (base, context) => {
        let payload = Object.assign({}, base);
        // ... 处理合伙人活动或签到活动特有的 `targetType` 或 `limitGroups` 逻辑 ...
        
        // 举例：如果是合伙人活动的逻辑
        if (context.type === 'platform') {
            payload.userLimit = 1;
        } else if (context.type === 'exclude') {
            payload.userLimit = 0;
            payload.limitGroups = JSON.stringify({
                Group: String(context.excludeGroup),
                TagComposite: String(context.excludeTag)
            });
        }
        // ... 
        
        return payload;
    };

    // 5. 执行适配器
    runMemberLimitAdapter(adminToken, {
        activityUpdateApi: updateApi,
        basePayload: basePayload,
        triggerActivity: triggerActivity,
        patchPayload: patchPayload // 不传则使用内置的 defaultPayloadPatcher
    });
}
