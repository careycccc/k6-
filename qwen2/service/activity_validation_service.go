package service

import (
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
)

// ActivityValidationService 活动验证服务
type ActivityValidationService struct{}

// NewActivityValidationService 创建活动验证服务实例
func NewActivityValidationService() *ActivityValidationService {
	return &ActivityValidationService{}
}

// ValidateActivity 验证活动
// platform: 平台编号 (3001/3002/3003/3004)
// activityName: 活动名称 (如：充值转盘)
func (s *ActivityValidationService) ValidateActivity(platform, activityName string) (string, error) {
	log.Printf("[活动验证] 开始验证: platform=%s, activity=%s", platform, activityName)

	// 验证平台编号
	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return "", fmt.Errorf("平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 根据活动名称映射到对应的验证脚本
	validationScript, err := s.getValidationScript(activityName)
	if err != nil {
		return "", err
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
		validationScript,
	}

	log.Printf("[活动验证] 执行命令: k6 %s", strings.Join(args, " "))

	// 执行K6脚本
	cmd := exec.Command("k6", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	startTime := time.Now()
	err = cmd.Run()
	elapsed := time.Since(startTime)

	stdoutStr := stdout.String()
	stderrStr := stderr.String()
	output := stdoutStr + "\n" + stderrStr

	log.Printf("[活动验证] 执行耗时: %v", elapsed)

	// 解析验证结果
	result := s.parseValidationResult(output, activityName)

	return result, nil
}

// getValidationScript 根据活动名称获取对应的验证脚本路径
func (s *ActivityValidationService) getValidationScript(activityName string) (string, error) {
	// 活动名称到验证脚本的映射
	activityScriptMap := map[string]string{
		"充值转盘":          "../k6/tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js",
		"rechargewheel": "../k6/tests/api/activity/rechargeWheel/rechargeWheelValidation.test.js",
	}

	// 查找对应的脚本（不区分大小写）
	for key, script := range activityScriptMap {
		if strings.EqualFold(activityName, key) {
			return script, nil
		}
	}

	// 如果找不到，尝试构建通用路径
	// 假设活动名称的英文版本就是目录名
	activityDir := strings.ToLower(activityName)
	activityDir = strings.ReplaceAll(activityDir, " ", "")
	activityDir = strings.ReplaceAll(activityDir, "转盘", "wheel")
	activityDir = strings.ReplaceAll(activityDir, "充值", "recharge")

	genericScript := fmt.Sprintf("../k6/tests/api/activity/%s/%sValidation.test.js", activityDir, activityDir)

	// 检查文件是否存在
	if _, err := exec.Command("test", "-f", genericScript).CombinedOutput(); err == nil {
		return genericScript, nil
	}

	return "", fmt.Errorf("未找到活动 '%s' 的验证脚本，目前仅支持：充值转盘", activityName)
}

// parseValidationResult 解析验证结果
func (s *ActivityValidationService) parseValidationResult(output, activityName string) string {
	var result strings.Builder

	result.WriteString(fmt.Sprintf("✅ %s 验证任务完成！\n\n", activityName))

	// 提取测试结果统计
	lines := strings.Split(output, "\n")
	var totalTests, successTests, failedTests int
	var testDetails []string

	for _, line := range lines {
		// 提取总测试数
		if strings.Contains(line, "总测试数:") {
			parts := strings.Split(line, "总测试数:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &totalTests)
			}
		}
		// 提取成功数
		if strings.Contains(line, "成功:") {
			parts := strings.Split(line, "成功:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &successTests)
			}
		}
		// 提取失败数
		if strings.Contains(line, "失败:") {
			parts := strings.Split(line, "失败:")
			if len(parts) > 1 {
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &failedTests)
			}
		}
		// 提取测试详情
		if strings.Contains(line, "✅") || strings.Contains(line, "❌") {
			testDetails = append(testDetails, strings.TrimSpace(line))
		}
	}

	// 显示统计结果
	if totalTests > 0 {
		result.WriteString(fmt.Sprintf("📊 测试统计：\n"))
		result.WriteString(fmt.Sprintf("   总测试数: %d\n", totalTests))
		result.WriteString(fmt.Sprintf("   成功: %d\n", successTests))
		result.WriteString(fmt.Sprintf("   失败: %d\n", failedTests))
		if totalTests > 0 {
			successRate := float64(successTests) / float64(totalTests) * 100
			result.WriteString(fmt.Sprintf("   成功率: %.2f%%\n", successRate))
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

	// 如果有失败的测试，显示失败详情
	if failedTests > 0 {
		result.WriteString("⚠️ 失败详情：\n")
		for _, line := range lines {
			if strings.Contains(line, "失败详情") {
				// 找到失败详情部分
				result.WriteString("   请查看完整日志获取详细信息\n")
				break
			}
		}
	}

	// 添加前台地址
	frontUrls := map[string]string{
		"3001": "https://arplatsaassit1.club",
		"3002": "https://arplatsaassit2.club",
		"3003": "https://arplatsaassit3.club",
		"3004": "https://arplatsaassit4.club",
	}

	// 从输出中提取平台编号
	for platform, url := range frontUrls {
		if strings.Contains(output, platform) {
			result.WriteString(fmt.Sprintf("\n🌐 前台地址：%s", url))
			break
		}
	}

	return result.String()
}
