# 多线程多级返佣测试流水线 (Multi-Thread Pipeline)

## 架构概述

本项目引入了全新的**流水线 (Pipeline) 测试架构**，专门用来解决传统单脚本 K6 无法“**多线程并发造数据 -> 单线程严格时序调度 -> 多线程并发打流水**”的技术瓶颈。

我们不再使用单脚本的同步 `for` 循环，而是将业务拆分到了 3 个高度专一的子脚本中，并由 Node.js 作为大脑统一调度。

### 核心组件说明

- 🧠 **`runner.js`**：Node.js 调度器。整个框架的大脑，它负责编排业务的时序（多种模式，含新版 3 团队复杂场景 `mode_3team`）。
- 🚀 **`step1_register.js`**：负责并发“**建树**”。内部集成了分布式森林算法，支持几百个 VU 同时挂载用户。注册完毕后会将总代信息交还给调度器。
- ➕ **`step_invite.js`**：负责“**中途追加下级**”。拉取团队活树、随机挑现有成员当上级，在其下注册若干新下级（转线前/后各一波）。新下级会被后续 `step3_action` 自动纳入充投提。
- 🎯 **`step2_swap.js`**：负责“**解绑绑定 (Swap)**”。单线程运行，拉取全树名单，**每次随机搬 `SWAP_MIN`~`SWAP_MAX` 人**（默认 1~3）完成团队转换。
- 💸 **`step3_action.js`**：负责“**并发充投提**”。每次运行前实时请求最新树结构（含刚转线过来的成员 + 新邀请的下级），把人员均匀分配给所有 VU，高并发进行充值、投注、**以及按概率提现**（`WITHDRAW_RATE`）。

---

## 快速使用说明

### 1. 运行依赖
本架构由 Node.js 驱动 K6 命令，因此你需要先确保终端进入当前文件夹：
```bash
cd d:\project\k6-\k6\tests\api\sixearn\multiThread
```

### 2. 运行示例命令

**运行默认的 Mode 1 (A充投 -> 互相解绑绑定 -> B充投)：**
```bash
node runner.js
```

**运行复杂模式 Mode 14 (全程随机，最大不确定性)：**
```bash
$env:REBATE_MODE="mode14"
$env:TEAM1_TOTAL="50"
$env:TEAM2_TOTAL="50"
node runner.js
```

**运行新版 3 团队复杂场景 `mode_3team`（默认模式）：**
```bash
# 直接 node runner.js 即为该模式（REBATE_MODE 默认 mode_3team）
$env:TEAM1_TOTAL="20"; $env:TEAM2_TOTAL="20"; $env:TEAM3_TOTAL="20"  # 每队 20 人
$env:TEAM1_LEVELS="6"; $env:TEAM2_LEVELS="6"; $env:TEAM3_LEVELS="6"  # 6 级
$env:SWAP_MIN="1"; $env:SWAP_MAX="3"           # 每次转线随机搬 1~3 人
$env:SWAP_PRE_WAIT="5"; $env:SWAP_POST_WAIT="8" # 转线前/后等待秒数
$env:INVITE_MIN="2"; $env:INVITE_MAX="5"        # 每队每波邀请 2~5 个新下级
$env:WITHDRAW_RATE="0.3"                        # 充投人群最终阶段 30% 概率提现
$env:VERIFY_WAIT_SEC="300"                      # 执行完毕后等待 5 分钟再做层级验证
node runner.js
```
> 流程：建 A/B/C → 各队充投 → 转线前邀请波 → 新人充投 → **6 次相互转线**(A↔B、A↔C、B↔C 各双向，前后等待) → 转线后邀请波 → 最终全员(含转入+新下级)充投 + 按概率提现
> **→ 等待 5 分钟 → 验证「所有总代」**：3 个队根 + **当天转线遗留的野生总代**（解绑后没绑回团队、卡在 newParentId=0 的漏网之鱼）。用 `agentHierarchy/verifyAllGeneralAgents.test.js`，逐个总代出「层级 + 总代generalAgentId + 转线」报告，有问题精确到具体会员。
> 想让提现真正出款(走后台审核)：加 `$env:ENABLE_BACKEND_APPROVAL="true"`。想跳过验证：`$env:SKIP_VERIFY="true"`。

*(说明：在 Windows PowerShell 下使用 `$env:` 赋值环境变量；如果你使用 cmd 或 bash，请相应替换为 `set` 或 `export`)*

---

## 环境变量配置表

| 参数名 | 说明 | 默认值 |
|--------|------|--------|
| `TENANT_ID` | 测试租户 ID | `3007` |
| `REBATE_MODE` | 要运行的测试模式名称（见 runner.js 的 switch 块）| `mode_3team` |
| `TEAM1_TOTAL` / `TEAM1_LEVELS` | 团队A 的总人数 / 最大层级 | `20` / `6` |
| `TEAM2_TOTAL` / `TEAM2_LEVELS` | 团队B 的总人数 / 最大层级 | `20` / `6` |
| `TEAM3_TOTAL` / `TEAM3_LEVELS` | 团队C 的总人数 / 最大层级（仅 3 团队模式用） | `20` / `6` |
| `INACTIVE_RATE` | V2模式：不活跃人群比例（啥都不干） | `0.1` |
| `RECHARGE_ONLY_RATE` | V2模式：只充值人群比例（不投注） | `0.1` |
| `ACTION_VUS` | 充投并发 VU 数（限流敏感，勿调高） | `4` |
| `SWAP_MIN` / `SWAP_MAX` | 每次转线随机搬的人数区间 | `1` / `3` |
| `SWAP_PRE_WAIT` / `SWAP_POST_WAIT` | 每次转线前 / 后的等待秒数 | `5` / `8` |
| `INVITE_MIN` / `INVITE_MAX` | 每队每波中途邀请的新下级人数区间 | `2` / `5` |
| `WITHDRAW_RATE` | 最终阶段充投人群的提现概率 | `0.3` |
| `ENABLE_BACKEND_APPROVAL` | 提现是否走后台审核出款 | `false` |
| `VERIFY_WAIT_SEC` | 执行完毕后、层级验证前的等待秒数 | `300` |
| `SKIP_VERIFY` | 设 `true` 跳过执行后的层级验证 | `false` |

> V2 模式充投(充值+投注)人群 = 1 − `INACTIVE_RATE` − `RECHARGE_ONLY_RATE`（剩余项，默认 80%），无独立配置项。

---

## 如何添加或修改自定义模式 (Developer Guide)

如果你需要扩展 `mode2` ~ `mode17`，或者是你自己独创的时序模式，你只需要修改 `runner.js` 文件中的 `switch(rebateMode)` 块，像搭积木一样排列组合即可。

例如：如果你想要创造一个新模式：
`[绑定前TeamA充投] -> [执行A->B转线] -> [绑定后TeamB全员(含新进来的A成员)只充值]`

你只需要在 `runner.js` 添加：

```javascript
case 'my_custom_mode':
    console.log('\n🌟 流水线开始：自定义模式');
    buildTeam('TeamA', team1Total, team1Levels);
    buildTeam('TeamB', team2Total, team2Levels);
    
    // 绑定前 A 充投
    runAction('TeamA', full); 
    
    // 单向转线：A 成员转去 B
    runSwap('TeamA', 'TeamB'); 
    
    // 绑定后 B 团队只充值 (注意: B现在包含了刚刚转进来的A成员!)
    runAction('TeamB', recharge); 
    break;
```

### API 积木块说明
- `buildTeam(teamName, total, levels)`: 使用多线程极速建队。
- `runInvite(teamName, count)`: 给团队随机现有成员下追加 `count` 个新下级（转线前/后各来一波）。
- `runSwap(fromTeam, toTeam)`: 触发单线程解绑绑定，每次随机搬 `SWAP_MIN`~`SWAP_MAX` 人。
- `runSwapWithWait(fromTeam, toTeam)`: 在 `runSwap` 前后各加 `SWAP_PRE_WAIT`/`SWAP_POST_WAIT` 秒等待（避免转线过快出问题）。
- `wait(seconds)`: 调度器层的阻塞等待（Node 同步睡眠）。
- `runAction(teamName, mode)`: 触发多线程并行充投（提）。mode 可加 `withdrawRate` 字段开启提现。其中 mode 可以是：
  - `full` : 全员必充值且投注
  - `recharge` : 全员只充值，不投注
  - `v2Mode` : 三段式随机人群划分，比例由 `INACTIVE_RATE` / `RECHARGE_ONLY_RATE` 控制。
    **充投(充值+投注)是剩余项** = 1 − 不活跃 − 只充值。
    代码默认 `0.1 / 0.1` → **10%不活跃 + 10%只充值 + 80%充投**（如需 60%充投则设两者均为 0.2）
  - `none` : 内部逻辑直接跳过不执行

---

## 设计哲学与高级原理

本框架彻底抛弃了**内存状态共享**。
当 `step3_action.js` 执行 `runAction('TeamB')` 时，它会调用 API 去服务器实时查询 `TeamB` 总代下面真实存在的下级成员。因此：
**只要 `step2_swap.js` 在前一步成功把人转了过去，下一步多线程打流水时，新成员就能被100%精准识别并分配到独立的 VU 手中进行高并发压测。** 

这正是业界在面对 K6 这种“无共享内存多并发”测试框架时最稳定、解耦度最高的标准解决方案。
