# 扩展验证功能集成文档

## 📋 概述

本文档说明如何使用新增的扩展验证功能，包括每日签到验证、3级代理验证和新版返佣验证。

---

## 🏗️ 架构说明

### 新增文件

| 文件 | 功能 |
|------|------|
| [`service/extended_validation_service.go`](k6-/qwen2/service/extended_validation_service.go:1) | 扩展验证服务，处理K6脚本调用和结果解析 |
| [`handler/extended_handler.go`](k6-/qwen2/handler/extended_handler.go:1) | 扩展处理器，提供验证功能的业务逻辑 |
| [`handler/extended_dispatcher.go`](k6-/qwen2/handler/extended_dispatcher.go:1) | 扩展调度器，整合原有调度器和新增意图 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| [`config/config.go`](k6-/qwen2/config/config.go:1) | 添加新的意图定义和示例 |

---

## 🎯 新增意图

### 1. validate_signin - 每日签到验证

**功能描述：** 验证每日签到活动的功能是否正常

**支持的参数：**
- `platform`: 平台编号（3001/3002/3003/3004）
- `mode`: 验证模式（"random" 或 "specified"）
- `user_count`: 随机用户数量（random模式，默认3）
- `accounts`: 指定账号列表（specified模式，逗号分隔）
- `manual_receive_rate`: 手动领取比例（0-1之间，默认0.8）

**用户输入示例：**
```
3004平台每日签到活动验证
3003平台每日签到活动执行
3004平台每日签到活动验证随机6个人
3002平台每日签到活动验证
验证3004的每日签到活动
```

**K6命令示例：**
```bash
# 随机模式（默认）
k6 run -e TENANT_ID=3004 -e USER_COUNT=6 k6/tests/api/activity/signin/signinValidation.test.js

# 指定账号模式
k6 run -e TENANT_ID=3002 \
  -e MODE=specified \
  -e ACCOUNTS="913190610583,913191269257,913170156615" \
  k6/tests/api/activity/signin/signinValidation.test.js
```

---

### 2. validate_agent_l3 - 3级代理验证

**功能描述：** 验证3级代理活动的功能是否正常

**支持的参数：**
- `platform`: 平台编号（3001/3002/3003/3004）
- `target_uid`: 总代UID（5-8位数字）

**用户输入示例：**
```
3004平台3级代理验证136139
3003平台3级代理验证
3002平台3级代理验证700128
验证3004的3级代理
```

**K6命令示例：**
```bash
k6 run -e TENANT_ID=3004 -e TARGET_UID=136139 runAgentL3Validation.test.js
```

**验证规则：**
- 如果用户提供了UID，验证格式（5-8位数字）
- 格式正确 → 执行K6命令
- 格式错误 → 提示"你的会员id是错误的请重新提供"
- 如果用户未提供UID → 询问："请提供总代的会员ID（5-8位数字）"

---

### 3. validate_new_commission - 新版返佣验证

**功能描述：** 验证新版返佣活动的功能是否正常（与3级代理验证相同）

**支持的参数：**
- `platform`: 平台编号（3001/3002/3003/3004）
- `target_uid`: 总代UID（5-8位数字）

**用户输入示例：**
```
3004平台新版返佣验证136139
3003平台新版返佣验证
3002平台新版返佣验证700128
验证3004的新版返佣
```

**K6命令示例：**
```bash
k6 run -e TENANT_ID=3004 -e TARGET_UID=136139 runAgentL3Validation.test.js
```

---

## 🔧 如何使用扩展调度器

### 方法1：直接使用 ExtendedDispatcher

```go
package main

import (
    "smart-qa/handler"
    "smart-qa/model"
)

func main() {
    // 创建扩展调度器
    extendedDispatcher := handler.NewExtendedDispatcher()
    
    // 处理用户消息
    userMessage := "3004平台每日签到活动验证"
    response := extendedDispatcher.HandleMessage(userMessage)
    
    // 输出结果
    fmt.Printf("回复: %s\n", response.Reply)
    fmt.Printf("意图: %s\n", response.Intent)
    fmt.Printf("参数: %v\n", response.Params)
}
```

### 方法2：在现有代码中集成

如果你已经有一个使用 `Dispatcher` 的应用，可以将其替换为 `ExtendedDispatcher`：

```go
// 原有代码
// dispatcher := handler.NewDispatcher()

// 替换为
extendedDispatcher := handler.NewExtendedDispatcher()

// 使用方式完全相同
response := extendedDispatcher.HandleMessage(userMessage)
```

---

## 📊 完整示例

### 示例1：每日签到验证

```go
package main

import (
    "fmt"
    "smart-qa/handler"
)

func main() {
    extendedDispatcher := handler.NewExtendedDispatcher()
    
    // 测试每日签到验证
    testCases := []string{
        "3004平台每日签到活动验证",
        "3004平台每日签到活动验证随机6个人",
        "3002平台每日签到活动验证",
    }
    
    for _, testCase := range testCases {
        fmt.Printf("\n用户输入: %s\n", testCase)
        response := extendedDispatcher.HandleMessage(testCase)
        fmt.Printf("回复: %s\n", response.Reply)
    }
}
```

### 示例2：3级代理验证

```go
package main

import (
    "fmt"
    "smart-qa/handler"
)

func main() {
    extendedDispatcher := handler.NewExtendedDispatcher()
    
    // 测试3级代理验证
    testCases := []string{
        "3004平台3级代理验证136139",
        "3003平台3级代理验证",
        "3002平台3级代理验证700128",
    }
    
    for _, testCase := range testCases {
        fmt.Printf("\n用户输入: %s\n", testCase)
        response := extendedDispatcher.HandleMessage(testCase)
        fmt.Printf("回复: %s\n", response.Reply)
    }
}
```

---

## ⚠️ 注意事项

### 1. 不修改现有代码

根据角色定位要求，本扩展功能：
- ✅ 只读分析现有代码
- ✅ 在新文件中编写新逻辑
- ✅ 通过 import 或调用方式引用现有功能
- ❌ 不修改任何现有代码

### 2. 依赖关系

扩展调度器依赖于原有的 `Dispatcher`，因此：
- 必须先初始化 `Dispatcher`
- 通过组合方式扩展功能
- 保持向后兼容

### 3. AI 意图识别

新增的意图需要在 [`config/config.go`](k6-/qwen2/config/config.go:1) 中定义：
- 添加意图描述
- 添加参数说明
- 添加示例

AI 引擎会根据这些定义自动识别用户意图。

### 4. K6 脚本路径

确保 K6 脚本路径正确：
- 每日签到：`../k6/tests/api/activity/signin/signinValidation.test.js`
- 3级代理：`../k6/tests/api/agentL3/runAgentL3Validation.test.js`

---

## 🧪 测试建议

### 1. 单元测试

测试各个处理函数：

```go
func TestHandleValidateSignIn(t *testing.T) {
    handler := NewExtendedHandler()
    
    params := map[string]string{
        "platform": "3004",
        "mode": "random",
        "user_count": "6",
    }
    
    result := handler.HandleValidateSignIn(params)
    if result == "" {
        t.Error("结果不应为空")
    }
}
```

### 2. 集成测试

测试完整的消息处理流程：

```go
func TestExtendedDispatcher(t *testing.T) {
    dispatcher := NewExtendedDispatcher()
    
    testCases := []struct {
        input    string
        expected string
    }{
        {"3004平台每日签到活动验证", "validate_signin"},
        {"3004平台3级代理验证136139", "validate_agent_l3"},
    }
    
    for _, tc := range testCases {
        response := dispatcher.HandleMessage(tc.input)
        if response.Intent != tc.expected {
            t.Errorf("期望意图 %s，实际 %s", tc.expected, response.Intent)
        }
    }
}
```

---

## 📚 相关文档

- [`k6/tests/api/activity/signin/README.md`](k6-/k6/tests/api/activity/signin/README.md:1) - 每日签到验证详细说明
- [`k6/tests/api/agentL3/runAgentL3Validation.test.js`](k6-/k6/tests/api/agentL3/runAgentL3Validation.test.js:1) - 3级代理验证脚本
- [`docs/k6-go-integration-pattern.md`](k6-/docs/k6-go-integration-pattern.md:1) - K6与Go集成模式

---

## 🎉 总结

通过本扩展功能，系统现在支持：

| 意图 | 功能 | K6脚本 |
|------|------|---------|
| `validate_signin` | 每日签到验证 | `signinValidation.test.js` |
| `validate_agent_l3` | 3级代理验证 | `runAgentL3Validation.test.js` |
| `validate_new_commission` | 新版返佣验证 | `runAgentL3Validation.test.js` |

所有新功能都遵循"只读、禁止修改、增量创作"的原则，不改动现有代码库。
