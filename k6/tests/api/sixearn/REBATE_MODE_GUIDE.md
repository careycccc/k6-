# 多级返佣流程测试 - 16种模式说明文档

## 概述

`multiLevelRebate.test.js` 通过 `REBATE_MODE` 环境变量支持 16 种测试模式。  
核心测试逻辑围绕**解绑绑定前后**两个团队的行为组合，验证返佣结算在不同场景下的正确性。

---

## 行为标识说明

| 标识 | 含义 |
|------|------|
| `充投` | 全部成员充值 + 投注 |
| `只充值` | 全部成员只充值，不投注 |
| `无` | 不做任何操作 |
| `V2` | 三段式随机分层（默认 20% 不活跃 / 20% 只充值 / 60% 充投） |

---

## 公共参数

| 参数 | 含义 | 默认值 |
|------|------|--------|
| `TENANT_ID` | 租户ID | `3004` |
| `TEAM1_TOTAL` | 团队A总人数 | `50` |
| `TEAM1_LEVELS` | 团队A层级数 | `4` |
| `TEAM2_TOTAL` | 团队B总人数 | `40` |
| `TEAM2_LEVELS` | 团队B层级数 | `3` |
| `REBATE_MODE` | 测试模式 | `mode1` |
| `INACTIVE_RATE` | V2 不活跃比例（全局） | `0.2` |
| `RECHARGE_ONLY_RATE` | V2 只充值比例（全局） | `0.2` |
| `TEAM1_INACTIVE_RATE` | V2 不活跃比例（团队A单独覆盖） | 同全局 |
| `TEAM1_RECHARGE_ONLY_RATE` | V2 只充值比例（团队A单独覆盖） | 同全局 |
| `TEAM2_INACTIVE_RATE` | V2 不活跃比例（团队B单独覆盖） | 同全局 |
| `TEAM2_RECHARGE_ONLY_RATE` | V2 只充值比例（团队B单独覆盖） | 同全局 |

---

## 16 种模式详细说明

### 流程图说明
```
[绑定前 A 行为] | [绑定前 B 行为] → A→B 解绑绑定, B→A 解绑绑定 → [绑定后 A 行为] | [绑定后 B 行为]
```

---

如果需要加入L3的自动验证需要添加  -e VERIFY=L3

### mode1（默认）— 基准模式

**流程：** `A充投 | 无 → A→B, B→A → 无 | B充投`

**说明：**  
团队A先完成充值投注，团队B不做任何操作。互换成员后，团队B再进行充值投注。  
验证：A的历史充投记录在成员换组后，B的新充投返佣归属是否正确。

```bash
k6 run -e TENANT_ID=3007 -e TEAM1_TOTAL=1 -e TEAM1_LEVELS=0 -e TEAM2_TOTAL=0 -e TEAM2_LEVELS=0  multiLevelRebate.test.js
```

---

### mode2 — 双方充投后互换

**流程：** `A充投 | B充投 → A→B, B→A → 无 | 无`

**说明：**  
双方都完成充值投注后再互换成员，互换后不再做任何操作。  
验证：已有充投记录的成员被换组后，历史返佣数据归属是否正确，不产生重复结算。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode2 multiLevelRebate.test.js
```

---

### mode3 — A只充值，换人后B充投

**流程：** `A只充值 | 无 → A→B, B→A → 无 | B充投`

**说明：**  
团队A只充值不投注，团队B不做操作。互换成员后，团队B进行完整充投。  
验证：充值但未投注的成员换组后，投注发生在新团队，返佣应归新团队。

```bash
k6 run -e TENANT_ID=3007 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 -e REBATE_MODE=mode3 multiLevelRebate.test.js
```

---

### mode4 — 先换人再双方充投

**流程：** `无 | 无 → A→B, B→A → A充投 | B充投`

**说明：**  
双方都不做任何操作，直接互换成员，换人后双方再各自充投。  
验证：完全空白成员换组后再充投，返佣完全归新团队，无历史数据干扰。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode4 multiLevelRebate.test.js
```

---

### mode5 — 换人前后A持续充投

**流程：** `A充投 | 无 → A→B, B→A → A充投 | B充投`

**说明：**  
团队A在换人前后持续充投，团队B换人后也进行充投。  
验证：A持续充投中途换入新成员，新成员的后续行为是否影响A的返佣连续性。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode5 multiLevelRebate.test.js
```

---

### mode6 — 换人前只充值，换人后补投注

**流程：** `A只充值 | B只充值 → A→B, B→A → A充投 | B充投`

**说明：**  
双方换人前都只充值不投注，换人后双方再补完整充投。  
验证：充值和投注被解绑绑定动作分隔，投注返佣应归换人后的新团队。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode6 multiLevelRebate.test.js
```

---

### mode7 — A充投B只充，换人后B补完

**流程：** `A充投 | B只充值 → A→B, B→A → 无 | B充投`

**说明：**  
团队A完整充投，团队B只充值。互换后团队B补完投注。  
验证：混合状态下换人，B补投注的返佣是否正确归属。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode7 multiLevelRebate.test.js
```

---

### mode8 — B先充投，换人后A充投（对称）

**流程：** `无 | B充投 → A→B, B→A → A充投 | 无`

**说明：**  
与 mode1 完全对称，B先充投，换人后A再充投。  
验证：顺序颠倒是否影响返佣结算结果，与 mode1 对比验证对称性。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode8 multiLevelRebate.test.js
```

---

### mode9 — A随机分层，换人后B随机分层

**流程：** `A(V2) | 无 → A→B, B→A → 无 | B(V2)`

**说明：**  
团队A用V2三段式随机分层充投，团队B换人后也用V2随机分层。  
验证：随机行为下换人，返佣结算是否稳定。

```bash
k6 run -e TENANT_ID=3007 -e TEAM1_TOTAL=45 -e TEAM1_LEVELS=6 -e TEAM2_TOTAL=25 -e TEAM2_LEVELS=3 -e REBATE_MODE=mode9 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 multiLevelRebate.test.js
```

---

### mode10 — 双方随机分层后互换

**流程：** `A(V2) | B(V2) → A→B, B→A → 无 | 无`

**说明：**  
双方都用V2随机分层充投后互换，互换后不再操作。  
验证：双方都有随机历史数据时，换人后返佣归属是否正确。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode10 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

### mode11 — 换人后双方随机分层

**流程：** `A充投 | 无 → A→B, B→A → A(V2) | B(V2)`

**说明：**  
换人前A确定充投，换人后双方都用V2随机分层。  
验证：确定行为换人后引入随机行为，返佣结算是否受影响。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode11 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

### mode12 — A随机B只充，换人后B补完

**流程：** `A(V2) | B只充值 → A→B, B→A → 无 | B充投`

**说明：**  
团队A随机分层，团队B只充值。换人后团队B补完投注。  
验证：A随机行为与B半完整行为交叉，换人后B补投注的返佣归属。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode12 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

### mode13 — A只充B随机，换人后A补完

**流程：** `A只充值 | B(V2) → A→B, B→A → A充投 | 无`

**说明：**  
与 mode12 对称，A只充值，B随机分层，换人后A补完投注。  
验证：对称场景下返佣归属的一致性。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode13 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

### mode14 — 全程随机，最大不确定性

**流程：** `A(V2) | B(V2) → A→B, B→A → A(V2) | B(V2)`

**说明：**  
全程所有阶段都使用V2三段式随机分层，最大化测试不确定性。  
验证：系统在高度随机行为下的返佣结算稳定性和正确性。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode14 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js

# 两个团队使用不同的V2比例
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=35 -e TEAM1_LEVELS=4 -e TEAM2_TOTAL=25 -e TEAM2_LEVELS=3 -e REBATE_MODE=mode14 -e TEAM1_INACTIVE_RATE=0.3 -e TEAM1_RECHARGE_ONLY_RATE=0.1 -e TEAM2_INACTIVE_RATE=0.1 -e TEAM2_RECHARGE_ONLY_RATE=0.3   multiLevelRebate.test.js
```

---

### mode15 — A确定B随机交叉

**流程：** `A充投 | B(V2) → A→B, B→A → A(V2) | B充投`

**说明：**  
换人前A确定充投、B随机，换人后A随机、B确定充投。行为交叉对称。  
验证：确定行为与随机行为交叉时，返佣结算是否受随机性影响。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode15 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

### mode16 — 与 mode15 完全对称

**流程：** `A(V2) | B充投 → A→B, B→A → A充投 | B(V2)`

**说明：**  
与 mode15 完全对称，换人前A随机、B确定，换人后A确定、B随机。  
验证：与 mode15 对比，确认对称场景下结算结果的一致性。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 \
  -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 \
  -e REBATE_MODE=mode16 -e INACTIVE_RATE=0.2 -e RECHARGE_ONLY_RATE=0.2 \
  multiLevelRebate.test.js
```

---

## 模式速查表

| 模式 | 绑定前 A | 绑定前 B | 绑定后 A | 绑定后 B | 核心验证点 |
|------|---------|---------|---------|---------|-----------|
| mode1 | 充投 | 无 | 无 | 充投 | 基准：A先充投换人后B充投 |
| mode2 | 充投 | 充投 | 无 | 无 | 双方充投后互换，历史数据归属 |
| mode3 | 只充值 | 无 | 无 | 充投 | 充值未投注换组，投注归新团队 |
| mode4 | 无 | 无 | 充投 | 充投 | 空白成员换组后充投，无历史干扰 |
| mode5 | 充投 | 无 | 充投 | 充投 | A持续充投，换人后连续性 |
| mode6 | 只充值 | 只充值 | 充投 | 充投 | 充值投注被换人分隔，投注归新团队 |
| mode7 | 充投 | 只充值 | 无 | 充投 | 混合状态换人，B补投注归属 |
| mode8 | 无 | 充投 | 充投 | 无 | mode1 对称，验证顺序影响 |
| mode9 | V2 | 无 | 无 | V2 | 单侧随机换人 |
| mode10 | V2 | V2 | 无 | 无 | 双侧随机后互换 |
| mode11 | 充投 | 无 | V2 | V2 | 确定行为换人后引入随机 |
| mode12 | V2 | 只充值 | 无 | 充投 | A随机B半完整，B补投注 |
| mode13 | 只充值 | V2 | 充投 | 无 | mode12 对称 |
| mode14 | V2 | V2 | V2 | V2 | 全程随机，最大不确定性 |
| mode15 | 充投 | V2 | V2 | 充投 | 确定与随机交叉 |
| mode16 | V2 | 充投 | 充投 | V2 | mode15 对称 |
| mode17 | 充投 | 无 | 无 | 无 | A充投换人后双方静止，验证历史返佣归属 |

---

## V2 三段式分层说明

V2 模式将团队成员按概率随机分为三组：

| 分组 | 默认比例 | 行为 |
|------|---------|------|
| 不活跃 | 20%（`INACTIVE_RATE`） | 不充值，不投注 |
| 半活跃 | 20%（`RECHARGE_ONLY_RATE`） | 只充值，不投注 |
| 活跃 | 60%（剩余） | 充值 + 投注 |

> 注意：`INACTIVE_RATE + RECHARGE_ONLY_RATE` 不能超过 1。

---

### mode17 — A充投，B无操作，互换后结束

**流程：** `A充投 | 无 → A→B, B→A → 无 | 无`

**说明：**  
团队A完成充值投注，团队B不做任何操作。互换成员后，双方都不再进行任何充投。  
验证：A的历史充投记录在成员换组后，返佣归属是否正确，且换入B的成员不产生新的充投行为。

```bash
k6 run -e TENANT_ID=3004 -e TEAM1_TOTAL=15 -e TEAM1_LEVELS=4 -e TEAM2_TOTAL=10 -e TEAM2_LEVELS=3 -e REBATE_MODE=mode17 multiLevelRebate.test.js
```
