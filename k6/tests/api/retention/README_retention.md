# 复充测试体系使用说明

## 文件结构

```
k6/tests/api/retention/
├── retentionService.js          # 公共业务逻辑（被三个脚本复用，无需直接执行）
├── day1_seed.test.js            # 脚本①：第一天播种（注册+充值）
├── dayN_recharge.test.js        # 脚本②：第N天复充执行
├── dayN_verify.test.js          # 脚本③：复充率验证（纯查询）
├── rechargeRetention.test.js    # 原有：留存分析报表
└── rechargeRetentionApi.js      # 原有：API封装
```

---

## 脚本① day1_seed.test.js — 第一天播种

注册新用户并随机充值，充值策略：90%充1次 → 50%充2次 → 20%充3次（级联概率）。

```bash
# 基本用法（注册10人，使用租户专属配置）
k6 run -e TENANT_ID=3004 day1_seed.test.js

# 指定注册人数
k6 run -e TENANT_ID=3004 -e USER_COUNT=100 day1_seed.test.js

# 指定包类型
k6 run -e TENANT_ID=3101 -e USER_COUNT=50 -e PACKAGE_TYPE=3 day1_seed.test.js

# 指定邀请码
k6 run -e TENANT_ID=3004 -e USER_COUNT=100 -e INVITE_CODE=ABCDEFG day1_seed.test.js
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| TENANT_ID | 租户ID（必需） | ENV_CONFIG.TENANTID |
| USER_COUNT | 注册用户数量 | 10 |
| PACKAGE_TYPE | 埋点包类型（21/22/2/3/4/24） | 租户专属配置 |
| INVITE_CODE | 邀请码 | 配置文件中的邀请码 |
| COUNTRY_CODE | 手机号区号 | 91 |

---

## 脚本② dayN_recharge.test.js — 第N天复充执行

查询N天前充值成功的用户，以80%概率让其今天再次充值。

```bash
# 次日复充（查昨天的用户，今天让他们充值）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js

# 3日复充场景的第3天（查前天的用户）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=2 dayN_recharge.test.js

# 调整参与率为90%
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 -e PARTICIPATION_RATE=0.9 dayN_recharge.test.js

# 固定充值2次
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 -e RECHARGE_STRATEGY=double dayN_recharge.test.js
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| TENANT_ID | 租户ID（必需） | ENV_CONFIG.TENANTID |
| CHANNEL_PACKAGE_ID | 渠道来源ID（必需，不传直接报错） | - |
| DAYS_AGO | 查几天前的充值用户 | 1（昨天） |
| PARTICIPATION_RATE | 参与复充概率 | 0.8（80%） |
| RECHARGE_STRATEGY | 充值策略：single/double/triple/random（random=级联概率） | random |

---

## 脚本③ dayN_verify.test.js — 复充率验证

纯查询，验证连续N天都有充值的用户数量及复充率，不执行任何充值操作。

```bash
# 当日复充验证（昨天同一天内充值≥2次）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=1 dayN_verify.test.js

# 次日复充验证（前天+昨天，连续2天）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=2 dayN_verify.test.js

# 3日复充验证（连续3天）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=3 dayN_verify.test.js

# 7日复充验证（连续7天）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=7 dayN_verify.test.js
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| TENANT_ID | 租户ID（必需） | ENV_CONFIG.TENANTID |
| CHANNEL_PACKAGE_ID | 渠道来源ID（必需，不传直接报错） | - |
| RETENTION_DAYS | 验证连续几天 | 2（次日复充） |

**验证逻辑：**
- `RETENTION_DAYS=1`：当日复充，昨天同一天内充值≥2次的用户
- `RETENTION_DAYS≥2`：多天连续复充，今天往前推N天，每天都必须有充值记录
- 复充率 = |Day1 ∩ Day2 ∩ ... ∩ DayN| / |Day1|
- 永远不包含今天（今天数据未完整），今天只用于计算日期偏移

---

## 原有留存分析报表

```bash
# 当日复充分析
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=same_day rechargeRetention.test.js

# 次日复充分析
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=next_day rechargeRetention.test.js

# 指定目标日期
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=same_day -e TARGET_DATE=2026-04-16 rechargeRetention.test.js
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e MODE=next_day -e TARGET_DATE=2026-04-14 rechargeRetention.test.js
```

---

## 每日操作流程

### 次日复充测试（2天）

```bash
# 第1天：播种
k6 run -e TENANT_ID=3004 -e USER_COUNT=100 day1_seed.test.js

# 第2天：复充执行
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js

# 第2天：验证次日复充率
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=2 dayN_verify.test.js
```

### 3日复充测试（3天）

```bash
# 第1天：播种
k6 run -e TENANT_ID=3004 -e USER_COUNT=100 day1_seed.test.js

# 第2天：复充执行
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js

# 第3天：复充执行
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js

# 第3天：验证次日复充率（Day2→Day3）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=2 dayN_verify.test.js

# 第3天：验证3日复充率（Day1∩Day2∩Day3）
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=3 dayN_verify.test.js
```

### 7日复充测试

```bash
# 第1天：播种
k6 run -e TENANT_ID=3004 -e USER_COUNT=100 day1_seed.test.js

# 第2~7天：每天执行复充
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js

# 第7天：验证7日复充率
k6 run -e TENANT_ID=3004 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=7 dayN_verify.test.js
```

---

## 多租户支持

所有脚本通过 `-e TENANT_ID=xxxx` 切换租户，内部自动读取对应租户的：
- 前台域名（登录、充值）
- 后台域名（管理员登录、审核）
- 时区（时间范围计算，按租户 COUNTRY_CODE 自动推算）

```bash
# 3101 租户
k6 run -e TENANT_ID=3101 -e USER_COUNT=50 -e PACKAGE_TYPE=3 day1_seed.test.js
k6 run -e TENANT_ID=3101 -e CHANNEL_PACKAGE_ID=100056 -e DAYS_AGO=1 dayN_recharge.test.js
k6 run -e TENANT_ID=3101 -e CHANNEL_PACKAGE_ID=100056 -e RETENTION_DAYS=2 dayN_verify.test.js
```

---

## 注意事项

1. `day1_seed.test.js` 使用多VU并发注册，USER_COUNT 即 VU 数量，每个VU注册1个用户
2. `dayN_recharge.test.js` 使用单VU串行执行，避免同一用户被重复处理
3. `dayN_verify.test.js` 纯查询，随时可以重复执行，不影响数据
4. `CHANNEL_PACKAGE_ID` 为渠道来源ID，查询时用于过滤指定渠道的充值订单，不传直接报错
5. 充值金额默认随机 2000-5000，可通过 `envconfig.js` 中的 `RECHARGE_AMOUNT_MIN/MAX` 调整
6. 复充率验证永远不包含今天的数据，今天只用于计算日期偏移
