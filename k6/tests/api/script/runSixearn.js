import { AdminLogin, adminTag } from '../login/adminlogin.test.js';
import { querySubAccounts as sixearnFunc, sixearnTag } from '../sixearn/sixearn.test.js';
import { hanlderThresholds } from '../../../config/thresholds.js';
import { logger } from '../../../libs/utils/logger.js';
import { VerifyBetAmountStatistics as verifyBetAmountStatisticsFunc } from '../sixearn/RebateLevel.test.js';
import { bundEarn as unbindSubAccountsFunc } from '../sixearn/bundearn.test.js';



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

export function loginExec() {
    AdminLogin(); // 这里执行登录，会计入 metrics
}


// 返佣金额查询逻辑
//k6 run -e TENANT_ID=3004 -e TARGET_UID=135833 k6-/k6/tests/api/script/runSixearn.js

// 返佣金额的绑定和验证逻辑
//k6 run -e TENANT_ID=3002 -e UNBIND_UID=5945184 -e BIND_INVITE_CODE=QSQKH5N k6-/k6/tests/api/script/runSixearn.js

// k6 run -e TENANT_ID=3002 -e UNBIND_UID=5945198 -e BIND_INVITE_CODE=NP672GN runSixearn.js

// ============================================================
// 配置：要查询明日返佣的总代 UID 和 租户
// 支持通过环境变量动态传入，例如：
// k6 run -e TENANT_ID=3004 -e TARGET_UID=135833 runSixearn.js
// 如果不传环境变量，则使用下面的默认值
// ============================================================
const TARGET_UID = __ENV.TARGET_UID || 135833;

export function querySubAccounts(data) {
    if (__ENV.TENANT_ID) {
        console.log(`\n======================================================`);
        console.log(`[Multi-Tenant] 当前使用租户: ${__ENV.TENANT_ID}`);
        console.log(`======================================================`);
    }
    return sixearnFunc(data, parseInt(TARGET_UID, 10));
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
            exec: 'loginExec',
            maxDuration: '5s'
        }
    },
    thresholds: thresholds // 或按 tag 分开
};

// 根据传入的环境变量决定当前运行哪个场景功能，保证“返佣查询”和“解绑与绑定”完全分开独立执行
if (__ENV.ACTION === 'bundearn' || __ENV.UNBIND_UID || __ENV.BIND_INVITE_CODE) {
    // 场景4：解绑下级账号与绑定
    options.scenarios.bundEarn = {
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 1, // 只运行一次
        exec: 'bundEarn',
        startTime: '2s',
    };
} else {
    // 场景2：查询下级账号执行返佣逻辑的检查（默认）
    options.scenarios.querySubAccounts = {
        executor: 'per-vu-iterations',
        vus: 1,
        iterations: 1, // 只运行一次
        exec: 'querySubAccounts',
        startTime: '2s',
        maxDuration: '1000s'
    };
}
export default function () { }
