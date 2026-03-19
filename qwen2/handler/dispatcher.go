package handler

import (
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"smart-qa/ai"
	"smart-qa/model"
	"smart-qa/service"
	"strconv"
	"strings"
	"time"
)

// Dispatcher 意图调度器
// SessionState 用于保存用户的上下文状态
type SessionState struct {
	PendingIntent string
	PendingParams map[string]string
	RetryCount    int
}

var globalSession *SessionState

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
func (d *Dispatcher) HandleMessage(userMessage string) *model.ChatResponse {
	start := time.Now()

	log.Printf("========================================")
	log.Printf("[调度] 收到消息: %s", userMessage)

	// ====== 检查是否处于会话上下文中 ======
	if globalSession != nil && globalSession.PendingIntent == "create_activity" {
		platform := strings.TrimSpace(userMessage)
		validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
		matchedPlatform := ""
		for p := range validPlatforms {
			if strings.Contains(platform, p) {
				matchedPlatform = p
				break
			}
		}
		if matchedPlatform != "" {
			globalSession.PendingParams["platform"] = matchedPlatform
			params := globalSession.PendingParams
			globalSession = nil
			reply := d.handleCreateActivity(params)
			return &model.ChatResponse{
				Reply:        reply,
				Intent:       "create_activity",
				Params:       params,
				ResponseTime: time.Since(start).Milliseconds(),
			}
		} else {
			globalSession.RetryCount++
			if globalSession.RetryCount >= 3 {
				globalSession = nil
				return &model.ChatResponse{
					Reply:        "您已连续 3 次未提供有效的租户编号(3001/3002/3003/3004)，本次会话结束。如果需要创建活动，请重新告诉我。",
					ResponseTime: time.Since(start).Milliseconds(),
				}
			}
			return &model.ChatResponse{
				Reply:        fmt.Sprintf("❌ 平台编号无效，请使用 3001/3002/3003/3004。\n(剩余重试次数: %d)", 3-globalSession.RetryCount),
				ResponseTime: time.Since(start).Milliseconds(),
			}
		}
	}

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

	case "create_activity":

		reply = d.handleCreateActivity(params)

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

		// 如果指定了充值金额，调用充值脚本
		if amount != "" {
			log.Printf("[调度] 正在为账号 %s 充值 %s 元", account.Username, amount)
			args := []string{
				"run",
				"-e", fmt.Sprintf("TENANT_ID=%s", platform),
				"-e", fmt.Sprintf("TARGET_USER=%s", account.Username),
				"-e", "IS_REGISTER=false",
				"../k6/tests/api/recharge/frontendRecharge.test.js",
			}
			cmd := exec.Command("k6", args...)
			err := cmd.Run()
			if err != nil {
				log.Printf("[调度] 账号 %s 充值失败: %v", account.Username, err)
				successAccounts[len(successAccounts)-1] += fmt.Sprintf(" (⚠️ 充值 %s 元遇到问题，请检查日志)", amount)
			} else {
				successAccounts[len(successAccounts)-1] += fmt.Sprintf(" (✅ 已成功发起充值 %s 元)", amount)
			}
		}

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
		return "请提供完整的充值信息。\n例如：给3004的1234@qq.com充值500，或者：给我一个3004账号充值500"
	}

	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	var actionDesc string
	var args []string
	var isRegister bool

	if account == "" || account == "undefined" {
		actionDesc = fmt.Sprintf("✅ 任务已受理！\n\n系统已为您【随机注册】一个 %s 平台的新账号，并尝试完成 %s 元充值。\n", platform, amount)
		account = "" // 留空，让 K6 随机生成
		isRegister = true
	} else {
		actionDesc = fmt.Sprintf("✅ 任务已受理！\n\n系统已使用您提供的账号 %s 在 %s 平台进行登录，并尝试完成 %s 元充值。\n", account, platform, amount)
		isRegister = false
	}

	log.Printf("[充值执行] 开始调用 k6: platform=%s, account=%s, amount=%s", platform, account, amount)

	// 获取当前工作目录，拼接 k6 脚本路径
	args = []string{
		"run",
		"-e", fmt.Sprintf("TENANT_ID=%s", platform),
	}
	if account != "" {
		args = append(args, "-e", fmt.Sprintf("TARGET_USER=%s", account))
		args = append(args, "-e", "IS_REGISTER=false")
	} else {
		args = append(args, "-e", "IS_REGISTER=true")
	}
	args = append(args, "../k6/tests/api/recharge/frontendRecharge.test.js")

	cmd := exec.Command("k6", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	output := stdout.String()

	// 解析日志，提取生成的随机账号
	var genAccount string
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "会话建立成功! 账号:") {
			parts := strings.Split(line, "账号: ")
			if len(parts) > 1 {
				genAccount = strings.Split(parts[1], ",")[0]
				genAccount = strings.TrimSpace(genAccount)
			}
		}
	}

	reply := actionDesc

	if isRegister && genAccount != "" {
		reply += fmt.Sprintf("\n⭐ 生成账号: %s\n⭐ 默认密码: qwer1234", genAccount)
	}

	frontUrls := map[string]string{
		"3001": "https://arplatsaassit1.club",
		"3002": "https://arplatsaassit2.club",
		"3003": "https://arplatsaassit3.club",
		"3004": "https://arplatsaassit4.club",
	}
	if url, ok := frontUrls[platform]; ok {
		reply += fmt.Sprintf("\n🌐 前台地址: %s", url)
	}

	if err != nil || !strings.Contains(output, "充值测试结束") {
		log.Printf("[充值执行] K6 执行错误或未正常结束: %v\n%s\n%s", err, output, stderr.String())
		reply += "\n\n⚠️ 充值自动化执行似乎遇到了一些问题，请检查后台控制台日志。"
	} else {
		reply += "\n\n(提示: 充值脚本已在后台执行完毕。如果是随机账号，建议立即登录前台查看余额。)"
	}

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
  2. 新增活动     → 例：创建一个3004平台的xxx活动
  3. 多个下级     → 例：3004平台4级下级总人数25人
  4. 某个活动的账号     → 例：3004平台的邀请转盘的账号

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
		globalSession = &SessionState{
			PendingIntent: "create_activity",
			PendingParams: params,
			RetryCount:    0,
		}
		return fmt.Sprintf("请告诉我你要在哪个租户(3001、3002、3003、3004)创建【%s】活动？\n例如回答: 在3001平台", activitiesStr)
	}
	
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	if activitiesStr == "" {
		return "请告诉我你需要创建什么活动？(如: 每日签到、红包雨等)"
	}

	activities := strings.Split(activitiesStr, ",")
	var successList []string
	
	for _, act := range activities {
		act = strings.TrimSpace(act)
		if act == "" { continue }
		
		scriptMap := map[string]string{
			"每日签到": "../k6/tests/api/activity/signin/createSignin.js",
			"红包雨":   "../k6/tests/api/activity/RedRainActivity/createRedRainActivity.js",
			"锦标赛":   "../k6/tests/api/activity/champion/createChampion.js",
			"幸运礼包": "../k6/tests/api/activity/luckyDoubleBonus/createluckyDoubleBonus.js",
			"活动":     "../k6/tests/api/activity/systemActive/createSystemActive.js",
		}
		
		matchedScript := ""
		for key, script := range scriptMap {
			if strings.Contains(act, key) {
				matchedScript = script
				break
			}
		}

		if matchedScript != "" {
			log.Printf("[活动创建] 正在 %s 平台创建活动: %s (%s)", platform, act, matchedScript)
			args := []string{"run", "-e", fmt.Sprintf("TENANT_ID=%s", platform), matchedScript}
			cmd := exec.Command("k6", args...)
			err := cmd.Run()
			if err != nil {
				log.Printf("[活动创建] k6 执行失败: %v", err)
				successList = append(successList, fmt.Sprintf("⚠️ 【%s】(创建执行失败)", act))
			} else {
				successList = append(successList, fmt.Sprintf("✅ 【%s】(创建成功)", act))
			}
		} else {
			successList = append(successList, fmt.Sprintf("❌ 目前还没有实现【%s】活动的新建", act))
		}
	}

	var reply strings.Builder
	reply.WriteString(fmt.Sprintf("活动已调度完毕！\n\n租户：%s\n\n创建结果如下：\n", platform))
	reply.WriteString(strings.Join(successList, "\n"))

	return reply.String()
}
