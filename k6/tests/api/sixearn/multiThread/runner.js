const { execSync, spawnSync } = require('child_process');
// @ts-ignore
const fs = require('fs');

const tenantId = process.env.TENANT_ID || '3004';
const team1Total = process.env.TEAM1_TOTAL || '40';   // 团队1总人数
const team1Levels = process.env.TEAM1_LEVELS || '4';    // 团队1总层级
const team2Total = process.env.TEAM2_TOTAL || '35';   // 团队2总人数
const team2Levels = process.env.TEAM2_LEVELS || '4';    // 团队2总层级
const team3Total = process.env.TEAM3_TOTAL || '32';   // 团队3总人数
const team3Levels = process.env.TEAM3_LEVELS || '5';    // 团队3总层级
const rebateMode = process.env.REBATE_MODE || 'mode_3team';  // 返佣模式（默认新版3团队复杂场景）

const globalInactive = parseFloat(process.env.INACTIVE_RATE || '0.1');    // V2 不活跃比例（全局）
const globalRechargeOnly = parseFloat(process.env.RECHARGE_ONLY_RATE || '0.1'); //  V2 只充值比例（全局）
// 注意：这两个是"少数派"比例；充投(充值+投注)= 剩余项 = 1 - 不活跃 - 只充值。
// 默认 0.1/0.1 → 10%不活跃 + 10%只充值 + 80%充投。想多充投就把这两个调小(都设0=全员充投)。

// 充投(step3)并发 VU 数：登录+充值+投注每人一长串接口，后端限流(msgCode13)极敏感。
// 并发过高(原来最高50)会把登录/充值/投注大面积打回 → 大多数人卡住、"充投"不成(只剩~10%)。
// rate limit 按 IP 全局，调高并不提速、反而更多失败，所以默认压到 4。
const actionVus = parseInt(process.env.ACTION_VUS || '4');

// —— 转线（step2_swap）——
// 每次转线随机搬 [SWAP_MIN, SWAP_MAX] 人（默认 1~3），更贴近真实。
const swapMin = process.env.SWAP_MIN || '1';
const swapMax = process.env.SWAP_MAX || '3';
// 转线前后的等待秒数：太快转线易出问题，前后各留缓冲（bundEarn 内部另有 5s+3s）。
const swapPreWait = parseInt(process.env.SWAP_PRE_WAIT || '5', 10);
const swapPostWait = parseInt(process.env.SWAP_POST_WAIT || '8', 10);

// —— 中途邀请（step_invite）——
// 每队每波随机邀请 [INVITE_MIN, INVITE_MAX] 个新下级，挂到随机现有成员下。
const inviteMin = parseInt(process.env.INVITE_MIN || '2', 10);
const inviteMax = parseInt(process.env.INVITE_MAX || '5', 10);

// —— 提现（step3_action）——
// 充投人群在最终阶段按此概率提现；是否走后台审核出款由 ENABLE_BACKEND_APPROVAL 控制。
const withdrawRate = process.env.WITHDRAW_RATE || '0.3';
const enableBackendApproval = process.env.ENABLE_BACKEND_APPROVAL || 'false';

// —— 执行后层级验证（agentHierarchyValidation）——
// 3 团队执行完毕后，等待 VERIFY_WAIT_SEC 秒（让转线/改挂的层级重算、总代回填等后端异步落地），
// 再对每个团队逐一做「层级 + 总代 + 转线」验证，有问题可精确定位到具体会员。
const verifyWaitSec = parseInt(process.env.VERIFY_WAIT_SEC || '180', 10); // 默认 3 分钟
const skipVerify = process.env.SKIP_VERIFY === 'true';
// 验证脚本相对 multiThread 目录的路径
// - 单总代验证（保留，供单独用）
const VERIFY_SCRIPT = '../../agentHierarchy/agentHierarchyValidation.test.js';
// - 全部总代验证：3 队根 + 转线遗留的野生总代
const VERIFY_SCRIPT_ALL = '../../agentHierarchy/verifyAllGeneralAgents.test.js';

console.log(`\n🚀 开始运行多线程返佣模式测试: ${rebateMode} (租户: ${tenantId})`);

const roots = {};
// 队名 → 总人数 / 层级 映射（支持 3 团队；原来 runAction 只认 A/B 已修复）
const TEAM_TOTALS = { TeamA: team1Total, TeamB: team2Total, TeamC: team3Total };
const TEAM_LEVELS = { TeamA: team1Levels, TeamB: team2Levels, TeamC: team3Levels };

// @ts-ignore
function runK6(script, envs, capture = false) {
    const envArgs = Object.keys(envs).flatMap(k => ['-e', `${k}=${envs[k]}`]);
    const allArgs = ['run', '--summary-mode=disabled', '-q', ...envArgs, '-e', `TENANT_ID=${tenantId}`, script];

    // 构建用于日志展示的命令字符串（仅用于打印）
    const displayCmd = `k6 run --summary-mode=disabled -q ${Object.keys(envs).map(k => `-e ${k}=${envs[k]}`).join(' ')} -e TENANT_ID=${tenantId} ${script} 2>&1`;
    console.log(`\n▶️ 执行阶段: ${script}`);
    console.log(`💻 运行命令: ${displayCmd}\n`);

    try {
        if (capture) {
            // 【修复 Windows pipe 死锁】
            // 原实现用 execSync+stdio:pipe，Windows 下管道缓冲区约 64KB，k6 输出稍多即被反压卡死。
            // spawnSync 内部通过事件循环流式消费 pipe，不会死锁，且无需 maxBuffer 限制。
            // stderr 单独捕获（不用 2>&1 shell 重定向），stdout+stderr 合并打印即可。
            const result = spawnSync('k6', allArgs, {
                encoding: 'utf-8',
                maxBuffer: 512 * 1024 * 1024,
                // @ts-ignore
                windowsHide: true,
            });
            const output = (result.stdout || '') + (result.stderr || '');
            console.log(output);
            if (result.status !== 0) {
                const err = new Error(`k6 exited with code ${result.status}`);
                // @ts-ignore
                err.stdout = result.stdout;
                // @ts-ignore
                err.stderr = result.stderr;
                throw err;
            }
            // 返回 stdout+stderr 合并输出供调用方解析 ROOT_INFO。
            // ⚠️ k6 的 console.log 全部写到 stderr（不是 stdout！stdout 恒为空），
            //    因此必须带上 stderr，否则 buildTeam 在 stdout 里匹配不到 [ROOT_INFO]，
            //    会误报「无法从 step1_register 的输出中解析出根节点信息」。
            return (result.stdout || '') + (result.stderr || '');
        }
        // 不需要回读：直接把子进程输出继承到本进程 stdout，边跑边打印。
        // @ts-ignore
        execSync(`k6 ${allArgs.join(' ')} 2>&1`, { stdio: 'inherit' });
        return '';
    } catch (err) {
        // @ts-ignore
        console.error(`❌ 执行报错:\n${(err && err.stdout) || ''}\n${(err && err.stderr) || ''}`);
        throw err;
    }
}

// 阻塞式等待（Node 同步睡眠，跨平台，不依赖系统 sleep 命令）
function wait(seconds) {
    if (!seconds || seconds <= 0) return;
    console.log(`\n⏳ 等待 ${seconds}s ...`);
    // @ts-ignore
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

// @ts-ignore
function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
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
    }, true); // capture=true：需要回读输出解析 ROOT_INFO
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

// 阶段 2：单线程转线 Swap（每次随机搬 SWAP_MIN~SWAP_MAX 人）
// @ts-ignore
function runSwap(fromTeam, toTeam) {
    // @ts-ignore
    const fromId = roots[fromTeam].rootId;
    // @ts-ignore
    const toInvite = roots[toTeam].rootInvite;
    runK6('step2_swap.js', {
        FROM_ROOT_ID: fromId,
        TO_ROOT_INVITE: toInvite,
        FROM_TEAM: fromTeam,
        TO_TEAM: toTeam,
        SWAP_MIN: swapMin,
        SWAP_MAX: swapMax
    });
}

// 转线 + 前后等待：太快转线易出问题，前后各留缓冲
// @ts-ignore
function runSwapWithWait(fromTeam, toTeam) {
    wait(swapPreWait);
    runSwap(fromTeam, toTeam);
    wait(swapPostWait);
}

// 阶段：中途随机邀请新下级（挂到团队随机现有成员下）
// @ts-ignore
function runInvite(teamName, count) {
    // @ts-ignore
    runK6('step_invite.js', {
        TEAM_NAME: teamName,
        // @ts-ignore
        ROOT_ID: roots[teamName].rootId,
        // @ts-ignore
        ROOT_INVITE: roots[teamName].rootInvite,
        INVITE_COUNT: count
    });
}

// 阶段 3：多线程并发充投（可选提现）
// @ts-ignore
function runAction(teamName, options) {
    // @ts-ignore
    const rootId = roots[teamName].rootId;
    // 按队伍取对应总人数（支持 3 团队）
    const teamTotal = TEAM_TOTALS[teamName] || team1Total;
    runK6('step3_action.js', {
        TEAM_NAME: teamName,
        ROOT_ID: rootId,
        VUS: Math.min(parseInt(teamTotal), actionVus), // 降并发，避免限流导致充投不成
        INACTIVE_RATE: options.inactiveRate || 0,
        RECHARGE_ONLY_RATE: options.rechargeOnlyRate || 0,
        WITHDRAW_RATE: options.withdrawRate || 0,          // 0=本阶段不提现
        ENABLE_BACKEND_APPROVAL: enableBackendApproval
    });
}

// 阶段：执行后层级验证 —— 一次性验证所有总代（队根 + 转线遗留的野生总代）
// @ts-ignore
function runVerifyAll(teamNames) {
    // @ts-ignore
    const rootIds = teamNames.map((t) => roots[t] && roots[t].rootId).filter(Boolean).join(',');
    console.log(`\n🔎 验证所有总代（队根 ${rootIds} + 转线遗留的野生总代）...`);
    runK6(VERIFY_SCRIPT_ALL, { ROOT_IDS: rootIds });
}

// 配置定义
const full = { inactiveRate: 0, rechargeOnlyRate: 0 };
const recharge = { inactiveRate: 0, rechargeOnlyRate: 1 };
const v2Mode = { inactiveRate: globalInactive, rechargeOnlyRate: globalRechargeOnly };
// 最终阶段：V2 分层 + 充投人群按概率提现
const v2WithWithdraw = { inactiveRate: globalInactive, rechargeOnlyRate: globalRechargeOnly, withdrawRate: withdrawRate };
// @ts-ignore
const none = null;

// 执行多种模式的流水线时序编排
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

        case 'mode_3team': {
            // 3 团队 + 转线前后随机邀请 + 相互转线6次 + 最终提现 —— 更贴近线上复杂场景
            // 建A/B/C → 各队充投 → [转线前邀请波] → 新人充投 →
            // 6次相互转线(A↔B, A↔C, B↔C 各双向，每次随机1~3人，前后等待) →
            // [转线后邀请波] → 最终全员(含转入成员+两波新下级)充投 + 按概率提现
            console.log('\n🌟 流水线开始：mode_3team - 3团队/转线前后邀请/相互转线6次/提现');
            const teams = ['TeamA', 'TeamB', 'TeamC'];

            // 1) 并发建三支团队
            buildTeam('TeamA', team1Total, team1Levels);
            buildTeam('TeamB', team2Total, team2Levels);
            buildTeam('TeamC', team3Total, team3Levels);

            // 2) 各队初始充投（V2 随机分层，暂不提现）
            for (const t of teams) runAction(t, v2Mode);

            // 3) 转线前邀请波：每队随机 inviteMin~inviteMax 个新下级
            for (const t of teams) runInvite(t, randInt(inviteMin, inviteMax));

            // 4) 新下级也充投（此时活树已含新人，step3 会自动纳入）
            for (const t of teams) runAction(t, v2Mode);

            // 5) 6 次相互转线（每个有向对各一次，前后等待）
            const swapPairs = [
                ['TeamA', 'TeamB'], ['TeamB', 'TeamA'],
                ['TeamA', 'TeamC'], ['TeamC', 'TeamA'],
                ['TeamB', 'TeamC'], ['TeamC', 'TeamB'],
            ];
            let n = 0;
            for (const pair of swapPairs) {
                n++;
                console.log(`\n🔁 相互转线 ${n}/${swapPairs.length}: ${pair[0]} → ${pair[1]}`);
                runSwapWithWait(pair[0], pair[1]);
            }

            // 6) 转线后邀请波：每队再随机 inviteMin~inviteMax 个新下级
            for (const t of teams) runInvite(t, randInt(inviteMin, inviteMax));

            // 7) 最终全员充投 + 按概率提现（含转入成员 + 两波新下级）
            for (const t of teams) runAction(t, v2WithWithdraw);

            // 8) 执行完毕，等待 3 分钟（让转线/改挂的层级重算、总代回填等后端异步处理落地）
            //    再对 3 个团队逐一做「层级 + 总代 + 转线」验证，有问题可精确定位到具体会员。
            if (!skipVerify) {
                console.log(`\n🕒 3 团队执行完毕，等待 ${verifyWaitSec}s 后进行层级验证 ...`);
                wait(verifyWaitSec);
                console.log(`\n${'█'.repeat(3)} 开始验证所有总代（3 队根 + 转线遗留的野生总代）${'█'.repeat(3)}`);
                try {
                    runVerifyAll(teams);
                } catch (e) {
                    // @ts-ignore
                    console.error(`⚠️ 总代验证执行异常: ${e && e.message}`);
                }
            } else {
                console.log(`\n⏭️ 已设置 SKIP_VERIFY=true，跳过执行后层级验证`);
            }
            break;
        }

        // 这里仅展示了最典型的几个模式，后续您可以非常方便地按需添加 case 'modeX'
        // 所有时序逻辑都能被完美控制，因为 K6 的执行被强行同步化了！
        default:
            console.error(`❌ 未实现或不支持的模式: ${rebateMode}`);
            break;
    }
    console.log('\n🎉 所有多线程流水线步骤执行完毕！');
}

main();

// 【已修复 2026-07-08】"人数/层级不对(如130只建出60)"的根因：注册接口有 msgCode=13 "Too frequent"
// 限流，step1 原实现失败即丢人且不重试(成功日志还被注释)，并发下大量注册被静默丢弃，同时压平层级。
// 修复：step1_register.js 对根/下级注册与取邀请码均加限流退避重试，按名额重试直到建成，
// 并打印 [BUILD_RESULT] 目标 vs 实建 对账。若仍见"丢失>0"，调大 -e MAX_REG_ATTEMPTS 或降低 VUS。
