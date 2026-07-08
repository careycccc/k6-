# 多线程多级返佣测试流水线 (Multi-Thread Pipeline)

## 架构概述

本项目引入了全新的**流水线 (Pipeline) 测试架构**，专门用来解决传统单脚本 K6 无法“**多线程并发造数据 -> 单线程严格时序调度 -> 多线程并发打流水**”的技术瓶颈。

我们不再使用单脚本的同步 `for` 循环，而是将业务拆分到了 3 个高度专一的子脚本中，并由 Node.js 作为大脑统一调度。

### 核心组件说明

- 🧠 **`runner.js`**：Node.js 调度器。整个框架的大脑，它负责编排业务的时序（例如你的 17 种模式）。
- 🚀 **`step1_register.js`**：负责并发“**建树**”。内部集成了分布式森林算法，支持几百个 VU 同时挂载用户。注册完毕后会将总代信息交还给调度器。
- 🎯 **`step2_swap.js`**：负责“**解绑绑定 (Swap)**”。单线程运行，负责拉取全树名单，根据算法随机挑人并完成团队转换。
- 💸 **`step3_action.js`**：负责“**并发充投**”。每次运行前会实时请求最新树结构（包含刚转线过来的成员），把人员均匀分配给所有 VU，高并发进行充值和投注操作。

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

*(说明：在 Windows PowerShell 下使用 `$env:` 赋值环境变量；如果你使用 cmd 或 bash，请相应替换为 `set` 或 `export`)*

---

## 环境变量配置表

| 参数名 | 说明 | 默认值 |
|--------|------|--------|
| `TENANT_ID` | 测试租户 ID | `3006` |
| `REBATE_MODE` | 要运行的测试模式名称（见 runner.js 的 switch 块）| `mode1` |
| `TEAM1_TOTAL` | 团队A 的总生成人数 | `10` |
| `TEAM1_LEVELS`| 团队A 的最大层级深度 | `3` |
| `TEAM2_TOTAL` | 团队B 的总生成人数 | `10` |
| `TEAM2_LEVELS`| 团队B 的最大层级深度 | `3` |
| `INACTIVE_RATE` | V2模式：不活跃人群比例（啥都不干） | `0.1` |
| `RECHARGE_ONLY_RATE` | V2模式：只充值人群比例（不投注） | `0.1` |

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
- `runSwap(fromTeam, toTeam)`: 触发单线程解绑绑定。
- `runAction(teamName, mode)`: 触发多线程并行充投。其中 mode 可以是：
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
