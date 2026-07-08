import { sleep } from 'k6';
import exec from 'k6/execution';
import { AdminLogin } from '../../login/adminlogin.test.js';
import { getAllRelatedUserIds, updateUserAgentRebateMode } from '../../invite/agentApi.js';
import { batchGetUserAccounts, autoLoginByAccount } from '../../user/userAccountApi.js';
import { hybridRecharge, getConfigRechargeAmount } from '../../recharge/rechargeService.js';
import { betRun } from '../../runbet/betRun.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../../config/envconfig.js';

export const options = {
    scenarios: {
        action: {
            executor: 'per-vu-iterations',
            vus: parseInt(__ENV.VUS || '10', 10),
            iterations: 1,
            maxDuration: '2h',
        },
    },
};

export function setup() {
    const tenantId = __ENV.TENANT_ID || '3006';
    const adminToken = AdminLogin();
    const envConfig = getEnvByTenantId(tenantId);
    
    const rootId = parseInt(__ENV.ROOT_ID);
    console.log(`\n[Setup] 获取 ${__ENV.TEAM_NAME} 全树名单 (ROOT_ID: ${rootId}) ...`);
    const userIds = getAllRelatedUserIds(adminToken, rootId);
    console.log(`[Setup] ${__ENV.TEAM_NAME} 共找到 ${userIds.length} 名成员`);
    
    return { token: adminToken, envConfig, userIds };
}

export default function (data) {
    const tenantId = __ENV.TENANT_ID || '3006';
    if (tenantId !== '3004') Object.assign(ENV_CONFIG, data.envConfig);
    const adminData = { token: data.token, envConfig: data.envConfig };

    const inactiveRate = parseFloat(__ENV.INACTIVE_RATE || '0');
    const rechargeOnlyRate = parseFloat(__ENV.RECHARGE_ONLY_RATE || '0');
    const rebateChance = 0.2; // 随机设置返佣几率
    
    const allIds = data.userIds || [];
    const totalVUs = parseInt(__ENV.VUS || '10', 10);
    const vuId = exec.vu.idInInstance - 1; // 0-based
    
    const chunkSize = Math.ceil(allIds.length / totalVUs);
    const myIds = allIds.slice(vuId * chunkSize, (vuId + 1) * chunkSize);
    
    if (myIds.length === 0) return; // 本 VU 没有分到任务
    
    console.log(`[VU-${vuId+1}] 开始处理 ${__ENV.TEAM_NAME} 团队中分配到的 ${myIds.length} 个用户...`);
    
    // 步骤1：按概率分配行为
    const rechargeOnlyIds = [];
    const activeIds = [];
    
    for (const uid of myIds) {
        const rand = Math.random();
        if (rand < inactiveRate) {
            // 跳过，什么都不干
        } else if (rand < inactiveRate + rechargeOnlyRate) {
            rechargeOnlyIds.push(uid);
        } else {
            activeIds.push(uid);
        }
        
        // 随机设置返佣模式 (为了测试覆盖率)
        if (Math.random() < rebateChance) {
            updateUserAgentRebateMode(adminData.token, uid, Math.floor(Math.random() * 2) + 1, Math.floor(Math.random() * 6) + 1);
        }
    }
    
    // 人群三段式划分对账：不活跃 / 只充值 / 充投(充值+投注)。充投=剩余项。
    const inactiveCount = myIds.length - rechargeOnlyIds.length - activeIds.length;
    console.log(`[VU-${vuId+1}] ${__ENV.TEAM_NAME} 人群划分(本VU ${myIds.length}人): 不活跃=${inactiveCount} | 只充值=${rechargeOnlyIds.length} | 充投=${activeIds.length}  (配置比例 不活跃=${inactiveRate}/只充值=${rechargeOnlyRate}/充投=${(1 - inactiveRate - rechargeOnlyRate).toFixed(2)})`);

    const processIds = [...rechargeOnlyIds, ...activeIds];
    if (processIds.length === 0) {
        console.log(`[VU-${vuId+1}] 所有用户都是不活跃，跳过`);
        return;
    }
    
    // 步骤2：批量获取账号并自动登录充投
    // 每次查 50 个避免批量查接口卡死
    let loginFail = 0, rechargeOk = 0, rechargeFail = 0, betOk = 0, betFail = 0;
    for (let j = 0; j < processIds.length; j += 50) {
        const batchIds = processIds.slice(j, j + 50);
        const accounts = batchGetUserAccounts(adminData.token, batchIds, 500);

        const rechargeOnlySet = new Set(rechargeOnlyIds.map(String));

        for (const acc of accounts) {
            const token = autoLoginByAccount(acc.account, adminData.token);
            if (!token) { loginFail++; continue; }

            const isRechargeOnly = rechargeOnlySet.has(String(acc.userId));

            // 充值 (模拟随机双充)
            const randCount = Math.random();
            const rc = randCount < 0.6 ? 1 : randCount < 0.9 ? 2 : 3;
            let success = false;

            for (let i = 0; i < rc; i++) {
                if (i > 0) sleep(1);
                const amt = getConfigRechargeAmount();
                const res = hybridRecharge({
                    userToken: token, adminToken: adminData.token, userId: acc.userId, amount: amt, frontendFirst: true
                });
                if (res.success) success = true;
            }
            if (success) { rechargeOk++; } else { rechargeFail++; continue; } // 充值都失败就没法投注

            // 投注（充投人群才投）
            if (!isRechargeOnly) {
                sleep(1);
                const betRes = betRun(token, acc.account);
                if (betRes) betOk++; else betFail++;
            }
        }
    }

    // 处理结果对账：能看出"充投"用户到底卡在 登录/充值/投注 哪一步
    console.log(`[VU-${vuId+1}] ${__ENV.TEAM_NAME} 处理结果: 登录失败=${loginFail} | 充值成功=${rechargeOk}(失败${rechargeFail}) | 投注成功=${betOk}(失败${betFail}) | 本VU充投目标=${activeIds.length}`);
}
