# 租户AI意图识别扩展指南

## 概述

本扩展为qwen2 AI意图识别系统添加了对租户3006和3007的支持。

## 新增文件

### 1. 配置文件
- `config/tenant_config.go` - 租户扩展AI系统提示词配置
  - 包含支持3006和3007租户的完整意图识别规则
  - 提供了 `GetTenantSystemPrompt()` 函数获取扩展提示词

### 2. AI引擎
- `tenant_ai/engine.go` - 租户扩展AI意图识别引擎
  - 独立的AI引擎实现，避免与原有引擎冲突
  - 使用租户扩展系统提示词进行意图识别

## 使用方式

### 基本使用

```go
import "smart-qa/tenant_ai"

// 创建租户AI引擎实例
engine := tenant_ai.NewEngine()

// 检查连接
if !engine.CheckConnection() {
    log.Fatal("Ollama服务未启动")
}

// 解析用户输入
result, err := engine.Parse("我需要一个3006的账号")
if err != nil {
    log.Fatal(err)
}

fmt.Printf("意图: %s\n", result.Intent)
fmt.Printf("参数: %v\n", result.Params)
```

### 支持的租户

租户AI引擎支持以下平台编号：
- 3001
- 3002
- 3003
- 3004
- **3006** (新增)
- **3007** (新增)

### 支持的意图

1. **get_account** - 获取账号
   - 示例：`我需要一个3006的账号`
   - 示例：`给我2个3007平台的号`

2. **query_balance** - 查询余额
   - 示例：`查一下余额`

3. **recharge** - 充值
   - 示例：`帮我充值500到3006平台`

4. **list_accounts** - 查看可用账号
   - 示例：`3006平台有哪些号`

5. **ask_platform** - 询问平台
   - 示例：`给我一个账号`

6. **create_activity** - 创建活动
   - 示例：`3006创建一个每日签到`
   - 示例：`3007平台新建一个红包雨`

7. **validate_activity** - 验证活动
   - 示例：`3006充值转盘验证`

8. **validate_signin** - 验证每日签到
   - 示例：`3006平台每日签到活动验证`

9. **validate_agent_l3** - 验证3级代理
   - 示例：`3006平台3级代理验证136139`

10. **validate_new_commission** - 验证新版返佣
    - 示例：`3006平台新版返佣验证136139`

11. **validate_invite_turntable** - 验证邀请转盘
    - 示例：`3006平台邀请转盘验证`

## 与原有引擎的区别

| 特性 | 原有引擎 (ai.Engine) | 租户引擎 (tenant_ai.Engine) |
|------|---------------------|---------------------------|
| 支持的租户 | 3001-3004 | 3001-3004, 3006, 3007 |
| 系统提示词 | config.SystemPrompt | config.GetTenantSystemPrompt() |
| 包路径 | smart-qa/ai | smart-qa/tenant_ai |

## 集成建议

### 方案1：根据租户ID选择引擎

```go
func getEngine(tenantID string) AIEngine {
    switch tenantID {
    case "3006", "3007":
        return tenant_ai.NewEngine()
    default:
        return ai.NewEngine()
    }
}
```

### 方案2：统一使用租户引擎

如果所有租户都需要支持，可以直接使用租户引擎：

```go
engine := tenant_ai.NewEngine()
```

## 注意事项

1. 租户引擎需要Ollama服务正常运行
2. 确保qwen2.5:3b模型已下载
3. 租户引擎与原有引擎可以共存，互不影响
4. 建议在生产环境中根据实际需求选择合适的引擎

## 测试示例

```bash
# 测试3006租户
echo "我需要一个3006的账号" | go run main.go

# 测试3007租户
echo "3007平台创建一个每日签到" | go run main.go

# 测试未知意图
echo "今天天气怎么样" | go run main.go
```

## 扩展更多租户

如需添加更多租户（如3008、3009等），请按以下步骤操作：

1. 在 `config/tenant_config.go` 中添加新的租户编号到系统提示词
2. 在 `k6-/k6/config/tenantConfig.js` 中添加对应的环境配置
3. 在 `k6-/k6/tests/api/tenant/` 下创建对应的测试文件
4. 在 `local-dispatcher/routes/tenant.go` 中添加租户配置

## 相关文档

- [AI意图识别配置](config/config.go)
- [租户环境配置](../k6/config/tenantConfig.js)
- [local-dispatcher路由配置](../../local-dispatcher/routes/tenant.go)
