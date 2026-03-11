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

	// 创建调度器
	dispatcher := handler.NewDispatcher()

	// 检查 AI 服务
	if dispatcher.CheckAI() {
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
	router := web.SetupRouter(dispatcher)
	if err := router.Run(config.ServerPort); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
