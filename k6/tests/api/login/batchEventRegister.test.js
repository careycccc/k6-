import { group, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { AdminLogin } from './adminlogin.test.js';
import { eventIdentityRegister } from './register.test.js';
import { hybridRecharge, getConfigRechargeAmount, eventBatchFrontendRechargeRequest, eventBatchAuditUserOrders } from '../recharge/rechargeService.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { hanlderThresholds } from '../../../config/thresholds.js';

// 自定义指标汇总
const regSuccessCounter = new Counter('custom_reg_success');
const firstRechargeCounter = new Counter('custom_first_recharge_total');
const doubleRechargeCounter = new Counter('custom_double_recharge_users');

const tag = 'batchEventRegister';

// ============ 压测配置 ============
const userCount = __ENV.USER_COUNT ? parseInt(__ENV.USER_COUNT) : 1;
const packageType = __ENV.PACKAGE_TYPE || '22'; // 21 或 22

// 根据包类型 ID 自动分配参数与默认邀请码
const scenarioConfig = packageType === '21' ? {
    id: 21,
    pixelId: 'D7G8J3JC77UBV63HPUH0',
    inviteCode: 'FXNDMAN', // 21 的默认邀请码
    desc: '📦 老包 (Old Package - ID: 21)'
} : {
    id: 22,
    pixelId: 'D7GEL23C77U0PCJMRE8G',
    inviteCode: 'CPWHUUN', // 22 的默认邀请码
    desc: '🚀 新包 (New Package - ID: 22)'
};

// 优先使用环境变量传入的邀请码
const finalInviteCode = __ENV.INVITE_CODE || scenarioConfig.inviteCode;

export const options = {
    // 使用 per-vu-iterations 确保每个 VU 只执行一次
    scenarios: {
        batch_register: {
            executor: 'per-vu-iterations',
            vus: userCount,
            iterations: 1,
            maxDuration: '60m', // 300人每10s一人，全量跑完需至少50分钟
        },
    },
    thresholds: hanlderThresholds(tag),
    tags: {
        environment: __ENV.ENVIRONMENT || 'local',
        test_type: 'api',
        service: 'user',
        operation: tag,
        package_type: packageType
    }
};

// 执行命令
// k6 run -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.test.js


/**
 * 设置：获取后台管理员 Token 以便查询验证码
 */
export function setup() {
    console.log(`[BatchRegister] ========== 开始测试准备阶段 ==========`);
    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('后台登录失败，无法继续测试');
    }
    return {
        token: adminToken,
        envConfig: ENV_CONFIG
    };
}

/**
 * 每个 VU 执行逻辑
 */
export default function (data) {
    // 1. 交错启动逻辑：加大步长至 10 秒，防止服务器频率限制
    if (__ITER === 0) {
        const staggerTime = (__VU - 1) * 10;
        console.log(`[BatchRegister] [VU${__VU}] 交错等待 ${staggerTime} 秒后启动...`);
        sleep(staggerTime);
    }

    // 2. 随机账号生成：使用项目内置的随机手机号生成器
    const countryCode = __ENV.COUNTRY_CODE || '91';
    const userName = generateRandomPhone(countryCode);

    const tiktokDomain = 'https://tiktok.arplatsaassit4.club';

    group('埋点批量注册', function () {
        console.log(`[BatchRegister] [VU${__VU}] 准备注册 [${packageType}] 账号: ${userName}`);

        // 增加较大的随机延迟 (3-7秒)，进一步打散请求
        const prepDelay = 3 + Math.random() * 4;
        sleep(prepDelay);

        const registerResult = eventIdentityRegister(userName, data, {
            pixelId: scenarioConfig.pixelId,
            eventConfigId: scenarioConfig.id,
            inviteCode: finalInviteCode,
            registerUrl: tiktokDomain,
            customFrontUrl: tiktokDomain
        });

        if (registerResult && registerResult.code === 0) {
            console.log(`[BatchRegister] [VU${__VU}] ✅ 账号 ${userName} 注册成功！`);
            regSuccessCounter.add(1);

            // 2. 充值策略分支：40% 的用户充值两次
            const isDoubleRecharger = Math.random() < 0.4;
            const userToken = registerResult.data.token;
            const userId = registerResult.data.userId;
            const adminToken = data.token;

            if (isDoubleRecharger) {
                // 3. 50% 几率是连续发起两次充值，然后后台审核连续通过 (Mode B)
                const isBurstMode = Math.random() < 0.5;
                
                if (isBurstMode) {
                    console.log(`[BatchRegister] [VU${__VU}] 🚀 Mode B: 两次连冲`);
                    eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                    firstRechargeCounter.add(1);
                    sleep(3);
                    eventBatchFrontendRechargeRequest(userToken, getConfigRechargeAmount());
                    doubleRechargeCounter.add(1); // 成功发起第二次冲才计数
                    eventBatchAuditUserOrders(adminToken, userId);
                } else {
                    console.log(`[BatchRegister] [VU${__VU}] 🚶 Mode A: 串行双充`);
                    hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                    firstRechargeCounter.add(1);
                    sleep(3);
                    hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                    doubleRechargeCounter.add(1); // 成功发起第二次冲才计数
                }
            } else {
                // 正常单次充值
                console.log(`[BatchRegister] [VU${__VU}] 标准单充`);
                sleep(2);
                hybridRecharge({ userToken, adminToken, userId, amount: getConfigRechargeAmount() });
                firstRechargeCounter.add(1);
            }
        } else {
            console.error(`[BatchRegister] [VU${__VU}] ❌ 账号 ${userName} 注册失败`);
        }
    });

    // 注册完成后适当等待，避免瞬间冲击
    sleep(1);
}

/**
 * 格式化自定义总结报告 (表格形式)
 */
export function handleSummary(data) {
    const regSuccess = data.metrics.custom_reg_success ? data.metrics.custom_reg_success.values.count : 0;
    const firstRecharge = data.metrics.custom_first_recharge_total ? data.metrics.custom_first_recharge_total.values.count : 0;
    const doubleRecharge = data.metrics.custom_double_recharge_users ? data.metrics.custom_double_recharge_users.values.count : 0;

    const table = `
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                 📊 批量注册与充值测试汇总报告                ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 测试场景模式                  ┃ ${scenarioConfig.desc.padEnd(25)} ┃
┃ 🎫 当前使用邀请码                ┃ ${finalInviteCode.padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 注册成功总人数                ┃ ${String(regSuccess).padEnd(25)} ┃
┃ 💰 完成首充用户数                ┃ ${String(firstRecharge).padEnd(25)} ┃
┃ 🔄 执行双充用户数                ┃ ${String(doubleRecharge).padEnd(25)} ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📈 双充转化率                    ┃ ${((doubleRecharge / (regSuccess || 1)) * 100).toFixed(2)}%                  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
`;

    return {
        'stdout': table, // 将表格打印到控制台
    };
}

/**
 * 结束
 */
export function teardown(data) {
    // 基础清理或结束标志
}
