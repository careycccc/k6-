/**
 * workOrderSuite/runWorkOrderSubmitOnly.test.js
 * 纯提交版工单测试 —— 只触发前台工单申请，无后台审核，无客服回复
 *
 * 与 runWorkOrderFull.test.js 的区别：
 *   - 去掉阶段 B（客服处理工单）
 *   - 去掉阶段 C（等待工单清空）
 *   - 客服工单（一对一客服）只由前台会员发起，不做任何回复
 *   - 不改动任何现有文件，只通过 import 复用已有逻辑
 *
 * 运行示例：
 *   # 单账号单轮
 *   k6 run -e TENANT_ID=3007 -e ACCOUNT_COUNT=1 -e VUS=1 -e ITERATIONS=1 runWorkOrderSubmitOnly.test.js
 *
 *   # 多账号多线程
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=5 -e VUS=2 -e ITERATIONS=2 runWorkOrderSubmitOnly.test.js
 *
 *   # 只触发已登录工单
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=2 -e VUS=2 -e TRIGGER_MODE=login runWorkOrderSubmitOnly.test.js
 *
 *   # 只触发未登录工单
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=2 -e VUS=2 -e TRIGGER_MODE=nologin runWorkOrderSubmitOnly.test.js
 *
 * 参数说明：
 *   TENANT_ID      租户 ID（默认读环境配置）
 *   ACCOUNT_COUNT  账号数量（默认 1）
 *   VUS            并发 VU 数（默认 1）
 *   ITERATIONS     每个 VU 的迭代轮数（默认 1）
 *   TRIGGER_MODE   login=只已登录, nologin=只未登录, all=全部（默认 all）
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { sendQueryRequest } from '../../common/request.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../../../config/envconfig.js';
import { getUserAccount, autoLoginByAccount } from '../../user/userAccountApi.js';
import { phoneRegister } from '../../login/register.test.js';
import { getFrontUserInfo } from '../../user/userManagement.js';
import { addAllWallets } from '../../withdraw/addWalletApi.js';
import { generateRandomPhone } from '../../../utils/accountGeneratorFaker.js';
import { generateCryptoRandomString } from '../../../utils/utils.js';

// 复用已有触发逻辑，不做任何修改
import { triggerAllForAccount }   from './lib/triggerAll.js';
import { triggerLoginForAccount } from './lib/triggerLogin.js';

// ============================================================
// 性能监控系统
// ============================================================
import { PERF_METRICS, ERROR_COUNTERS, GAUGES, buildThresholdsByPreset } from '../../../../libs/monitor/perfMetrics.js';
import { measure, recordResponse, diagnoseTiming } from '../../../../libs/monitor/perfWrapper.js';
import { buildHandleSummary } from '../../../../libs/monitor/perfSummary.js';

// ============================================================
// K6 Options
// ============================================================
const VUS        = parseInt(__ENV.VUS        || '1', 10);
const ITERATIONS = parseInt(__ENV.ITERATIONS || '1', 10);

// 性能阈值预设：strict（生产红线）/ normal（日常回归）/ relaxed（开发调试）
const PERF_PRESET = (__ENV.PERF_PRESET || 'normal').toLowerCase();

export const options = {
    setupTimeout: '10m',
    scenarios: {
        work_order_submit_only: {
            executor:    'per-vu-iterations',
            vus:         VUS,
            iterations:  ITERATIONS,
            maxDuration: '4h',
        },
    },
    // 熔断阈值：超标自动停止压测
    thresholds: buildThresholdsByPreset(PERF_PRESET, {
        'trend_work_order_submit':   [{ threshold: 'p(95)<3000' }],  // 触发工单允许 3s（含表单构建）
        'trend_create_work_order':   [{ threshold: 'p(95)<1000' }],  // 纯后端交互允许 1s
    }),
};

const TAG = 'WorkOrderSubmitOnly';
const PWD = 'qwer1234';

// 从注册响应中提取前台 token
function extractToken(res) {
    if (!res) return null;
    if (typeof res === 'string' && res.length > 10) return res;
    if (res.data && res.data.token) return res.data.token;
    if (res.headers) {
        const a = res.headers['Authorization'] || res.headers['authorization'];
        if (a) return a.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

// ============================================================
// 工具
// ============================================================
function getTenantId() {
    return __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
}

function getCurrentEnv() {
    return getEnvByTenantId(getTenantId());
}

// ============================================================
// setup：登录 + 账号预分配 + 预登录 token（复用 runWorkOrderFull 同款逻辑）
// ============================================================
export function setup() {
    logger.info(`[${TAG}] ========== Setup：账号预分配 ==========`);

    const adminToken   = AdminLogin();
    if (!adminToken) throw new Error(`[${TAG}] 管理员登录失败，终止测试`);

    const accountCount = parseInt(__ENV.ACCOUNT_COUNT || '1', 10);
    const tenantId     = getTenantId();
    const env          = getCurrentEnv();
    const adminData    = { token: adminToken, envConfig: env };
    const countryCode  = env.COUNTRY_CODE || '91';

    // ---- 新注册 accountCount 个账号,每个绑全钱包并记录 ----
    // 目的:保证账号有 银行卡/USDT/PIX/电子钱包 数据,后续"删除USDT/删除银行卡/修改银行"等工单才有数据可操作
    // (系统现有账号常没绑对应钱包,删除类工单会因"无钱包数据"跳过;
    //  另外主管理员对 GetUserAccount 无权限拿不到明文账号,直接新注册最稳妥)
    logger.info(`[${TAG}] 新注册 ${accountCount} 个账号(每个绑全钱包)...`);
    const accountInfoList = [];
    for (let i = 0; i < accountCount; i++) {
        const phone = generateRandomPhone(countryCode);
        const deviceId = generateCryptoRandomString(16);
        const res = phoneRegister(phone, adminData, PWD, '', null, deviceId, '');
        const token = extractToken(res);
        if (!token) { logger.warn(`[${TAG}] ⚠️ 第${i + 1}个账号注册失败: ${phone}`); continue; }
        const uinfo = getFrontUserInfo(token);
        const userId = uinfo && uinfo.userId ? uinfo.userId : null;
        if (!userId) { logger.warn(`[${TAG}] ⚠️ 第${i + 1}个账号取 userId 失败: ${phone}`); continue; }
        // 绑全钱包:银行卡 + 电子钱包 + PIX + USDT(供删除/修改类工单使用)
        addAllWallets(adminToken, userId, token);
        // 记录新账号(账号/密码/userId)
        logger.info(`[${TAG}] 📝 新账号就绪: account=${phone} | password=${PWD} | userId=${userId} (已绑全钱包)`);
        accountInfoList.push({ account: phone, userId });
        sleep(0.5);
    }

    if (accountInfoList.length === 0) {
        throw new Error(`[${TAG}] 没有可用账号(注册全失败)，终止测试`);
    }
    logger.info(`[${TAG}] 选取账号: ${accountInfoList.map(a => a.account).join(', ')}`);

    // ---- 2. 按 VU 数量均分账号 ----
    const accountsByVu = Array.from({ length: VUS }, () => []);
    accountInfoList.forEach((info, i) => {
        accountsByVu[i % VUS].push(info);
    });
    logger.info(`[${TAG}] 账号分配: ${accountsByVu.map((a, i) => `VU${i + 1}:${a.length}个`).join(', ')}`);

    // ---- 3. 预登录所有会员，建立 token 映射表 ----
    const memberTokenMap = {};
    for (const info of accountInfoList) {
        logger.info(`[${TAG}] 预登录: ${info.account} (userId=${info.userId})`);
        const memberToken = autoLoginByAccount(info.account, adminToken);
        if (memberToken) {
            memberTokenMap[info.userId] = memberToken;
            logger.info(`[${TAG}] ✅ 预登录成功: ${info.account}`);
        } else {
            logger.warn(`[${TAG}] ⚠️ 预登录失败: ${info.account}`);
        }
        sleep(0.5);
    }
    logger.info(`[${TAG}] token 映射表就绪，成功 ${Object.keys(memberTokenMap).length}/${accountInfoList.length} 个`);

    return { adminToken, accountsByVu, tenantId, memberTokenMap };
}

// ============================================================
// default：只触发工单，不做任何审核或客服回复
// ============================================================
export default function (data) {
    const { adminToken, accountsByVu, tenantId, memberTokenMap } = data;
    const env         = getCurrentEnv();
    const triggerMode = (__ENV.TRIGGER_MODE || 'all').toLowerCase();
    const runNoLogin  = triggerMode === 'all' || triggerMode === 'nologin';
    const runLogin    = triggerMode === 'all' || triggerMode === 'login';

    const vuId    = exec.vu.idInInstance;
    const vuIndex = (vuId - 1) % VUS;
    const myAccounts = accountsByVu[vuIndex] || [];
    const iter    = exec.vu.iterationInScenario; // 0-based

    if (myAccounts.length === 0) {
        logger.warn(`[${TAG}] VU${vuId} 没有分配到账号，跳过`);
        return;
    }

    logger.info(`\n[${TAG}] ===== VU${vuId} 第 ${iter + 1}/${ITERATIONS} 轮 | 账号: ${myAccounts.map(a => a.account).join(',')} =====`);
    logger.info(`[${TAG}] 触发模式: ${triggerMode}`);

    for (let ai = 0; ai < myAccounts.length; ai++) {
        const accountInfo = myAccounts[ai];
        logger.info(`\n[${TAG}] >> 账号 ${ai + 1}/${myAccounts.length}: ${accountInfo.account} (userId=${accountInfo.userId})`);

        // 触发未登录工单（含未登录客服工单，只提交不回复）
        if (runNoLogin) {
            logger.info(`[${TAG}] [未登录] 触发工单...`);
            triggerAllForAccount(adminToken, tenantId, accountInfo.account, accountInfo.userId);
            sleep(1);
        }

        // 触发已登录工单（含已登录客服工单，只提交不回复）
        if (runLogin) {
            logger.info(`[${TAG}] [已登录] 触发工单...`);
            triggerLoginForAccount(adminToken, tenantId, accountInfo.account, accountInfo.userId, env, memberTokenMap);
        }

        sleep(1);
    }

    logger.info(`\n[${TAG}] ===== VU${vuId} 第 ${iter + 1} 轮完成（仅触发，无审核）=====`);
}

// ============================================================
// handleSummary：增强版性能分析报告
// ============================================================
export function handleSummary(data) {
    return buildHandleSummary(data, {
        testName:    'WorkOrderSubmitOnly',
        environment: __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID),
    });
}
