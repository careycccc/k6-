package handler

import (
	"fmt"
	"log"
	"smart-qa/ai"
	"smart-qa/model"
	"smart-qa/service"
	"strconv"
	"strings"
	"time"
)

// Dispatcher 意图调度器
type Dispatcher struct {
	engine         *ai.Engine
	accountService *service.AccountService
}

// NewDispatcher 创建调度器
func NewDispatcher() *Dispatcher {
	return &Dispatcher{
		engine:         ai.NewEngine(),
		accountService: service.NewAccountService(),
	}
}

// CheckAI 检查AI服务是否正常
func (d *Dispatcher) CheckAI() bool {
	return d.engine.CheckConnection()
}

// HandleMessage 处理用户消息的完整流程
//
//  1. 接收用户输入
//  2. 调用 AI 识别意图
//  3. 根据意图调用对应的业务函数
//  4. 组装回复返回
func (d *Dispatcher) HandleMessage(userMessage string) *model.ChatResponse {
	start := time.Now()

	log.Printf("========================================")
	log.Printf("[调度] 收到消息: %s", userMessage)

	// ===== 第1步：AI 意图识别 =====
	parseResult, err := d.engine.Parse(userMessage)
	if err != nil {
		log.Printf("[调度] AI解析失败: %v", err)
		return &model.ChatResponse{
			Reply:        "⚠️ AI 服务暂时不可用，请稍后再试。",
			ResponseTime: time.Since(start).Milliseconds(),
		}
	}

	intent := parseResult.Intent
	params := parseResult.Params

	log.Printf("[调度] 识别结果: intent=%s, params=%v", intent, params)

	// ===== 第2步：根据意图调用对应的业务函数 =====
	var reply string

	switch intent {

	case "get_account":
		reply = d.handleGetAccount(params)

	case "ask_platform":
		reply = d.handleAskPlatform()

	case "query_balance":
		reply = d.handleQueryBalance(params)

	case "recharge":
		reply = d.handleRecharge(params)

	case "list_accounts":
		reply = d.handleListAccounts(params)

	case "unknown":
		reply = d.handleUnknown()

	default:
		reply = d.handleUnknown()
	}

	elapsed := time.Since(start).Milliseconds()
	log.Printf("[调度] 回复内容: %s", truncate(reply, 100))
	log.Printf("[调度] 总耗时: %dms", elapsed)
	log.Printf("========================================")

	return &model.ChatResponse{
		Reply:        reply,
		Intent:       intent,
		Params:       params,
		ResponseTime: elapsed,
	}
}

// ============ 各意图的处理方法 ============

func (d *Dispatcher) handleGetAccount(params map[string]string) string {
	platform := params["platform"]
	count := params["count"]
	accountType := params["type"]
	amount := params["amount"]

	// 验证平台编号
	if platform == "" {
		return "请告诉我你需要哪个平台的账号？\n例如：给我一个3002平台的账号"
	}

	// 验证平台编号是否有效
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 解析数量
	accountCount := 1
	if count != "" {
		if n, err := strconv.Atoi(count); err == nil && n > 0 && n <= 10 {
			accountCount = n
		} else if n > 10 {
			return "❌ 一次最多只能注册10个账号"
		}
	}

	// 默认账号类型为手机号
	if accountType == "" {
		accountType = "phone"
	}

	// 验证账号类型
	if accountType != "phone" && accountType != "email" {
		accountType = "phone"
	}

	accountTypeName := "手机号"
	if accountType == "email" {
		accountTypeName = "邮箱"
	}

	log.Printf("[调度] 准备注册: platform=%s, count=%d, type=%s", platform, accountCount, accountType)

	// ⭐ 调用业务函数批量注册
	var successAccounts []string
	var failedCount int
	var frontendURL string
	var errorMessages []string // 收集错误信息

	for i := 0; i < accountCount; i++ {
		account, err := d.accountService.GetAccount(platform, accountType, amount)
		if err != nil {
			log.Printf("[调度] 第 %d 个账号注册失败: %v", i+1, err)
			failedCount++
			
			// 提取详细错误信息
			errMsg := err.Error()
			// 如果错误信息包含 "响应:" 说明有API响应详情
			if strings.Contains(errMsg, "响应:") {
				errorMessages = append(errorMessages, fmt.Sprintf("  第 %d 个: %s", i+1, errMsg))
			} else {
				errorMessages = append(errorMessages, fmt.Sprintf("  第 %d 个: %v", i+1, err))
			}
			continue
		}

		successAccounts = append(successAccounts, fmt.Sprintf("  %d. 账号：%s | 密码：%s", i+1, account.Username, account.Password))

		// 保存前台地址（从第一个成功的账号中获取）
		if frontendURL == "" && account.Amount != "" {
			frontendURL = account.Amount // 临时使用 Amount 字段传递前台地址
		}
	}

	// 组装回复
	if len(successAccounts) == 0 {
		var reply strings.Builder
		reply.WriteString(fmt.Sprintf("❌ 抱歉，%s平台%s账号注册失败\n\n", platform, accountTypeName))

		// 添加详细错误信息
		if len(errorMessages) > 0 {
			reply.WriteString("错误详情：\n")
			for _, errMsg := range errorMessages {
				reply.WriteString(errMsg)
				reply.WriteString("\n")
			}
			reply.WriteString("\n")
		}

		reply.WriteString("请检查配置或联系管理员")
		return reply.String()
	}

	var reply strings.Builder
	reply.WriteString(fmt.Sprintf("✅ 已为你在 %s 平台注册 %d 个%s账号：\n\n", platform, len(successAccounts), accountTypeName))
	reply.WriteString(strings.Join(successAccounts, "\n"))

	if failedCount > 0 {
		reply.WriteString(fmt.Sprintf("\n\n⚠️ 有 %d 个账号注册失败", failedCount))

		// 添加失败账号的错误信息
		if len(errorMessages) > 0 {
			reply.WriteString("\n错误详情：\n")
			for _, errMsg := range errorMessages {
				reply.WriteString(errMsg)
				reply.WriteString("\n")
			}
		}
	}

	// 添加前台地址
	if frontendURL != "" {
		reply.WriteString(fmt.Sprintf("\n\n🌐 前台地址：%s", frontendURL))
	}

	reply.WriteString("\n\n请妥善保管账号信息！")

	return reply.String()
}

func (d *Dispatcher) handleAskPlatform() string {
	return `请告诉我你需要哪个平台的账号？

可选平台：
  • 3001 平台
  • 3002 平台  
  • 3003 平台
  • 3004 平台

例如：给我一个3002的账号`
}

func (d *Dispatcher) handleQueryBalance(params map[string]string) string {
	account := params["account"]
	if account == "" {
		return "请告诉我你要查询哪个账号的余额？\n例如：查一下 user_001 的余额"
	}

	// ⭐ 调用你的业务函数
	balance, err := d.accountService.QueryBalance(account)
	if err != nil {
		return fmt.Sprintf("❌ 查询失败：%v", err)
	}

	return fmt.Sprintf("📊 账号 %s 的当前余额为：%s 元", account, balance)
}

func (d *Dispatcher) handleRecharge(params map[string]string) string {
	platform := params["platform"]
	amount := params["amount"]
	account := params["account"] // 如果为空则代表随机注册

	if platform == "" || amount == "" {
		return "请提供完整的充值信息。\n例如：给3004的12344@qq.com充值500，或者：给我一个3004账号充值500"
	}

	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	var actionDesc string
	if account == "" || account == "undefined" {
		actionDesc = fmt.Sprintf("✅ 任务已受理！\n\n系统将为您【随机注册】一个 %s 平台的新账号，并完成 %s 元充值。\n", platform, amount)
		account = "【系统随机生成】"
	} else {
		actionDesc = fmt.Sprintf("✅ 任务已受理！\n\n系统将使用您提供的账号 %s 在 %s 平台进行登录，并完成 %s 元充值。\n", account, platform, amount)
	}

	// 实际项目中这里通过 exec.Command 调用 k6 脚本，并将 platform, account, amount 传递给环境变量
	// 例如：exec.Command("k6", "run", "-e", "TARGET_USER=" + account, "-e", "TARGET_PLATFORM=" + platform, "k6/tests/api/recharge/frontendRecharge.test.js")

	var reply = actionDesc + "\n(提示: 后端已触发对应的 k6 自动化脚本执行前台充值流程)"
	return reply
}

func (d *Dispatcher) handleListAccounts(params map[string]string) string {
	platform := params["platform"]
	if platform == "" {
		return "请指定要查看哪个平台的账号。\n例如：3003平台有哪些号"
	}

	// ⭐ 调用你的业务函数
	accounts, err := d.accountService.ListAccounts(platform)
	if err != nil {
		return fmt.Sprintf("❌ 查询失败：%v", err)
	}

	if len(accounts) == 0 {
		return fmt.Sprintf("📋 %s 平台暂无可用账号", platform)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("📋 %s 平台可用账号：\n\n", platform))
	for i, acc := range accounts {
		sb.WriteString(fmt.Sprintf("  %d. %s（充值%s元）\n", i+1, acc.Username, acc.Amount))
	}

	return sb.String()
}

func (d *Dispatcher) handleUnknown() string {
	return `🤔 抱歉，我没有理解你的意思。

我可以帮你：
  1. 获取平台账号 → 例：给我一个3003平台充值500的账号
  2. 查询余额     → 例：查一下 user_001 的余额
  3. 充值         → 例：帮我在3003平台充值500
  4. 查看账号列表 → 例：3003平台有哪些号

请换个说法试试～`
}

// truncate 截断字符串
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) > maxLen {
		return string(runes[:maxLen]) + "..."
	}
	return s
}

// truncateToken 截断 token 显示
func truncateToken(token string) string {
	if len(token) > 30 {
		return token[:30] + "..."
	}
	return token
}

func (d *Dispatcher) handleCreateActivity(params map[string]string) string {
	platform := params["platform"]
	activitiesStr := params["activities"]

	if platform == "" {
		return "请告诉我你要在哪个平台创建活动？（如：3001/3002/3003/3004）"
	}
    
    validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	if activitiesStr == "" {
		return "请告诉我你需要创建什么活动？（如：每日签到、红包雨等）"
	}

	// TODO: 实际项目中，这里需要调用 service 层的方法，比如使用 exec.Command 调用 k6 脚本
	// d.activityService.Create(platform, activitiesStr)
    
	activities := strings.Split(activitiesStr, ",")
	var successList []string
    
	for _, act := range activities {
        act = strings.TrimSpace(act)
        if act == "" { continue }
		successList = append(successList, fmt.Sprintf("✅ 【%s】", act))
	}

	var reply strings.Builder
	reply.WriteString(fmt.Sprintf("活动已创建完毕！\n\n租户：%s\n\n创建的活动如下：\n", platform))
	reply.WriteString(strings.Join(successList, "\n"))
    
    // (可选) 提示后台正在调用K6脚本
    // reply.WriteString("\n\n(系统已在后台触发对应的K6测试脚本)")

	return reply.String()
}
