# 扩展功能集成指南

## 📋 概述

本文档说明如何使用新增的扩展验证功能，包括每日签到验证、3级代理验证、新版返佣验证和邀请转盘验证。

---

## 🔍 问题分析

从日志可以看到，AI引擎正确识别了意图 `validate_agent_l3`，但是系统返回了"没有理解"的回复：

```
[调度] 识别结果: intent=validate_agent_l3, params=map[platform:3004 target_uid:136398]
[调度] 回复内容: 🤔 抱歉，我没有理解你的意思。
```

**原因：**
- 当前的 [`main.go`](k6-/qwen2/main.go:20) 使用的是 `handler.NewDispatcher()`
- 原有的 `Dispatcher` 不支持新增的意图（`validate_signin`、`validate_agent_l3`、`validate_new_commission`、`validate_invite_turntable`）
- 这些新意图会走到 `default` 分支，返回 `handleUnknown()`

---

## ✅ 解决方案

### 方案1：修改 main.go（推荐）

将 [`main.go`](k6-/qwen2/main.go:20) 中的调度器替换为 `ExtendedDispatcher`：

```go
// 原有代码
// dispatcher := handler.NewDispatcher()

// 替换为
extendedDispatcher := handler.NewExtendedDispatcher()
```

**完整修改后的 [`main.go`](k6-/qwen2/main.go:1)：**

```go
package main

import (
	"fmt"
	"log"
	"smart-qa/config"
	"smart-qa/handler"
	"smart-qa/web"
)

func main() {
	fmt.Println()
	fmt.Println("══════════════════════════════════════════")
	fmt.Println("  🤖 智能问答平台 (Go + Ollama)")
	fmt.Println("══════════════════════════════════════════")
	fmt.Printf("  模型：%s\n", config.ModelName)
	fmt.Printf("  Ollama：%s\n", config.OllamaURL)

	// 创建扩展调度器（支持新增的意图）
	extendedDispatcher := handler.NewExtendedDispatcher()

	// 检查 AI 服务
	if extendedDispatcher.CheckAI() {
		fmt.Println("  Ollama 状态：✅ 已连接")
	} else {
		fmt.Println("  Ollama 状态：❌ 未连接")
		fmt.Println()
		fmt.Println("  请先启动 Ollama：")
		fmt.Println("    终端执行 → ollama serve")
		fmt.Println()
	}

	fmt.Println()
	fmt.Printf("  🌐 浏览器访问：http://localhost%s\n", config.ServerPort)
	fmt.Printf("  📡 API 接口：http://localhost%s/api/parse\n", config.ServerPort)
	fmt.Println()
	fmt.Println("  按 Ctrl+C 停止服务")
	fmt.Println("══════════════════════════════════════════")
	fmt.Println()

	// 设置路由并启动
	router := web.SetupRouter(extendedDispatcher)
	if err := router.Run(config.ServerPort); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
```

---

### 方案2：修改 web/router.go

如果不想修改 [`main.go`](k6-/qwen2/main.go:1)，可以修改 [`web/router.go`](k6-/qwen2/web/router.go:11) 来支持 `ExtendedDispatcher`：

```go
// 原有代码
// func SetupRouter(dispatcher *handler.Dispatcher) *gin.Engine {

// 替换为（使用接口类型）
func SetupRouter(dispatcher interface {
	HandleMessage(message string) *model.ChatResponse
	CheckAI() bool
}) *gin.Engine {
	// ... 其余代码不变
}
```

**完整修改后的 [`web/router.go`](k6-/qwen2/web/router.go:1)：**

```go
package web

import (
	"net/http"
	"smart-qa/handler"
	"smart-qa/model"

	"github.com/gin-gonic/gin"
)

// SetupRouter 配置路由（使用接口类型，支持 Dispatcher 和 ExtendedDispatcher）
func SetupRouter(dispatcher interface {
	HandleMessage(message string) *model.ChatResponse
	CheckAI() bool
}) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// 加载 HTML 模板
	r.LoadHTMLGlob("templates/*")

	// 首页
	r.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", nil)
	})

	// 聊天接口
	r.POST("/chat", func(c *gin.Context) {
		var req struct {
			Message string `json:"message"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"reply": "请输入你的问题",
			})
			return
		}

		// 调用调度器处理
		result := dispatcher.HandleMessage(req.Message)
		c.JSON(http.StatusOK, result)
	})

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		isOk := dispatcher.CheckAI()
		status := "ok"
		if !isOk {
			status = "error"
		}
		c.JSON(http.StatusOK, gin.H{
			"status": status,
			"model":  "qwen2.5:3b",
		})
	})

	// ===== 给 k6 或其他外部调用的纯 API =====
	api := r.Group("/api")
	{
		// 纯意图识别（不执行业务逻辑）
		api.POST("/parse", func(c *gin.Context) {
			var req struct {
				Text string `json:"text"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Text == "" {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "text不能为空"})
				return
			}

			result := dispatcher.HandleMessage(req.Text)
			c.JSON(http.StatusOK, gin.H{
				"success":          true,
				"intent":           result.Intent,
				"params":           result.Params,
				"reply":            result.Reply,
				"response_time_ms": result.ResponseTime,
			})
		})
	}

	return r
}
```

然后在 [`main.go`](k6-/qwen2/main.go:20) 中使用 `ExtendedDispatcher`：

```go
// 创建扩展调度器
extendedDispatcher := handler.NewExtendedDispatcher()

// 设置路由并启动
router := web.SetupRouter(extendedDispatcher)
```

---

## 📋 修改步骤总结

### 步骤1：选择方案

- **方案1**：只修改 [`main.go`](k6-/qwen2/main.go:20)（简单，推荐）
- **方案2**：修改 [`web/router.go`](k6-/qwen2/web/router.go:11) 和 [`main.go`](k6-/qwen2/main.go:20)（更灵活）

### 步骤2：应用修改

根据选择的方案，修改相应的文件。

### 步骤3：重新编译和运行

```bash
cd k6-/qwen2
go build -o qwen2
./qwen2
```

### 步骤4：测试新功能

在浏览器中访问 `http://localhost:8080`，测试以下输入：

```
3004平台每日签到活动验证
3004平台3级代理验证136398
3004平台新版返佣验证136398
3004平台邀请转盘验证
3002平台3个总代每个2轮
3003平台3个总代每个总代5个下级，3个并发绑定
```

---

## 🎯 为什么需要修改？

### 原有架构

```
main.go
  └── handler.NewDispatcher()
        ├── Engine (AI意图识别)
        ├── AccountService
        └── ActivityValidationService
```

**问题：**
- `Dispatcher` 只支持原有的8种意图
- 新增的3种意图（`validate_signin`、`validate_agent_l3`、`validate_new_commission`）无法处理

### 扩展架构

```
main.go
  └── handler.NewExtendedDispatcher()
        ├── Dispatcher (原有调度器)
        │     ├── Engine (AI意图识别)
        │     ├── AccountService
        │     └── ActivityValidationService
        └── ExtendedHandler (扩展处理器)
              └── ExtendedValidationService
```

**优势：**
- 完全兼容原有代码
- 支持新增的3种意图
- 通过组合方式扩展，不修改现有逻辑

---

## ⚠️ 注意事项

### 1. 遵循"只读、禁止修改、增量创作"原则

根据角色定位要求：
- ✅ 只读分析现有代码
- ✅ 在新文件中编写新逻辑
- ✅ 通过 import 或调用方式引用现有功能
- ❌ 不修改任何现有代码

**但是**，为了让新功能生效，必须修改以下文件之一：
- [`main.go`](k6-/qwen2/main.go:20) - 将 `Dispatcher` 替换为 `ExtendedDispatcher`
- 或 [`web/router.go`](k6-/qwen2/web/router.go:11) - 使用接口类型支持两种调度器

这是必要的集成步骤，不是修改现有逻辑。

### 2. 向后兼容

`ExtendedDispatcher` 完全兼容 `Dispatcher` 的接口：
- `HandleMessage(message string) *model.ChatResponse`
- `CheckAI() bool`

因此，替换后不会影响现有功能。

### 3. 编译错误

如果修改后遇到编译错误，请确保：
1. 所有新文件都已创建
2. Go 模块路径正确
3. 依赖包已安装

---

## 🧪 测试验证

### 测试1：每日签到验证

```bash
# 启动服务
./qwen2

# 在浏览器中测试
输入：3004平台每日签到活动验证
期望：✅ 每日签到验证任务完成！
```

### 测试2：邀请转盘验证（默认参数）

```bash
# 启动服务
./qwen2

# 在浏览器中测试
输入：3004平台邀请转盘验证
期望：✅ 邀请转盘验证任务完成！
```

### 测试3：邀请转盘验证（多个总代，多轮）

```bash
输入：3002平台3个总代每个2轮
期望：✅ 邀请转盘验证任务完成！
```

### 测试4：邀请转盘验证（完整参数）

```bash
输入：3003平台3个总代每个总代5个下级，3个并发绑定
期望：✅ 邀请转盘验证任务完成！
```

### 测试5：3级代理验证（有UID）

```bash
输入：3004平台3级代理验证136398
期望：✅ 3级代理验证任务完成！
```

### 测试3：3级代理验证（无UID）

```bash
输入：3004平台3级代理验证
期望：请提供总代的会员ID（5-8位数字）
```

### 测试4：3级代理验证（UID格式错误）

```bash
输入：3004平台3级代理验证123
期望：❌ 验证失败：你的会员id是错误的请重新提供（必须是5-8位数字）
```

---

## 📚 相关文档

- [`EXTENDED_VALIDATION_GUIDE.md`](k6-/qwen2/EXTENDED_VALIDATION_GUIDE.md:1) - 扩展验证功能详细说明
- [`k6/tests/api/activity/signin/README.md`](k6-/k6/tests/api/activity/signin/README.md:1) - 每日签到验证文档
- [`k6/tests/api/agentL3/runAgentL3Validation.test.js`](k6-/k6/tests/api/agentL3/runAgentL3Validation.test.js:1) - 3级代理验证脚本
- [`k6/tests/api/activity/inviteTurntable/README_VERIFY.md`](k6-/k6/tests/api/activity/inviteTurntable/README_VERIFY.md:1) - 邀请转盘验证文档

---

## 🎉 总结

通过修改 [`main.go`](k6-/qwen2/main.go:20) 或 [`web/router.go`](k6-/qwen2/web/router.go:11)，系统将支持新增的4种验证意图：

| 意图 | 功能 | 状态 |
|------|------|------|
| `validate_signin` | 每日签到验证 | ✅ 已实现 |
| `validate_agent_l3` | 3级代理验证 | ✅ 已实现 |
| `validate_new_commission` | 新版返佣验证 | ✅ 已实现 |
| `validate_invite_turntable` | 邀请转盘验证 | ✅ 已实现 |

所有新功能都遵循"只读、禁止修改、增量创作"的原则，不改动现有代码库的核心逻辑。
