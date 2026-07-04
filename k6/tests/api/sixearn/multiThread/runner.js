const { execSync } = require('child_process');
// @ts-ignore
const fs = require('fs');

const tenantId = process.env.TENANT_ID || '3007';
const team1Total = process.env.TEAM1_TOTAL || '70';   // 团队1总人数
const team1Levels = process.env.TEAM1_LEVELS || '7';    // 团队1总层级
const team2Total = process.env.TEAM2_TOTAL || '60';   // 团队2总人数
const team2Levels = process.env.TEAM2_LEVELS || '8';    // 团队2总层级
const rebateMode = process.env.REBATE_MODE || 'mode9';  // 返佣模式

const globalInactive = parseFloat(process.env.INACTIVE_RATE || '0.1');    // V2 不活跃比例（全局）
const globalRechargeOnly = parseFloat(process.env.RECHARGE_ONLY_RATE || '0.1'); //  V2 只充值比例（全局

console.log(`\n🚀 开始运行多线程返佣模式测试: ${rebateMode} (租户: ${tenantId})`);

const roots = {};

// @ts-ignore
function runK6(script, envs) {
    const envVars = Object.keys(envs).map(k => `-e ${k}=${envs[k]}`).join(' ');
    // 强制禁用 K6 的自带进度条，避免污染 stdout 输出
    // @ts-ignore
    const cmd = `k6 run --summary-mode=disabled -q ${envVars} -e TENANT_ID=${tenantId} ${script} 2>&1`;
    // 上面是拼写 cmd，真正执行用下面的：
    const actualCmd = `k6 run --summary-mode=disabled -q ${envVars} -e TENANT_ID=${tenantId} ${script} 2>&1`;

    console.log(`\n▶️ 执行阶段: ${script}`);
    console.log(`💻 运行命令: ${actualCmd}\n`);

    try {
        const output = execSync(actualCmd, { encoding: 'utf-8', stdio: 'pipe' });
        console.log(output);
        return output;
    } catch (err) {
        // @ts-ignore
        console.error(`❌ 执行报错:\n${err.stdout}\n${err.stderr}`);
        throw err;
    }
}

// ========================
// 步骤封装
// ========================

// 阶段 1：并发建树
// @ts-ignore
function buildTeam(teamName, total, levels) {
    // 团队总人数包含 1 个 Root 节点，因此子节点数为 total - 1
    const subUsers = Math.max(1, parseInt(total) - 1);

    // 确保每个 VU 至少分配到 levels*2 个节点，否则 distributePeople 会退化为每层1人
    // 举例：subUsers=69, levels=7 → 每VU至少处理14人 → maxVus=floor(69/14)=4
    const minUsersPerVu = parseInt(levels) * 2;
    const maxVus = Math.max(1, Math.floor(subUsers / minUsersPerVu));
    const vus = Math.min(maxVus, 50);

    const output = runK6('step1_register.js', {
        TEAM_NAME: teamName,
        TOTAL_USERS: subUsers,
        LEVELS: levels,
        VUS: vus
    });
    // 从 K6 的输出中提取 Root 信息
    const match = output.match(/\[ROOT_INFO\]:\s*(\{.*?\})/);
    if (match) {
        let jsonStr = match[1];
        // K6 日志会转义双引号，这里需要反转义
        jsonStr = jsonStr.replace(/\\"/g, '"');
        // @ts-ignore
        roots[teamName] = JSON.parse(jsonStr);
        // @ts-ignore
        console.log(`✅ [调度器] ${teamName} 根节点信息已保存:`, roots[teamName]);
    } else {
        throw new Error(`[调度器] 无法从 step1_register 的输出中解析出 ${teamName} 的根节点信息`);
    }
}

// 阶段 2：单线程转线 Swap
// @ts-ignore
function runSwap(fromTeam, toTeam) {
    // @ts-ignore
    const fromId = roots[fromTeam].rootId;
    // @ts-ignore
    const toInvite = roots[toTeam].rootInvite;
    runK6('step2_swap.js', { FROM_ROOT_ID: fromId, TO_ROOT_INVITE: toInvite, FROM_TEAM: fromTeam, TO_TEAM: toTeam });
}

// 阶段 3：多线程并发充投
// @ts-ignore
function runAction(teamName, options) {
    // @ts-ignore
    const rootId = roots[teamName].rootId;
    runK6('step3_action.js', {
        TEAM_NAME: teamName,
        ROOT_ID: rootId,
        VUS: Math.min(parseInt(team1Total), 50),
        INACTIVE_RATE: options.inactiveRate || 0,
        RECHARGE_ONLY_RATE: options.rechargeOnlyRate || 0
    });
}

// 配置定义
const full = { inactiveRate: 0, rechargeOnlyRate: 0 };
const recharge = { inactiveRate: 0, rechargeOnlyRate: 1 };
const v2Mode = { inactiveRate: globalInactive, rechargeOnlyRate: globalRechargeOnly };
// @ts-ignore
const none = null;

// 执行 17 种模式的流水线时序编排
async function main() {
    switch (rebateMode) {
        case 'mode1':
            // A充投 | 无 → A→B, B→A → 无 | B充投
            console.log('\n🌟 流水线开始：mode1 - 基准模式');
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            runAction('TeamA', full);
            runSwap('TeamA', 'TeamB');
            runSwap('TeamB', 'TeamA');
            runAction('TeamB', full);
            break;

        case 'mode2':
            // A充投 | B充投 → A→B, B→A → 无 | 无
            console.log('\n🌟 流水线开始：mode2');
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            runAction('TeamA', full);
            runAction('TeamB', full);
            runSwap('TeamA', 'TeamB');
            runSwap('TeamB', 'TeamA');
            break;

        case 'mode3':
            // A只充值 | 无 → A→B, B→A → 无 | B充投
            console.log('\n🌟 流水线开始：mode3');
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            runAction('TeamA', recharge);
            runSwap('TeamA', 'TeamB');
            runSwap('TeamB', 'TeamA');
            runAction('TeamB', full);
            break;

        case 'mode9':
            // A(V2) | 无 → A→B, B→A → 无 | B(V2)
            console.log('\n🌟 流水线开始：mode9 - A随机分层，换人后B随机分层');
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            runAction('TeamA', v2Mode);
            runSwap('TeamA', 'TeamB');
            runSwap('TeamB', 'TeamA');
            runAction('TeamB', v2Mode);
            break;

        case 'mode14':
            // A(V2) | B(V2) → A→B, B→A → A(V2) | B(V2)
            console.log('\n🌟 流水线开始：mode14 - 全程最大随机');
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            runAction('TeamA', v2Mode);
            runAction('TeamB', v2Mode);
            runSwap('TeamA', 'TeamB');
            runSwap('TeamB', 'TeamA');
            runAction('TeamA', v2Mode);
            runAction('TeamB', v2Mode);
            break;

        // 这里仅展示了最典型的几个模式，后续您可以非常方便地按需添加 case 'modeX'
        // 所有时序逻辑都能被完美控制，因为 K6 的执行被强行同步化了！
        default:
            console.error(`❌ 未实现或不支持的模式: ${rebateMode}`);
            break;
    }
    console.log('\n🎉 所有多线程流水线步骤执行完毕！');
}

main();



// 这个脚本还有问题，需要新的ai进行改进，邀请下级的人数和层级不对