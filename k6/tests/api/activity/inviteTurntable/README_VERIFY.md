# 邀请转盘验证测试

## 功能说明

验证邀请转盘活动的完整流程，包括：
1. 总代注册（手机号优先，失败则邮箱）
2. 点击4个礼物盒（开启邀请转盘）
3. 旋转转盘（免费次数）
4. 获取邀请码
5. 并发邀请下级（随机数量）
6. 下级注册+充值（混合充值策略）
7. 获取转盘总金额
8. 提现

## 文件说明

- `verifyInviteTurntable.test.js` - 主测试脚本
- `inviteTurntableApi.js` - 邀请转盘API封装
- `run-verify-invite-turntable.sh` - 运行脚本
- `README_VERIFY.md` - 本文档

## 环境变量

| 变量名 | 说明 | 默认值 | 示例 |
|--------|------|--------|------|
| TENANT_ID | 租户ID（必需） | 3004 | 3001/3002/3003/3004 |
| LANGUAGE | 语言 | en | en/es |
| GENERAL_AGENT_COUNT | 总代数量 | 1 | 1-10 |
| WHEEL_NUMBER | 轮次数量 | 1 | 1-5 |
| SUB_MIN_NUMBER | 最小下级数量 | 2 | 1-10 |
| SUB_MAX_NUMBER | 最大下级数量 | 5 | 5-20 |
| SUB_CONCURRENT | 下级并发数 | 3 | 1-10 |
| MIN_MONEY | 最小充值金额 | 1000 | 100-10000 |
| MAX_MONEY | 最大充值金额 | 5000 | 1000-50000 |

## 使用方法

### 方法1：使用运行脚本（推荐）

```bash
# 进入目录
cd k6/tests/api/activity/inviteTurntable

# 添加执行权限
chmod +x run-verify-invite-turntable.sh

# 基本用法（使用默认参数）
./run-verify-invite-turntable.sh

# 指定租户ID
./run-verify-invite-turntable.sh 3003

# 指定租户ID和总代数量
./run-verify-invite-turntable.sh 3004 2

# 指定租户ID、总代数量和轮次数量
./run-verify-invite-turntable.sh 3004 2 3

# 完整参数
./run-verify-invite-turntable.sh 3004 2 3 3 8 5 2000 5000
# 参数说明: 租户ID 总代数 轮次数 最小下级 最大下级 并发数 最小金额 最大金额
```

### 方法2：直接使用K6命令

```bash
# 基本测试（1个总代，1轮）
k6 run \
  -e TENANT_ID=3004 \
  -e LANGUAGE=en \
  verifyInviteTurntable.test.js

# 多个总代，多轮测试
k6 run \
  -e TENANT_ID=3004 \
  -e LANGUAGE=en \
  -e GENERAL_AGENT_COUNT=3 \
  -e WHEEL_NUMBER=2 \
  -e SUB_MIN_NUMBER=3 \
  -e SUB_MAX_NUMBER=8 \
  -e SUB_CONCURRENT=5 \
  -e MIN_MONEY=2000 \
  -e MAX_MONEY=5000 \
  verifyInviteTurntable.test.js

# 3003平台（西班牙语）
k6 run \
  -e TENANT_ID=3003 \
  -e LANGUAGE=es \
  -e GENERAL_AGENT_COUNT=2 \
  verifyInviteTurntable.test.js
```

## 测试场景示例

### 场景1：单个总代，单轮测试
```bash
./run-verify-invite-turntable.sh 3004 1 1
```
- 1个总代
- 执行1轮邀请转盘流程
- 每轮邀请2-5个下级
- 下级充值1000-5000元

### 场景2：多个总代，单轮测试
```bash
./run-verify-invite-turntable.sh 3002 3 2
```
- 5个总代
- 每个总代执行1轮
- 测试多租户并发场景

### 场景3：单个总代，多轮测试
```bash
./run-verify-invite-turntable.sh 3004 1 3
```
- 1个总代
- 执行3轮邀请转盘流程
- 测试重复邀请场景

### 场景4：压力测试
```bash
./run-verify-invite-turntable.sh 3004 3 2 5 10 8 2000 5000
```
- 3个总代
- 每个总代执行2轮
- 每轮邀请5-10个下级
- 下级并发数8
- 充值金额2000-5000元

## 流程说明

### 总代流程
1. 尝试手机号注册（区号根据租户配置）
2. 如果手机号注册失败，自动切换到邮箱注册
3. 获取用户信息（userId, inviteCode）
4. 执行N轮邀请转盘流程

### 单轮流程
1. 点击4个礼物盒（开启邀请转盘）
2. 旋转转盘（获取免费奖励）
3. 获取邀请码
4. 并发邀请下级（随机数量）
5. 等待10秒（确保状态更新）
6. 获取转盘总金额
7. 提现

### 下级流程
1. 尝试手机号邀请注册
2. 如果手机号注册失败，自动切换到邮箱邀请注册
3. 获取用户信息（userId）
4. 混合充值（优先前台充值，失败则后台充值兜底）

## 注意事项

1. **并发控制**：下级注册和充值是并发执行的，通过 `SUB_CONCURRENT` 控制并发数
2. **等待时间**：所有下级完成充值后，等待10秒再提现，确保状态更新
3. **充值策略**：使用混合充值策略（`hybridRecharge`），优先前台充值，失败则后台充值兜底
4. **注册策略**：手机号优先，失败则自动切换到邮箱
5. **多租户支持**：支持3001/3002/3003/3004多个租户
6. **语言自动适配**：3003平台自动使用西班牙语(es)，其他平台使用英语(en)

## 日志说明

测试过程中会输出详细日志，包括：
- 总代注册信息
- 每轮流程的执行步骤
- 下级注册和充值结果
- 转盘金额和提现结果
- 最终统计信息

## 故障排查

### 问题1：总代注册失败
- 检查手机号和邮箱注册是否都失败
- 查看日志中的错误信息
- 确认租户配置正确

### 问题2：下级充值失败
- 检查前台充值通道是否可用
- 确认后台充值兜底是否生效
- 查看充值金额是否在通道限制范围内

### 问题3：提现失败
- 确认转盘总金额是否正确
- 检查是否等待了足够的时间（10秒）
- 查看API响应的错误信息

## 相关文档

- [K6-Go集成模式](../../../../../docs/k6-go-integration-pattern.md)
- [充值服务文档](../../recharge/README.md)
- [注册API文档](../../login/README.md)
