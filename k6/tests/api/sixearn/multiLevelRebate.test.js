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
 * k6 run -e TENANT_ID=3002 -e TEAM1_TOTAL=5 -e TEAM1_LEVELS=2 -e TEAM2_TOTAL=4 -e TEAM2_LEVELS=3 multiLevelRebate.test.js
 */

import { sleep } from 'k6';
import { AdminLogin } from '../login/adminlogin.test.js';
import { phoneRegister } from '../login/register.test.js';
import { generateRandomPhone } from '../../utils/accountGenerator.js';
import { getFrontUserInfo } from '../user/userManagement.js';
import { getAgentHierarchyList } from '../invite/agentApi.js';
import { runMultiLevelInvite } from '../invite/inviteService.js';
import { runTeamRechargeAndBet } from '../invite/teamRechargeAndBet.js';
import { bundEarn } from './bundearn.test.js';

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

    const phone = generateRandomPhone();
    console.log(`[${teamName}] 生成手机号: ${phone}`);

    const registerResult = phoneRegister(phone, adminData);

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
 */
async function executeMultiLevelInvite(rootInviteCode, levels, adminData, withRecharge, teamName) {
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

    await runMultiLevelInvite(
        rootInviteCode,
        levels,
        adminData,
        tenantConfig,
        withRecharge
    );

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
 */
function executeTeamRechargeAndBet(adminToken, targetUserId, teamName) {
    console.log(`\n[${teamName}] 开始团队充值投注...`);
    console.log(`[${teamName}] 目标用户ID: ${targetUserId}`);

    const adminData = { token: adminToken };
    const options = {
        rechargeChance: 0.5,  // 50%充值几率
        rebateChance: 0.2,    // 20%返佣设置几率
        delayMs: 1000
    };

    const stats = runTeamRechargeAndBet(targetUserId, adminData, options);

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

    return { token: adminToken };
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
            maxDuration: '60m'
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

    // ========== 1. 解析配置 ==========
    const team1Total = parseInt(__ENV.TEAM1_TOTAL || '50', 10);
    const team1Levels = parseInt(__ENV.TEAM1_LEVELS || '4', 10);
    const team2Total = parseInt(__ENV.TEAM2_TOTAL || '40', 10);
    const team2Levels = parseInt(__ENV.TEAM2_LEVELS || '3', 10);

    console.log('📋 测试配置:');
    console.log(`  团队1: ${team1Total}人, ${team1Levels}层`);
    console.log(`  团队2: ${team2Total}人, ${team2Levels}层`);
    console.log('');

    // ========== 2. 计算层级分配 ==========
    const team1Distribution = distributePeople(team1Total, team1Levels);
    const team2Distribution = distributePeople(team2Total, team2Levels);

    console.log('📊 层级分配:');
    console.log(`  团队1: ${team1Distribution.join(' -> ')}`);
    console.log(`  团队2: ${team2Distribution.join(' -> ')}`);
    console.log('');

    // ========== 3. 注册两个总代 ==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤1: 注册总代');
    console.log('─'.repeat(80));

    const team1Root = registerRootAgent(data, '团队1');
    sleep(2);
    const team2Root = registerRootAgent(data, '团队2');
    sleep(2);

    // ========== 4. 团队1：多级邀请 + 充值投注 ==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤2: 团队1 - 多级邀请（含充值投注）');
    console.log('─'.repeat(80));

    await executeMultiLevelInvite(
        team1Root.inviteCode,
        team1Distribution,
        data,
        true,  // 充值投注
        '团队1'
    );

    sleep(3);

    // ========== 5. 团队2：多级邀请（不充值投注）==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤3: 团队2 - 多级邀请（不充值投注）');
    console.log('─'.repeat(80));

    await executeMultiLevelInvite(
        team2Root.inviteCode,
        team2Distribution,
        data,
        false,  // 不充值投注
        '团队2'
    );

    sleep(3);

    // ========== 6. 等待5秒 ==========
    console.log('\n⏳ 等待5秒...');
    sleep(5);

    // ========== 7. 团队1随机解绑一个下级，绑定到团队2 ==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤4: 团队1 -> 团队2 解绑绑定');
    console.log('─'.repeat(80));

    const team1UnbindUserId = selectRandomSubordinate(data.token, team1Root.userId);

    if (team1UnbindUserId) {
        console.log(`\n[解绑绑定] 团队1用户 ${team1UnbindUserId} 解绑并绑定到团队2`);

        // 设置环境变量供 bundearn 使用
        __ENV.UNBIND_UID = team1UnbindUserId.toString();
        __ENV.BIND_INVITE_CODE = team2Root.inviteCode;

        // 调用解绑绑定函数
        bundEarn(data);

        console.log(`[解绑绑定] ✅ 完成`);
    } else {
        console.warn(`[解绑绑定] ⚠️  团队1没有符合条件的下级，跳过此步骤`);
    }

    // ========== 8. 团队2进行充值投注 ==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤5: 团队2 - 充值投注');
    console.log('─'.repeat(80));

    executeTeamRechargeAndBet(data.token, team2Root.userId, '团队2');

    sleep(3);

    // ========== 9. 团队2随机解绑一个下级，绑定到团队1 ==========
    console.log('\n' + '─'.repeat(80));
    console.log('步骤6: 团队2 -> 团队1 解绑绑定');
    console.log('─'.repeat(80));

    const team2UnbindUserId = selectRandomSubordinate(data.token, team2Root.userId);

    if (team2UnbindUserId) {
        console.log(`\n[解绑绑定] 团队2用户 ${team2UnbindUserId} 解绑并绑定到团队1`);

        // 设置环境变量供 bundearn 使用
        __ENV.UNBIND_UID = team2UnbindUserId.toString();
        __ENV.BIND_INVITE_CODE = team1Root.inviteCode;

        // 调用解绑绑定函数
        bundEarn(data);

        console.log(`[解绑绑定] ✅ 完成`);
    } else {
        console.warn(`[解绑绑定] ⚠️  团队2没有符合条件的下级，跳过此步骤`);
    }

    // ========== 10. 完成 ==========
    console.log('\n' + '='.repeat(80));
    console.log('✅ 多级返佣流程测试完成');
    console.log('='.repeat(80));
    console.log('\n📊 测试摘要:');
    console.log(`  团队1总代: ${team1Root.userId} (邀请码: ${team1Root.inviteCode})`);
    console.log(`  团队2总代: ${team2Root.userId} (邀请码: ${team2Root.inviteCode})`);
    if (team1UnbindUserId) {
        console.log(`  团队1->团队2: 用户 ${team1UnbindUserId}`);
    }
    if (team2UnbindUserId) {
        console.log(`  团队2->团队1: 用户 ${team2UnbindUserId}`);
    }
    console.log('');
}

/**
 * Teardown 阶段
 */
export function teardown(data) {
    console.log('[Teardown] 测试结束');
}
