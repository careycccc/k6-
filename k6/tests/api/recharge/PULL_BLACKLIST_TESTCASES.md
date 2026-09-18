# 充值拉单黑名单（拉单监控）风控 —— 测试用例文档

> 关联脚本：
> - `pullBlacklistVerify.js`（k6 用例实现，一用例=一VU=一真实用户）
> - `pullBlacklistRunner.js`（Node 包装器，汇总打印每条用例：执行/用户ID/预期/实际/详情）
> - `pullMonitorApi.js`（`GetPageList` / `SetLimitTime` 接口封装）

---

## 一、规则模型（后台实测已对齐）

| 维度 | 规则 |
|---|---|
| 触发口径 | 单日**累计未支付订单数 > 阈值**（默认 5，即 ≥6 触发）；阈值在后台「监控配置」调整（本套脚本不动，人工测） |
| 累计未支付 | 未支付 = `Wait`(待处理) + 待审核(`PendingReview`) + 已取消(`Cancel`) 等所有非 `Payed`；累计未支付 = `pullOrderCount`(当日累计发起数,**只增不减**) − `paidOrderCount`(已支付数) |
| 超时取消 | `Wait` 约 **5 分钟自动转 `Cancel`**，但 **`Cancel` 仍算未支付** → 未支付数不降、**不抵消触发**（快慢都一样）；已取消订单仍可**手动补单**变 `Payed` |
| 检测机制 | 后台**每 10 分钟轮询一次**；轮询到才在 `GetPageList` 出现记录（**非实时**） |
| 两阶段 | ① 进入监控名单 = 已风控（监控中）；② 仅当 `SetLimitTime` 设置了 `limitStartTime` 后前台才**正式被拦**；**进表但未设限 → 前台可无限发** |
| 前台被拦 | `/api/Recharge/GoodsDepositRecharge` 返回 **`msgCode===10068`**（`code=11`，"restricted due to frequent operations"） |
| 限制时长 | `SetLimitTime`，闭区间 **[30, 1440]** 的**整数**分钟 |
| 多次设置 | 后一次必须 **> 前一次**；时长是**绝对值、不累加**，从 GetPageList 响应的 **`limitStartTime`** 算起；**到期后再设更大值 → 重新被风控**（前台无法发起）直到新 `limitEndTime` |
| 解除 | 到达 `limitEndTime` 后前台恢复正常发起 |
| 记录唯一性 | **一个会员一天只能有一条记录（同一 `tenantDate`），出现两条即 bug** |
| 跨天 | 数据只按「当天」：今天订单算今天、明天算明天；下一天的触发/限制按下一天报表；限制最多跨 1 天（≤1440） |
| 数据生命周期 | **一旦进表，后台每 10min 轮询持续刷新该会员当天全量**：`pullOrderCount`(今天所有订单) / `paidOrderCount`(今天已支付) 会累计当天所有变化（含解封后再发起、再补单），直到当天结束 |
| 时区 | 服务器**印度 UTC+5:30**；`tenantDate` 与查询范围一律按印度时区生成 |

> ⚠️ 重要纠正：触发看的是**累计未支付数（pullOrderCount）**，不是"当前 Wait 数"。实测 167388 慢发 9 次、当前 Wait 峰值仅 5，因累计=9 照样进表（只是没设限所以前台还能发）。

**绝对值示例**：10:00 起风控，设 30 → 10:30 解除；未到期再设 40 → **10:40** 解除（= 起点+40，不是 10:30+40）。

### 关键接口

| 接口 | 用途 | 关键字段 |
|---|---|---|
| `POST /api/RechargePullMonitor/GetPageList` | 查监控名单 | `startTime/endTime` 为**字符串** `"YYYY-MM-DD HH:mm:ss"`（印度时区） |
| `POST /api/RechargePullMonitor/SetLimitTime` | 设置限制时长 | `tenantDate` 字符串 `"YYYY-MM-DD"`、`limitMinutes` |
| `POST /api/Recharge/GoodsDepositRecharge` | 前台充值发起 | 被拦 `msgCode=10068` |
| `POST /api/RechargeOrder/GetRechargeOrderPageList` | 后台查累计/已支付订单数（造数计数口径） | 时间用**毫秒**范围；`rechargeState=''` 查全部，`'Payed'` 查已支付 |

**GetPageList 记录字段**：`pullOrderCount`(当日累计拉单数) / `paidOrderCount`(已支付数) / `triggerTime` / `lastUpdateTime` / `limitStartTime` / `limitEndTime` / `limitMinutes` / `totalLimitMinutes` / `lastUpdateMan`。

---

## 二、自动化用例（脚本已实现）

> **短脚本（默认全跑，16 条）**：当天/几十分钟内可完成，默认 `--max-duration 120m`。
> **长脚本（2 条，默认不跑）**：`cross_day`（半夜发起）/ `dubai_release`（第二天迪拜 10 点解除），要跑到午夜/第二天，须 `--cases` 单独跑并加 `--max-duration 24h`。

| 编号 | case 名 | 组别 | 预期 | 约耗时 |
|---|---|---|---|---|
| PB-01 | `trigger` | 短 | 造累计未支付 >5 → 等轮询**进入监控名单**，且**今日仅 1 条记录** | ~15min |
| PB-02 | `no_trigger` | 短 | 只造累计未支付 =5 → 等 ~13min **不进名单** | ~15min |
| PB-03 | `cancel_still_trigger` | 短 | 造 6 笔 → 等 5min 超时转 Cancel（仍算未支付）→ **仍进表** | ~22min |
| PB-04 | `limit_block` | 短 | 进表后 `SetLimitTime(30)` → 限制期内前台发起 **被拦(10068)** | ~18min |
| PB-05 | `no_limit_pass` | 短 | 进表但**不设限** → 连发 5 笔**全部成功(可无限发)** | ~18min |
| PB-06 | `limit_bounds` | 短 | `29→拒绝`、`1441→拒绝`、`30→成功`、`1440→成功` | ~18min |
| PB-07 | `limit_increase_absolute` | 短 | 先 30 后 40 → 起点不变、总时长=40min（**绝对值非累加**） | ~18min |
| PB-08 | `limit_decrease_reject` | 短 | 先 40 后设更小的 30 → **拒绝或不生效**（时长不变小） | ~18min |
| PB-09 | `paid_reduce_no_trigger` | 短 | **风控前补单**：发 8 笔→进表前补单使净未支付≤5 → **不触发** | ~15min |
| PB-10 | `paid_partial_trigger` | 短 | **风控前补部分**：发 8 补 2（净=6）→ 仍进表，验证 `pullOrderCount`/`paidOrderCount` | ~18min |
| PB-11 | `paid_during_no_release` | 短 | **风控中补单**：进表后补单降净未支付 → 记录**不撤销**、`paidOrderCount` 随轮询更新 | ~30min |
| PB-12 | `paid_after_limit` | 短 | **风控后补单**：进表+设限后补单 → 前台**仍被拦**、`limitEndTime` 不变、`paidOrderCount` 更新 | ~20min |
| PB-13 | `cross_day` | **长** | 设跨午夜的限制 → 等印度跨过今晚 00:00 → 前台发起**仍被拦(10068)** | 到午夜 |
| PB-14 | `dubai_release` | **长** | 今天限制到「明天迪拜 10:00」→ 到期后前台充值**可正常发起(code=0)** | 到第二天 |
| PB-15 | `data_keeps_updating` | 短 | 进表→设限 30min→等解除→再发 3 笔+补 2 单→轮询→`pullOrderCount`/`paidOrderCount` **累计增长** | ~60min |
| PB-16 | `update_last_4` | 短 | 进表后补单清空未支付 → 再发 **4 笔** → 轮询：表单应更新且与后台一致 | ~35min |
| PB-17 | `update_last_5` | 短 | 同上，最后一批 **5 笔** | ~35min |
| PB-18 | `update_last_6` | 短 | 同上，最后一批 **6 笔** | ~35min |

> ⚠️ 短脚本组默认并发全跑，整组耗时取决于最慢的 `data_keeps_updating`（约 60min），故默认 `--max-duration 120m`。**maxDuration 必须 ≥ 最慢用例耗时，否则用例还在等轮询/等解除时会被 k6 强杀、跑不出结果**（`per-vu-iterations` 下 maxDuration 只是上限，用例做完即退，宁大勿小）。

### 补单说明
- 补单 = 后台把「未支付」订单（`Wait`/`Cancel`/待审核 等所有非 `Payed`，含超时取消的）审核成 `Payed`（`ManualAuditRechargeOrder`/`ManualAuditLocalRechargeOrder`，三方优先补，其次本地）。
- `paidOrderCount` 每 10 分钟轮询更新：`paid_reduce`/`paid_partial` 在进表轮询前补单，进表记录一次性带上正确 `paidOrderCount`；`paid_during`/`paid_after` 进表后才补，需再等一个轮询周期才能看到变化。

### 长脚本说明
- `cross_day`：脚本自动把 `limitEndTime` 设到「明天印度 00:30」（`limitMinutes` 夹在 [30,1440]）。**建议临近印度午夜再跑**，否则距午夜 >24h 无法一次设够时长（脚本会直接判 FAIL 并提示）。**必须 `--max-duration 24h`**。
- `dubai_release`：脚本把 `limitEndTime` 设到「下一个迪拜 10:00」（迪拜 UTC+4）。**建议印度傍晚下班时跑**（此时到明天迪拜 10:00 < 24h）。**必须 `--max-duration 24h`**。

---

## 三、补充/手工用例（脚本未实现，需联调或人工）

| 编号 | 名称 | 优先级 | 预期 | 未自动化原因 |
|---|---|---|---|---|
| PB-M04 | 触发后 Wait 全超时取消，记录仍在 | P1 | 停发等所有 Wait 超时 → 监控记录**不撤销** | `cancel_still_trigger` 已部分覆盖 |
| PB-M05 | 限制期内 Wait 超时不影响 limitEndTime | P1 | 限制期内原 Wait 全取消，`limitEndTime` 不变、仍被拦 | 需长等待 |
| PB-M06 | 相等时长边界 | P1 | 先 40 再 40 → 验证"大于"是否严格 | 补充 `limit_bounds` |
| PB-M07 | 到期后再设置（新窗口） | P1 | `limitEndTime` 已过后再设 → `limitStartTime` 是否重置为 now | 需等到期 |
| PB-M08 | 二次触发 | P1 | 到期恢复后再造累计未支付 >5 → 再次进限制 | 需等到期 |
| PB-M09 | 账号隔离 | P0 | A 被限制，B 正常发起成功 | 可后续加双账号用例 |
| PB-M10 | 只锁前台充值 | P1 | 限制期内提现/查询等不受影响 | 需接入其他链路 |
| PB-M11 | GetPageList/SetLimitTime 鉴权 | P1 | 错误 signature / 过期 timestamp → 拒绝 | 需构造异常请求 |
| PB-M12 | 被拒发起是否计入 pullOrderCount | P2 | 限制期内被拒的发起是否增加 `pullOrderCount` | 观察类 |

### 待确认口径
- **触发是否减 paid**：由 `paid_reduce_no_trigger`（发 8 补单到净 5 → 应不触发）与 `paid_partial_trigger`（净 6 → 仍进表）验证。若 `paid_reduce_no_trigger` 反而进表，说明触发看 `pullOrderCount`（不减 paid），据 detail 反馈开发。
- **PB-K07 轮询快照错过**：若触发是"轮询快照判定"，理论上可能出现"累计够了但轮询恰在超时后、当前状态已变"的边界；实测 167388 说明触发看累计、不看当前 Wait，故此风险基本不成立，`cancel_still_trigger` 会正面验证。
- **风控后更新丢失（PB-16/17/18，已知疑似 bug）**：已进表会员再次发起充值，若"最后一批未支付"未达阈值（如 4 笔），疑似轮询**跳过更新** → 监控表单 `pullOrderCount/paidOrderCount` 与后台真实订单**对应不上**。`update_last_4/5/6` 三档定位边界；正确行为是进表后任意批次都应更新到与后台一致。

---

## 四、运行方式

### 短脚本（默认全跑，16 条，默认 --max-duration 120m）
```bash
# 一次跑完全部 16 条短脚本（整组约 60min，取决于最慢的 data_keeps_updating）
node pullBlacklistRunner.js --tenant 3004

# 先小范围验证接口/判定（快，约 15~18min）
node pullBlacklistRunner.js --tenant 3004 --cases trigger,limit_bounds

# 只补单相关（确认补单链路 + paidOrderCount）
node pullBlacklistRunner.js --tenant 3004 --cases paid_reduce_no_trigger,paid_partial_trigger,paid_during_no_release,paid_after_limit

# 只跑"最后一批 4/5/6 笔更新对不上"的 bug 定位
node pullBlacklistRunner.js --tenant 3004 --cases update_last_4,update_last_5,update_last_6
```

### 长脚本（默认不跑，下班/过夜跑，必须 --max-duration 24h）
```bash
# 半夜发起（跨天仍风控） + 第二天迪拜10点解除后可充值
node pullBlacklistRunner.js --tenant 3004 --cases cross_day,dubai_release --max-duration 24h
```

> ⚠️ **k6 运行时长**：`--max-duration` 必须 ≥ 所跑用例里最慢的那条耗时，否则用例还在等轮询/等解除时就会被 k6 强制中断、拿不到结果。短脚本组默认 120m 已够；长脚本必须 24h。缩小 `--cases` 时可相应调小，但**只能调小到覆盖所选用例的最大耗时**。

**参数**：`--tenant` 租户 | `--cases` 用例清单（默认 16 条短脚本） | `--max-duration` k6 最大时长(默认 120m；长脚本必须 24h) | `--poll-sec` 进表轮询上限秒(默认 900) | `--poll-interval` 轮询间隔秒(默认 30) | `--threshold` 阈值(默认 5)。

### 造数节奏（重要）
- **触发只看累计未支付**（`pullOrderCount − paidOrderCount`），与快慢无关；造数发到累计未支付 >5 即可，再等最多一个 10min 轮询周期出记录。
- **超时取消不抵消**：`Wait` 5min 后转 `Cancel`，但累计不减，仍会触发。
- **解除/多次设时长**类不真 `sleep`，靠读 `limitStartTime/limitEndTime` 时间戳做算术断言。
- **计数只认后台**：造数计数用 `GetRechargeOrderPageList`（全部 / `Payed`）；进表后用 `GetPageList` 的 `pullOrderCount/paidOrderCount`。

---

## 五、结果输出

- 每条用例打印：`[PASS/FAIL] 用例 / 用户userId / 手机号 / 预期 / 实际 / 详情`
- 汇总：请求数 / 已执行 / 通过 / 失败；未产出结果的用例单列；FAIL 用例单独汇总
- 成功后落档 `pull_blacklist_result.txt`
