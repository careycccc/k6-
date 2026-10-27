/**
 * FB广告分析 - 每日造数 k6脚本（配合 fbAdSeedRunner.js 使用）
 *
 * ⚠️ 账号落盘由 Node 包装器 fbAdSeedRunner.js 完成（k6 沙箱无法写文件）：
 *    - 账号完整记录打成标记行走 stdout：`##ACCT##<json>`
 *    - runner 收集后用 libs/common/ndjsonStore.js 合并写入 state/accounts_<tenantId>.ndjson
 *    - 读上一次状态用 open()（模块顶层，文件不存在时兜底成空数组——第一次跑还没有历史数据）
 *
 * 流程：
 *   1) 注册 USER_COUNT 个新账号：按权重分配广告组合(fbAdConfig.pickWeightedAdCombo)
 *      + D0充值目标档位(fbAdConfig.assignRechargeTargets)，走 facebookIdentityRegister
 *      (带 campaignId/adSetId/adId)，成功后按档位连续充值(hybridRecharge)。
 *   2) 老账号留存登录检查：遍历上一次状态里的账号，若 registerDate+N==今天 且
 *      N 不在 loginRetentionDone 里，命中则重新登录，更新 loginRetentionDone。
 *
 * 运行（推荐，见 fbAdSeedRunner.js）：
 *   node fbAdSeedRunner.js --tenant 3004 --user-count 10
 *
 * 参数（-e，由 runner 组装）：
 *   TENANT_ID / USER_COUNT / COUNTRY_CODE / PIXEL_ID / EVENT_CONFIG_ID / PACKAGE_NAME / VIA_RUNNER
 */

/* global open */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange } from '../../../libs/common/time.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { facebookIdentityRegister } from '../channel/facebookRegister.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge } from '../recharge/rechargeService.js';
import { loginByPasswordRetry } from '../common/auth.js';
import { pickWeightedAdCombo, assignRechargeTargets } from './fbAdConfig.js';

// ================= 参数（init 上下文） =================

const TENANT_ID = __ENV.TENANT_ID || '3004';
const USER_COUNT = parseInt(__ENV.USER_COUNT || '10', 10);
const COUNTRY_CODE = __ENV.COUNTRY_CODE || '91';

// 对应后台 fb419 渠道，照抄 channel_cmd.go facebookRegisterFn 的默认值
const PIXEL_ID = __ENV.PIXEL_ID || '2010850729480687';
const EVENT_CONFIG_ID = parseInt(__ENV.EVENT_CONFIG_ID || '200018', 10);
const PACKAGE_NAME = __ENV.PACKAGE_NAME || 'com.ar3004.fb.app';

const RECHARGE_AMOUNT_MIN = 2000;
const RECHARGE_AMOUNT_MAX = 5000;

// 留存登录档位，对齐原型图的留存天数
const LOGIN_RETENTION_DAY_MARKS = [1, 3, 5, 7, 15, 30, 60, 90];

const STATE_FILE = './state/accounts_' + TENANT_ID + '.ndjson';

// init 阶段读上一次状态（文件不存在时兜底为空数组——第一次跑还没有历史数据）
let PREV_ACCOUNTS = [];
try {
    PREV_ACCOUNTS = open(STATE_FILE)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line));
} catch (e) {
    console.warn(`[FbAdSeed] ⚠️ 读取本地状态 ${STATE_FILE} 失败（首次运行正常，否则检查路径）：${e.message}`);
}

export const options = {
    scenarios: {
        fbad_seed: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120m'
        }
    }
};

// ================= 工具 =================

function emitAcct(record) {
    console.log(`##ACCT##${JSON.stringify(record)}`);
}

/** YYYY-MM-DD 字符串加 n 天（纯 UTC 日期运算，照抄 retentionVerify.js 的 addDays） */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    const pad2 = v => String(v).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function getRandomAmount(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ================= 注册 + D0充值 =================

/**
 * 注册单个新账号并按目标档位完成 D0 充值，返回完整的本地状态记录（不含 success 字段的账号没有注册成功）。
 */
function seedOneAccount(adminToken, registerDate, rechargeTier) {
    const phone = generateRandomPhone(COUNTRY_CODE);
    const adCombo = pickWeightedAdCombo();

    const result = facebookIdentityRegister(phone, { token: adminToken }, {
        pixelId: PIXEL_ID,
        eventConfigId: EVENT_CONFIG_ID,
        packageName: PACKAGE_NAME,
        campaignId: adCombo.campaignId,
        adSetId: adCombo.adSetId,
        adId: adCombo.adId
    });

    if (!result || !result.data || !result.data.token) {
        console.error(`[FbAdSeed] ❌ 账号注册失败: ${phone}`);
        return null;
    }

    const token = result.data.token;
    // 注册响应是否直接带 userId 未经验证(项目里 channelInviteService.js 直接信任
    // data.userId，但 register.test.js 的 registerWithRetry 统一二次查询
    // getFrontUserInfo 才取 userId)——两边都试一下，不可靠时才多付一次查询代价。
    let userId = result.data.userId;
    if (!userId) {
        const info = getFrontUserInfo(token);
        userId = info && info.userId;
    }
    if (!userId) {
        console.error(`[FbAdSeed] ❌ 注册成功但拿不到userId: ${phone}`);
        return null;
    }
    console.log(`[FbAdSeed] ✅ 注册成功: ${phone} (userId=${userId}) 广告=${adCombo.campaignName} 目标档位=${rechargeTier}`);

    let d0RechargeCount = 0;
    let d0RechargeTotalAmount = 0;

    for (let i = 0; i < rechargeTier; i++) {
        if (i > 0) sleep(3);
        const amount = getRandomAmount(RECHARGE_AMOUNT_MIN, RECHARGE_AMOUNT_MAX);
        const rechargeResult = hybridRecharge({
            userToken: token,
            adminToken,
            userId,
            amount,
            frontendFirst: true,
            remark: `FbAdSeed-${i + 1}`
        });
        if (rechargeResult && rechargeResult.success) {
            d0RechargeCount++;
            d0RechargeTotalAmount += rechargeResult.amount;
        } else {
            console.warn(`[FbAdSeed] ⚠️ 第${i + 1}笔D0充值失败: ${phone}`);
            break;
        }
    }

    const now = new Date().toISOString();
    return {
        account: phone,
        password: 'qwer1234',
        userId,
        tenantId: TENANT_ID,
        registerDate,
        adCombo,
        d0RechargeCount,
        d0RechargeTotalAmount,
        d0Tier: rechargeTier,
        loginRetentionDone: [],
        createdAt: now,
        updatedAt: now
    };
}

// ================= 老账号留存登录检查 =================

function checkRetentionLogins(today) {
    if (PREV_ACCOUNTS.length === 0) {
        console.log('[FbAdSeed] 本地状态为空，跳过留存登录检查');
        return;
    }
    console.log(`[FbAdSeed] 开始留存登录检查，共 ${PREV_ACCOUNTS.length} 个历史账号`);

    for (const acc of PREV_ACCOUNTS) {
        const done = acc.loginRetentionDone || [];
        for (const n of LOGIN_RETENTION_DAY_MARKS) {
            const targetDate = addDays(acc.registerDate, n);
            if (targetDate !== today) continue;
            if (done.includes(n)) continue; // 幂等：同一天不重复登录同一个N

            const token = loginByPasswordRetry(acc.account, acc.password);
            if (!token) {
                console.warn(`[FbAdSeed] ⚠️ 留存登录失败(N=${n}): ${acc.account}`);
                break;
            }
            console.log(`[FbAdSeed] ✅ 留存登录成功(N=${n}): ${acc.account}`);
            const updated = {
                ...acc,
                loginRetentionDone: [...done, n],
                updatedAt: new Date().toISOString()
            };
            emitAcct(updated);
            sleep(1);
            break; // 一天最多命中一个 N，避免同一账号在同一天被判定出多个N(理论上不会同时命中两个不同N，这里是防御性break)
        }
    }
}

// ================= Setup / VU =================

export function setup() {
    console.log(`[FbAdSeed] ========== FB广告分析每日造数 租户=${TENANT_ID} 新增账号数=${USER_COUNT} ==========`);
    const envConfig = getEnvByTenantId(TENANT_ID) || ENV_CONFIG;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    const adminToken = tenantAdminLogin(TENANT_ID);
    if (!adminToken) throw new Error(`[FbAdSeed] ❌ 租户 ${TENANT_ID} 管理员登录失败`);
    console.log('[FbAdSeed] ✅ 管理员登录成功');

    if (!__ENV.VIA_RUNNER) {
        console.warn('[FbAdSeed] ⚠️ 直接 k6 run 不会写状态文件（沙箱限制），请用: node fbAdSeedRunner.js --tenant ' + TENANT_ID);
    }

    return { adminToken, envConfig, today: getDayRange(0, TENANT_ID).dateStr };
}

export default function (data) {
    const { adminToken, envConfig, today } = data;
    if (TENANT_ID !== '3004') Object.assign(ENV_CONFIG, envConfig);

    console.log(`[FbAdSeed] 今日日期(租户时区)=${today}`);

    // 1) 注册新账号 + D0充值
    const rechargeTargets = assignRechargeTargets(USER_COUNT);
    for (let i = 0; i < USER_COUNT; i++) {
        const record = seedOneAccount(adminToken, today, rechargeTargets[i]);
        if (record) emitAcct(record);
        sleep(1);
    }

    // 2) 老账号留存登录检查
    checkRetentionLogins(today);
}
