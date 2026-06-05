/**
 * 分布式森林注册压测脚本 - distributedForest.test.js
 *
 * ============================================================
 * 任务目标：
 *   利用 k6 生命周期在 setup() 阶段通过无邀请码注册创建"全局根节点"（老祖宗），
 *   在 default() 阶段通过带邀请码注册结合"分布式森林算法"让 500 个并发 VU
 *   的用户逐层挂载，最终在数据库中形成一棵拥有 10,000 个节点的合法层级树。
 *
 * 规模参数（可通过环境变量覆盖）：
 *   -e TENANT_ID=3004      租户ID（默认3004）
 *   -e VUS=500             并发VU数（默认500）
 *   -e TOTAL_USERS=10000   目标总注册人数（默认10000）
 *   -e LEVELS=5            每VU内部树的层级数（默认5）
 *
 * 运行示例：
 *   k6 run -e TENANT_ID=3101 -e VUS=5 -e TOTAL_USERS=20 -e LEVELS=4  distributedForest.test.js
 *
 * ============================================================
 * 设计原则（只读 + 增量）：
 *   - 只新增本文件，不修改任何现有文件
 *   - import 复用项目中已有的函数，不重新实现
 *   - 函数签名严格遵循项目实际定义（batchRegister.js 中已验证）
 * ============================================================
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ── 复用已有函数（只读引用）────────────────────────────────────
import { AdminLogin } from '../login/adminlogin.test.js';
import {
    phoneRegister,
    phoneRegisterByInvite,
    emailRegister,
    // emailRegisterByInvite 原函数在 register.test.js 中存在 bug（httpResponse 声明后
    // 未赋值即读 .status），这里不 import，改用下方本地修复版 localEmailRegisterByInvite
} from '../login/register.test.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { generateRandomPhone, generateRandomEmail } from '../../utils/accountGenerator.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
// 用于本地修复版邮箱邀请注册
import { httpClient } from '../../../libs/http/client.js';
import { sendToGetVerCode } from '../login/SendVerifiyCode.test.js';
import { getTimeRandom } from '../../utils/utils.js';

// ============================================================
// localEmailRegisterByInvite —— 修复版邮箱邀请注册
//
// 原因：register.test.js 中的 emailRegisterByInvite 存在 bug，
//   let httpResponse 声明后缺少实际 HTTP 发送代码，
//   直接打印 httpResponse.status 导致 TypeError。
// 本函数完全对齐 phoneRegisterByInvite 的正确实现，仅将
//   loginType 改为 "Email"，verifyCode 改用 codeType=20。
//
// 签名与 emailRegisterByInvite 完全一致，可无缝替换调用。
// ============================================================
function localEmailRegisterByInvite(email, inviteCode, adminData, password = 'qwer1234', turnstileToken = '', customUrls = null) {
    const customFrontUrl = customUrls && customUrls.frontUrl ? customUrls.frontUrl : null;
    const customAdminUrl = customUrls && customUrls.adminUrl ? customUrls.adminUrl : null;
    const customRegisterUrl = customUrls && customUrls.registerUrl ? customUrls.registerUrl : null;

    // 1. 发验证码（codeType=20 = 邮箱邀请注册）
    const verifyCode = sendToGetVerCode(2, 20, email, adminData.token, customFrontUrl, customAdminUrl);
    if (!verifyCode) {
        console.error(`[LocalEmailByInvite] 获取验证码失败: ${email}`);
        return null;
    }

    const codeStr = String(verifyCode).trim();
    const api = '/api/Home/Register';
    const timeData = getTimeRandom();

    // 2. 组装 payload
    const payload = {
        userName: email,
        inviteCode: inviteCode,
        loginType: 'Email',
        turnstileToken: turnstileToken,
        password: password,
        code: codeStr,
        language: timeData.language,
        random: timeData.random,
        signature: '',
        timestamp: timeData.timestamp,
    };

    // 3. 发送请求（customRegisterUrl 优先，否则用默认域名）
    let httpResponse;
    if (customRegisterUrl) {
        const fullUrl = customRegisterUrl + api;
        httpResponse = httpClient.post(api, payload, { fullUrl: fullUrl }, true);
    } else {
        httpResponse = httpClient.post(api, payload, {}, true);
    }

    if (!httpResponse || !httpResponse.body) {
        console.error(`[LocalEmailByInvite] 无响应: ${email}`);
        return null;
    }

    // 4. 解析响应
    let parsedBody;
    try {
        parsedBody = typeof httpResponse.body === 'string' ? JSON.parse(httpResponse.body) : httpResponse.body;
    } catch (e) {
        console.error(`[LocalEmailByInvite] 解析失败: ${e.message}`);
        return null;
    }

    const statusCode = parsedBody.code !== undefined ? parsedBody.code : parsedBody.msgCode;
    if (statusCode === 0) {
        const token = parsedBody.data && parsedBody.data.token ? parsedBody.data.token : null;
        console.log(`[LocalEmailByInvite] ✅ 注册成功: ${email}`);
        return {
            headers: token ? { 'Authorization': `Bearer ${token}` } : httpResponse.headers,
            data: parsedBody.data,
            code: statusCode,
            msg: parsedBody.msg,
        };
    }

    console.error(`[LocalEmailByInvite] ❌ 注册失败: ${email}, code=${statusCode}, msg=${parsedBody.msg}`);
    return null;
}

// ============================================================
// 自定义 k6 指标 (由于 k6 限制，必须使用 ASCII 字符)
// ============================================================
const phoneRegSuccess = new Counter('phone_reg_success_counter');
const emailRegSuccess = new Counter('email_reg_success_counter');
const totalRegistered = new Counter('total_registered_counter');
const userSkipCounter = new Counter('user_skip_counter');

// ============================================================
// K6 执行选项
// ============================================================
export const options = {
    scenarios: {
        distributed_forest: {
            executor: 'per-vu-iterations',
            vus: parseInt(__ENV.VUS || '50', 10),
            iterations: 1,       // 每个VU只执行一次 default()，在内部完成所有分配到的用户注册
            maxDuration: '6h',   // 大规模注册预留足够时长
        },
    },
    thresholds: {
        // 核心成功率指标：手机+邮箱注册总成功量应趋近 10000
        'phone_reg_success_counter': [],
        'email_reg_success_counter': [],
        // HTTP 请求 P95 延迟
        http_req_duration: ['p(95)<10000'],
    },
};

// ============================================================
// 工具函数（仅在本文件内使用，不导出）
// ============================================================

/**
 * 从注册响应中提取前台 token
 * 兼容两种来源：data.token 和 headers.Authorization
 * （复用 batchRegister.js 中验证过的提取逻辑）
 * @param {object|null} response - 注册响应对象
 * @returns {string|null}
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

/**
 * 按层级递减随机分配人数
 * 复用项目中 batchRegister.js / channelInviteService.js 同款算法（只读参考，本地拷贝以保持独立性）
 * @param {number} totalPeople
 * @param {number} levels
 * @returns {number[]}
 */
function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }

    const weights = [];
    for (let i = 0; i < levels; i++) {
        const base = (levels - i) / levels;
        weights.push(base * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));

    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) {
        for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; }
    }
    while (diff < 0) {
        for (let i = levels - 1; i >= 0 && diff < 0; i--) {
            if (result[i] > 1) { result[i]--; diff++; }
        }
    }
    result.sort((a, b) => b - a);
    return result;
}

/**
 * 从池中完全随机抽取一个邀请码
 * @param {string[]} pool
 * @returns {string|null}
 */
function randomPickFromPool(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 单次邀请注册尝试（手机优先 → 失败降级邮箱）
 * 严格遵循项目真实函数签名：phoneRegisterByInvite(phone, inviteCode, adminData, password, turnstile, customUrls)
 *
 * @param {string} parentInviteCode - 上级邀请码
 * @param {object} adminData        - { token, envConfig }
 * @param {object} customUrls       - { frontUrl, adminUrl, registerUrl }
 * @param {string} vuLabel          - 日志标识（如 "VU-1"）
 * @returns {{ token: string, account: string, method: 'phone'|'email' }|null}
 */
function tryInviteRegisterOnce(parentInviteCode, adminData, customUrls, vuLabel) {
    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    const email = generateRandomEmail();

    // ── 1. 手机邀请注册 ────────────────────────────────────────
    let response = null;
    try {
        response = phoneRegisterByInvite(phone, parentInviteCode, adminData, 'qwer1234', '', customUrls);
    } catch (e) {
        console.error(`[${vuLabel}] 手机邀请注册异常: ${e.message}`);
    }

    const phoneToken = extractToken(response);
    if (phoneToken) {
        return { token: phoneToken, account: phone, method: 'phone' };
    }

    // ── 2. 邮箱邀请注册降级 ────────────────────────────────────
    console.log(`[${vuLabel}] 手机号注册失败，降级邮箱: ${email}`);
    response = null;
    try {
        // 使用本文件内的修复版（原 emailRegisterByInvite 在 register.test.js 中有 bug）
        response = localEmailRegisterByInvite(email, parentInviteCode, adminData, 'qwer1234', '', customUrls);
    } catch (e) {
        console.error(`[${vuLabel}] 邮箱邀请注册异常: ${e.message}`);
    }

    const emailToken = extractToken(response);
    if (emailToken) {
        return { token: emailToken, account: email, method: 'email' };
    }

    return null; // 双败
}

// ============================================================
// Setup 阶段：注册全局根节点（老祖宗），仅执行一次
// ============================================================
export function setup() {
    console.log('\n' + '═'.repeat(70));
    console.log('🌳 [Setup] 分布式森林压测 - 开始创建全局根节点（老祖宗）');
    console.log('═'.repeat(70));

    // 1. 全局管理员登录
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('[Setup] ❌ 管理员登录失败，压测中止');
    }
    console.log('[Setup] ✅ 管理员登录成功');

    // 2. 初始化租户环境配置
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const envConfig = getEnvByTenantId(tenantId);

    // 切换全局 ENV_CONFIG（与 multiLevelRebate.test.js 保持一致）
    if (tenantId !== '3004') {
        Object.assign(ENV_CONFIG, envConfig);
        console.log(`[Setup] 已切换租户 ${tenantId} → 前台: ${envConfig.BASE_DESK_URL}`);
    }

    const adminData = { token: adminToken, envConfig };
    const countryCode = envConfig.COUNTRY_CODE || '91';

    // 普通注册（总代注册）所用 URL 配置
    const deskCustomUrls = {
        frontUrl: envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.BASE_DESK_URL
    };

    // 3. 优先手机注册根用户（无邀请码，前台总代注册方式）
    const rootPhone = generateRandomPhone(countryCode);
    const rootEmail = generateRandomEmail();
    let rootToken = null;
    let rootAccount = '';

    console.log(`[Setup] 尝试手机注册根节点: ${rootPhone}`);
    let res = null;
    try {
        res = phoneRegister(rootPhone, adminData, 'qwer1234', '');
    } catch (e) {
        console.error(`[Setup] 手机注册异常: ${e.message}`);
    }

    const phoneToken = extractToken(res);
    if (phoneToken) {
        phoneRegSuccess.add(1);
        totalRegistered.add(1);
        rootToken = phoneToken;
        rootAccount = rootPhone;
        console.log(`[Setup] ✅ 手机注册根节点成功: ${rootPhone}`);
    } else {
        // 4. 降级邮箱注册根用户
        console.log(`[Setup] 手机注册失败，降级邮箱注册: ${rootEmail}`);
        try {
            res = emailRegister(rootEmail, adminData, 'qwer1234', '');
        } catch (e) {
            console.error(`[Setup] 邮箱注册异常: ${e.message}`);
        }

        const emailToken = extractToken(res);
        if (emailToken) {
            emailRegSuccess.add(1);
            totalRegistered.add(1);
            rootToken = emailToken;
            rootAccount = rootEmail;
            console.log(`[Setup] ✅ 邮箱注册根节点成功: ${rootEmail}`);
        } else {
            throw new Error('[Setup] ❌ 手机和邮箱均无法注册根节点，压测中止');
        }
    }

    // 5. 获取根节点的邀请码（通过前台用户 token 调用 getFrontUserInfo）
    sleep(1);
    const rootUserInfo = getFrontUserInfo(rootToken);
    if (!rootUserInfo || !rootUserInfo.inviteCode) {
        throw new Error(`[Setup] ❌ 无法获取根节点邀请码（账号: ${rootAccount}）`);
    }

    const rootInviteCode = rootUserInfo.inviteCode;
    const rootUserId = rootUserInfo.userId;

    console.log('');
    console.log('═'.repeat(70));
    console.log(`🌳 [Setup] 根节点创建成功`);
    console.log(`   账号: ${rootAccount}`);
    console.log(`   UserId: ${rootUserId}`);
    console.log(`   邀请码: ${rootInviteCode}`);
    console.log('═'.repeat(70) + '\n');

    // 6. 广播给所有 VU
    return {
        adminToken,
        envConfig,
        rootInviteCode,
        rootUserId,
        rootAccount,
    };
}

// ============================================================
// Default 阶段：并发造树（每个 VU 独立执行，内部逐层挂载）
// ============================================================
export default function (data) {
    const { adminToken, envConfig, rootInviteCode } = data;
    const vuId = exec.vu.idInInstance;

    // ── VU 阶段重新绑定租户环境（k6 VU 会重新加载模块，ENV_CONFIG 会还原默认值）────
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    if (tenantId !== '3004') {
        Object.assign(ENV_CONFIG, envConfig);
    }

    const adminData = { token: adminToken, envConfig };
    const vuLabel = `VU-${vuId}`;

    // ── 1. 精准计算当前 VU 应注册的用户总数 ───────────────────
    const totalVUs = parseInt(__ENV.VUS || '500', 10);
    const totalTarget = parseInt(__ENV.TOTAL_USERS || '10000', 10);
    const levels = parseInt(__ENV.LEVELS || '5', 10);

    let myTotalUsers = Math.floor(totalTarget / totalVUs);
    // 最后一个 VU 吸收所有除不尽的余数，精确补齐总量
    if (vuId === totalVUs) {
        myTotalUsers += (totalTarget % totalVUs);
    }

    if (myTotalUsers < levels) {
        console.warn(`[${vuLabel}] ⚠️ 警告: 分配到的用户数(${myTotalUsers}) < 目标层数(${levels})，无法建满所有层级！建议增加 TOTAL_USERS 或 减少 VUS。`);
    }

    console.log(`\n[${vuLabel}] 开始注册 ${myTotalUsers} 个用户（目标 ${levels} 层）`);

    // ── 2. 层级人数分配 ────────────────────────────────────────
    const levelDistribution = distributePeople(myTotalUsers, levels);
    console.log(`[${vuLabel}] 层级分配: ${levelDistribution.join(' → ')}`);

    // 每层邀请码池（用于下一层用户挂载）
    const inviteCodesByLevel = Array.from({ length: levels }, () => []);

    // 邀请注册所用 URL（走租户的邀请注册专用域名）
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    // ── 3. 逐层注册，构建 VU 内部子树 ─────────────────────────
    for (let currentLevel = 0; currentLevel < levelDistribution.length; currentLevel++) {
        const levelCount = levelDistribution[currentLevel];
        if (levelCount === 0) continue;

        console.log(`\n[${vuLabel}] ── Level ${currentLevel + 1} 层：注册 ${levelCount} 人 ──`);

        for (let i = 0; i < levelCount; i++) {

            // ── 3a. 确定上级邀请码（认祖归宗 / 随机绑定 / 降级兜底）─
            let parentCode = null;

            if (currentLevel === 0) {
                // 第一层：全部认祖归宗，挂到全局老祖宗
                parentCode = rootInviteCode;

            } else {
                // 后续层：优先从上一层码池随机抽取
                parentCode = randomPickFromPool(inviteCodesByLevel[currentLevel - 1]);

                if (!parentCode) {
                    // 上一层码池为空 → 降级：从上上层码池随机抽取
                    if (currentLevel >= 2) {
                        parentCode = randomPickFromPool(inviteCodesByLevel[currentLevel - 2]);
                        if (parentCode) {
                            console.warn(`[${vuLabel}] Level ${currentLevel + 1} 上一层池为空，降级到上上层 (Level ${currentLevel - 1})`);
                        }
                    }

                    if (!parentCode) {
                        // 继续向上找直到 Level 0（rootInviteCode）
                        for (let fallback = currentLevel - 3; fallback >= 0; fallback--) {
                            parentCode = randomPickFromPool(inviteCodesByLevel[fallback]);
                            if (parentCode) {
                                console.warn(`[${vuLabel}] Level ${currentLevel + 1} 降级到 Level ${fallback + 1}`);
                                break;
                            }
                        }

                        // 所有历史层都为空 → 最终兜底到老祖宗
                        // （这只会发生在极端情况：整棵子树前面所有注册都失败）
                        // 理论上 Level 0 已成功才会到 Level 1，这里只防御越界
                        if (!parentCode) {
                            userSkipCounter.add(1);
                            console.error(`[${vuLabel}] Level ${currentLevel + 1} 第 ${i + 1} 个用户：所有历史层码池均为空，跳过该用户`);
                            continue;
                        }
                    }
                }
            }

            // ── 3b. 首用户熔断 Flag ───────────────────────────────
            // 绝对时间下全局第一个迭代：VU=1 且 ITER=0
            const isFirstUser = (vuId === 1 && i === 0 && currentLevel === 0);

            // ── 3c. 执行注册（手机→失败降级邮箱）───────────────────
            const result = tryInviteRegisterOnce(parentCode, adminData, customUrls, vuLabel);

            if (!result) {
                // 双败处理
                if (isFirstUser) {
                    // 首用户熔断：强行终止整个压测
                    exec.test.abort(`[${vuLabel}] 首个用户（手机+邮箱）均注册失败，环境不通，强行终止压测`);
                    return;
                }
                // 后续用户容错：记录日志，跳过
                userSkipCounter.add(1);
                console.error(`[${vuLabel}] Level ${currentLevel + 1} 第 ${i + 1} 个用户注册双败，跳过`);
                continue;
            }

            // ── 3d. 注册成功：累加指标 ────────────────────────────
            if (result.method === 'phone') {
                phoneRegSuccess.add(1);
            } else {
                emailRegSuccess.add(1);
            }
            totalRegistered.add(1);

            // ── 3e. 获取该用户的邀请码，塞入当前层级码池 ──────────
            // 优先从注册响应的 token 调用前台接口获取（最准确）
            sleep(1); // 给后端写库留出时间
            let myInviteCode = null;
            try {
                const userInfo = getFrontUserInfo(result.token);
                if (userInfo && userInfo.inviteCode) {
                    myInviteCode = userInfo.inviteCode;
                }
            } catch (e) {
                console.error(`[${vuLabel}] 获取邀请码失败（${result.account}）: ${e.message}`);
            }

            // 如果前台接口拿不到，降级用后台 getUserInfo
            if (!myInviteCode) {
                try {
                    const backendInfo = getUserInfo(adminToken, result.account);
                    if (backendInfo && backendInfo.inviteCode) {
                        myInviteCode = backendInfo.inviteCode;
                    }
                } catch (e) {
                    console.error(`[${vuLabel}] 后台 getUserInfo 失败（${result.account}）: ${e.message}`);
                }
            }

            if (myInviteCode) {
                inviteCodesByLevel[currentLevel].push(myInviteCode);
                console.log(`[${vuLabel}] ✅ Level ${currentLevel + 1} [${i + 1}/${levelCount}] ${result.account} → 邀请码: ${myInviteCode}`);
            } else {
                // 没拿到邀请码：用户已成功注册，但无法作为上级，不塞池，仅记录
                console.warn(`[${vuLabel}] ⚠️ Level ${currentLevel + 1} [${i + 1}/${levelCount}] ${result.account} 注册成功但未能获取邀请码`);
            }
        }

        console.log(`[${vuLabel}] Level ${currentLevel + 1} 完成，当前层码池: ${inviteCodesByLevel[currentLevel].length} 个邀请码`);
    }

    // ── 4. 当前 VU 子树构建完毕，打印摘要 ─────────────────────
    const poolSummary = inviteCodesByLevel.map((p, i) => `L${i + 1}:${p.length}`).join(' | ');
    console.log(`\n[${vuLabel}] ✅ 子树构建完成 → 各层邀请码池: ${poolSummary}`);
}

// ============================================================
// Teardown 阶段
// ============================================================
export function teardown(data) {
    console.log('\n' + '═'.repeat(70));
    console.log('🌳 分布式森林压测完成');
    console.log(`   根节点账号:   ${data.rootAccount}`);
    console.log(`   根节点UserId: ${data.rootUserId}`);
    console.log(`   根节点邀请码: ${data.rootInviteCode}`);
    console.log('═'.repeat(70) + '\n');
}

// ============================================================
// 汇总报告
// ============================================================
export function handleSummary(data) {
    const totalReg = data.metrics.total_registered_counter?.values?.count || 0;
    const userSkip = data.metrics.user_skip_counter?.values?.count || 0;
    const phoneReg = data.metrics.phone_reg_success_counter?.values?.count || 0;
    const emailReg = data.metrics.email_reg_success_counter?.values?.count || 0;

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃        🌳 分布式森林统计 结果统计报告                      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ✅ 总计注册成功人数              ┃ ${String(totalReg).padEnd(25)} ┃
┃ ❌ 注册失败跳过人数              ┃ ${String(userSkip).padEnd(25)} ┃
┃ 📱 首选手机注册成功量            ┃ ${String(phoneReg).padEnd(25)} ┃
┃ 📧 降级邮箱注册成功量            ┃ ${String(emailReg).padEnd(25)} ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;

    // 依然保留 k6 默认的长篇输出
    const summary = textSummary(data, { indent: ' ', enableColors: true });

    return {
        'stdout': table + '\n' + summary
    };
}

