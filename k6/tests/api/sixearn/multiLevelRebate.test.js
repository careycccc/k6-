/**
 * 多级返佣流程测试
 * 
 * 测试场景：
 * 1. 创建两个团队（团队1和团队2）
 * 2. 团队1进行充值投注
 * 3. 团队2只进行下级绑定（不充值投注）
 * 4. 等待5秒后，团队1的某个下级解绑并绑定到团队2
 * 5. 等待2秒后，团队2进行充值投注
 * 6. 等待3秒后，团队2的某个下级解绑并绑定到团队1
 * 7. 注意只有团队2进行充值投注的时候才会有一定的几率把成员加入到特殊/固定的返佣中
 * 
 * 使用方法：
 * k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=2 multiLevelRebate.test.js

# 默认模式（不变）
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=2 multiLevelRebate.test.js

# 团队1使用 V2 模式
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM1_MODE=v2 -e TEAM1_INACTIVE_RATE=0.2 -e TEAM1_RECHARGE_ONLY_RATE=0.2 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=2 \
  multiLevelRebate.test.js

# 团队2使用 V2 模式
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=2 \
  -e TEAM2_MODE=v2 -e TEAM2_INACTIVE_RATE=0.3 -e TEAM2_RECHARGE_ONLY_RATE=0.1 \
  multiLevelRebate.test.js

# 两个团队都用 V2
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 -e TEAM1_MODE=v2 -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=2 -e TEAM2_MODE=v2 multiLevelRebate.test.js
 

*/

import { sleep } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { phoneRegister, phoneRegisterByInvite } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { runMultiLevelInvite, runMultiLevelInviteV2 } from '../invite/inviteService.js';
import { runTeamRechargeAndBet, runTeamRechargeAndBetV2 } from '../invite/teamRechargeAndBet.js';
import { bundEarn } from './bundearn.test.js';
import { getEnvByTenantId, ENV_CONFIG } from '../../../config/envconfig.js';
import { snapshotL1Members, runAgentL3ValidationWithOriginalTeam } from '../agentL3/agentL3Validation.js';

/**
 * 将总人数按层级递减地随机分配
 * @param {number} totalPeople - 总人数
 * @param {number} levels - 层级数
 * @returns {number[]} 每层人数数组（降序）
 */
function distributePeople(totalPeople, levels) {
    // ========== 边界处理 ==========
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];

    // 层级数 >= 总人数时，前面每层1人，后面0人
    if (levels >= totalPeople) {
        return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));
    }

    // ========== 1. 生成随机递减权重 ==========
    const weights = [];
    for (let i = 0; i < levels; i++) {
        // 基础权重随层级递减，乘以随机因子增加变化
        const base = (levels - i) / levels;
        weights.push(base * (0.5 + Math.random())); // 随机因子 0.5~1.5
    }

    // 确保权重为降序
    weights.sort((a, b) => b - a);

    // ========== 2. 按权重比例分配人数 ==========
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    // 先用 floor 取整，保证每层至少 1 人
    const result = weights.map(w =>
        Math.max(1, Math.floor((w / totalWeight) * totalPeople))
    );

    // ========== 3. 修正总数，确保总和 === totalPeople ==========
    let diff = totalPeople - result.reduce((sum, n) => sum + n, 0);

    // 人数不够 → 从前往后补（优先补给高层级）
    while (diff > 0) {
        for (let i = 0; i < levels && diff > 0; i++) {
            result[i]++;
            diff--;
        }
    }

    // 人数多了 → 从后往前减（优先减最低层级，但不减到 0）
    while (diff < 0) {
        for (let i = levels - 1; i >= 0 && diff < 0; i--) {
            if (result[i] > 1) {
                result[i]--;
                diff++;
            }
        }
    }

    // 最终排序保证降序输出
    result.sort((a, b) => b - a);

    return result;
}

/**
 * 注册总代并获取邀请码
 * @param {object} adminData - 管理员数据
 * @param {string} teamName - 团队名称
 * @returns {object} { userId, inviteCode, token, phone }
 */
function registerRootAgent(adminData, teamName) {
    console.log(`\n[${teamName}] 开始注册总代...`);

    const countryCode = adminData.envConfig.COUNTRY_CODE || '91';
    const phone = generateRandomPhone(countryCode);
    console.log(`[${teamName}] 生成手机号: ${phone} (区号: ${countryCode})`);

    // 策略1：优先用普通注册 (codeType=1) via BASE_DESK_URL
    // BASE_DESK_URL 的 SMS 通道稳定，且总代注册不需要邀请码
    const deskUrls = {
        frontUrl: adminData.envConfig.BASE_DESK_URL,
        adminUrl: adminData.envConfig.BASE_ADMIN_URL,
        registerUrl: adminData.envConfig.BASE_DESK_URL
    };

    console.log(`[${teamName}] 策略1: 普通注册 (codeType=1) via ${deskUrls.frontUrl}`);
    let registerResult = phoneRegister(phone, adminData, 'qwer1234', '', null);

    // 策略2：如果普通注册失败（租户关闭了 codeType=1），降级到邀请注册域名
    if (!registerResult || !registerResult.data) {
        const inviteUrl = adminData.envConfig.INVITE_REGISTER_URL || adminData.envConfig.BASE_DESK_URL;
        const inviteUrls = {
            frontUrl: inviteUrl,
            adminUrl: adminData.envConfig.BASE_ADMIN_URL,
            registerUrl: inviteUrl
        };
        console.log(`[${teamName}] 策略2: 邀请注册域名 (codeType=19) via ${inviteUrl}`);
        registerResult = phoneRegisterByInvite(phone, '', adminData, 'qwer1234', '', inviteUrls);
    }

    if (!registerResult || !registerResult.data) {
        throw new Error(`[${teamName}] 总代注册失败`);
    }

    // 检查注册是否成功
    const statusCode = registerResult.code !== undefined ? registerResult.code : registerResult.msgCode;
    if (statusCode !== 0) {
        throw new Error(`[${teamName}] 总代注册失败：${registerResult.msg}`);
    }

    // 从多个位置尝试获取 token
    let token = null;

    // 尝试从多个位置获取 token
    if (registerResult.headers && registerResult.headers.Authorization) {
        token = registerResult.headers.Authorization.replace('Bearer ', '').trim();
        console.log(`[${teamName}] Token来源: headers.Authorization`);
    } else if (registerResult.data && registerResult.data.token) {
        token = registerResult.data.token;
        console.log(`[${teamName}] Token来源: data.token`);
    }

    if (!token) {
        throw new Error(`[${teamName}] 未能获取到token`);
    }

    sleep(1);

    // 获取用户信息（包含邀请码）
    const userInfo = getFrontUserInfo(token);

    if (!userInfo || !userInfo.inviteCode) {
        throw new Error(`[${teamName}] 未能获取到邀请码`);
    }

    console.log(`[${teamName}] ✅ 总代注册成功`);
    console.log(`[${teamName}]   用户ID: ${userInfo.userId}`);
    console.log(`[${teamName}]   邀请码: ${userInfo.inviteCode}`);
    console.log(`[${teamName}]   手机号: ${phone}`);

    return {
        userId: userInfo.userId,
        inviteCode: userInfo.inviteCode,
        token: token,
        phone: phone
    };
}

/**
 * 执行多级邀请
 * @param {string} rootInviteCode - 总代邀请码
 * @param {number[]} levels - 层级人数数组
 * @param {object} adminData - 管理员数据
 * @param {boolean} withRecharge - 是否充值投注
 * @param {string} teamName - 团队名称
 * @param {object} [v2Rates] - V2 分层比例（mode=v2 时生效）
 */
async function executeMultiLevelInvite(rootInviteCode, levels, adminData, withRecharge, teamName, v2Rates = {}) {
    console.log(`\n[${teamName}] 开始多级邀请...`);
    console.log(`[${teamName}] 层级配置: ${levels.join(' -> ')}`);
    console.log(`[${teamName}] 是否充值投注: ${withRecharge ? '是' : '否'}`);

    const tenantId = __ENV.TENANT_ID || '3002';
    const tenantConfig = {
        tenantId: tenantId,
        frontUrl: null,
        adminUrl: null,
        registerApiUrl: null
    };

    const { mode = 'default', inactiveRate = 0.2, rechargeOnlyRate = 0.2, rebateChance = 0.2 } = v2Rates;

    if (withRecharge && mode === 'v2') {
        console.log(`[${teamName}] 使用 V2 三段式分层: 不活跃=${(inactiveRate*100).toFixed(0)}% | 只充值=${(rechargeOnlyRate*100).toFixed(0)}% | 充值+投注=${((1-inactiveRate-rechargeOnlyRate)*100).toFixed(0)}% | 返佣几率=${(rebateChance*100).toFixed(0)}%`);
        await runMultiLevelInviteV2(
            rootInviteCode,
            levels,
            adminData,
            tenantConfig,
            { inactiveRate, rechargeOnlyRate, rebateChance }
        );
    } else {
        await runMultiLevelInvite(
            rootInviteCode,
            levels,
            adminData,
            tenantConfig,
            withRecharge,
            rebateChance
        );
    }

    console.log(`[${teamName}] ✅ 多级邀请完成`);
}

/**
 * 从团队中随机选择一个下级用户（排除总代，但如果只有总代则返回总代）
 * 优先选择有下级的账号，层级随机性更强
 * @param {string} adminToken - 管理员token
 * @param {number} rootUserId - 总代用户ID
 * @returns {number|null} 随机选中的用户ID
 */
function selectRandomSubordinate(adminToken, rootUserId) {
    console.log(`\n[选择下级] 查询团队成员...`);

    const agentList = getAgentHierarchyList(adminToken, rootUserId);

    if (!agentList || agentList.length === 0) {
        console.error(`[选择下级] 未找到团队成员`);
        return null;
    }

    // 过滤：排除层级0（总代），只选择层级>=1的用户
    const eligibleMembers = agentList.filter(member => member.hierarchy >= 1);

    // 如果没有下级，说明团队只有总代，则返回总代本身
    if (eligibleMembers.length === 0) {
        console.warn(`[选择下级] ⚠️  团队中只有总代，将选择总代本身`);
        const rootAgent = agentList.find(member => member.hierarchy === 0);
        if (rootAgent) {
            console.log(`[选择下级] ✅ 选中总代`);
            console.log(`[选择下级]   用户ID: ${rootAgent.userId}`);
            console.log(`[选择下级]   层级: ${rootAgent.hierarchy}`);
            return rootAgent.userId;
        }
        return null;
    }

    // 统计每个用户的下级数量
    const memberWithSubordinates = eligibleMembers.map(member => {
        const subordinateCount = agentList.filter(m =>
            m.hierarchy > member.hierarchy &&
            m.userId !== member.userId
        ).length;
        return {
            ...member,
            subordinateCount
        };
    });

    // 按层级分组
    const membersByLevel = {};
    memberWithSubordinates.forEach(member => {
        if (!membersByLevel[member.hierarchy]) {
            membersByLevel[member.hierarchy] = [];
        }
        membersByLevel[member.hierarchy].push(member);
    });

    const levels = Object.keys(membersByLevel).map(Number).sort((a, b) => a - b);
    console.log(`[选择下级] 可用层级: ${levels.join(', ')}`);

    // 随机选择一个层级（增加随机性）
    const randomLevel = levels[Math.floor(Math.random() * levels.length)];
    const candidatesAtLevel = membersByLevel[randomLevel];

    console.log(`[选择下级] 随机选中层级: ${randomLevel}, 该层级有 ${candidatesAtLevel.length} 个成员`);

    // 在该层级中，优先选择有下级的账号
    const withSubordinates = candidatesAtLevel.filter(m => m.subordinateCount > 0);
    const withoutSubordinates = candidatesAtLevel.filter(m => m.subordinateCount === 0);

    let selectedMember;

    if (withSubordinates.length > 0) {
        // 80% 概率选择有下级的账号
        if (Math.random() < 0.8) {
            selectedMember = withSubordinates[Math.floor(Math.random() * withSubordinates.length)];
            console.log(`[选择下级] 优先选择有下级的账号 (该账号有 ${selectedMember.subordinateCount} 个下级)`);
        } else if (withoutSubordinates.length > 0) {
            selectedMember = withoutSubordinates[Math.floor(Math.random() * withoutSubordinates.length)];
            console.log(`[选择下级] 随机选择无下级的账号`);
        } else {
            selectedMember = withSubordinates[Math.floor(Math.random() * withSubordinates.length)];
            console.log(`[选择下级] 该层级只有有下级的账号 (该账号有 ${selectedMember.subordinateCount} 个下级)`);
        }
    } else {
        // 该层级都没有下级，随机选一个
        selectedMember = candidatesAtLevel[Math.floor(Math.random() * candidatesAtLevel.length)];
        console.log(`[选择下级] 该层级都没有下级，随机选择`);
    }

    console.log(`[选择下级] ✅ 最终选中用户`);
    console.log(`[选择下级]   用户ID: ${selectedMember.userId}`);
    console.log(`[选择下级]   层级: ${selectedMember.hierarchy}`);
    console.log(`[选择下级]   下级数量: ${selectedMember.subordinateCount}`);

    return selectedMember.userId;
}

/**
 * 执行团队充值投注
 * @param {string} adminToken - 管理员token  
 * @param {number} targetUserId - 目标用户ID（总代）
 * @param {string} teamName - 团队名称
 * @param {number} rechargeChance - 充值几率（仅 default 模式使用）
 * @param {object} [v2Rates] - V2 分层比例
 */
function executeTeamRechargeAndBet(adminToken, targetUserId, teamName, rechargeChance = 0.5, v2Rates = {}) {
    console.log(`\n[${teamName}] 开始团队充值投注...`);
    console.log(`[${teamName}] 目标用户ID: ${targetUserId}`);

    const adminData = { token: adminToken };
    const { mode = 'default', inactiveRate = 0.2, rechargeOnlyRate = 0.2, rebateChance = 0.2 } = v2Rates;

    let stats;
    if (mode === 'v2') {
        console.log(`[${teamName}] 使用 V2 三段式分层: 不活跃=${(inactiveRate*100).toFixed(0)}% | 只充值=${(rechargeOnlyRate*100).toFixed(0)}% | 充值+投注=${((1-inactiveRate-rechargeOnlyRate)*100).toFixed(0)}% | 返佣几率=${(rebateChance*100).toFixed(0)}%`);
        stats = runTeamRechargeAndBetV2(targetUserId, adminData, {
            inactiveRate,
            rechargeOnlyRate,
            rebateChance,
            delayMs: 1000
        });
    } else {
        stats = runTeamRechargeAndBet(targetUserId, adminData, {
            rechargeChance,
            rebateChance,
            delayMs: 1000
        });
    }

    console.log(`[${teamName}] ✅ 团队充值投注完成`);
    console.log(`[${teamName}]   充值成功: ${stats.rechargeSuccess} 人`);
    console.log(`[${teamName}]   投注成功: ${stats.betSuccess} 人`);

    return stats;
}

/**
 * Setup 阶段
 */
export function setup() {
    console.log('[Setup] 开始管理员登录...');

    const adminToken = AdminLogin();
    if (!adminToken) {
        throw new Error('管理员登录失败');
    }

    console.log('[Setup] ✅ 管理员登录成功');

    // 获取环境配置
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    const envConfig = getEnvByTenantId(tenantId);

    // 切换全局 ENV_CONFIG（影响 inviteService、teamRechargeAndBet 等内部模块）
    if (tenantId !== '3004') {
        Object.assign(ENV_CONFIG, envConfig);
        console.log(`[Setup] 已切换到租户 ${tenantId} 的环境配置`);
        console.log(`[Setup]   前台地址: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[Setup]   后台地址: ${ENV_CONFIG.BASE_ADMIN_URL}`);
    }

    return {
        token: adminToken,
        envConfig: envConfig
    };
}

/**
 * K6 配置选项
 */
export const options = {
    scenarios: {
        multi_level_rebate: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '2h'  // 含 L3 验证等待时间，预留充足时长
        },
    },
    thresholds: {
        http_req_duration: ['p(95)<5000'],
    },
};

/**
 * 主测试函数
 */
export default async function (data) {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 多级返佣流程测试开始');
    console.log('='.repeat(80) + '\n');

    // VU 阶段重新切换租户环境（k6 VU 会重新加载模块，ENV_CONFIG 会恢复默认值）
    const tenantId = __ENV.TENANT_ID || __ENV.TENANT || '3004';
    if (tenantId !== '3004') {
        const envConfig = getEnvByTenantId(tenantId);
        Object.assign(ENV_CONFIG, envConfig);
        console.log(`[VU] 重新切换到租户 ${tenantId} 的环境配置`);
        console.log(`[VU]   前台地址: ${ENV_CONFIG.BASE_DESK_URL}`);
        console.log(`[VU]   后台地址: ${ENV_CONFIG.BASE_ADMIN_URL}`);
    }

    // ========== 公共参数解析 ==========
    const team1Total  = parseInt(__ENV.TEAM1_TOTAL  || '50', 10);
    const team1Levels = parseInt(__ENV.TEAM1_LEVELS || '4',  10);
    const team2Total  = parseInt(__ENV.TEAM2_TOTAL  || '40', 10);
    const team2Levels = parseInt(__ENV.TEAM2_LEVELS || '3',  10);
    const rebateMode  = __ENV.REBATE_MODE || 'mode1';

    // 全局 V2 比例（两个团队共用，也可通过 TEAM1_/TEAM2_ 前缀单独覆盖）
    const globalInactive      = parseFloat(__ENV.INACTIVE_RATE      || '0.2');
    const globalRechargeOnly  = parseFloat(__ENV.RECHARGE_ONLY_RATE || '0.2');
    const globalRebateChance  = parseFloat(__ENV.REBATE_CHANCE      || '0.2');

    const v2A = {
        mode            : 'v2',
        inactiveRate    : parseFloat(__ENV.TEAM1_INACTIVE_RATE      || globalInactive),
        rechargeOnlyRate: parseFloat(__ENV.TEAM1_RECHARGE_ONLY_RATE || globalRechargeOnly),
        rebateChance    : globalRebateChance
    };
    const v2B = {
        mode            : 'v2',
        inactiveRate    : parseFloat(__ENV.TEAM2_INACTIVE_RATE      || globalInactive),
        rechargeOnlyRate: parseFloat(__ENV.TEAM2_RECHARGE_ONLY_RATE || globalRechargeOnly),
        rebateChance    : globalRebateChance
    };
    const full     = { mode: 'default', rebateChance: globalRebateChance };
    const recharge = { mode: 'recharge', rebateChance: globalRebateChance };  // 只充值不投注（见 executeAction 内部处理）
    const none     = null;                  // 不做任何操作

    const team1Distribution = distributePeople(team1Total, team1Levels);
    const team2Distribution = distributePeople(team2Total, team2Levels);

    console.log(`� REBATE_MODE : ${rebateMode}`);
    console.log(`📋 团队A: ${team1Total}人 ${team1Levels}层 → ${team1Distribution.join('->')}`);
    console.log(`📋 团队B: ${team2Total}人 ${team2Levels}层 → ${team2Distribution.join('->')}`);
    console.log(`📋 V2比例: 不活跃=${(globalInactive*100).toFixed(0)}% 只充值=${(globalRechargeOnly*100).toFixed(0)}%\n`);

    // ========== 工具函数 ==========

    /**
     * 注册团队并执行指定行为
     * @param {string} teamName
     * @param {number[]} distribution
     * @param {object|null} actionMode  - full/v2/recharge/null
     */
    async function buildTeam(teamName, distribution, actionMode) {
        const root = registerRootAgent(data, teamName);
        sleep(2);
        const withRecharge = actionMode !== null && actionMode !== none;
        // recharge 模式：注册时不投注，后续单独处理
        const doFullInvite = actionMode && actionMode.mode !== 'recharge';
        // 如果没有下级需要注册，直接跳过邀请流程，只保留总代
        if (distribution && distribution.length > 0) {
            await executeMultiLevelInvite(root.inviteCode, distribution, data, withRecharge && doFullInvite, teamName, actionMode || {});
        }

        // recharge 模式：只充值不投注，借用 rechargeOnly V2（100% 只充值）
        if (actionMode && actionMode.mode === 'recharge') {
            if (distribution && distribution.length > 0) {
                await executeMultiLevelInvite(root.inviteCode, distribution, data, false, teamName, {});
            }
            executeTeamRechargeAndBet(data.token, root.userId, teamName, 1.0, {
                mode: 'v2', inactiveRate: 0, rechargeOnlyRate: 1.0  // 100% 只充值
            });
        }
        sleep(3);
        return root;
    }

    /**
     * 对已有团队执行行为（充值/投注）
     * @param {object} root        - { userId, inviteCode }
     * @param {string} teamName
     * @param {object|null} actionMode
     */
    function doAction(root, teamName, actionMode) {
        if (!actionMode) {
            console.log(`[${teamName}] ⏭️  跳过（none）`);
            return;
        }
        if (actionMode.mode === 'recharge') {
            executeTeamRechargeAndBet(data.token, root.userId, teamName, 1.0, {
                mode: 'v2', inactiveRate: 0, rechargeOnlyRate: 1.0
            });
        } else {
            executeTeamRechargeAndBet(data.token, root.userId, teamName, 1.0, actionMode);
        }
        sleep(3);
    }

    /**
     * 执行 A→B 解绑绑定
     */
    function swap(fromRoot, toRoot, fromName, toName) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`🔄 解绑绑定: ${fromName} → ${toName}`);
        const uid = selectRandomSubordinate(data.token, fromRoot.userId);
        if (uid) {
            __ENV.UNBIND_UID       = uid.toString();
            __ENV.BIND_INVITE_CODE = toRoot.inviteCode;
            bundEarn(data);
        } else {
            console.warn(`[${fromName}] ⚠️  无符合条件的下级，跳过`);
        }
        sleep(3);
        return uid;
    }

    /**
     * 执行互相解绑绑定（根据团队人数决定执行 1 次或 2 次）
     * 触发条件：任意一个团队人数 > 30，执行 2 次互换（间隔 10 秒）
     */
    function executeSwaps() {
        const needDoubleSwap = team1Total > 30 || team2Total > 30;
        const swapRounds = needDoubleSwap ? 2 : 1;

        if (needDoubleSwap) {
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`🔄 检测到大团队（A=${team1Total}人 | B=${team2Total}人），执行 ${swapRounds} 轮互换`);
            console.log(`${'═'.repeat(60)}\n`);
        }

        for (let round = 1; round <= swapRounds; round++) {
            if (swapRounds > 1) {
                console.log(`\n${'─'.repeat(60)}`);
                console.log(`🔄 第 ${round}/${swapRounds} 轮互换`);
                console.log(`${'─'.repeat(60)}`);
            }

            swapLog.push(swap(rootA, rootB, '团队A', '团队B'));
            swapLog.push(swap(rootB, rootA, '团队B', '团队A'));

            // 第1轮完成后等待 10 秒再进行第2轮
            if (round < swapRounds) {
                console.log(`\n⏳ 第 ${round} 轮完成，等待 10 秒后进行第 ${round + 1} 轮互换...`);
                sleep(10);
            }
        }
    }

    // ========== 16 种模式 ==========
    let rootA, rootB;
    const swapLog = [];
    // swap 前的原始 L1 成员快照（用于 L3 有效邀请过滤）
    let originalL1A = new Set();
    let originalL1B = new Set();

    // ── 辅助：打印模式说明 ──
    function printMode(desc) {
        console.log(`\n${'═'.repeat(80)}`);
        console.log(`🎯 ${rebateMode}: ${desc}`);
        console.log(`${'═'.repeat(80)}\n`);
    }

    // ── 辅助：在 swap 前快照两个团队的 L1 成员 ──
    function snapshotBeforeSwap() {
        console.log(`\n📸 快照 swap 前的原始 L1 成员...`);
        originalL1A = snapshotL1Members(data, rootA.userId);
        originalL1B = snapshotL1Members(data, rootB.userId);
        console.log(`   团队A 原始 L1: ${originalL1A.size} 人 | 团队B 原始 L1: ${originalL1B.size} 人`);
    }

    switch (rebateMode) {

        // ── mode1（现有逻辑）A充投 → swap → B充投 ──────────────────────────
        case 'mode1':
            printMode('A充投 | 无 → A→B, B→A → 无 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootB, '团队B', full);
            break;

        // ── mode2 双方充投后互换 ────────────────────────────────────────────
        case 'mode2':
            printMode('A充投 | B充投 → A→B, B→A → 无 | 无');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, full);
            snapshotBeforeSwap();
            executeSwaps();
            break;

        // ── mode3 A只充值，换人后B充投 ─────────────────────────────────────
        case 'mode3':
            printMode('A只充值 | 无 → A→B, B→A → 无 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, recharge);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootB, '团队B', full);
            break;

        // ── mode4 先换人再双方充投 ──────────────────────────────────────────
        case 'mode4':
            printMode('无 | 无 → A→B, B→A → A充投 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, none);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            doAction(rootB, '团队B', full);
            break;

        // ── mode5 换人前后A持续充投，B换人后充投 ───────────────────────────
        case 'mode5':
            printMode('A充投 | 无 → A→B, B→A → A充投 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            doAction(rootB, '团队B', full);
            break;

        // ── mode6 换人前只充值，换人后补投注 ───────────────────────────────
        case 'mode6':
            printMode('A只充值 | B只充值 → A→B, B→A → A充投 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, recharge);
            rootB = await buildTeam('团队B', team2Distribution, recharge);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            doAction(rootB, '团队B', full);
            break;

        // ── mode7 A充投B只充，换人后B补完 ──────────────────────────────────
        case 'mode7':
            printMode('A充投 | B只充值 → A→B, B→A → 无 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, recharge);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootB, '团队B', full);
            break;

        // ── mode8 B先充投，换人后A充投（对称） ─────────────────────────────
        case 'mode8':
            printMode('无 | B充投 → A→B, B→A → A充投 | 无');
            rootA = await buildTeam('团队A', team1Distribution, none);
            rootB = await buildTeam('团队B', team2Distribution, full);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            break;

        // ── mode9 A随机分层，换人后B随机分层 ───────────────────────────────
        case 'mode9':
            printMode('A(V2) | 无 → A→B, B→A → 无 | B(V2)');
            rootA = await buildTeam('团队A', team1Distribution, v2A);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootB, '团队B', v2B);
            break;

        // ── mode10 双方随机分层后互换 ───────────────────────────────────────
        case 'mode10':
            printMode('A(V2) | B(V2) → A→B, B→A → 无 | 无');
            rootA = await buildTeam('团队A', team1Distribution, v2A);
            rootB = await buildTeam('团队B', team2Distribution, v2B);
            snapshotBeforeSwap();
            executeSwaps();
            break;

        // ── mode11 换人后双方随机分层 ───────────────────────────────────────
        case 'mode11':
            printMode('A充投 | 无 → A→B, B→A → A(V2) | B(V2)');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', v2A);
            doAction(rootB, '团队B', v2B);
            break;

        // ── mode12 A随机B只充，换人后B补完 ─────────────────────────────────
        case 'mode12':
            printMode('A(V2) | B只充值 → A→B, B→A → 无 | B充投');
            rootA = await buildTeam('团队A', team1Distribution, v2A);
            rootB = await buildTeam('团队B', team2Distribution, recharge);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootB, '团队B', full);
            break;

        // ── mode13 A只充B随机，换人后A补完 ─────────────────────────────────
        case 'mode13':
            printMode('A只充值 | B(V2) → A→B, B→A → A充投 | 无');
            rootA = await buildTeam('团队A', team1Distribution, recharge);
            rootB = await buildTeam('团队B', team2Distribution, v2B);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            break;

        // ── mode14 全程随机，最大不确定性 ───────────────────────────────────
        case 'mode14':
            printMode('A(V2) | B(V2) → A→B, B→A → A(V2) | B(V2)');
            rootA = await buildTeam('团队A', team1Distribution, v2A);
            rootB = await buildTeam('团队B', team2Distribution, v2B);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', v2A);
            doAction(rootB, '团队B', v2B);
            break;

        // ── mode15 A确定B随机交叉 ───────────────────────────────────────────
        case 'mode15':
            printMode('A充投 | B(V2) → A→B, B→A → A(V2) | B充投');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, v2B);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', v2A);
            doAction(rootB, '团队B', full);
            break;

        // ── mode16 与 mode15 对称 ────────────────────────────────────────────
        case 'mode16':
            printMode('A(V2) | B充投 → A→B, B→A → A充投 | B(V2)');
            rootA = await buildTeam('团队A', team1Distribution, v2A);
            rootB = await buildTeam('团队B', team2Distribution, full);
            snapshotBeforeSwap();
            executeSwaps();
            doAction(rootA, '团队A', full);
            doAction(rootB, '团队B', v2B);
            break;

        // ── mode17 A充投，B无操作，互换后双方都不操作 ───────────────────────
        case 'mode17':
            printMode('A充投 | 无 → A→B, B→A → 无 | 无');
            rootA = await buildTeam('团队A', team1Distribution, full);
            rootB = await buildTeam('团队B', team2Distribution, none);
            snapshotBeforeSwap();
            executeSwaps();
            break;

        default:
            console.error(`❌ 未知 REBATE_MODE: ${rebateMode}，支持 mode1~mode17`);
            return;
    }

    // ========== 完成摘要 ==========
    console.log('\n' + '='.repeat(80));
    console.log(`✅ ${rebateMode} 测试完成`);
    console.log('='.repeat(80));
    console.log(`  团队A总代: ${rootA.userId} (邀请码: ${rootA.inviteCode})`);
    console.log(`  团队B总代: ${rootB.userId} (邀请码: ${rootB.inviteCode})`);
    console.log(`  解绑绑定记录: ${swapLog.filter(Boolean).join(', ')}`);
    console.log('');

    // ========== L3 验证（可选，-e VERIFY=L3 触发）==========
    const verifyMode = __ENV.VERIFY || '';
    if (verifyMode.toUpperCase() === 'L3') {
        const waitMinutes = parseInt(__ENV.VERIFY_WAIT_MINUTES || '10', 10);
        console.log(`\n${'='.repeat(80)}`);
        console.log(`⏳ VERIFY=L3 已启用，等待 ${waitMinutes} 分钟后开始 L3 验证...`);
        console.log(`   团队A总代: ${rootA.userId} | 团队B总代: ${rootB.userId}`);
        console.log(`   原始L1快照 - 团队A: ${originalL1A.size} 人 | 团队B: ${originalL1B.size} 人`);
        console.log(`${'='.repeat(80)}\n`);

        sleep(waitMinutes * 60);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 开始 L3 验证 - 团队A (总代 UID: ${rootA.userId})`);
        console.log(`${'='.repeat(80)}`);
        runAgentL3ValidationWithOriginalTeam(data, rootA.userId, originalL1A);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 开始 L3 验证 - 团队B (总代 UID: ${rootB.userId})`);
        console.log(`${'='.repeat(80)}`);
        runAgentL3ValidationWithOriginalTeam(data, rootB.userId, originalL1B);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅ L3 验证全部完成`);
        console.log(`${'='.repeat(80)}\n`);
    }
}

/**
 * Teardown 阶段
 */
export function teardown(data) {
    console.log('[Teardown] 测试结束');
}
