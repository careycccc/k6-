/**
 * 昵称重复检测压测脚本 - nickNameDuplicateCheck.test.js
 *
 * ============================================================
 * 测试目标：
 *   在高并发场景下注册大量用户，验证后端在分配昵称（nickName）时
 *   是否存在竞态条件（Race Condition），即是否会出现昵称重复的情况。
 *
 * 并发策略：
 *   使用 shared-iterations executor，所有 VU 共同抢着执行注册任务，
 *   最大化同一时间窗口内打到后端的并发请求量，这是最能暴露竞态问题的模式。
 *   - 200 VU 同时并发
 *   - 共 1000 次注册（VU 之间抢占执行，不是每 VU 5 次串行）
 *
 * 每次迭代流程：
 *   1. 注册新账号 POST /api/Home/Register
 *   2. 用注册返回的 token 调用 POST /api/User/GetUserInfo
 *   3. 提取 nickName + userId，打印固定格式日志供离线分析
 *
 * 重复检测方式：
 *   - teardown 阶段：通过 k6 metric 统计 nickName 出现次数（tag 方式）
 *   - 离线日志分析：grep 固定格式行做 sort + uniq 去重对比（最准确）
 *     命令示例：
 *       k6 run ... 2>&1 | grep "\[NICKNAME_CHECK\]" | awk '{print $3}' | sort | uniq -d
 *
 * 运行示例：
 *   k6 run -e TENANT_ID=3007 -e VUS=2 -e TOTAL_USERS=5 nickNameDuplicateCheck.test.js
 *   k6 run -e TENANT_ID=3004 -e VUS=50  -e TOTAL_USERS=200  nickNameDuplicateCheck.test.js
 *
 * 环境变量：
 *   TENANT_ID    租户ID（默认 3004）
 *   VUS          并发VU数（默认 200）
 *   TOTAL_USERS  总注册人数（默认 1000）
 * ============================================================
 */

import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import { textSummary } from '../../../libs/vendor/k6-summary-0.0.2.js';

// ── 复用已有函数 ──────────────────────────────────────────────
import { AdminLogin } from '../login/adminlogin.test.js';
import { phoneRegister, emailRegister } from '../login/register.test.js';
import { getFrontUserInfo } from './userManagement.js';
import { generateRandomPhone, generateRandomEmail } from '../../utils/accountGeneratorFaker.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';

// ============================================================
// 自定义 k6 指标
// ============================================================
const regSuccessCounter   = new Counter('reg_success_total');
const regFailCounter      = new Counter('reg_fail_total');
const nicknameFetchFail   = new Counter('nickname_fetch_fail_total');
const regDurationTrend    = new Trend('reg_duration_ms', true);

// ============================================================
// K6 执行选项
// ============================================================
export const options = {
    scenarios: {
        nickname_duplicate_check: {
            // shared-iterations：所有 VU 共享 iterations 池，争抢执行
            // 这是高并发爆破的最优 executor，VU 完成一次就立刻抢下一次
            // 对比 per-vu-iterations：那种每VU串行5次，并发窗口小很多
            executor: 'shared-iterations',
            vus: parseInt(__ENV.VUS || '200', 10),
            iterations: parseInt(__ENV.TOTAL_USERS || '1000', 10),
            maxDuration: '30m',
        },
    },
    thresholds: {
        // 注册接口 P95 延迟不超过 10 秒
        http_req_duration: ['p(95)<10000'],
        // 注册成功率：至少 80% 的注册需要成功
        'reg_success_total': [`count>=${Math.floor(parseInt(__ENV.TOTAL_USERS || '1000', 10) * 0.8)}`],
    },
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 从注册响应中提取前台 token
 * 兼容两种来源：data.token 和 headers.Authorization
 */
function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) {
        return response.data.token;
    }
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

// ============================================================
// Setup 阶段：管理员登录 + 租户环境初始化
// ============================================================
export function setup() {
    console.log('\n' + '═'.repeat(65));
    console.log('🔍 [Setup] 昵称重复检测压测 - 初始化');
    console.log('═'.repeat(65));

    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const totalUsers = parseInt(__ENV.TOTAL_USERS || '1000', 10);
    const vus = parseInt(__ENV.VUS || '200', 10);

    // 切换租户环境
    const envConfig = getEnvByTenantId(tenantId);
    if (tenantId !== '3004') {
        Object.assign(ENV_CONFIG, envConfig);
    }

    console.log(`[Setup] 租户: ${tenantId}`);
    console.log(`[Setup] 并发VU: ${vus}`);
    console.log(`[Setup] 总注册目标: ${totalUsers}`);
    console.log(`[Setup] 前台地址: ${envConfig.BASE_DESK_URL}`);

    // 管理员登录（用于后续需要时调用后台接口兜底）
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败，压测中止');
    }
    console.log('[Setup] ✅ 管理员登录成功');
    console.log('═'.repeat(65) + '\n');

    return {
        adminToken,
        envConfig,
        tenantId,
    };
}

// ============================================================
// Default 阶段：每次迭代 = 1次注册 + 1次GetUserInfo + 打印昵称
// ============================================================
export default function (data) {
    const { adminToken, envConfig, tenantId } = data;
    const vuId = exec.vu.idInInstance;
    const iterInVu = exec.vu.iterationInInstance;
    const globalIter = exec.instance.iterationsCompleted;
    const label = `VU${vuId}-iter${iterInVu}`;

    // VU 内重新绑定租户环境（k6 VU 会重新加载模块，ENV_CONFIG 会还原默认值）
    if (tenantId !== '3004') {
        Object.assign(ENV_CONFIG, envConfig);
    }

    const adminData = { token: adminToken, envConfig };
    const countryCode = envConfig.COUNTRY_CODE || '91';

    // ── 1. 随机抖动（错开请求洪峰，避免触发频控）─────────────
    // 默认 0~500ms，可通过环境变量 JITTER_MS 调整上限
    // 例：-e JITTER_MS=1000 表示最大抖动 1 秒
    const jitterMax = parseInt(__ENV.JITTER_MS || '500', 10) / 1000;
    sleep(Math.random() * jitterMax);

    // ── 2. 生成账号，手机注册优先 ─────────────────────────────
    const phone = generateRandomPhone(countryCode);
    const email = generateRandomEmail();

    let regResponse = null;
    let registeredAccount = '';
    const startTs = Date.now();

    // 手机注册
    try {
        regResponse = phoneRegister(phone, adminData);
    } catch (e) {
        console.error(`[${label}] 手机注册异常: ${e.message}`);
    }

    let token = extractToken(regResponse);

    // 手机失败 → 降级邮箱
    if (!token) {
        console.log(`[${label}] 手机注册失败，降级邮箱: ${email}`);
        try {
            regResponse = emailRegister(email, adminData);
        } catch (e) {
            console.error(`[${label}] 邮箱注册异常: ${e.message}`);
        }
        token = extractToken(regResponse);
        registeredAccount = email;
    } else {
        registeredAccount = phone;
    }

    const regDuration = Date.now() - startTs;
    regDurationTrend.add(regDuration);

    // 双败 → 记录失败并跳过
    if (!token) {
        regFailCounter.add(1);
        console.error(`[${label}] ❌ 注册双败: phone=${phone}, email=${email}`);
        return;
    }

    regSuccessCounter.add(1);

    // ── 3. 等待后端写库，再查 GetUserInfo ─────────────────────
    // 注册成功后稍等一下再查，保证数据库写入完成
    sleep(0.2);

    let nickName = null;
    let userId = null;

    try {
        const userInfo = getFrontUserInfo(token);
        if (userInfo) {
            nickName = userInfo.nickName || null;
            userId   = userInfo.userId   || null;
        }
    } catch (e) {
        console.error(`[${label}] GetUserInfo 异常: ${e.message}`);
    }

    if (!nickName) {
        nicknameFetchFail.add(1);
        console.warn(`[${label}] ⚠️ 未能获取昵称: account=${registeredAccount}, userId=${userId}`);
        return;
    }

        // ── 3. 打印固定格式日志，供 handleSummary 和离线脚本解析 ──
    // 格式固定，analyzeNicknames.js 会 parse 这一行做去重聚合
    // 字段之间用 \t 分隔，nickName 放最后防止含空格时截断
    console.log(`[NICKNAME_CHECK]\t${userId}\t${registeredAccount}\t${nickName}`);
}

// ============================================================
// Teardown 阶段：打印完成提示
// ============================================================
export function teardown(data) {
    console.log('\n' + '═'.repeat(65));
    console.log('🔍 昵称重复检测压测完成');
    console.log(`   租户: ${data.tenantId}`);
    console.log('');
    console.log('📌 下一步：运行分析脚本，自动检测重复昵称并打印 userId');
    console.log('');
    console.log('   node analyzeNicknames.js output.log');
    console.log('');
    console.log('   或先把日志输出到文件再分析：');
    console.log('   k6 run ... 2>&1 | tee output.log && node analyzeNicknames.js output.log');
    console.log('═'.repeat(65) + '\n');
}

// ============================================================
// 汇总报告：输出压测统计 + nickname-results.json（供分析脚本用）
// ============================================================
export function handleSummary(data) {
    const totalVUs      = parseInt(__ENV.VUS || '200', 10);
    const totalTarget   = parseInt(__ENV.TOTAL_USERS || '1000', 10);
    const regSuccess    = data.metrics.reg_success_total?.values?.count         || 0;
    const regFail       = data.metrics.reg_fail_total?.values?.count            || 0;
    const nickFetchFail = data.metrics.nickname_fetch_fail_total?.values?.count || 0;
    const p95Duration   = data.metrics.reg_duration_ms?.values?.['p(95)']       || 0;
    const successRate   = regSuccess + regFail > 0
        ? ((regSuccess / (regSuccess + regFail)) * 100).toFixed(1)
        : '0.0';

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃              🔍 昵称重复检测 - 压测结果汇总                  ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━┫
┃  配置                                 ┃  数值               ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━┫
┃  并发VU数                             ┃  ${String(totalVUs).padEnd(19)} ┃
┃  目标注册总量                         ┃  ${String(totalTarget).padEnd(19)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━┫
┃  结果                                 ┃  数值               ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━┫
┃  ✅ 注册成功                          ┃  ${String(regSuccess).padEnd(19)} ┃
┃  ❌ 注册失败（双败）                  ┃  ${String(regFail).padEnd(19)} ┃
┃  ⚠️  昵称获取失败                    ┃  ${String(nickFetchFail).padEnd(19)} ┃
┃  📊 注册成功率                        ┃  ${(successRate + '%').padEnd(19)} ┃
┃  ⏱️  注册 P95 耗时(ms)               ┃  ${String(Math.round(p95Duration)).padEnd(19)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━┫
┃  🔑 昵称去重分析                      ┃  运行 analyzeNicknames.js ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━┛
`;

    const summary = textSummary(data, { indent: ' ', enableColors: true });

    // 同时输出 nickname-results.json，内容是所有 [NICKNAME_CHECK] 行的结构化记录
    // analyzeNicknames.js 会读这个文件做去重聚合
    // 注意：k6 的 handleSummary 可以写多个文件，这里利用 stdout 以外的 key
    // 实际 nickName 数据在日志里，analyzeNicknames.js 直接 parse output.log 更可靠
    // 这里额外输出一个空的 JSON 壳，方便用户确认文件路径
    const jsonMeta = JSON.stringify({
        _note: "此文件为元信息占位，完整数据在 output.log 中的 [NICKNAME_CHECK] 行",
        _analyze_cmd: "node analyzeNicknames.js output.log",
        tenantId: __ENV.TENANT_ID || '3004',
        vus: totalVUs,
        totalTarget: totalTarget,
        regSuccess: regSuccess,
        regFail: regFail,
        successRate: successRate + '%',
        p95DurationMs: Math.round(p95Duration),
    }, null, 2);

    return {
        'stdout': table + '\n' + summary,
        'nickname-results.json': jsonMeta,
    };
}
