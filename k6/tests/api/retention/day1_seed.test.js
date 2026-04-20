/**
 * 脚本①：第一天数据播种
 * 注册新用户并随机充值1-2次
 *
 * 使用方法：
 *   k6 run -e TENANT_ID=3004 -e USER_COUNT=100 day1_seed.test.js
 *
 * 参数：
 *   TENANT_ID     租户ID（必需）
 *   USER_COUNT    注册用户数量（默认10）
 *   PACKAGE_TYPE  埋点包类型（可选，不传则用租户专属配置）
 *   INVITE_CODE   邀请码（可选，覆盖配置文件）
 */

import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getEventConfig } from '../../../config/eventRegisterConfig.js';
import { eventIdentityRegister } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { hybridRecharge } from '../recharge/rechargeService.js';

const regSuccessCounter   = new Counter('seed_reg_success');
const rechargeCounter     = new Counter('seed_recharge_success');
const doubleRechargeCounter = new Counter('seed_double_recharge');
const tripleRechargeCounter = new Counter('seed_triple_recharge');

const tenantId    = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
const userCount   = __ENV.USER_COUNT ? parseInt(__ENV.USER_COUNT) : 10;
const packageType = __ENV.PACKAGE_TYPE || '';

const scenarioConfig  = getEventConfig(tenantId, packageType);
const finalInviteCode = __ENV.INVITE_CODE || scenarioConfig.inviteCode;

export const options = {
    scenarios: {
        seed: {
            executor: 'per-vu-iterations',
            vus: userCount,
            iterations: 1,
            maxDuration: '60m'
        }
    }
};

// 全局统计（单VU场景安全）
let _stats = {
    tenantId,
    userCount,
    regSuccess: 0,
    rechargeSuccess: 0,
    singleRecharge: 0,
    doubleRecharge: 0,
    tripleRecharge: 0
};

export function setup() {
    console.log(`[Seed] ========== 第一天数据播种 ==========`);
    console.log(`[Seed] 租户: ${tenantId}，计划注册: ${userCount} 人`);
    console.log(`[Seed] 包类型: ${scenarioConfig.desc}，邀请码: ${finalInviteCode || '(无)'}`);

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error(`[Seed] ❌ 租户 ${tenantId} 管理员登录失败`);

    console.log(`[Seed] ✅ 管理员登录成功`);

    const envConfig = getEnvByTenantId(tenantId);
    return { token: adminToken, envConfig };
}

export default function (data) {
    // 交错启动，每个VU间隔5秒
    if (__ITER === 0) {
        sleep((__VU - 1) * 5);
    }

    const countryCode = __ENV.COUNTRY_CODE || '91';
    const userName = generateRandomPhone(countryCode);
    const tiktokDomain = scenarioConfig.registerDomain || data.envConfig.BASE_DESK_URL;

    console.log(`[Seed] [VU${__VU}] 注册账号: ${userName}`);

    // 1. 注册
    const registerResult = eventIdentityRegister(userName, data, {
        pixelId:       scenarioConfig.pixelId,
        eventConfigId: scenarioConfig.id,
        packageName:   scenarioConfig.packageName,
        inviteCode:    finalInviteCode,
        registerUrl:   tiktokDomain,
        customFrontUrl: tiktokDomain
    });

    if (!registerResult || registerResult.code !== 0) {
        console.error(`[Seed] [VU${__VU}] ❌ 注册失败: ${userName}`);
        return;
    }

    console.log(`[Seed] [VU${__VU}] ✅ 注册成功: ${userName}`);
    regSuccessCounter.add(1);
    _stats.regSuccess++;

    const userToken  = registerResult.data.token;
    const userId     = registerResult.data.userId;
    const adminToken = data.token;

    // 级联充值逻辑：
    // 注册成功 → 90% 充第1次 → 50% 充第2次 → 20% 充第3次
    if (Math.random() >= 0.9) {
        console.log(`[Seed] [VU${__VU}] 跳过充值（10%概率）`);
        return;
    }

    const amount1 = 2000 + Math.floor(Math.random() * 3001);
    const result1 = hybridRecharge({ userToken, adminToken, userId, amount: amount1 });

    if (!result1.success) {
        console.error(`[Seed] [VU${__VU}] ❌ 第1次充值失败`);
        return;
    }

    rechargeCounter.add(1);
    _stats.rechargeSuccess++;
    console.log(`[Seed] [VU${__VU}] ✅ 第1次充值成功，金额: ${result1.amount}`);

    // 50% 进行第2次充值
    if (Math.random() >= 0.5) {
        _stats.singleRecharge++;
        return;
    }

    sleep(3);
    const amount2 = 2000 + Math.floor(Math.random() * 3001);
    const result2 = hybridRecharge({ userToken, adminToken, userId, amount: amount2 });

    if (!result2.success) {
        console.error(`[Seed] [VU${__VU}] ❌ 第2次充值失败`);
        _stats.singleRecharge++;
        return;
    }

    doubleRechargeCounter.add(1);
    _stats.doubleRecharge++;
    console.log(`[Seed] [VU${__VU}] ✅ 第2次充值成功，金额: ${result2.amount}`);

    // 20% 进行第3次充值
    if (Math.random() >= 0.2) {
        return;
    }

    sleep(3);
    const amount3 = 2000 + Math.floor(Math.random() * 3001);
    const result3 = hybridRecharge({ userToken, adminToken, userId, amount: amount3 });

    if (!result3.success) {
        console.error(`[Seed] [VU${__VU}] ❌ 第3次充值失败`);
        return;
    }

    tripleRechargeCounter.add(1);
    _stats.tripleRecharge++;
    console.log(`[Seed] [VU${__VU}] ✅ 第3次充值成功，金额: ${result3.amount}`);

    sleep(1);
}

export function handleSummary() {
    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃                    📊 第一天播种报表                         ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 计划注册用户数                   ┃ ${String(userCount).padEnd(25)} ┃`,
        `┃ 注册成功数                       ┃ ${String(_stats.regSuccess).padEnd(25)} ┃`,
        `┃ 充值成功数                       ┃ ${String(_stats.rechargeSuccess).padEnd(25)} ┃`,
        `┃ 单次充值用户                     ┃ ${String(_stats.singleRecharge).padEnd(25)} ┃`,
        `┃ 双次充值用户                     ┃ ${String(_stats.doubleRecharge).padEnd(25)} ┃`,
        `┃ 三次充值用户                     ┃ ${String(_stats.tripleRecharge).padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];
    return { stdout: lines.join('\n') };
}
