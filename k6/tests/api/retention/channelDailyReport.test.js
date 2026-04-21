/**
 * 渠道今日新增会员充值分析报表
 *
 * 功能：
 *   1. 查询指定渠道今日新增注册会员列表
 *   2. 查询今日该渠道充值成功订单
 *   3. 交叉分析：哪些新增会员进行了充值，充值几次，充值金额
 *   4. 输出统计报表
 *
 * 使用方法：
 *   k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 channelDailyReport.test.js
 *
 * 参数：
 *   TENANT_ID            租户ID（必需）
 *   CHANNEL_PACKAGE_ID   渠道来源ID（必需，不传直接报错）
 */

import { sleep } from 'k6';
import { tenantAdminLogin } from '../../../libs/http/tenantRequest.js';
import { sendRequest } from '../common/request.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';
import { getDayRange, fetchAllRechargeOrders } from './rechargeRetentionApi.js';
import { getTimeRandom } from '../../utils/utils.js';

const tenantId         = __ENV.TENANT_ID || String(ENV_CONFIG.TENANTID);
const channelPackageId = __ENV.CHANNEL_PACKAGE_ID ? parseInt(__ENV.CHANNEL_PACKAGE_ID) : null;

export const options = {
    scenarios: {
        channel_report: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '30m'
        }
    }
};

export function setup() {
    if (!channelPackageId) {
        throw new Error('[ChannelReport] ❌ 未提供渠道来源，请通过 -e CHANNEL_PACKAGE_ID=xxx 传入');
    }

    console.log(`[ChannelReport] ========== 渠道今日新增会员充值分析 ==========`);
    console.log(`[ChannelReport] 租户: ${tenantId}，渠道: ${channelPackageId}`);

    const adminToken = tenantAdminLogin(tenantId);
    if (!adminToken) throw new Error(`[ChannelReport] ❌ 租户 ${tenantId} 管理员登录失败`);

    console.log(`[ChannelReport] ✅ 管理员登录成功`);
    return { token: adminToken };
}

// ============================================================
// 步骤1：查询今日新增会员（支持翻页）
// ============================================================
function fetchTodayNewUsers(adminToken, startTime, endTime) {
    const api = '/api/Users/GetPageList';
    const tag = 'GetUserPageList';
    const allUsers = [];
    let pageNo = 1;
    let totalCount = null;

    console.log(`[ChannelReport] 查询今日新增会员: ${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`);

    while (true) {
        const timeData = getTimeRandom();
        const payload = {
            packageId: channelPackageId,
            registerBeginTime: startTime,
            registerEndTime: endTime,
            pageNo: pageNo,
            pageSize: 500,
            orderBy: 'Desc',
            language: timeData.language,
            random: timeData.random,
            timestamp: timeData.timestamp
        };

        const response = sendRequest(payload, api, tag, false, adminToken);

        if (!response) {
            console.error(`[ChannelReport] 第 ${pageNo} 页用户列表请求失败`);
            break;
        }

        const data = response.data ? response.data : response;
        const list = data.list || [];
        allUsers.push(...list);

        if (pageNo === 1) {
            totalCount = data.totalCount || 0;
            console.log(`[ChannelReport] 今日新增会员总数: ${totalCount}，本页获取: ${list.length}`);
        } else {
            console.log(`[ChannelReport] 第 ${pageNo} 页获取: ${list.length} 条`);
        }

        const totalPage = data.totalPage || Math.ceil(totalCount / 500);
        if (pageNo >= totalPage || list.length === 0) break;

        pageNo++;
        sleep(0.5);
    }

    return allUsers;
}

// ============================================================
// 主函数
// ============================================================
export default function (data) {
    const adminToken = data.token;
    const todayRange = getDayRange(0, tenantId);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 渠道今日分析  租户: ${tenantId}  渠道: ${channelPackageId}`);
    console.log(`   统计日期: ${todayRange.dateStr}`);
    console.log(`${'='.repeat(60)}\n`);

    // ── 步骤1：查询今日新增会员 ──────────────────────────────
    const newUsers = fetchTodayNewUsers(adminToken, todayRange.startTime, todayRange.endTime);

    if (!newUsers || newUsers.length === 0) {
        console.warn(`[ChannelReport] ⚠️ 该渠道今日无新增用户，报告结束`);
        console.log(buildEmptyReport(todayRange.dateStr));
        return;
    }

    // 提取 userId Set
    const newUserIds = new Set(newUsers.map(u => String(u.userId)));
    console.log(`[ChannelReport] 今日新增会员: ${newUserIds.size} 人`);

    // ── 步骤2：查询今日充值订单 ──────────────────────────────
    console.log(`[ChannelReport] 查询今日充值订单...`);
    const orders = fetchAllRechargeOrders(adminToken, todayRange.startTime, todayRange.endTime, 'Payed', channelPackageId);

    // ── 步骤3：交叉分析 ──────────────────────────────────────
    // 按 userId 聚合充值数据
    const rechargeMap = new Map(); // userId -> { count, totalAmount }
    for (const order of orders) {
        const uid = String(order.userId);
        if (!rechargeMap.has(uid)) {
            rechargeMap.set(uid, { count: 0, totalAmount: 0 });
        }
        const entry = rechargeMap.get(uid);
        entry.count++;
        entry.totalAmount += order.amount || 0;
    }

    // 筛选出新增会员中有充值的
    const rechargedNewUsers = [];
    for (const uid of newUserIds) {
        if (rechargeMap.has(uid)) {
            rechargedNewUsers.push({
                userId: uid,
                count: rechargeMap.get(uid).count,
                totalAmount: rechargeMap.get(uid).totalAmount
            });
        }
    }

    // 按充值总额降序
    rechargedNewUsers.sort((a, b) => b.totalAmount - a.totalAmount);

    // 统计
    const totalRechargeAmount = rechargedNewUsers.reduce((s, u) => s + u.totalAmount, 0);
    const singleRechargeUsers = rechargedNewUsers.filter(u => u.count === 1);
    const singleRechargeAmount = singleRechargeUsers.reduce((s, u) => s + u.totalAmount, 0);

    // ── 输出报表 ─────────────────────────────────────────────
    console.log(buildReport({
        dateStr: todayRange.dateStr,
        newUserCount: newUserIds.size,
        rechargedCount: rechargedNewUsers.length,
        totalRechargeAmount,
        singleRechargeCount: singleRechargeUsers.length,
        singleRechargeAmount,
        detail: rechargedNewUsers
    }));
}

// ============================================================
// 报表构建
// ============================================================
function buildReport({ dateStr, newUserCount, rechargedCount, totalRechargeAmount, singleRechargeCount, singleRechargeAmount, detail }) {
    const rechargeRate = newUserCount > 0 ? ((rechargedCount / newUserCount) * 100).toFixed(2) : '0.00';

    const lines = [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃              📊 渠道今日新增会员充值分析报表                 ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 渠道来源ID                       ┃ ${String(channelPackageId).padEnd(25)} ┃`,
        `┃ 统计日期                         ┃ ${dateStr.padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 今日新增会员数                   ┃ ${String(newUserCount).padEnd(25)} ┃`,
        `┃ 今日有充值会员数                 ┃ ${String(rechargedCount).padEnd(25)} ┃`,
        `┃ 首充转化率                       ┃ ${(rechargeRate + '%').padEnd(25)} ┃`,
        `┃ 今日充值总额                     ┃ ${totalRechargeAmount.toFixed(2).padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 仅充值1次会员数                  ┃ ${String(singleRechargeCount).padEnd(25)} ┃`,
        `┃ 仅充值1次总额                    ┃ ${singleRechargeAmount.toFixed(2).padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        ''
    ];

    if (detail.length > 0) {
        lines.push('  📋 充值会员明细（按充值总额降序）');
        lines.push('  ' + '─'.repeat(56));
        lines.push(`  ${'userId'.padEnd(16)} ${'充值次数'.padEnd(10)} ${'充值总额'.padEnd(16)} 备注`);
        lines.push('  ' + '─'.repeat(56));
        for (const r of detail) {
            const note = r.count === 1 ? '首充' : `${r.count}次`;
            lines.push(`  ${String(r.userId).padEnd(16)} ${String(r.count).padEnd(10)} ${r.totalAmount.toFixed(2).padEnd(16)} ${note}`);
        }
        lines.push('  ' + '─'.repeat(56));
    } else {
        lines.push('  （今日新增会员暂无充值记录）');
    }

    lines.push('');
    return lines.join('\n');
}

function buildEmptyReport(dateStr) {
    return [
        '',
        '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
        '┃              📊 渠道今日新增会员充值分析报表                 ┃',
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 租户ID                           ┃ ${String(tenantId).padEnd(25)} ┃`,
        `┃ 渠道来源ID                       ┃ ${String(channelPackageId).padEnd(25)} ┃`,
        `┃ 统计日期                         ┃ ${dateStr.padEnd(25)} ┃`,
        '┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫',
        `┃ 今日新增会员数                   ┃ ${'0'.padEnd(25)} ┃`,
        '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛',
        '',
        '  ⚠️  该渠道今日暂无新增用户',
        ''
    ].join('\n');
}

export function handleSummary() {
    // 报表已在 default 函数里通过 console.log 输出
    return { stdout: '' };
}
