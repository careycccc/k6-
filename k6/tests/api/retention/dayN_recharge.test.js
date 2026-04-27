/**
 * 脚本②：第N天复充执行（纯执行，不含验证）
 * 查询N天前充值成功的用户，80%概率让其今天再次充值
 * 参与复充的用户遵循级联充值概率：90%充1次 → 50%充2次 → 20%充3次
 *
 * 使用方法：
 *   # 次日复充（查昨天的用户）
 *   k6 run -e TENANT_ID=3101 -e CHANNEL_PACKAGE_ID=100051 -e DAYS_AGO=1 dayN_recharge.test.js
 *
 *   # 3日复充场景的第3天（查前天的用户）
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=2 dayN_recharge.test.js
 *
 * 参数：
 *   TENANT_ID            租户ID（必需）
 *   CHANNEL_PACKAGE_ID   渠道来源ID（必需，不传直接报错）
 *   DAYS_AGO             查几天前的充值用户（默认1=昨天）
 *   PARTICIPATION_RATE   参与复充概率（默认0.8=80%）
 *   RECHARGE_STRATEGY    充值策略 single/double/triple/random（默认random）
 *                        random = 级联概率：90%充1次 → 50%充2次 → 20%充3次
 */

import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange } from './rechargeRetentionApi.js';
import {
    getRechargedUserIds,
    getUsersWithAccounts,
    batchRecharge
} from './retentionService.js';

const tenantId = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
const daysAgo = __ENV.DAYS_AGO ? parseInt(__ENV.DAYS_AGO) : 1;
const participationRate = __ENV.PARTICIPATION_RATE ? parseFloat(__ENV.PARTICIPATION_RATE) : 0.8;
const strategy = __ENV.RECHARGE_STRATEGY || 'random';
const channelPackageId = __ENV.CHANNEL_PACKAGE_ID ? parseInt(__ENV.CHANNEL_PACKAGE_ID) : null;

export const options = {
    scenarios: {
        day_n_recharge: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '120m'
        }
    }
};

// 全局统计
let _stats = null;
let _queryDateStr = '';
let _todayDateStr = '';

export function setup() {
    console.log(`[DayNRecharge] ========== 第N天复充执行 ==========`);
    console.log(`[DayNRecharge] 租户: ${tenantId}，查询 ${daysAgo} 天前的充值用户`);
    console.log(`[DayNRecharge] 参与率: ${participationRate * 100}%，策略: ${strategy}`);

    if (!channelPackageId) {
        throw new Error('[DayNRecharge] ❌ 未提供渠道来源，请通过 -e CHANNEL_PACKAGE_ID=xxx 传入');
    }
    console.log(`[DayNRecharge] 渠道来源: ${channelPackageId}`);

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error(`[DayNRecharge] ❌ 租户 ${tenantId} 管理员登录失败`);

    console.log(`[DayNRecharge] ✅ 管理员登录成功`);
    return { token: adminToken };
}

export default function (data) {
    const adminData = data;

    // 记录日期信息（用于报表）
    const queryRange = getDayRange(daysAgo, tenantId);
    const todayRange = getDayRange(0, tenantId);
    _queryDateStr = queryRange.dateStr;
    _todayDateStr = todayRange.dateStr;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 复充执行  租户: ${tenantId}`);
    console.log(`   查询日期: ${_queryDateStr}（${daysAgo} 天前）`);
    console.log(`   执行日期: ${_todayDateStr}（今天）`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. 查询N天前充值用户
    const userIds = getRechargedUserIds(adminData.token, tenantId, daysAgo, channelPackageId);

    if (userIds.length === 0) {
        console.warn(`[DayNRecharge] ⚠️ ${daysAgo} 天前无充值用户，脚本结束`);
        _stats = { total: 0, participating: 0, skipped: 0, loginSuccess: 0, loginFailed: 0, rechargeSuccess: 0, rechargeFailed: 0, totalAmount: 0, singleRechargeUsers: 0, doubleRechargeUsers: 0 };
        return;
    }

    // 2. 批量获取账号
    const userList = getUsersWithAccounts(adminData.token, userIds);

    if (userList.length === 0) {
        console.warn(`[DayNRecharge] ⚠️ 获取账号失败，脚本结束`);
        _stats = { total: userIds.length, participating: 0, skipped: userIds.length, loginSuccess: 0, loginFailed: 0, rechargeSuccess: 0, rechargeFailed: 0, totalAmount: 0, singleRechargeUsers: 0, doubleRechargeUsers: 0 };
        return;
    }

    // 3. 批量复充（80%参与率）
    _stats = batchRecharge(userList, adminData, {
        strategy,
        participationRate,
        delayBetweenUsers: 3
    });
}

export function handleSummary() {
    if (!_stats) {
        return { stdout: '\n[DayNRecharge] 无统计数据\n' };
    }

    const rate = _stats.total > 0
        ? ((_stats.rechargeSuccess / _stats.total) * 100).toFixed(2)
        : '0.00';

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃                    📊 复充执行报表                           ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 执行日期                         ┃ ${_todayDateStr.padEnd(25)} ┃`,
        `┃ 查询日期 (${daysAgo} 天前)            ┃ ${_queryDateStr.padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 查询日充值用户总数               ┃ ${String(_stats.total).padEnd(25)} ┃`,
        `┃ 参与复充用户数 (${(participationRate * 100).toFixed(0)}%)          ┃ ${String(_stats.participating).padEnd(25)} ┃`,
        `┃ 跳过用户数                       ┃ ${String(_stats.skipped).padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 登录成功数                       ┃ ${String(_stats.loginSuccess).padEnd(25)} ┃`,
        `┃ 登录失败数                       ┃ ${String(_stats.loginFailed).padEnd(25)} ┃`,
        `┃ 充值成功数                       ┃ ${String(_stats.rechargeSuccess).padEnd(25)} ┃`,
        `┃ 充值失败数                       ┃ ${String(_stats.rechargeFailed).padEnd(25)} ┃`,
        `┃ 单次充值用户                     ┃ ${String(_stats.singleRechargeUsers).padEnd(25)} ┃`,
        `┃ 双次充值用户                     ┃ ${String(_stats.doubleRechargeUsers).padEnd(25)} ┃`,
        `┃ 三次充值用户                     ┃ ${String(_stats.tripleRechargeUsers || 0).padEnd(25)} ┃`,
        `┃ 总充值金额                       ┃ ${String(_stats.totalAmount.toFixed(2)).padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 实际复充率 (成功/总数)           ┃ ${(rate + '%').padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];

    return { stdout: lines.join('\n') };
}
