/**
 * workOrderSuite/runWorkOrderFull.test.js
 * 工单全流程主入口（多线程 + 多轮）
 *
 * 运行示例：
 *   # 单线程单轮（开发调试）
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=1 -e VUS=1 -e ITERATIONS=1 -e TRIGGER_MODE=login runWorkOrderFull.test.js
 *
 *   # 多线程多轮
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=2 -e VUS=4 -e ITERATIONS=2 runWorkOrderFull.test.js
 *
 *   # 只触发已登录工单（调试）
 *   k6 run -e TENANT_ID=3004 -e ACCOUNT_COUNT=1 -e VUS=1 -e ITERATIONS=1 -e TRIGGER_MODE=login runWorkOrderFull.test.js
 *
 * 参数说明：
 *  注意后台的工单的总条数 = 总账号数 * 25 * ITERATIONS
 *   TENANT_ID      租户 ID
 *   ACCOUNT_COUNT  总账号数，setup 阶段从后台查询，按 VUS 均分给各 VU
 *   VUS            并发线程数（默认 1）
 *   ITERATIONS     每个 VU 的迭代轮数（默认 1，每个工单需要触发几次）
 *   IS_MAIN_ADMIN  true=主账号客服 systemkefu, false=普通客服 kefu（默认 true）
 *   TRIGGER_MODE   login=只触发已登录, nologin=只触发未登录, 不传=全部（默认 all）
 *   PERF_PRESET    strict/normal/relaxed 三档阈值预设（默认 normal）
 *
 * 多轮逻辑：
 *   - 每轮：触发工单 → 客服处理 → 等待所有工单清空 → 下一轮
 *   - 只有第一轮（__ITER === 0）才执行环境巡检
 *   - 账号按 VU 预分配，每个 VU 每轮处理同一批账号
 */

import { sleep } from 'k6';
import exec from 'k6/execution';
import { logger } from '../../../../libs/utils/logger.js';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { sendRequest, sendQueryRequest } from '../../common/request.js';
import { ENV_CONFIG, getEnvByTenantId } from '../../../../config/envconfig.js';
import { getActiveLangs } from '../../../../config/languageConfig.js';
import { getUserAccount, autoLoginByAccount } from '../../user/userAccountApi.js';
import { tenantRequest, backendLogin } from '../../../../libs/http/tenantRequest.js';

import { orderSystemConfig } from '../orderSystem/oderyconfig.js';
import { TRANSLATIONS } from '../orderSystem/createOrdersystem.js';
import { createImageUploader } from '../../uploadFile/uploadFactory.js';

import {
    getPendingOrders,
    getProcessingOrders,
    waitUntilAllClear,
} from './lib/pendingHelper.js';
import { dispatchHandler } from './handlers/index.js';
import { triggerAllForAccount } from './lib/triggerAll.js';
import { triggerLoginForAccount } from './lib/triggerLogin.js';
import { addAllWallets } from '../../withdraw/addWalletApi.js';

// ============================================================
// 性能监控系统
// ============================================================
import { PERF_METRICS, ERROR_COUNTERS, GAUGES, buildThresholdsByPreset } from '../../../../libs/monitor/perfMetrics.js';
import { measure, recordResponse, diagnoseTiming } from '../../../../libs/monitor/perfWrapper.js';
import { buildHandleSummary } from '../../../../libs/monitor/perfSummary.js';

// ============================================================
// 图片预加载（setup 阶段创建工单时用）
// ============================================================
const orderImageUploaders = {};
for (const config of orderSystemConfig) {
    if (config.img) {
        orderImageUploaders[config.img] = createImageUploader(
            `../../uploadFile/img/order/${config.img}`,
            `InspectSetup`
        );
    }
}

// ============================================================
// K6 选项（从环境变量读取线程数和迭代次数）
// ============================================================
const VUS = parseInt(__ENV.VUS || '1', 10);
const ITERATIONS = parseInt(__ENV.ITERATIONS || '1', 10);

// 性能阈值预设：strict（生产红线）/ normal（日常回归）/ relaxed（开发调试）
const PERF_PRESET = (__ENV.PERF_PRESET || 'normal').toLowerCase();

export const options = {
    setupTimeout: '10m', // 预登录账号 + 巡检工单需要较长时间
    scenarios: {
        work_order_full: {
            executor: 'per-vu-iterations',
            vus: VUS,
            iterations: ITERATIONS,
            maxDuration: '8h',
        },
    },
    // 熔断阈值：超标自动停止压测
    thresholds: buildThresholdsByPreset(PERF_PRESET, {
        // 工单系统专项阈值（可在这里覆盖全局默认值）
        'trend_work_order_submit': [{ threshold: 'p(95)<3000' }],  // 触发工单整体允许 3s（含表单构建）
        'trend_create_work_order': [{ threshold: 'p(95)<1000' }],  // 创建工单单次网络交互允许 1s
        'trend_approve_work_order': [{ threshold: 'p(95)<2000' }],  // 审批/关闭工单单次网络交互允许 2s
        'trend_work_order_dispatch': [{ threshold: 'p(95)<2000' }],  // 派发 2s
        'trend_work_order_reply': [{ threshold: 'p(95)<2000' }],  // 回复 2s
        'trend_work_order_query': [{ threshold: 'p(95)<1000' }],  // 查询 1s
    }),
};

const TAG = 'WorkOrderFull';

// ============================================================
// 环境工具
// ============================================================
function getCurrentEnv() {
    const tenantId = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
    return getEnvByTenantId(tenantId);
}

function getTenantId() {
    return __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
}

// ============================================================
// setup：环境巡检 + 账号预分配
// ============================================================
export function setup() {
    logger.info(`[${TAG}] ========== Setup：环境巡检 + 账号预分配 ==========`);

    // ── 监控：管理员登录耗时 ──────────────────────────────────────────────────
    const { ok: loginOk, body: loginBody, raw: loginRaw } = measure(
        PERF_METRICS.ADMIN_LOGIN,
        () => AdminLogin.__raw ? AdminLogin.__raw() : null,
        { label: `${TAG}:AdminLogin`, errorCounter: ERROR_COUNTERS.BUSINESS_ERROR, silent: true }
    );
    // AdminLogin() 返回的是 token 字符串（非 k6 response），用普通调用即可
    const adminToken = AdminLogin();
    if (!adminToken) throw new Error(`[${TAG}] 管理员登录失败，终止测试`);

    const accountCount = parseInt(__ENV.ACCOUNT_COUNT || '1', 10);
    const tenantId = getTenantId();

    // ---- 1. 后台查询账号并解析 userId ----
    // 查询 accountCount * 5 个候选账号，过滤邮箱后随机选 accountCount 个
    const candidateSize = Math.min(accountCount * 5, 200);
    logger.info(`[${TAG}] 查询 ${candidateSize} 个候选账号（目标 ${accountCount} 个手机号账号）...`);

    const userListRes = sendQueryRequest(
        { pageNo: 1, pageSize: candidateSize },
        '/api/Users/GetPageList',
        TAG,
        false,
        adminToken
    );

    if (!userListRes || !userListRes.list || userListRes.list.length === 0) {
        throw new Error(`[${TAG}] 无法获取会员列表，终止测试`);
    }

    // 获取真实账号，自动过滤邮箱账号
    const candidates = [];
    for (const u of userListRes.list) {
        const realAccount = getUserAccount(adminToken, u.userId);
        if (!realAccount) {
            logger.warn(`[${TAG}] ⚠️ userId=${u.userId} 无法获取账号，跳过`);
            sleep(0.1);
            continue;
        }
        // 过滤邮箱
        if (realAccount.includes('@')) {
            logger.info(`[${TAG}] ⏭️ userId=${u.userId} 账号为邮箱，跳过`);
            sleep(0.1);
            continue;
        }
        candidates.push({ account: realAccount, userId: u.userId });
        sleep(0.1);
        // 够用就停止查询
        if (candidates.length >= accountCount * 3) break;
    }

    if (candidates.length === 0) {
        throw new Error(`[${TAG}] 没有可用的手机号账号，终止测试`);
    }

    logger.info(`[${TAG}] 候选手机号账号 ${candidates.length} 个`);

    // 从候选账号中随机选 accountCount 个（Fisher-Yates shuffle 取前 N 个）
    const shuffled = candidates.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
    }
    const accountInfoList = shuffled.slice(0, accountCount);

    logger.info(`[${TAG}] 随机选取 ${accountInfoList.length} 个账号: ${accountInfoList.map(a => a.account).join(', ')}`);

    // ---- 2. 按 VU 数量均分账号 ----
    // accountsByVu[vuIndex] = [{ account, userId }, ...]
    const accountsByVu = Array.from({ length: VUS }, () => []);
    accountInfoList.forEach((info, i) => {
        accountsByVu[i % VUS].push(info);
    });

    logger.info(`[${TAG}] 账号分配: ${accountsByVu.map((a, i) => `VU${i + 1}:${a.length}个`).join(', ')}`);

    // ---- 3. 登录第二客服（WorkOrderRole）----
    const envConfig = getCurrentEnv();
    let workOrderRoleToken = null;
    if (envConfig.WorkOrderRole && envConfig.WorkOrderRolePasswrod) {
        logger.info(`[${TAG}] 登录第二客服: ${envConfig.WorkOrderRole}`);
        // 客服角色也是后台登录，走统一 backendLogin（带 vCode，共用租户 GOOGLE_SECRET）
        workOrderRoleToken = backendLogin(envConfig.WorkOrderRole, envConfig.WorkOrderRolePasswrod, envConfig.GOOGLE_SECRET, envConfig.TENANTID);
        if (workOrderRoleToken) {
            logger.info(`[${TAG}] ✅ 第二客服登录成功: ${envConfig.WorkOrderRole}`);
        } else {
            logger.warn(`[${TAG}] ⚠️ 第二客服登录失败，将使用单客服模式`);
        }
    } else {
        logger.warn(`[${TAG}] 未配置 WorkOrderRole，将使用单客服模式`);
    }

    // ---- 4. 预登录所有会员账号，建立 userId → memberToken 映射表 ----
    // 只登录一次，多轮复用，避免每轮重复发验证码
    logger.info(`[${TAG}] ---- 预登录会员账号（建立 token 映射表）----`);
    const memberTokenMap = {}; // { userId: memberToken }
    for (const info of accountInfoList) {
        logger.info(`[${TAG}] 预登录: ${info.account} (userId=${info.userId})`);
        const memberToken = autoLoginByAccount(info.account, adminToken);
        if (memberToken) {
            memberTokenMap[info.userId] = memberToken;
            logger.info(`[${TAG}] ✅ 预登录成功: ${info.account}`);
        } else {
            logger.warn(`[${TAG}] ⚠️ 预登录失败: ${info.account}，已登录工单将跳过`);
        }
        sleep(0.5);
    }
    logger.info(`[${TAG}] token 映射表建立完成，成功 ${Object.keys(memberTokenMap).length}/${accountInfoList.length} 个`);

    // ---- 5. 环境巡检 ----
    _runInspection(adminToken);

    return { adminToken, accountsByVu, tenantId, workOrderRoleToken, workOrderRoleName: envConfig.WorkOrderRole || null, memberTokenMap };
}

// ============================================================
// default：多轮触发 + 处理
// ============================================================
export default function (data) {
    const { adminToken, accountsByVu, tenantId, workOrderRoleToken, workOrderRoleName, memberTokenMap } = data;
    const env = getCurrentEnv();
    const isMainAdmin = (__ENV.IS_MAIN_ADMIN || 'true') !== 'false';
    const triggerMode = (__ENV.TRIGGER_MODE || 'all').toLowerCase();
    const runNoLogin = triggerMode === 'all' || triggerMode === 'nologin';
    const runLogin = triggerMode === 'all' || triggerMode === 'login';

    // 当前 VU 分配到的账号（vuId 从 1 开始）
    const vuId = exec.vu.idInInstance;
    const vuIndex = (vuId - 1) % VUS;
    const myAccounts = accountsByVu[vuIndex] || [];
    const myUserIds = myAccounts.map((a) => a.userId);
    const iter = exec.vu.iterationInScenario; // 0-based

    if (myAccounts.length === 0) {
        logger.warn(`[${TAG}] VU${vuId} 没有分配到账号，跳过`);
        return;
    }

    logger.info(`\n[${TAG}] ===== VU${vuId} 第 ${iter + 1}/${ITERATIONS} 轮 | 账号: ${myAccounts.map(a => a.account).join(',')} =====`);
    logger.info(`[${TAG}] 触发模式: ${triggerMode}`);

    // ---- 阶段 A：触发工单 ----
    logger.info(`[${TAG}] ---- 阶段 A：触发工单 ----`);
    for (let ai = 0; ai < myAccounts.length; ai++) {
        const accountInfo = myAccounts[ai];
        logger.info(`\n[${TAG}] >> 账号 ${ai + 1}/${myAccounts.length}: ${accountInfo.account} (userId=${accountInfo.userId})`);

        // 每轮触发前先绑定所有类型的钱包（银行卡/电子钱包/PIX/USDT）
        // 确保后续删除/修改类工单有数据可操作
        logger.info(`[${TAG}] [绑卡] 为 userId=${accountInfo.userId} 绑定所有钱包...`);
        addAllWallets(adminToken, accountInfo.userId);
        sleep(1);

        if (runNoLogin) {
            logger.info(`[${TAG}] [未登录] 触发...`);
            // 直接用 accountInfo.userId 对应的 index
            triggerAllForAccount(adminToken, tenantId, accountInfo.account, accountInfo.userId);
            sleep(1);
        }

        if (runLogin) {
            logger.info(`[${TAG}] [已登录] 触发...`);
            triggerLoginForAccount(adminToken, tenantId, accountInfo.account, accountInfo.userId, env, memberTokenMap);
        }

        sleep(1);
    }

    // ---- 阶段 B：客服处理待处理和处理中工单 ----
    logger.info(`\n[${TAG}] ---- 阶段 B：客服处理工单 ----`);
    sleep(2); // 等待工单落库

    _processOrders(adminToken, tenantId, env, isMainAdmin, myUserIds, workOrderRoleToken, workOrderRoleName);

    // ---- 阶段 C：等待所有工单清空（多轮时才需要等）----
    if (ITERATIONS > 1) {
        logger.info(`\n[${TAG}] ---- 阶段 C：等待工单清空（准备下一轮）----`);
        // 等待 30s 后如果还有工单，主动再处理一次卡住的工单，再继续等
        sleep(30);
        const stillPending = myUserIds.some((uid) => {
            const p = getPendingOrders(adminToken, uid);
            const q = getProcessingOrders(adminToken, uid);
            return p.length > 0 || q.length > 0;
        });
        if (stillPending) {
            logger.info(`[${TAG}] 仍有未完成工单，再处理一次...`);
            _processOrders(adminToken, tenantId, env, isMainAdmin, myUserIds, workOrderRoleToken, workOrderRoleName);
        }
        // 最多再等 2 分钟
        waitUntilAllClear(adminToken, myUserIds, 10, 120);
    }

    logger.info(`\n[${TAG}] ===== VU${vuId} 第 ${iter + 1} 轮完成 =====`);
}

// ============================================================
// 内部：处理待处理（state=1）和处理中（state=2）工单
// ============================================================
function _processOrders(adminToken, tenantId, env, isMainAdmin, userIds, workOrderRoleToken = null, workOrderRoleName = null) {
    // 合并 state=1 和 state=2 的工单
    const allOrders = [];

    for (const uid of userIds) {
        const pending = getPendingOrders(adminToken, uid);
        const processing = getProcessingOrders(adminToken, uid);
        allOrders.push(...pending, ...processing);
    }

    if (allOrders.length === 0) {
        logger.warn(`[${TAG}] 无待处理/处理中工单`);
        return;
    }

    // 去重（同一 id 可能在两个接口里都出现）
    const seen = new Set();
    const unique = allOrders.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
    });

    logger.info(`[${TAG}] 共 ${unique.length} 个工单待处理`);

    for (let i = 0; i < unique.length; i++) {
        const order = unique[i];
        logger.info(`[${TAG}] [${i + 1}/${unique.length}] ${order.workOrderTypeName} (${order.id}) state=${order.state}`);

        // state=2 处理中工单不参与奇偶分配，优先用 adminToken（主客服有最高权限）
        // state=1 待处理工单按奇偶交替分配客服
        const isProcessing = order.state === 2;
        dispatchHandler(order, adminToken, tenantId, env, isMainAdmin,
            isProcessing ? null : workOrderRoleToken,  // 处理中工单不用第二客服
            i,
            workOrderRoleName
        );
    }
}

// ============================================================
// 内部：环境巡检（只在第一轮执行）
// ============================================================
function _runInspection(adminToken) {
    logger.info(`[${TAG}] ========== 环境巡检与自动修复 ==========`);

    for (let i = 0; i < orderSystemConfig.length; i++) {
        const config = orderSystemConfig[i];

        let res = sendQueryRequest(
            { workOrderTypeId: config.queryId, isLoginForm: config.isLoginForm, pageNo: 1, pageSize: 20 },
            '/api/TenantForm/GetPageList',
            TAG,
            false,
            adminToken
        );

        if (res && res.msgCode === 13) {
            logger.warn(`[${TAG}] 查询限流，1s 后重试...`);
            sleep(1);
            res = sendQueryRequest(
                { workOrderTypeId: config.queryId, isLoginForm: config.isLoginForm, pageNo: 1, pageSize: 20 },
                '/api/TenantForm/GetPageList',
                TAG,
                false,
                adminToken
            );
        }

        if (!res || !res.list || res.list.length === 0) {
            logger.warn(`[${TAG}] [未创建] "${config.name}"，正在自动新建...`);
            _createWorkOrderType(config, adminToken);
        } else {
            const allDisabled = res.list.every((item) => item.state === 0);
            if (allDisabled) {
                const firstId = res.list[0].id;
                logger.info(`[${TAG}] [全关闭] "${config.name}"，正在开启 ID: ${firstId}...`);
                let switchRes = sendRequest({ id: firstId, state: 1 }, '/api/TenantForm/SwitchState', TAG, false, adminToken);
                if (switchRes && switchRes.msgCode === 13) {
                    sleep(1);
                    switchRes = sendRequest({ id: firstId, state: 1 }, '/api/TenantForm/SwitchState', TAG, false, adminToken);
                }
                if (switchRes && switchRes.code === 0) {
                    logger.info(`[${TAG}] ✅ "${config.name}" 开启成功`);
                } else {
                    logger.error(`[${TAG}] ❌ "${config.name}" 开启失败`);
                }
            } else {
                logger.info(`[${TAG}] [正常] "${config.name}" 已开启`);
            }
        }

        sleep(1);
    }

    logger.info(`[${TAG}] ✅ 环境巡检完成`);
}

// ============================================================
// 内部：创建工单类型
// ============================================================
function _createWorkOrderType(config, adminToken) {
    const uploader = orderImageUploaders[config.img];
    if (!uploader) {
        logger.error(`[${TAG}] 找不到图片上传器 ${config.img}，跳过`);
        return;
    }
    const uploadResult = uploader(adminToken);
    if (!uploadResult.success) {
        logger.error(`[${TAG}] 图片上传失败 ${config.img}，跳过`);
        return;
    }
    const iconPath = (uploadResult.src || uploadResult.file || '').replace(/^https?:\/\/[^/]+\//, '');
    sleep(1);

    const translation = TRANSLATIONS[config.name];
    if (!translation) {
        logger.error(`[${TAG}] 找不到翻译 "${config.name}"，跳过`);
        return;
    }

    const buildFields = (lang) => (config.fields || []).map((field) => ({
        id: 0,
        name: { id: 0, text: lang === 'en' ? field.nameEn : (lang === 'es' ? (field.nameEs || field.nameEn) : '') },
        type: field.type,
        isRequired: 1,
        isDefault: true,
    }));

    const buildOutLinks = (lang) => {
        if ((config.type || 1) === 1 && (lang === 'en' || lang === 'es')) {
            return [
                { name: 'google', link: 'https://www.google.com', id: 0 },
                { name: 'git', link: 'https://github.com/', id: 0 },
            ];
        }
        return [];
    };

    const createPayload = {
        type: config.type || 1,
        iconPath,
        isLoginForm: config.isLoginForm,
        dailySubmissionLimit: 0,
        state: 1,
        sort: config.oderby,
        translationData: getActiveLangs().map((lang) => ({
            language: lang,
            formTitles: { id: 0, text: translation[lang] || translation.en },
            fields: buildFields(lang),
            outLinks: buildOutLinks(lang),
        })),
        fieldIdsToRemove: [],
    };

    // ── 监控：工单类型创建耗时（归入 FILE_UPLOAD 类型，属于 setup 操作） ────
    let createRes = measure(
        PERF_METRICS.FILE_UPLOAD,
        () => sendRequest(createPayload, '/api/TenantForm/Create', TAG, false, adminToken),
        { label: `${TAG}:CreateOrderType`, successCheck: (b) => b && (b.code === 0 || b.msgCode === 0) }
    ).body;

    if (createRes && createRes.msgCode === 13) {
        sleep(1);
        createRes = sendRequest(createPayload, '/api/TenantForm/Create', TAG, false, adminToken);
    }

    if (createRes && createRes.code === 0) {
        logger.info(`[${TAG}] ✅ "${config.name}" 创建成功`);
    } else {
        logger.error(`[${TAG}] ❌ "${config.name}" 创建失败: ${createRes ? createRes.msg : '无响应'}`);
    }
    sleep(1);
}

// ============================================================
// handleSummary：增强版性能分析报告
// ============================================================
export function handleSummary(data) {
    return buildHandleSummary(data, {
        testName: 'WorkOrderFull',
        environment: __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID),
    });
}
