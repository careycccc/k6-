# 渠道埋点注册目录

统一管理各渠道（TikTok、Adjust 等）的埋点注册脚本和配置。

---

// https://ar-cfdeploy.club/register?inviteCode=7DFAG4W&from=app

## 目录结构

```
k6/tests/api/channel/
├── README.md                        # 本文档
│
├── # ── Adjust 渠道 ──────────────────────────────────────────
├── adjustRegisterConfig.js          # Adjust 包配置
├── adjustRegister.js                # Adjust 注册核心函数
├── batchAdjustRegister.test.js      # Adjust 批量注册执行脚本（多租户版）
│
├── # ── Facebook 渠道 ────────────────────────────────────────
├── facebookRegisterConfig.js        # Facebook 包配置
├── facebookRegister.js              # Facebook 注册核心函数
├── batchFacebookRegister.test.js    # Facebook 批量注册执行脚本（多租户版）
│
└── # ── TikTok 渠道（原文件仍在 login/ 目录，此处为说明）──────
    # k6/tests/api/login/batchEventRegister.multi-tenant.test.js
    # k6/config/eventRegisterConfig.js
```

---

## TikTok 渠道

TikTok 相关文件暂保留在原位置，向后兼容：

| 文件 | 说明 |
|------|------|
| `k6/config/eventRegisterConfig.js` | TikTok 包配置（PACKAGE_CONFIGS / TENANT_EVENT_CONFIGS） |
| `k6/tests/api/login/batchEventRegister.multi-tenant.test.js` | TikTok 批量注册执行脚本 |
| `k6/tests/api/login/register.test.js` → `eventIdentityRegister` | TikTok 注册核心函数 |

### 运行命令

```bash
# 单租户
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e PACKAGE_TYPE=22 \
  k6/tests/api/login/batchEventRegister.multi-tenant.test.js

# 多租户并行
k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 -e PACKAGE_TYPE=22 \
  k6/tests/api/login/batchEventRegister.multi-tenant.test.js
```

---

## Adjust 渠道 （carey_adjust_001）

### 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `TENANT_ID` | 单租户时必填 | `3004` | 单个租户ID |
| `TENANTS` | 多租户时必填 | — | 多个租户ID，逗号分隔 |
| `USER_COUNT` | 否 | `1` | 每个租户注册的用户数 |
| `PACKAGE_TYPE` | 否 | `adjust_001` | 包类型，见下方配置表 |
| `INVITE_CODE` | 否 | 配置文件默认值 | 自定义邀请码 |
| `ADJUST_DOMAIN` | 否 | 租户前台地址 | 覆盖注册域名 |
| `REGISTER_ONLY` | 否 | `false` | 设为 `true` 时只注册，跳过充值 |
| `ENVIRONMENT` | 否 | `local` | 环境标识（用于 Grafana tag） |

### 包类型配置

| 包类型 | eventConfigId | pixelId | packageName | 说明 |
|--------|---------------|---------|-------------|------|
| `adjust_001`（默认） | `200015` | `uyyiyutewe` | `com.ar3004.adcarey_adjust_001.app` | Adjust 默认包 |

新增包类型：在 `adjustRegisterConfig.js` 的 `ADJUST_PACKAGE_CONFIGS` 里追加一条，脚本无需改动。

### Adjust vs TikTok payload 差异

| 字段 | TikTok | Adjust |
|------|--------|--------|
| `eventConfigId` | 22（新包） | 200015 |
| `eventType` | 6 | 2 |
| `packageName` | `com.ar3004.fb.app` | `com.ar3004.adcarey_adjust_001.app` |
| `eventIdentityInfo.Ttclid` | 无 | `""` |
| `eventIdentityInfo.Ttcsid` | 无 | `""` |
| `eventIdentityInfo.AdjustDeviceId` | 随机16位 | `""` |

### 运行命令

```bash
# 单租户，默认包
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 \
  k6/tests/api/channel/batchAdjustRegister.test.js

# 单租户，指定包类型
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e PACKAGE_TYPE=adjust_001 \
  k6/tests/api/channel/batchAdjustRegister.test.js

# 多租户并行
k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 \
  k6/tests/api/channel/batchAdjustRegister.test.js

# 指定邀请码
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e INVITE_CODE=SPEX6LN \
  k6/tests/api/channel/batchAdjustRegister.test.js

# 覆盖注册域名
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 \
  -e ADJUST_DOMAIN=https://custom.domain.com \
  k6/tests/api/channel/batchAdjustRegister.test.js

# 仅注册，跳过充值（排查注册问题时使用）
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 -e REGISTER_ONLY=true \
  k6/tests/api/channel/batchAdjustRegister.test.js


# 团队的方式

# Adjust 团队模式，50人4层
k6 run -e TENANT_ID=3004 -e TEAM_MODE=true -e TEAM_TOTAL=55 -e TEAM_LEVELS=7 batchAdjustRegister.test.js

# Facebook 团队模式，30人3层
k6 run -e TENANT_ID=3004 -e TEAM_MODE=true -e TEAM_TOTAL=55 -e TEAM_LEVELS=7 batchFacebookRegister.test.js

# tiktok 团队模式，30人3层
k6 run -e TENANT_ID=3004 -e TEAM_MODE=true  -e TEAM_TOTAL=50 -e TEAM_LEVELS=4 -e EMBED_RATE=0.6 -e RECHARGE_RATE=0.9 -e BET_RATE=0.8 -e WITHDRAW_RATE=0.6 -e ENABLE_BACKEND_APPROVAL=true batchTiktokRegister.test.js


```

---

## Facebook 渠道

### 与 Adjust 的 payload 差异

| 字段 | Adjust | Facebook |
|------|--------|---------|
| `eventConfigId` | 200015 | 200018 |
| `eventType` | 2 | 1 |
| `packageName` | `com.ar3004.adcarey_adjust_001.app` | `com.ar3004.fb.app` |
| `PixelId` | `uyyiyutewe` | `2010850729480687` |
| `Fbp` | `""` | 动态生成 `fb.1.<ts>.<rand>` |

### 包类型配置

| 包类型 | eventConfigId | pixelId | packageName | 说明 |
|--------|---------------|---------|-------------|------|
| `fb_001`（默认） | `200018` | `2010850729480687` | `com.ar3004.fb.app` | Facebook 默认包 |

### 运行命令

```bash
# 单租户，默认包
k6 run -e TENANT_ID=3004 -e USER_COUNT=1 batchFacebookRegister.test.js

# 注册 + 充值 + 投注 + 提现
k6 run -e TENANT_ID=3004 -e USER_COUNT=1 -e ENABLE_BET=true -e ENABLE_WITHDRAW=true -e ENABLE_BACKEND_APPROVAL=true batchFacebookRegister.test.js

# 多租户并行
k6 run -e TENANTS=3004,3007 -e USER_COUNT=50 \
  k6/tests/api/channel/batchFacebookRegister.test.js

# 覆盖注册域名
k6 run -e TENANT_ID=3004 -e USER_COUNT=10 \
  -e FB_DOMAIN=https://custom.domain.com \
  k6/tests/api/channel/batchFacebookRegister.test.js
```

---

## 新增渠道指引

1. 在 `channel/` 目录下新建 `xxxRegisterConfig.js`（配置）和 `xxxRegister.js`（核心函数）
2. 复制 `batchAdjustRegister.test.js`，替换 import 和配置引用
3. 在本 README 补充说明
