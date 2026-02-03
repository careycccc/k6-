
import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { queryL3InviteOkReward as queryL3InviteOkRewardfunc } from '../formdata/newagentForm/newagentForm.test.js';
import { logger } from '../../../libs/utils/logger.js';

// ==================== setup：全局登录一次 ====================
export function setup() {
    try {
        const token = AdminLogin();
        if (!token) {
            logger.error('AdminLogin 返回空值，登录失败');
            throw new Error('AdminLogin 返回空 token');
        }
        return { token };
    } catch (error) {
        logger.error('AdminLogin 发生异常:', error.message);
        throw new Error(`登录失败: ${error.message}`);
    }
}

export function queryL3InviteOkReward(data) {
    queryL3InviteOkRewardfunc(data)
}


// ==================== scenarios 定义 ====================
export const options = {
    scenarios: {
        // 场景1：后台登录
        login: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            maxDuration: '10s'
        },
        // 优惠券的场景
        queryL3InviteOkReward: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            exec: 'queryL3InviteOkReward', // 注意：这里用函数名字符串
            startTime: '2s'
        },
    },
};

// ==================== 必须的 default（多场景脚本要求） ====================
export default function () {
    // 不执行任何逻辑
    logger.info('此脚本通过 scenarios 运行');
}
