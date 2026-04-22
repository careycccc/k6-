/**
 * Token 池数据预热脚本
 * 
 * 作用：压测前向 Redis 池内注入带有 userId 的预热用户 token。
 * 本脚本使用前台原生注册接口（手机/邮箱），并提供了两种截然不同的拓扑模式，满足普通压测和多级返佣邀请的需求。
 *
 * 模式一：前台总代平行预热（无极）
 *   k6 run -e TENANT_ID=3004 -e SEED_MODE=flat -e USER_COUNT=10 -e INVITE_CODE=3EPLRGN seed.tokenPool.js 测试前台注册（支持可选邀请码）
 * 
 * 模式二：单线团队网状邀请预热（带上下级）
 *   k6 run -e TENANT_ID=3004 -e SEED_MODE=invite -e INVITE_CODE=W5LU89N -e TEAM_TOTAL=50 -e TEAM_LEVELS=3 tests/load/seed.tokenPool.js
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { AdminLogin } from '../api/login/adminlogin.test.js';
import { 
    phoneRegister, 
    emailRegister,
    phoneRegisterByInvite,
    emailRegisterByInvite
} from '../api/login/register.test.js';
import { generateRandomPhone, generateRandomEmails } from '../utils/accountGenerator.js';
import { getFrontUserInfo } from '../api/user/userManagement.js';
import { getEnvByTenantId } from '../../config/envconfig.js';
import { injectUserTokens, closeRedis, checkRedisConnection } from '../../libs/redis/tokenPool.js';

// ============================================================
// 自定义指标
// ============================================================
const seedSuccessCounter = new Counter('seed_success_count');
const seedFailCounter = new Counter('seed_fail_count');

// ============================================================
// k6 配置
// ============================================================
const seedMode = __ENV.SEED_MODE || 'flat';

export const options = {
    scenarios: {
        seed_pool: {
            executor: 'per-vu-iterations',
            // 邀请模式下由于需要严格串行级联生成 inviteCode，固定 1 VU 运行循环
            // 平铺模式下依靠并发 VU 生成，符合压测瞬时造数场景
            vus: seedMode === 'invite' ? 1 : (parseInt(__ENV.USER_COUNT) || 10),
            iterations: 1,
            maxDuration: '60m',
        },
    },
    tags: {
        test_type: 'setup',
        operation: 'seed_tokens',
        mode: seedMode
    }
};

// ============================================================
// 辅助函数：层级分配算法（与 multiLevelRebate 保持一致）
// ============================================================
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
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));
    let diff = totalPeople - result.reduce((sum, n) => sum + n, 0);
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

// ============================================================
// 辅助函数：高可用执行单次注册（手机兜底邮箱）
// ============================================================
function executeFallbackRegister(data, parentInviteCode, isInviteMode) {
    const { envConfig } = data;
    const countryCode = envConfig.COUNTRY_CODE || '91';
    
    // 生成一套账号数据供尝试
    const phone = generateRandomPhone(countryCode);
    const email = generateRandomEmails(1)[0];
    
    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    let registerResult = null;
    let accountUsed = phone;

    // 1. 尝试手机号注册
    if (isInviteMode) {
        registerResult = phoneRegisterByInvite(phone, parentInviteCode, data, 'qwer1234', '', customUrls);
    } else {
        // Flat 模式：如有环境传入，支持带邀请码的前台注册
        registerResult = phoneRegister(phone, data, 'qwer1234', parentInviteCode || '', null);
    }

    const isSuccess = (res) => res && (res.code === 0 || res.msgCode === 0);

    // 2. 手机失败 -> 等待3s后重试一次
    if (!isSuccess(registerResult)) {
        console.warn(`[Seed] ⚠️ 手机号注册失败 (${phone})，等待3s后重试...`);
        sleep(3);
        if (isInviteMode) {
            registerResult = phoneRegisterByInvite(phone, parentInviteCode, data, 'qwer1234', '', customUrls);
        } else {
            registerResult = phoneRegister(phone, data, 'qwer1234', parentInviteCode || '', null);
        }
    }

    // 3. 重试仍失败 -> 降级邮箱兜底注册
    if (!isSuccess(registerResult)) {
        console.warn(`[Seed] ⚠️ 手机号重试仍失败 (${phone})，自动降级尝试邮箱注册 (${email})`);
        accountUsed = email;
        if (isInviteMode) {
            registerResult = emailRegisterByInvite(email, parentInviteCode, data, 'qwer1234', '', customUrls);
        } else {
            registerResult = emailRegister(email, data, 'qwer1234', parentInviteCode || '', null);
        }
    }

    if (!isSuccess(registerResult)) {
        return null; // 双途径全部折损
    }

    // 提取 Token
    let token = null;
    if (registerResult.headers && registerResult.headers.Authorization) {
        token = registerResult.headers.Authorization.replace(/^Bearer\s+/i, '').trim();
    } else if (registerResult.headers && registerResult.headers.authorization) {
        token = registerResult.headers.authorization.replace(/^Bearer\s+/i, '').trim();
    } else if (registerResult.data && registerResult.data.token) {
        token = registerResult.data.token;
    }

    if (!token) return null;

    // 提取 userId 及生成的邀请码
    let userId = registerResult.data && registerResult.data.userId;
    let newInviteCode = registerResult.data && registerResult.data.inviteCode;

    if (!userId || !newInviteCode) {
        sleep(0.5); // 给服务器一点喘息
        const userInfo = getFrontUserInfo(token);
        if (userInfo) {
            userId = userInfo.userId || userId;
            newInviteCode = userInfo.inviteCode || newInviteCode;
        }
    }

    if (!userId) return null;

    return { userId, token, inviteCode: newInviteCode, accountUsed };
}

// ============================================================
// Setup：后台登录
// ============================================================
export async function setup() {
    console.log(`[SeedTokenPool] ========== 开始数据预热准备 (模式: ${seedMode}) ==========`);
    const tenantId = __ENV.TENANT_ID || '3004';

    // 第一步：验证 Redis 连通性，失败直接中止
    await checkRedisConnection(tenantId);

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('[SeedTokenPool] ❌ 后台管理员登录失败，无法建立环境授权');
    }
    
    const envConfig = getEnvByTenantId(tenantId);
    console.log(`[SeedTokenPool] ✅ 基础环境授权成功，准备执行注入`);
    
    return { token: adminToken, envConfig, tenantId };
}

// ============================================================
// 核心逻辑
// ============================================================
export default async function (data) {
    // 缓和并非，特别是 flat 多并发情况
    const staggerTime = (__VU - 1) * 1.5; 
    sleep(Math.min(staggerTime, 10));

    if (seedMode === 'flat') {
        // 模式一：前台总代平行无极造数
        const flatInviteCode = __ENV.INVITE_CODE || '';
        const result = executeFallbackRegister(data, flatInviteCode, false);
        
        if (result) {
            try {
                await injectUserTokens(data.tenantId, [{ userId: result.userId, token: result.token }]);
                seedSuccessCounter.add(1);
                console.log(`[VU-${__VU}] ✅ 成功注入账号到压测池: ${result.accountUsed} (userId: ${result.userId})`);
            } catch (e) {
                console.error(`[VU-${__VU}] ❌ Redis 写入失败: ${e.message}`);
                seedFailCounter.add(1);
            }
        } else {
            console.error(`[VU-${__VU}] ❌ 账号全部注册失败，弃用该轮生成`);
            seedFailCounter.add(1);
        }

    } else if (seedMode === 'invite') {
        // 模式二：团队分层级裂变邀请注册（在一个 VU 里串行大循环）
        const total = parseInt(__ENV.TEAM_TOTAL || '10', 10);
        const levels = parseInt(__ENV.TEAM_LEVELS || '2', 10);
        const rootInviteCode = __ENV.INVITE_CODE;

        if (!rootInviteCode) {
            throw new Error("[SeedTokenPool] Invite 模式必须提供 INVITE_CODE，例如：-e INVITE_CODE=W5LU89N");
        }

        const distribution = distributePeople(total, levels);
        console.log(`\n[SeedTokenPool] 层级自动算法：团队 ${total}人, 深度 ${levels}级 => 每级分布: [ ${distribution.join(' -> ')} ]`);

        let currentParentCodes = [rootInviteCode];
        
        for (let lvl = 0; lvl < distribution.length; lvl++) {
            const count = distribution[lvl];
            console.log(`\n🚀 === 正在衍生 第 ${lvl + 1} 层网络: 共 ${count} 节点 ===`);

            let nextParentCodes = [];
            let validUsersToInject = [];

            for (let i = 0; i < count; i++) {
                // 网格随机挂载挂靠父类
                const parentCode = currentParentCodes[Math.floor(Math.random() * currentParentCodes.length)];
                
                const result = executeFallbackRegister(data, parentCode, true);
                if (result) {
                    validUsersToInject.push({ userId: result.userId, token: result.token });
                    nextParentCodes.push(result.inviteCode);
                    console.log(`  └─ ✅ 节点接入成功: ${result.accountUsed} (上级: ${parentCode})`);
                    seedSuccessCounter.add(1);
                } else {
                    console.error(`  └─ ❌ 节点接入失败 (上级: ${parentCode})`);
                    seedFailCounter.add(1);
                }
                sleep(2); // 减压
            }

            // 本层一旦执行所有用户生成，立即批量入池
            if (validUsersToInject.length > 0) {
                try {
                    await injectUserTokens(data.tenantId, validUsersToInject);
                    console.log(`  └─ 📦 本层 ${validUsersToInject.length} 个 Token 已推入预热池`);
                } catch(e) {
                    console.error(`  └─ ❌ Redis 层级批量写入失败: ${e.message}`);
                }
            } else {
                console.warn(`  └─ ⚠️ 本层所有衍生节点均断层，团队树阻断。`);
                break; // 如果这一层一个人都没成功，下一层就没父类了，直接断开
            }

            // 向下承继扩散
            currentParentCodes = nextParentCodes;
        }
    }
}

// ============================================================
// 格式化输出日志
// ============================================================
export function handleSummary(data) {
    const success = data.metrics.seed_success_count?.values?.count || 0;
    const fail = data.metrics.seed_fail_count?.values?.count || 0;
    const modeDesc = seedMode === 'invite' ? '团队裂变邀请模式' : '前台总代平行模式';

    let resultMsg = '\n';
    resultMsg += '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n';
    resultMsg += '┃           🚀 压测账号池预热报告             ┃\n';
    resultMsg += '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━┫\n';
    resultMsg += `┃ ⚙️ 预热运行策略                  ┃ ${modeDesc.padEnd(9)} ┃\n`;
    resultMsg += `┃ ✅ 成功注册并写入 Redis 的账号   ┃ ${String(success).padEnd(9)} ┃\n`;
    resultMsg += `┃ ❌ 生成断层/失败的死信账号数量   ┃ ${String(fail).padEnd(9)} ┃\n`;
    resultMsg += '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━┛\n';

    return { stdout: resultMsg };
}

// ============================================================
// Teardown
// ============================================================
export function teardown() {
    console.log(`\n[SeedTokenPool] ========== 数据预热作业收尾 ==========`);
    closeRedis();
}
