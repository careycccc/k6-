# 充值转盘验证逻辑

## 概述

这个模块实现了充值转盘的验证逻辑，对应 Golang 版本的 `rechargewheel` 包。支持多租户环境，可以验证充值转盘的各种充值条件。

## 文件说明

### 1. `rechargeWheelValidation.js`
主要的验证逻辑文件，包含以下功能：

- **获取充值转盘信息** (`getUserRechargeWheelInfo`)
- **设置充值条件** (`setRechargeWheelCondition`)
- **获取充值金额** (`returnRechargeAmount`)
- **旋转充值转盘** (`spinRechargeWheel`)
- **随机注册用户** (`randomRegisterUser`)
- **验证无需首充** (`validateNoFirstRecharge`)
- **验证需首充** (`validateNeedFirstRecharge`)
- **验证二充** (`validateSecondRecharge`)
- **验证三充** (`validateThirdRecharge`)

### 2. `rechargeWheelValidation.test.js`
测试文件，包含以下功能：

- **运行所有测试** (`runRechargeWheelValidationTest`)
- **运行单个测试** (`runSingleRechargeWheelValidationTest`)
- **测试结果统计和汇总**

## 充值条件说明

充值转盘支持以下 4 种充值条件：

| 条件值 | 名称 | 说明 |
|--------|------|------|
| 0 | 无需首充 | 充值后可以立即旋转转盘 |
| 1 | 需首充 | 第一次充值不能旋转，第二次充值后才能旋转 |
| 2 | 二充 | 需要充值 3 次后才能旋转转盘 |
| 3 | 三充 | 需要充值 4 次后才能旋转转盘 |

## 使用方法（已优化：一键验证）

我们对验证脚本进行了深度优化。现在你只需要运行一条 K6 命令，它会自动基于你提供的 `TENANT_ID` 读取对应的后台和前台配置，完成管理员登录，并跑完全部或单个充值转盘的验证。

### 1. 验证单一租户的全部充值转盘条件（最常用）

进入 `k6/` 目录，通过环境变量 `TENANT_ID` 指定要验证的租户（如 `3004`）：

```bash
k6 run -e TENANT_ID=3004 tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js
```

如果不带参数，会默认使用 `3004` 租户：
```bash
k6 run tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js
```

### 2. 验证单一租户的某个特定充值条件

如果你只想验证特定的条件（0=无需首充, 1=需首充, 2=二充, 3=三充），可以附加 `CONDITION` 环境变量：

```bash
# 只验证需首充 (CONDITION=1) 租户 3004
k6 run -e TENANT_ID=3004 -e CONDITION=1 tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js

# 只验证二充 (CONDITION=2) 租户 3004
k6 run -e TENANT_ID=3004 -e CONDITION=2 tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js
```

## 验证流程

### 无需首充验证流程

1. 设置后台为"无需首充"
2. 随机注册一个账号
3. 获取第一个转盘的充值金额
4. 进行充值
5. 等待 5 秒
6. 尝试旋转转盘
7. 验证是否能旋转成功

### 需首充验证流程

1. 设置后台为"需首充"
2. 随机注册一个账号
3. 获取第一个转盘的充值金额
4. 进行第一次充值
5. 验证是否有旋转次数（应该为 0）
6. 进行第二次充值
7. 等待 5 秒
8. 尝试旋转转盘
9. 验证是否能旋转成功

### 二充验证流程

1. 设置后台为"二充"
2. 随机注册一个账号
3. 获取第一个转盘的充值金额
4. 进行第一次充值
5. 验证充值转盘是否开启（应该未开启）
6. 进行第二次充值
7. 等待 5 秒
8. 验证充值转盘是否开启（应该开启）
9. 进行第三次充值
10. 等待 5 秒
11. 尝试旋转转盘
12. 验证是否能旋转成功

### 三充验证流程

1. 设置后台为"三充"
2. 随机注册一个账号
3. 获取第一个转盘的充值金额
4. 进行第一次充值
5. 验证充值转盘是否开启（应该未开启）
6. 进行第二次充值
7. 等待 5 秒
8. 验证充值转盘是否开启（应该未开启）
9. 进行第三次充值
10. 等待 5 秒
11. 验证充值转盘是否开启（应该开启）
12. 进行第四次充值
13. 等待 5 秒
14. 尝试旋转转盘
15. 验证是否能旋转成功

## 错误处理

如果验证失败，系统会记录以下信息：

- 失败的测试名称
- 失败的用户 ID
- 失败的原因

所有失败信息都会在测试结果汇总中显示。

## 多租户支持

本模块深度集成了项目的多租户配置体系。通过传递不同 `TENANT_ID` 环境变量，脚本会动态从 `config/envconfig.js` 或者 `tests/api/invite/tenantConfig.js` 中拉取不同租户的前后缀域名、账号密码等资源：

```bash
k6 run -e TENANT_ID=3001 tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js
k6 run -e TENANT_ID=3002 tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js

k6 run -e TENANT_ID=3004 rechargeWheelValidation.test.js
```

## 注意事项

1. 每次测试前会自动设置后台为"无需首充"，防止有默认配置影响测试结果
2. 每次充值后会等待 5 秒，确保后台处理完成
3. 如果手机号注册失败，会自动尝试邮箱注册
4. 所有测试都会记录详细的日志信息，方便调试

## 依赖

本模块依赖以下项目中的模块：

- `../../libs/utils/logger.js` - 日志工具
- `../../common/request.js` - 请求工具
- `../../recharge/manualRecharge.js` - 人工充值功能
- `../../login/register.test.js` - 用户注册功能
- `../../utils/utils.js` - 工具函数
- `../../login/adminlogin.test.js` - 管理员登录功能

## API 接口

### 后台接口

- `/api/RechargeWheel/UpdateConfig` - 更新充值转盘配置
- `/api/RechargeWheel/Get` - 获取充值转盘配置
- `/api/ArtificialRechargeRecord/ArtificialRecharge` - 人工充值

### 前台接口

- `/api/Home/GetGiftInfo` - 获取礼包信息（包含充值转盘信息）
- `/api/Activity/SpinRechargeWheel` - 旋转充值转盘
- `/api/Home/Register` - 用户注册

## 测试结果示例

```
========== 测试结果汇总 ==========
总测试数: 4
成功: 4
失败: 0
成功率: 100.00%
========== 测试完成 ==========
```

## 版本历史

- v1.0.0 - 初始版本，实现基本的充值转盘验证逻辑
