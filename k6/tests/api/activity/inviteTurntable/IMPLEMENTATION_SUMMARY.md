# 邀请转盘验证测试 - 实现总结

## 已完成的工作

### 1. 核心文件

#### verifyInviteTurntable.test.js
主测试脚本，包含：
- 配置管理（环境变量读取）
- 总代注册逻辑（手机号→邮箱fallback）
- 下级注册逻辑（手机号→邮箱fallback）
- 单个下级处理流程（注册+充值）
- 并发下级处理（批量+并发控制）
- 单轮邀请转盘流程
- 多轮流程控制
- 多总代支持
- Setup和主函数

#### inviteTurntableApi.js
API封装，包含：
- `clickSpinInvitedWheel()` - 点击礼物盒
- `clickShareLink()` - 获取邀请码
- `clickSpinningTurntable()` - 旋转转盘
- `getUserInvitedWheelInfo()` - 获取转盘总金额
- `clickWheelWithdraw()` - 提现

#### run-verify-invite-turntable.sh
运行脚本，支持：
- 命令行参数传递
- 默认参数设置
- 语言自动适配
- 友好的输出格式

#### README_VERIFY.md
完整文档，包含：
- 功能说明
- 环境变量说明
- 使用方法
- 测试场景示例
- 流程说明
- 注意事项
- 故障排查

## 核心特性

### 1. 多租户支持
- 支持3001/3002/3003/3004多个租户
- 自动根据租户配置区号
- 3003平台自动使用西班牙语

### 2. 智能注册策略
- 总代注册：手机号优先，失败则邮箱
- 下级注册：手机号邀请优先，失败则邮箱邀请
- 自动生成随机账号（手机号/邮箱）

### 3. 混合充值策略
- 使用 `hybridRecharge` 函数
- 优先前台充值（遍历所有通道）
- 失败则后台人工充值兜底
- 确保充值成功率

### 4. 并发控制
- 下级注册和充值并发执行
- 通过 `SUB_CONCURRENT` 控制并发数
- 批量处理，避免请求过快
- 批次间等待，保护服务器

### 5. 多轮支持
- 支持单个总代执行多轮流程
- 轮次间等待，避免状态冲突
- 每轮独立统计结果

### 6. 状态同步
- 所有下级完成充值后等待10秒
- 确保转盘金额状态更新
- 避免提现时金额不准确

## 与Golang代码的对应关系

| Golang函数 | K6实现 | 说明 |
|-----------|--------|------|
| `EmailRandomGeneralAgentRegister` | `registerGeneralAgent()` | 总代注册（手机号→邮箱） |
| `RunWhille` | `registerSubordinate()` | 下级注册（手机号→邮箱） |
| `ClickSpinInvitedWheel` | `clickSpinInvitedWheel()` | 点击礼物盒 |
| `ClickShareLink` | `clickShareLink()` | 获取邀请码 |
| `ClickSpinningTurntable` | `clickSpinningTurntable()` | 旋转转盘 |
| `GetUserInvitedWheelInfo` | `getUserInvitedWheelInfo()` | 获取转盘总金额 |
| `ClickWheelWithdrawFunc` | `clickWheelWithdraw()` | 提现 |
| `UpdatePasswordAndToUp` | `hybridRecharge()` | 充值（混合策略） |
| `RunTaskWhille` | `processSubordinatesConcurrently()` | 并发处理下级 |
| `TaskWhille` | `processSubordinate()` | 单个下级处理 |
| `NewRound` | `runSingleRound()` | 单轮流程 |
| `RunSpinInvitedWheelWork` | `runGeneralAgentFlow()` | 总代完整流程 |

## 使用示例

### 基本测试
```bash
cd k6/tests/api/activity/inviteTurntable
chmod +x run-verify-invite-turntable.sh
./run-verify-invite-turntable.sh 3004
```

### 多总代测试
```bash
./run-verify-invite-turntable.sh 3004 5 1
# 5个总代，每个执行1轮
```

### 多轮测试
```bash
./run-verify-invite-turntable.sh 3004 1 3
# 1个总代，执行3轮
```

### 压力测试
```bash
./run-verify-invite-turntable.sh 3004 3 2 5 10 8 2000 5000
# 3个总代，每个2轮，每轮5-10个下级，并发8，充值2000-5000
```

## 技术亮点

1. **完全异步并发**：下级注册和充值并发执行，大幅提升效率
2. **智能fallback**：注册和充值都有fallback机制，确保成功率
3. **批量控制**：通过批次处理控制并发数，避免服务器压力
4. **状态同步**：等待机制确保状态更新，避免数据不一致
5. **多租户支持**：一套代码支持所有租户，自动适配配置
6. **详细日志**：每个步骤都有日志输出，方便调试和监控
7. **灵活配置**：所有参数都可通过环境变量配置，无需修改代码

## 注意事项

1. **并发数设置**：`SUB_CONCURRENT` 不宜过大，建议3-8
2. **等待时间**：下级充值完成后必须等待10秒再提现
3. **充值金额**：确保在通道限制范围内（通常1000-5000）
4. **轮次间隔**：多轮测试时，轮次间等待5秒
5. **总代间隔**：多总代测试时，总代间等待5秒

## 后续优化建议

1. **结果输出**：可以添加JSON格式输出，方便Go程序解析
2. **失败重试**：可以为关键步骤添加重试机制
3. **性能监控**：可以添加性能指标收集
4. **数据验证**：可以添加转盘金额计算验证
5. **错误分类**：可以对错误进行分类统计

## 依赖关系

```
verifyInviteTurntable.test.js
├── inviteTurntableApi.js (邀请转盘API)
├── register.test.js (注册API)
├── userManagement.js (用户管理API)
├── rechargeService.js (充值服务)
├── accountGenerator.js (账号生成工具)
├── envconfig.js (环境配置)
└── adminlogin.test.js (管理员登录)
```

## 测试覆盖

- ✅ 总代注册（手机号/邮箱）
- ✅ 下级注册（手机号/邮箱邀请）
- ✅ 点击礼物盒
- ✅ 旋转转盘
- ✅ 获取邀请码
- ✅ 并发邀请下级
- ✅ 混合充值策略
- ✅ 获取转盘总金额
- ✅ 提现
- ✅ 多轮流程
- ✅ 多总代支持
- ✅ 多租户支持

## 完成时间

2026-03-24

## 作者

Kiro AI Assistant
