# 埋点批量注册 - 多租户版本使用指南

## 与原版的区别

| 特性 | 原版 `batchEventRegister.test.js` | 多租户版 `batchEventRegister.multi-tenant.test.js` |
|------|-----------------------------------|---------------------------------------------------|
| 租户支持 | 单租户（硬编码 3004） | 多租户并行（`-e TENANTS=3001,3002,3003`） |
| 域名配置 | 硬编码 `tiktokDomain` | 从 `envConfig` 动态读取 |
| 区号配置 | 硬编码 `91` | 从租户配置读取 `COUNTRY_CODE` |
| 结果统计 | 单租户汇总 | 多租户分组统计 + 总计 |
| 兼容性 | 原有脚本 | 完全兼容原版参数 |

---

## 使用方法

### 单租户（兼容原版）

```bash
# 基础用法（与原版完全一致）
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.multi-tenant.test.js

# 指定邀请码
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 -e INVITE_CODE=CUSTOM123 batchEventRegister.multi-tenant.test.js

# 使用老包（ID: 21）
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=21 batchEventRegister.multi-tenant.test.js
```

### 多租户并行

```bash
# 同时在 3001、3002、3004 三个租户各注册 300 人
k6 run -e TENANTS=3001,3002,3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.multi-tenant.test.js

# 多租户 + 自定义邀请码
k6 run -e TENANTS=3001,3002 -e USER_COUNT=100 -e PACKAGE_TYPE=22 -e INVITE_CODE=MYCODE batchEventRegister.multi-tenant.test.js
```

### 高级配置

```bash
# 覆盖 tiktok 域名（优先级高于租户配置）
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 \
       -e TIKTOK_DOMAIN=https://custom.tiktok.domain.com \
       batchEventRegister.multi-tenant.test.js

# 指定环境标识（用于 Grafana 面板区分）
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 \
       -e ENVIRONMENT=production \
       batchEventRegister.multi-tenant.test.js
```

---

## 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `TENANT_ID` | 单租户时必填 | `3004` | 单个租户ID |
| `TENANTS` | 多租户时必填 | - | 多个租户ID，逗号分隔，如 `3001,3002,3003` |
| `USER_COUNT` | 否 | `1` | 每个租户注册的用户数 |
| `PACKAGE_TYPE` | 否 | `22` | 包类型：`21`（老包）或 `22`（新包） |
| `INVITE_CODE` | 否 | 根据包类型自动选择 | 自定义邀请码，覆盖默认值 |
| `TIKTOK_DOMAIN` | 否 | 从租户配置读取 | 覆盖 tiktok 域名 |
| `ENVIRONMENT` | 否 | `local` | 环境标识（用于 Grafana tag） |

---

## 包类型配置

| 包类型 | ID | PixelId | 默认邀请码 | 说明 |
|--------|----|---------|-----------|----|
| 老包 | 21 | `D7G8J3JC77UBV63HPUH0` | `FXNDMAN` | 📦 Old Package |
| 新包 | 22 | `D7GEL23C77U0PCJMRE8G` | `CPWHUUN` | 🚀 New Package |

---

## 租户配置自动读取

脚本会从 `k6/config/envconfig.js` 自动读取各租户配置：

```javascript
// 示例：租户 3001 的配置
{
  BASE_DESK_URL: "https://arplatsaassit1.club",    // 自动作为 tiktokDomain
  BASE_ADMIN_URL: "https://ar666999.club",
  COUNTRY_CODE: "91"                                 // 自动作为手机号区号
}
```

如果需要覆盖，使用 `-e TIKTOK_DOMAIN=xxx` 参数。

---

## 充值策略说明

脚本内置了两种充值模式，随机分配：

### 60% 用户：单次充值
- 注册成功后，执行一次 `hybridRecharge`

### 40% 用户：双充
- **Mode A（50%）**：串行双充，每次充值后等待审核完成
- **Mode B（50%）**：连冲模式，连续发起两次充值请求，然后批量审核

---

## 输出报告示例

### 单租户
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃           📊 埋点批量注册与充值测试汇总报告（多租户版）      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 测试场景模式                  ┃ 🚀 新包 (New Package - ID: 22) ┃
┃ 🎫 当前使用邀请码                ┃ CPWHUUN                   ┃
┃ 🏢 测试租户                      ┃ 3004                      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 注册成功总人数                ┃ 300                       ┃
┃ 💰 完成首充用户数                ┃ 300                       ┃
┃ 🔄 执行双充用户数                ┃ 120                       ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📈 双充转化率                    ┃ 40.00%                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### 多租户
```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃           📊 埋点批量注册与充值测试汇总报告（多租户版）      ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🟢 测试场景模式                  ┃ 🚀 新包 (New Package - ID: 22) ┃
┃ 🎫 当前使用邀请码                ┃ CPWHUUN                   ┃
┃ 🏢 测试租户                      ┃ 3001, 3002, 3004          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃           统计项名称             ┃         统计数值          ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 👥 注册成功总人数                ┃ 900                       ┃
┃ 💰 完成首充用户数                ┃ 900                       ┃
┃ 🔄 执行双充用户数                ┃ 360                       ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 📈 双充转化率                    ┃ 40.00%                    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

📋 各租户明细：
   租户 3001: 注册=300, 首充=300, 双充=120
   租户 3002: 注册=300, 首充=300, 双充=120
   租户 3004: 注册=300, 首充=300, 双充=120
```

---

## 注意事项

1. **交错启动**：每个 VU 间隔 10 秒启动，避免瞬间冲击服务器
2. **随机延迟**：注册前随机等待 3~7 秒，进一步打散请求
3. **多租户并行**：各租户独立 scenario，互不影响，结果按 tag 区分
4. **区号自动适配**：从租户配置读取 `COUNTRY_CODE`，无需手动指定
5. **域名自动适配**：从租户配置读取 `BASE_DESK_URL`，也可通过 `-e TIKTOK_DOMAIN` 覆盖

---

## 迁移指南（从原版迁移）

如果你之前使用的是 `batchEventRegister.test.js`，迁移到多租户版本只需：

```bash
# 原版命令
k6 run -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.test.js

# 多租户版命令（完全兼容）
k6 run -e TENANT_ID=3004 -e USER_COUNT=300 -e PACKAGE_TYPE=22 batchEventRegister.multi-tenant.test.js
```

无需修改任何参数，直接替换文件名即可。
