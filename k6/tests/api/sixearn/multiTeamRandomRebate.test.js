/**
 * 多团队全随机无转线返佣测试模式
 * 
 * 测试场景：
 * 1. 动态创建多个团队（不进行跨团队转线操作）
 * 2. 按 V2 比例划分活跃/只充值/不活跃下级成员
 * 3. 活跃成员进行随机 1-3 次充值、打码投注、最终执行提现（自动过机审）
 * 4. 生成精简版报表
 * 
 * 使用方法：每个团队的总人数和总层级一样
 * k6 run -e TENANT_ID=3006 -e TEAM_COUNT=2 -e TEAM_TOTAL=5000 -e TEAM_LEVELS=120 multiTeamRandomRebate.test.js
 * 
 * 每个团队的人数和总层级可以不一样
 * k6 run -e TENANT_ID=3006 -e TEAM_COUNT=2 -e TEAM1_TOTAL=2000 -e TEAM1_LEVELS=59 -e TEAM2_TOTAL=4000 -e TEAM2_LEVELS=78 multiTeamRandomRebate.test.js
 * 
 * # 多租户 + 混合团队规模
 * # 团队1 是 10人2级
 * # 团队2 是 80人6级
 * # 团队3 和 团队4 没有单独指定，就会自动使用默认的 20人3级
 * k6 run -e TENANT_ID=3101 -e TEAM_COUNT=4 \
 *   -e TEAM_TOTAL=20 -e TEAM_LEVELS=3 \
 *   -e TEAM1_TOTAL=10 -e TEAM1_LEVELS=2 \
 *   -e TEAM2_TOTAL=80 -e TEAM2_LEVELS=6 \
 *   multiTeamRandomRebate.test.js
 *
 */

import { sleep } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { runMultiLevelInvite } from '../invite/inviteService.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGeneratorFaker.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../user/userAccountApi.js';
import { hybridRecharge, getConfigRechargeAmount } from '../recharge/rechargeService.js';
import { betRun } from '../runbet/betRun.js';
import { addAllWallets } from '../withdraw/addWalletApi.js';
import { getWithdrawBasicInfo, setWithdrawPassword } from '../withdraw/withdrawApi.js';
import { executeWithdrawCase } from '../withdraw/withdraw.test.js';
import { runBackendWithdrawApproval } from '../withdraw/backendWithdrawApi.js';

export const options = {
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '24h'
    }
  }
};

function distributePeople(totalPeople, levels) {
  if (levels <= 0 || totalPeople <= 0) return [];
  if (levels === 1) return [totalPeople];
  if (levels >= totalPeople) return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
  const weights = [];
  for (let i = 0; i < levels; i++) {
    const base = (levels - i) / levels;
    weights.push(base * (0.5 + Math.random()));
  }
  weights.sort((a, b) => b - a);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const result = weights.map((w) => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));
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

function registerRootAgent(adminData, teamName) {
  console.log(`\n[${teamName}] 开始注册总代...`);
  const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
  const phone = generateRandomPhone(countryCode);
  let registerResult = phoneRegister(phone, adminData, 'qwer1234', '', null);
  if (!registerResult || !registerResult.data) {
    const inviteUrl = adminData.envConfig.INVITE_REGISTER_URL || adminData.envConfig.BASE_DESK_URL;
    const inviteUrls = { frontUrl: inviteUrl, adminUrl: adminData.envConfig.BASE_ADMIN_URL, registerUrl: inviteUrl };
    registerResult = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', inviteUrls);
  }
  if (!registerResult || !registerResult.data) {
    console.warn(`[${teamName}] ⚠️ 总代注册失败，跳过该团队`);
    return null;
  }
  let token = null;
  if (registerResult.headers && registerResult.headers.Authorization) token = registerResult.headers.Authorization.replace('Bearer ', '').trim();
  else if (registerResult.data && registerResult.data.token) token = registerResult.data.token;
  if (!token) {
    console.warn(`[${teamName}] ⚠️ 未能获取到token，跳过该团队`);
    return null;
  }
  sleep(1);
  const userInfo = getFrontUserInfo(token);
  if (!userInfo || !userInfo.inviteCode) {
    console.warn(`[${teamName}] ⚠️ 未能获取到邀请码，跳过该团队`);
    return null;
  }
  console.log(`[${teamName}] ✅ 总代注册成功 UserID: ${userInfo.userId}, InviteCode: ${userInfo.inviteCode}`);
  return { userId: userInfo.userId, inviteCode: userInfo.inviteCode, token: token, phone: phone };
}

const teamReports = [];

export default function () {
  console.log('====== 多团队全随机无转线测试模式 ======');

  const token = AdminLogin();
  if (!token) {
    console.error('管理员登录失败');
    return;
  }
  const adminData = { token: token };

  const tenantId = __ENV.TENANT_ID || '3004';
  const tenantConfig = getEnvByTenantId(tenantId);
  adminData.envConfig = tenantConfig || ENV_CONFIG;

  const teamCount = parseInt(__ENV.TEAM_COUNT || '3');
  const defaultTotal = parseInt(__ENV.TEAM_TOTAL || '10');
  const defaultLevels = parseInt(__ENV.TEAM_LEVELS || '3');

  const inactiveRate = parseFloat(__ENV.INACTIVE_RATE || '0.2');
  const rechargeOnlyRate = parseFloat(__ENV.RECHARGE_ONLY_RATE || '0.2');
  const activeRate = Math.max(0, 1 - inactiveRate - rechargeOnlyRate);

  console.log(`配置: ${teamCount}个团队, V2分层 (不活跃:${inactiveRate}, 只充值:${rechargeOnlyRate}, 活跃:${activeRate})`);

  for (let t = 1; t <= teamCount; t++) {
    const teamName = `Team_${t}`;
    const total = parseInt(__ENV[`TEAM${t}_TOTAL`] || defaultTotal);
    const levels = parseInt(__ENV[`TEAM${t}_LEVELS`] || defaultLevels);

    const root = registerRootAgent(adminData, teamName);
    if (!root) {
      console.warn(`[${teamName}] ⚠️ 总代注册失败，跳过该团队`);
      continue;
    }
    const distribution = distributePeople(total, levels);
    console.log(`[${teamName}] 层级分配:`, distribution);

    const tConfig = {
      tenantId: tenantConfig.TENANTID,
      frontUrl: tenantConfig.BASE_DESK_URL,
      adminUrl: tenantConfig.BASE_ADMIN_URL,
      registerApiUrl: tenantConfig.INVITE_REGISTER_URL
    };

    // 执行团队注册和构建（内部会控制是否充值）
    runMultiLevelInvite(root.inviteCode, distribution, adminData, tConfig, false, 0);
    sleep(2);

    const members = getAgentHierarchyList(adminData.token, root.userId);
    if (!members || members.length === 0) {
      console.error(`[${teamName}] 无法获取下级列表`);
      continue;
    }

    // 排除总代自身
    const memberIds = members.filter((m) => m.userId !== root.userId).map((m) => m.userId);
    const accountsInfo = batchGetUserAccounts(adminData.token, memberIds, 500);

    const hierarchyMap = {};
    members.forEach((m) => { hierarchyMap[m.userId] = m.hierarchy || 1; });

    console.log(`\n[${teamName}] 开始执行随机行为...`);

    for (const accountInfo of accountsInfo) {
      const userId = accountInfo.userId;
      const hierarchy = hierarchyMap[userId];

      const rand = Math.random();
      let group = 'active';
      if (rand < inactiveRate) group = 'inactive';
      else if (rand < inactiveRate + rechargeOnlyRate) group = 'rechargeOnly';

      console.log(`\n[${teamName}] 成员 UID=${userId} 分配组别: ${group}`);

      let totalRecharge = 0;
      let totalBet = 0;
      let totalWithdraw = 0;

      if (group !== 'inactive') {
        const userToken = autoLoginByAccount(accountInfo.account, adminData.token);
        if (!userToken) continue;

        const rechargeCount = Math.random() < 0.6 ? 1 : Math.random() < 0.9 ? 2 : 3;
        for (let i = 0; i < rechargeCount; i++) {
          const amount = getConfigRechargeAmount();
          const res = hybridRecharge({
            userToken, adminToken: adminData.token, userId, amount, frontendFirst: true, remark: 'RandomRebate Recharge'
          });
          if (res.success) totalRecharge += res.amount;
          sleep(1);
        }

        if (group === 'active' && totalRecharge > 0) {
          const betRes = betRun(userToken, accountInfo.account);
          if (betRes) totalBet += (betRes.amount || 0);
          sleep(2);

          if (totalBet > 0) {
            console.log(`[${teamName}] 成员 UID=${userId} 开始提现流程...`);
            addAllWallets(adminData.token, userId);
            setWithdrawPassword(userToken, '123456');
            const withdrawInfo = getWithdrawBasicInfo(userToken);
            if (withdrawInfo && withdrawInfo.balance > 0) {
              const wRes = executeWithdrawCase(userToken, withdrawInfo.balance, withdrawInfo);
              if (wRes && wRes.withDrawaAmont) {
                totalWithdraw += wRes.withDrawaAmont;
                sleep(2);
                runBackendWithdrawApproval(adminData.token, userId, wRes.withDrawaType, wRes.withDrawaAmont);
              }
            }
          }
        }
      }

      teamReports.push({
        team: teamName,
        userId: userId,
        level: hierarchy,
        recharge: totalRecharge,
        bet: totalBet,
        withdraw: totalWithdraw
      });
    }
  }

  console.log('\n\n========================================================================');
  console.log('======================== 最终报表 (多团队随机模式) ========================');
  console.log('========================================================================');
  console.log(`| ${'UserID'.padEnd(10)} | ${'层级'.padEnd(4)} | ${'充值总额'.padEnd(10)} | ${'投注总额'.padEnd(10)} | ${'提现总额'.padEnd(10)} |`);
  console.log('|------------|------|------------|------------|------------|');
  for (const r of teamReports) {
    console.log(`| ${String(r.userId).padEnd(10)} | ${String(r.level).padEnd(4)} | ${String(r.recharge).padEnd(10)} | ${String(r.bet).padEnd(10)} | ${String(r.withdraw).padEnd(10)} |`);
  }
  console.log('========================================================================\n');
}
