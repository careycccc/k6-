/**
 * 多租户多层级邀请测试脚本 (多线程分布式森林版)
 * 
 * 使用方法：
 * k6 run -e TENANT_ID=3004 -e ROOT_INVITE_CODE=CSQLLNN -e TOTAL_USERS=450 -e LEVELS=8 -e VUS=5 runInviteByTenantMultiThread.test.js

   k6 run -e TOTAL_USERS=200 -e LEVELS=5 -e VUS=15 k6/tests/api/invite/runInviteMultiThread.test.js

*/


import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../login/adminlogin.test.js';
import { phoneRegisterByInvite, emailRegisterByInvite } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getTenantConfig } from './tenantConfig.js';
import { updateUserAgentRebateMode } from './agentApi.js';

const totalUsers = parseInt(__ENV.TOTAL_USERS || '50', 10);
const levels = parseInt(__ENV.LEVELS || '3', 10);
// 计算 VUS 数量以确保深层树结构不会被压平
const subUsers = Math.max(1, totalUsers - 1);
const maxVus = Math.max(1, Math.floor(subUsers / levels));
let computedVus = Math.min(maxVus, 50);

// 允许用户通过环境变量强行指定线程数
if (__ENV.VUS) {
    computedVus = parseInt(__ENV.VUS, 10);
    // 更新 options 前进行日志警告，稍后会在 setup 中再次打印
}

export const options = {
    scenarios: {
        multi_thread_invite: {
            executor: 'per-vu-iterations',
            vus: computedVus,
            iterations: 1,
            maxDuration: '2h'
        }
    }
};

// ================= Utils =================

function extractToken(response) {
    if (!response) return null;
    if (response.data && response.data.token) return response.data.token;
    if (response.headers) {
        const auth = response.headers['Authorization'] || response.headers['authorization'];
        if (auth) return auth.replace(/^Bearer\s+/i, '').trim();
    }
    return null;
}

function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));

    const weights = [];
    for (let i = 0; i < levels; i++) {
        weights.push(((levels - i) / levels) * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));

    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

function randomPick(pool) {
    if (!pool || pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ================= Setup =================

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3004';
    console.log(`[Setup] 目标租户: ${tenantId}, 规划总人数: ${totalUsers}, 层级: ${levels}, 启动 VU: ${computedVus}`);

    const tenantConfig = getTenantConfig(tenantId);
    let rootInviteCode = __ENV.ROOT_INVITE_CODE || (tenantConfig ? tenantConfig.rootInviteCode : '');

    if (tenantId !== '3004') {
        const targetEnv = getEnvByTenantId(tenantId);
        if (targetEnv) Object.assign(ENV_CONFIG, targetEnv);
    }

    const adminToken = AdminLogin();
    if (!adminToken) throw new Error('管理员登录失败');

    const adminData = { token: adminToken, envConfig: ENV_CONFIG };

    // 如果没有提供根邀请码，则自动创建一个根节点
    if (!rootInviteCode) {
        console.log(`[Setup] 未提供 ROOT_INVITE_CODE，正在自动创建根节点...`);
        const phone = generateRandomPhone(ENV_CONFIG.COUNTRY_CODE || '91');
        const urls = { frontUrl: ENV_CONFIG.BASE_DESK_URL, adminUrl: ENV_CONFIG.BASE_ADMIN_URL, registerUrl: ENV_CONFIG.BASE_DESK_URL };
        let res = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', urls);
        const token = extractToken(res);
        sleep(1);
        const userInfo = getFrontUserInfo(token);
        if (userInfo && userInfo.inviteCode) {
            rootInviteCode = userInfo.inviteCode;
            console.log(`[Setup] ✅ 根节点创建成功: ${phone}, 邀请码: ${rootInviteCode}`);
        } else {
            throw new Error('根节点创建失败');
        }
    }

    return { adminToken, envConfig: ENV_CONFIG, rootInviteCode, tenantId };
}

// ================= VU 执行逻辑 =================

export default async function (data) {
    const { adminToken, envConfig, rootInviteCode, tenantId } = data;
    const vuId = exec.vu.idInInstance;

    if (tenantId !== '3004') Object.assign(ENV_CONFIG, envConfig);
    const adminData = { token: adminToken, envConfig };

    let myTotalUsers = Math.floor(subUsers / computedVus);
    if (vuId === computedVus) myTotalUsers += (subUsers % computedVus);

    const levelDistribution = distributePeople(myTotalUsers, levels);
    const inviteCodesByLevel = Array.from({ length: levels }, () => []);

    console.log(`[VU ${vuId}] 负责生成 ${myTotalUsers} 人，分布: ${JSON.stringify(levelDistribution)}`);

    const customUrls = {
        frontUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL,
        adminUrl: envConfig.BASE_ADMIN_URL,
        registerUrl: envConfig.INVITE_REGISTER_URL || envConfig.BASE_DESK_URL
    };

    const localReports = [];

    for (let currentLevel = 0; currentLevel < levelDistribution.length; currentLevel++) {
        const levelCount = levelDistribution[currentLevel];
        for (let i = 0; i < levelCount; i++) {
            let parentCode = currentLevel === 0 ? rootInviteCode : randomPick(inviteCodesByLevel[currentLevel - 1]);
            if (!parentCode && currentLevel > 0) parentCode = rootInviteCode;

            const phone = generateRandomPhone(envConfig.COUNTRY_CODE || '91');
            const res = phoneRegisterByInvite(phone, parentCode, adminData, 'qwer1234', '', customUrls);
            const token = extractToken(res);

            const reportEntry = {
                parentAccount: parentCode, // 近似记录，完整回溯在报表渲染
                childAccount: phone,
                inviteSuccess: false,
                rechargeAmount: 0,
                betAmount: 0,
                failedReason: '',
                inviteCode: '',
                parentInviteCode: parentCode
            };

            if (token) {
                sleep(0.5);
                const userInfo = getFrontUserInfo(token);
                if (userInfo && userInfo.inviteCode) {
                    inviteCodesByLevel[currentLevel].push(userInfo.inviteCode);
                    reportEntry.inviteCode = userInfo.inviteCode;

                    // 充值投注流程
                    sleep(1);
                    const rechargeAmount = getConfigRechargeAmount();
                    const rechargeResult = hybridRecharge({
                        userToken: token, adminToken, userId: userInfo.userId, amount: rechargeAmount, frontendFirst: true, remark: 'MultiThread Invite'
                    });

                    if (rechargeResult.success) {
                        reportEntry.rechargeAmount = rechargeResult.amount;
                        sleep(1);
                        const betResult = betRun(token, phone);
                        if (betResult) {
                            reportEntry.betAmount = betResult.amount || 0;
                            reportEntry.inviteSuccess = true;
                        } else {
                            reportEntry.failedReason = '投注失败';
                        }
                    } else {
                        reportEntry.failedReason = '充值失败';
                    }
                } else {
                    reportEntry.failedReason = '获取用户信息失败';
                }
            } else {
                reportEntry.failedReason = '注册失败';
            }

            localReports.push(reportEntry);
        }
    }

    // 在当前 VU 结束时，打印该 VU 生成的局部报表
    if (localReports.length > 0) {
        printInviteReport(localReports, rootInviteCode, vuId);
    }
}

// ================= 报表生成 =================

function printInviteReport(reports, rootInviteCode, vuId) {
    console.log(`\n========== [VU ${vuId}] 线程分布式测试报表 ==========`);

    const childrenCountMap = new Map();
    let totalRecharge = 0;
    let totalBet = 0;

    for (const r of reports) {
        if (r.parentInviteCode) {
            childrenCountMap.set(r.parentInviteCode, (childrenCountMap.get(r.parentInviteCode) || 0) + 1);
        }
        totalRecharge += r.rechargeAmount || 0;
        totalBet += r.betAmount || 0;
    }

    const getDisplayWidth = (str) => {
        let width = 0;
        const stringVal = String(str);
        for (let i = 0; i < stringVal.length; i++) width += stringVal.charCodeAt(i) > 255 ? 2 : 1;
        return width;
    };
    const padString = (str, targetWidth) => {
        const stringVal = String(str);
        const width = getDisplayWidth(stringVal);
        return width >= targetWidth ? stringVal : stringVal + ' '.repeat(targetWidth - width);
    };

    const headers = ['上级码', '下级账号', '是否成功', '充值金额', '投注金额', '失败原因', '下级数'];
    const rows = [];

    for (const r of reports) {
        rows.push([
            r.parentInviteCode || rootInviteCode,
            r.childAccount,
            r.inviteSuccess ? "是" : "否",
            r.rechargeAmount || "-",
            r.betAmount || "-",
            r.failedReason || "-",
            childrenCountMap.get(r.inviteCode) || 0
        ]);
    }

    const colWidths = headers.map(h => getDisplayWidth(h));
    for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
            const w = getDisplayWidth(row[i]);
            if (w > colWidths[i]) colWidths[i] = w;
        }
    }
    for (let i = 0; i < colWidths.length; i++) colWidths[i] += 2;

    let reportTable = "|";
    for (let i = 0; i < headers.length; i++) reportTable += ` ${padString(headers[i], colWidths[i])}|`;
    reportTable += "\n|";
    for (let i = 0; i < headers.length; i++) reportTable += `${'-'.repeat(colWidths[i] + 2)}|`;
    reportTable += "\n";

    for (const row of rows) {
        let rowStr = "|";
        for (let i = 0; i < row.length; i++) rowStr += ` ${padString(row[i], colWidths[i])}|`;
        reportTable += rowStr + "\n";
    }

    console.log(reportTable);
    console.log('\n========== 汇总统计 ==========');
    console.log(`总用户数: ${reports.length}`);
    console.log(`总充值额: ${totalRecharge}`);
    console.log(`总投注额: ${totalBet}`);
    console.log('===============================\n');
}
