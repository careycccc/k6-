package service

import (
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// ExtendedValidationService 扩展活动验证服务
// 支持更多活动类型和参数
type ExtendedValidationService struct{}

// NewExtendedValidationService 创建扩展验证服务实例
func NewExtendedValidationService() *ExtendedValidationService {
	return &ExtendedValidationService{}
}

// ValidateSignIn 验证每日签到活动
// platform: 平台编号 (3001/3002/3003/3004)
// mode: 验证模式 ("random" 或 "specified")
// userCount: 随机用户数量（random模式）
// accounts: 指定账号列表（specified模式）
// manualReceiveRate: 手动领取比例
func (s *ExtendedValidationService) ValidateSignIn(platform, mode, userCount, accounts, manualReceiveRate string) (string, error) {
	log.Printf("[每日签到验证] 开始验证: platform=%s, mode=%s, userCount=%s, accounts=%s, manualReceiveRate=%s",
		platform, mode, userCount, accounts, manualReceiveRate)

	// 验证平台编号
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return "", fmt.Errorf("平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 根据平台ID设置语言：3003使用西班牙语(es)，其他平台使用英语(en)
	language := "en"
	if platform == "3003" {
		language = "es"
	}

	// 构建K6命令
	args := []string{
		"run",
		"-e", fmt.Sprintf("TENANT_ID=%s", platform),
		"-e", fmt.Sprintf("LANGUAGE=%s", language),
	}

	// 添加模式参数
	if mode == "" {
		mode = "random" // 默认随机模式
	}
	args = append(args, "-e", fmt.Sprintf("MODE=%s", mode))

	// 根据模式添加不同参数
	if mode == "random" {
		// 随机模式：添加用户数量
		if userCount == "" {
			userCount = "3" // 默认3个用户
		}
		args = append(args, "-e", fmt.Sprintf("USER_COUNT=%s", userCount))
	} else if mode == "specified" {
		// 指定账号模式：添加账号列表
		if accounts == "" {
			return "", fmt.Errorf("指定账号模式下必须提供账号列表")
		}
		args = append(args, "-e", fmt.Sprintf("ACCOUNTS=%s", accounts))
	}

	// 添加手动领取比例
	if manualReceiveRate == "" {
		manualReceiveRate = "0.8" // 默认80%
	}
	args = append(args, "-e", fmt.Sprintf("MANUAL_RECEIVE_RATE=%s", manualReceiveRate))

	// 添加脚本路径
	args = append(args, "../k6/tests/api/activity/signin/signinValidation.test.js")

	log.Printf("[每日签到验证] 执行命令: k6 %s", strings.Join(args, " "))

	// 执行K6脚本
	cmd := exec.Command("k6", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startTime := time.Now()
	_ = cmd.Run() // 执行命令，错误会在输出中体现
	elapsed := time.Since(startTime)

	stdoutStr := stdout.String()
	stderrStr := stderr.String()
	output := stdoutStr + "\n" + stderrStr

	log.Printf("[每日签到验证] 执行耗时: %v", elapsed)

	// 解析验证结果
	result := s.parseSignInResult(output, platform)

	return result, nil
}

// ValidateAgentL3 验证3级代理/新版返佣活动
// platform: 平台编号 (3001/3002/3003/3004)
// targetUid: 总代UID（5-8位数字）
func (s *ExtendedValidationService) ValidateAgentL3(platform, targetUid string) (string, error) {
	log.Printf("[3级代理验证] 开始验证: platform=%s, targetUid=%s", platform, targetUid)

	// 验证平台编号
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return "", fmt.Errorf("平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 验证targetUid格式（5-8位数字）
	if targetUid == "" {
		return "", fmt.Errorf("请提供总代的会员ID（5-8位数字）")
	}

	// 使用正则验证UID格式
	uidRegex := regexp.MustCompile(`^\d{5,8}$`)
	if !uidRegex.MatchString(targetUid) {
		return "", fmt.Errorf("你的会员id是错误的请重新提供（必须是5-8位数字）")
	}

	// 根据平台ID设置语言：3003使用西班牙语(es)，其他平台使用英语(en)
	language := "en"
	if platform == "3003" {
		language = "es"
	}

	// 构建K6命令
	args := []string{
		"run",
		"-e", fmt.Sprintf("TENANT_ID=%s", platform),
		"-e", fmt.Sprintf("LANGUAGE=%s", language),
		"-e", fmt.Sprintf("TARGET_UID=%s", targetUid),
		"../k6/tests/api/agentL3/runAgentL3Validation.test.js",
	}

	log.Printf("[3级代理验证] 执行命令: k6 %s", strings.Join(args, " "))

	// 执行K6脚本
	cmd := exec.Command("k6", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startTime := time.Now()
	_ = cmd.Run() // 执行命令，错误会在输出中体现
	elapsed := time.Since(startTime)

	stdoutStr := stdout.String()
	stderrStr := stderr.String()
	output := stdoutStr + "\n" + stderrStr

	log.Printf("[3级代理验证] 执行耗时: %v", elapsed)

	// 解析验证结果
	result := s.parseAgentL3Result(output, platform, targetUid)

	return result, nil
}

// parseSignInResult 解析每日签到验证结果
func (s *ExtendedValidationService) parseSignInResult(output, platform string) string {
	var result strings.Builder

	result.WriteString("✅ 每日签到验证任务完成！\n\n")

	// 提取测试结果统计
	lines := strings.Split(output, "\n")
	var totalUsers, successUsers, failedUsers int
	var totalAmount float64
	var testDetails []string

	for _, line := range lines {
		// 提取总用户数
		if strings.Contains(line, "总用户数:") {
			parts := strings.Split(line, "总用户数:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &totalUsers)
			}
		}
		// 提取成功数
		if strings.Contains(line, "成功验证:") {
			parts := strings.Split(line, "成功验证:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &successUsers)
			}
		}
		// 提取失败数
		if strings.Contains(line, "失败验证:") {
			parts := strings.Split(line, "失败验证:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &failedUsers)
			}
		}
		// 提取总领取金额
		if strings.Contains(line, "总领取金额:") {
			parts := strings.Split(line, "总领取金额:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &totalAmount)
			}
		}
		// 提取测试详情
		if strings.Contains(line, "│") && (strings.Contains(line, "✅") || strings.Contains(line, "❌")) {
			testDetails = append(testDetails, strings.TrimSpace(line))
		}
	}

	// 显示统计结果
	if totalUsers > 0 {
		result.WriteString("📊 测试统计：\n")
		result.WriteString(fmt.Sprintf("   总用户数: %d\n", totalUsers))
		result.WriteString(fmt.Sprintf("   成功验证: %d\n", successUsers))
		result.WriteString(fmt.Sprintf("   失败验证: %d\n", failedUsers))
		if totalUsers > 0 {
			successRate := float64(successUsers) / float64(totalUsers) * 100
			result.WriteString(fmt.Sprintf("   成功率: %.2f%%\n", successRate))
		}
		if totalAmount > 0 {
			result.WriteString(fmt.Sprintf("   总领取金额: %.2f\n", totalAmount))
			result.WriteString(fmt.Sprintf("   平均领取金额: %.2f\n", totalAmount/float64(successUsers)))
		}
		result.WriteString("\n")
	}

	// 显示测试详情
	if len(testDetails) > 0 {
		result.WriteString("📋 测试详情：\n")
		for _, detail := range testDetails {
			result.WriteString(fmt.Sprintf("   %s\n", detail))
		}
		result.WriteString("\n")
	}

	// 添加前台地址
	frontUrls := map[string]string{
		"3001": "https://arplatsaassit1.club",
		"3002": "https://arplatsaassit2.club",
		"3003": "https://arplatsaassit3.club",
		"3004": "https://arplatsaassit4.club",
	}

	if frontUrl, ok := frontUrls[platform]; ok {
		result.WriteString(fmt.Sprintf("\n🌐 前台地址：%s", frontUrl))
	}

	return result.String()
}

// parseAgentL3Result 解析3级代理验证结果
func (s *ExtendedValidationService) parseAgentL3Result(output, platform, targetUid string) string {
	var result strings.Builder

	result.WriteString("✅ 3级代理验证任务完成！\n\n")

	// 提取验证结果
	lines := strings.Split(output, "\n")
	var validationSuccess bool
	var agentInfo string
	var subAgentCount int
	var totalCommission float64

	for _, line := range lines {
		// 检查验证是否成功
		if strings.Contains(line, "验证成功") || strings.Contains(line, "✅") {
			validationSuccess = true
		}
		// 提取代理信息
		if strings.Contains(line, "总代UID") || strings.Contains(line, "代理信息") {
			agentInfo = strings.TrimSpace(line)
		}
		// 提取下级代理数量
		if strings.Contains(line, "下级代理数") || strings.Contains(line, "下级数量") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &subAgentCount)
			}
		}
		// 提取总佣金
		if strings.Contains(line, "总佣金") || strings.Contains(line, "返佣金额") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &totalCommission)
			}
		}
	}

	// 显示验证结果
	result.WriteString("📊 验证结果：\n")
	result.WriteString(fmt.Sprintf("   平台: %s\n", platform))
	result.WriteString(fmt.Sprintf("   总代UID: %s\n", targetUid))
	result.WriteString(fmt.Sprintf("   验证状态: %s\n", map[bool]string{true: "✅ 成功", false: "❌ 失败"}[validationSuccess]))

	if agentInfo != "" {
		result.WriteString(fmt.Sprintf("   %s\n", agentInfo))
	}

	if subAgentCount > 0 {
		result.WriteString(fmt.Sprintf("   下级代理数: %d\n", subAgentCount))
	}

	if totalCommission > 0 {
		result.WriteString(fmt.Sprintf("   总佣金: %.2f\n", totalCommission))
	}

	result.WriteString("\n")

	// 添加前台地址
	frontUrls := map[string]string{
		"3001": "https://arplatsaassit1.club",
		"3002": "https://arplatsaassit2.club",
		"3003": "https://arplatsaassit3.club",
		"3004": "https://arplatsaassit4.club",
	}

	if frontUrl, ok := frontUrls[platform]; ok {
		result.WriteString(fmt.Sprintf("\n🌐 前台地址：%s", frontUrl))
	}

	return result.String()
}

// ValidateInviteTurntable 验证邀请转盘活动
// platform: 平台编号 (3001/3002/3003/3004)
// generalAgentCount: 总代数量（默认1）
// wheelNumber: 轮次数量（默认1）
// subMinNumber: 最小下级数量（默认2）
// subMaxNumber: 最大下级数量（默认5）
// subConcurrent: 下级并发数（默认3）
// minMoney: 最小充值金额（默认1000）
// maxMoney: 最大充值金额（默认5000）
func (s *ExtendedValidationService) ValidateInviteTurntable(platform, generalAgentCount, wheelNumber, subMinNumber, subMaxNumber, subConcurrent, minMoney, maxMoney string) (string, error) {
	log.Printf("[邀请转盘验证] 开始验证: platform=%s, generalAgentCount=%s, wheelNumber=%s, subMinNumber=%s, subMaxNumber=%s, subConcurrent=%s, minMoney=%s, maxMoney=%s",
		platform, generalAgentCount, wheelNumber, subMinNumber, subMaxNumber, subConcurrent, minMoney, maxMoney)

	// 验证平台编号
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return "", fmt.Errorf("平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 设置默认值
	if generalAgentCount == "" {
		generalAgentCount = "1"
	}
	if wheelNumber == "" {
		wheelNumber = "1"
	}
	if subMinNumber == "" {
		subMinNumber = "2"
	}
	if subMaxNumber == "" {
		subMaxNumber = "5"
	}
	if subConcurrent == "" {
		subConcurrent = "3"
	}
	if minMoney == "" {
		minMoney = "1000"
	}
	if maxMoney == "" {
		maxMoney = "5000"
	}

	// 构建Shell命令
	scriptPath := "../k6/tests/api/activity/inviteTurntable/run-verify-invite-turntable.sh"
	args := []string{
		scriptPath,
		platform,
		generalAgentCount,
		wheelNumber,
		subMinNumber,
		subMaxNumber,
		subConcurrent,
		minMoney,
		maxMoney,
	}

	log.Printf("[邀请转盘验证] 执行命令: %s", strings.Join(args, " "))

	// 执行Shell脚本
	cmd := exec.Command("bash", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startTime := time.Now()
	_ = cmd.Run() // 执行命令，错误会在输出中体现
	elapsed := time.Since(startTime)

	stdoutStr := stdout.String()
	stderrStr := stderr.String()
	output := stdoutStr + "\n" + stderrStr

	log.Printf("[邀请转盘验证] 执行耗时: %v", elapsed)

	// 解析验证结果
	result := s.parseInviteTurntableResult(output, platform, generalAgentCount, wheelNumber)

	return result, nil
}

// parseInviteTurntableResult 解析邀请转盘验证结果
func (s *ExtendedValidationService) parseInviteTurntableResult(output, platform, generalAgentCount, wheelNumber string) string {
	var result strings.Builder

	result.WriteString("✅ 邀请转盘验证任务完成！\n\n")

	// 提取验证结果
	lines := strings.Split(output, "\n")
	var validationSuccess bool
	var totalAgents int
	var totalWheels int
	var totalSubAgents int
	var totalWithdrawAmount float64

	for _, line := range lines {
		// 检查验证是否成功
		if strings.Contains(line, "验证成功") || strings.Contains(line, "✅") {
			validationSuccess = true
		}
		// 提取总代数量
		if strings.Contains(line, "总代数量") || strings.Contains(line, "总代数") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &totalAgents)
			}
		}
		// 提取轮次数量
		if strings.Contains(line, "轮次数量") || strings.Contains(line, "轮次数") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &totalWheels)
			}
		}
		// 提取下级数量
		if strings.Contains(line, "下级数量") || strings.Contains(line, "下级数") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &totalSubAgents)
			}
		}
		// 提取提现金额
		if strings.Contains(line, "提现金额") || strings.Contains(line, "总提现") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &totalWithdrawAmount)
			}
		}
	}

	// 显示验证结果
	result.WriteString("📊 验证结果：\n")
	result.WriteString(fmt.Sprintf("   平台: %s\n", platform))
	result.WriteString(fmt.Sprintf("   总代数量: %s\n", generalAgentCount))
	result.WriteString(fmt.Sprintf("   轮次数量: %s\n", wheelNumber))
	result.WriteString(fmt.Sprintf("   验证状态: %s\n", map[bool]string{true: "✅ 成功", false: "❌ 失败"}[validationSuccess]))

	if totalAgents > 0 {
		result.WriteString(fmt.Sprintf("   实际总代数: %d\n", totalAgents))
	}

	if totalWheels > 0 {
		result.WriteString(fmt.Sprintf("   实际轮次数: %d\n", totalWheels))
	}

	if totalSubAgents > 0 {
		result.WriteString(fmt.Sprintf("   下级总数: %d\n", totalSubAgents))
	}

	if totalWithdrawAmount > 0 {
		result.WriteString(fmt.Sprintf("   总提现金额: %.2f\n", totalWithdrawAmount))
	}

	result.WriteString("\n")

	// 添加前台地址
	frontUrls := map[string]string{
		"3001": "https://arplatsaassit1.club",
		"3002": "https://arplatsaassit2.club",
		"3003": "https://arplatsaassit3.club",
		"3004": "https://arplatsaassit4.club",
	}

	if frontUrl, ok := frontUrls[platform]; ok {
		result.WriteString(fmt.Sprintf("\n🌐 前台地址：%s", frontUrl))
	}

	return result.String()
}
