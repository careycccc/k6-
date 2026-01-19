import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { querySubAccounts as sixearnFunc, sixearnTag } from '../sixearn/sixearn.test.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { logger } from '../../../libs/utils/logger.js';
import { VerifyBetAmountStatistics as verifyBetAmountStatisticsFunc } from '../sixearn/RebateLevel.test.js';
import { bundEarn as unbindSubAccountsFunc } from '../sixearn/bundearn.test.js';


//优惠券的创建和启用
// const loader = loadConfigFromFile();

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

export function querySubAccounts(data) {
    return sixearnFunc(data);
}

export function verifyBetAmountStatistics(data) {
    return verifyBetAmountStatisticsFunc(data);
}

export function bundEarn(data) {
    return unbindSubAccountsFunc(data);
}

const thresholds = {
    // 合并所有场景的阈值
    ...hanlderThresholds(adminTag),
    ...hanlderThresholds(sixearnTag)
};

// 场景配置
export const options = {
    scenarios: {
        // 场景1：后台登录
        login: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            maxDuration: '10s'
        },
        //场景2：查询下级账号执行返佣逻辑的检查
        querySubAccounts: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1, // 只运行一次
            exec: 'querySubAccounts',
            startTime: '2s',
            maxDuration: '1000s'
        },
        // 场景3：验证投注金额统计
        // verifyBetAmountStatistics: {
        //     executor: 'per-vu-iterations',
        //     vus: 1,
        //     iterations: 1, // 只运行一次
        //     exec: 'verifyBetAmountStatistics',
        //     startTime: '2s',
        //     maxDuration: '1000s'
        // },
        // 场景4：解绑下级账号
        // bundEarn: {
        //     executor: 'per-vu-iterations',
        //     vus: 1,
        //     iterations: 1, // 只运行一次
        //     exec: 'bundEarn',
        //     startTime: '2s',
        // },
    },
    thresholds: thresholds // 或按 tag 分开
}
export default function () { }
