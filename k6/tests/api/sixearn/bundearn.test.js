import { sendQueryRequest, sendRequest } from '../common/request.js';

import { sleep, fail, check } from 'k6';

const tag = 'adminsixearn';
// 解除和绑定代理
// 要解除的账号id列表
let unbindAccountIds = [];

// ANSI 颜色代码
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    dim: "\x1b[2m",
    bright: "\x1b[1m"
};

/**
 * 获取某个账号的层级链路以供验证
 * 返回从顶层到底层的对象数组 [{userId, userName, hierarchy}, ...]
 */
function getAgentHierarchy(data, accountId) {
    const api = '/api/Agent/GetPageListAgentList';
    const payload = {
        userId: accountId,
        isAll: true,
        isIncludeSelfAndParent: true,
        hierarchy: 0,
        pageSize: 500, // 增加页面大小以获取更多数据
    }
    const result = sendQueryRequest(payload, api, tag, false, data.token);
    let parserRes = typeof result === 'object' ? result : JSON.parse(result);

    if (parserRes && parserRes.list) {
        // 后端返回的 list 通常是按层级排好的，我们确保它是从总代到成员的顺序
        return parserRes.list.sort((a, b) => a.hierarchy - b.hierarchy);
    }
    return [];
}

/**
 * 格式化金字塔形式的链路图
 * @param {Array} hierarchy 链路数组
 * @param {number} targetId 要高亮的目标成员ID
 * @param {Array} newIds 绑定后新增的上级链路ID（用于高亮新上级）
 * @param {Array} removedIds 被移除的上级链路ID（用于高亮移除的上级）
 * @param {string} title 标题
 */
function formatPyramidHierarchy(hierarchy, targetId, newIds = [], removedIds = [], title = "链路图") {
    if (!hierarchy || hierarchy.length === 0) return `${title}: 空链路`;

    let result = `\n${colors.cyan}┌─ ${title} ─┐${colors.reset}\n`;

    // 按层级显示，每层缩进不同
    hierarchy.forEach((member, index) => {
        const indent = "  ".repeat(index); // 每层增加缩进
        const isTarget = member.userId === targetId;
        const isNew = newIds.includes(member.userId);
        const isRemoved = removedIds.includes(member.userId);

        let prefix = "├─";
        if (index === hierarchy.length - 1) prefix = "└─";

        let label = `${member.userId}`;
        if (member.userName) label += ` (${member.userName})`;

        // 根据状态着色
        if (isTarget) {
            label = `${colors.yellow}${colors.bright}[目标] ${label}${colors.reset}`;
        } else if (isNew) {
            label = `${colors.green}${colors.bright}[新增] ${label}${colors.reset}`;
        } else if (isRemoved) {
            label = `${colors.red}${colors.bright}[移除] ${label}${colors.reset}`;
        } else {
            label = `${colors.dim}${label}${colors.reset}`;
        }

        result += `${indent}${prefix} ${label}\n`;
    });

    return result;
}

/**
 * 显示团队结构对比
 */
function displayTeamComparison(beforeTeam, afterTeam, targetId) {
    console.log(`\n${colors.cyan}═══════════════ 团队结构对比 ═══════════════${colors.reset}`);

    // 找出变更
    const beforeIds = beforeTeam.map(m => m.userId);
    const afterIds = afterTeam.map(m => m.userId);
    const newMembers = afterIds.filter(id => !beforeIds.includes(id));
    const removedMembers = beforeIds.filter(id => !afterIds.includes(id));

    // 显示变更前的团队结构
    const beforeDisplay = formatPyramidHierarchy(beforeTeam, targetId, [], removedMembers, "变更前团队结构");
    console.log(beforeDisplay);

    // 显示变更后的团队结构
    const afterDisplay = formatPyramidHierarchy(afterTeam, targetId, newMembers, [], "变更后团队结构");
    console.log(afterDisplay);

    // 显示变更摘要
    if (newMembers.length > 0 || removedMembers.length > 0) {
        console.log(`\n${colors.cyan}┌─ 变更摘要 ─┐${colors.reset}`);
        if (newMembers.length > 0) {
            console.log(`├─ ${colors.green}新增上级: ${newMembers.join(', ')}${colors.reset}`);
        }
        if (removedMembers.length > 0) {
            console.log(`├─ ${colors.red}移除上级: ${removedMembers.join(', ')}${colors.reset}`);
        }
        console.log(`└─ ${colors.yellow}目标账号: ${targetId}${colors.reset}`);
    }
}

// 2,进行解除
export function unbindSubAccounts(data) {
    if (unbindAccountIds.length === 0) {
        console.warn('没有找到需要解绑的账号');
        return;
    }
    const api = '/api/Agent/UserInviteUnBind';
    const token = data.token;
    for (const accountId of unbindAccountIds) {
        sleep(0.5); // 避免请求过快
        const payload = {
            userId: accountId,
        }
        const result = commonRequest(payload, api, tag, token);
        if (result) {
            console.log(`✅ 账号ID ${accountId} 解绑成功`);
        }
    }
}

// 3.进行绑定
/**
 * @param {*} inviteCode 邀请码
*/
export function bindSubAccounts(data, inviteCode) {
    const api = '/api/Agent/UserInviteBind';
    const token = data.token;
    if (unbindAccountIds.length === 0) {
        console.warn('没有找到需要解绑的账号');
        return;
    }
    for (const accountId of unbindAccountIds) {
        sleep(0.5); // 避免请求过快
        const payload = {
            userId: accountId,
            inviteCode: inviteCode
        }
        const result = commonRequest(payload, api, tag, token);
        if (result) {
            console.log(`✅ 账号ID ${accountId} 绑定成功`);
        }
    }
}

// 公共的请求
function commonRequest(payload, api, tag, token) {
    let result = sendRequest(payload, api, tag, false, token);
    if (typeof result != 'object' && result) {
        try {
            result = JSON.parse(result);
        } catch (e) {
            console.warn("API 结果解析错误", result);
        }
    }

    // 如果返回的字段中明确带有套娃等业务报错
    if (result && result.msgCode !== undefined && result.msgCode !== 0) {
        let customMsg = result.msg;
        if (result.msg && result.msg.includes('Matryoshka')) {
            customMsg = `⚠️ 绑定失败，出现【代理套娃(死循环)】！\n  原因分析: 您试图绑定的目标邀请码，其实本身就是被解绑账号的下级。系统为了防止层级混乱，已主动拒绝绑定！\n  系统原报错: ${result.msg}`;
        }
        fail(`\n🔴 发现业务拦截并终止执行:\n  接口: ${api}\n  错误详情: ${customMsg}\n`);
    }

    return result ? result.data : null;
}

// 主函数，执行解绑和绑定操作
export function bundEarn(data) {
    // 1. 解析参数
    const rawUnbindUid = __ENV.UNBIND_UID;
    const rawInviteCode = __ENV.BIND_INVITE_CODE;
    const accountId = rawUnbindUid ? parseInt(rawUnbindUid.trim(), 10) : 5944683;
    const inviteCode = rawInviteCode ? rawInviteCode.trim() : '85YJGZN';

    unbindAccountIds = [accountId];
    console.log(`\n${colors.cyan}================ [ 代理关系变更测试 ] ==================${colors.reset}`);
    console.log(`🎯 目标账号: ${colors.yellow}${accountId}${colors.reset}`);
    console.log(`🎫 目标邀请码: ${colors.green}${inviteCode}${colors.reset}`);

    // 2. 获取变更前的完整团队结构
    console.log(`\n🔍 正在获取变更前的团队结构...`);
    const beforeHierarchy = getAgentHierarchy(data, accountId);
    const beforeIds = beforeHierarchy.map(m => m.userId);

    // 3. 执行解绑（如果是顶级总代则跳过）
    if (beforeHierarchy.length <= 1) {
        console.log(`\n💡 该账号是最高级总代或当前无上级，无需解绑。`);
    } else {
        console.log(`\n🔄 正在执行解绑...`);
        unbindSubAccounts(data);
        sleep(2);
    }

    // 4. 执行绑定
    console.log(`\n🔄 正在执行绑定至新邀请码 [${inviteCode}]...`);
    bindSubAccounts(data, inviteCode);
    sleep(3);

    // 5. 获取变更后的完整团队结构
    console.log(`\n🔍 正在获取变更后的团队结构...`);
    const afterHierarchy = getAgentHierarchy(data, accountId);
    const afterIds = afterHierarchy.map(m => m.userId);

    // 6. 显示金字塔形式的团队结构对比
    displayTeamComparison(beforeHierarchy, afterHierarchy, accountId);

    // 7. K6 标志性验证逻辑 (Verification)
    const boundSucceeded = afterIds.length > 0 && afterIds.includes(accountId);
    const parentChanged = JSON.stringify(beforeIds) !== JSON.stringify(afterIds);

    check(data, {
        '验证：账号在系统中存在': () => boundSucceeded,
        '验证：链路层级已发生变更': () => parentChanged,
        '验证：新层级包含预期节点': () => afterIds.length >= 1
    });

    console.log(`\n${colors.cyan}========================================================${colors.reset}\n`);
}