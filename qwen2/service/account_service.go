package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"smart-qa/model"
)

// =============================================================
//
//  ⭐⭐⭐ 这个文件是你放业务逻辑的地方 ⭐⭐⭐
//
//  AI 识别到意图后，会调用这里对应的函数
//  你只需要把函数内部的模拟代码替换成你真实的逻辑
//
// =============================================================

// AccountService 账号服务
type AccountService struct {
	// 你可以在这里放数据库连接、API客户端等
	// db *sql.DB
	// apiClient *http.Client
}

// NewAccountService 创建服务实例
func NewAccountService() *AccountService {
	return &AccountService{
		// 初始化你的数据库连接等
		// db: initDB(),
	}
}

// GetAccount 获取指定平台和充值金额的账号
//
// ⭐ AI识别到 intent=get_account 时会调用这个函数
//
// 参数:
//   - platform: 平台编号，如 "3003"
//   - accountType: 账号类型，"phone" 或 "email"
//   - amount:   充值金额，如 "500"（暂未使用，预留）
//
// 返回：
//   - *model.AccountInfo: 账号信息
//   - error: 错误信息
func (s *AccountService) GetAccount(platform string, accountType string, amount string) (*model.AccountInfo, error) {
	log.Printf("[业务] GetAccount 被调用: platform=%s, type=%s, amount=%s", platform, accountType, amount)

	// 调用 K6 注册服务创建新账号
	account, err := s.registerAccountViaK6(platform, accountType, 1)
	if err != nil {
		// 如果是手机号注册失败，且错误信息包含"verification method is not enabled"
		// 自动尝试邮箱注册
		if accountType == "phone" && strings.Contains(err.Error(), "verification method is not enabled") {
			log.Printf("[业务] 手机号注册不可用，自动切换到邮箱注册")
			account, err = s.registerAccountViaK6(platform, "email", 1)
			if err != nil {
				log.Printf("[业务] 邮箱注册也失败: %v", err)
				return nil, fmt.Errorf("手机号和邮箱注册均失败: %v", err)
			}
			log.Printf("[业务] 邮箱注册成功: username=%s", account.Username)
			return account, nil
		}
		
		log.Printf("[业务] GetAccount 失败: %v", err)
		return nil, err
	}

	log.Printf("[业务] GetAccount 返回: username=%s", account.Username)
	return account, nil
}

// registerAccountViaK6 通过 K6 注册服务创建账号
func (s *AccountService) registerAccountViaK6(platform string, accountType string, count int) (*model.AccountInfo, error) {
	log.Printf("[K6调用] 开始调用 K6 注册服务: platform=%s, type=%s, count=%d", platform, accountType, count)

	// 获取当前工作目录
	currentDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("获取当前目录失败: %v", err)
	}

	// 计算项目根目录（假设 Go 服务在 qwen2/ 目录下）
	projectRoot := filepath.Join(currentDir, "..")
	scriptPath := filepath.Join(projectRoot, "scripts", "register-account-k6.js")

	log.Printf("[K6调用] 项目根目录: %s", projectRoot)
	log.Printf("[K6调用] 脚本路径: %s", scriptPath)

	// 检查脚本是否存在
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("注册脚本不存在: %s", scriptPath)
	}

	// 构建 K6 命令
	// 根据平台ID设置语言：3003使用西班牙语(es)，其他平台使用英语(en)
	language := "en"
	if platform == "3003" {
		language = "es"
	}
	
	args := []string{
		"run",
		"-e", fmt.Sprintf("TENANT=%s", platform),
		"-e", fmt.Sprintf("TYPE=%s", accountType),
		"-e", fmt.Sprintf("COUNT=%d", count),
		"-e", fmt.Sprintf("LANGUAGE=%s", language),
		scriptPath,
	}

	cmd := exec.Command("k6", args...)
	// 设置工作目录为项目根目录
	cmd.Dir = projectRoot

	// 捕获输出
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// 执行命令
	err = cmd.Run()
	if err != nil {
		log.Printf("[K6调用] 命令执行失败: %v", err)
		log.Printf("[K6调用] stdout: %s", stdout.String())
		log.Printf("[K6调用] stderr: %s", stderr.String())
		
		// 检查是否是后台登录失败的错误
		stderrStr := stderr.String()
		if strings.Contains(stderrStr, "后台登录失败") || strings.Contains(stderrStr, "Backend account not exists") {
			return nil, fmt.Errorf("租户 %s 后台登录失败", platform)
		}
		
		return nil, fmt.Errorf("K6注册服务调用失败: %v", err)
	}

	// 解析输出 - K6 的 console.log 输出在 stderr 中
	output := stderr.String()
	if output == "" {
		output = stdout.String()
	}
	
	log.Printf("[K6调用] 原始输出长度: %d 字节", len(output))

	// 提取 JSON 结果（在 __RESULT_START__ 和 __RESULT_END__ 之间）
	startMarker := "__RESULT_START__"
	endMarker := "__RESULT_END__"

	startIdx := strings.Index(output, startMarker)
	endIdx := strings.Index(output, endMarker)

	if startIdx == -1 || endIdx == -1 {
		log.Printf("[K6调用] 无法找到结果标记，完整输出: %s", output)
		return nil, fmt.Errorf("无法从输出中提取结果")
	}

	// 提取标记之间的内容
	jsonSection := output[startIdx+len(startMarker) : endIdx]
	jsonSection = strings.TrimSpace(jsonSection)
	
	log.Printf("[K6调用] 提取的JSON段落长度: %d 字节", len(jsonSection))
	
	// 从 K6 日志格式中提取 JSON
	// K6 输出格式: time="..." level=info msg="JSON内容" source=console
	var jsonStr string
	
	// 查找所有 msg=" 的位置，找到包含 JSON 的那一行
	lines := strings.Split(jsonSection, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		
		// 查找 msg=" 的位置
		msgStart := strings.Index(line, "msg=\"")
		if msgStart == -1 {
			// 如果这一行没有 msg=" 格式，可能就是纯 JSON
			if strings.HasPrefix(line, "{") {
				jsonStr = line
				break
			}
			continue
		}
		
		// 找到 msg=" 后面的内容
		msgStart += len("msg=\"")
		
		// 找到对应的结束引号
		msgEnd := -1
		escapeCount := 0
		for i := msgStart; i < len(line); i++ {
			if line[i] == '\\' {
				escapeCount++
				continue
			}
			if line[i] == '"' && escapeCount%2 == 0 {
				// 检查这是否是 msg 的结束引号
				if i+1 >= len(line) || line[i+1] == ' ' || strings.HasPrefix(line[i+1:], " source=") {
					msgEnd = i
					break
				}
			}
			escapeCount = 0
		}
		
		if msgEnd == -1 {
			continue
		}
		
		jsonStr = line[msgStart:msgEnd]
		// 处理转义字符
		jsonStr = strings.ReplaceAll(jsonStr, "\\n", "\n")
		jsonStr = strings.ReplaceAll(jsonStr, "\\\"", "\"")
		jsonStr = strings.ReplaceAll(jsonStr, "\\\\", "\\")
		jsonStr = strings.TrimSpace(jsonStr)
		
		// 检查是否是有效的 JSON 开头
		if strings.HasPrefix(jsonStr, "{") {
			break
		}
	}
	
	if jsonStr == "" {
		log.Printf("[K6调用] 无法从输出中提取JSON")
		return nil, fmt.Errorf("无法从输出中提取JSON")
	}
	
	log.Printf("[K6调用] 提取的JSON: %s", jsonStr)
	
	// 解析 JSON
	var result struct {
		Success  bool                     `json:"success"`
		Count    int                      `json:"count"`
		Accounts []model.AccountInfo      `json:"accounts"`
		Errors   []map[string]interface{} `json:"errors"` // 错误详情
		Tenant   string                   `json:"tenant"`
		Type     string                   `json:"type"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("[K6调用] JSON解析失败: %v", err)
		log.Printf("[K6调用] JSON内容: %s", jsonStr)
		return nil, fmt.Errorf("解析K6返回结果失败: %v", err)
	}

	if !result.Success {
		// 如果没有成功的账号，返回详细错误信息
		if len(result.Errors) > 0 {
			firstError := result.Errors[0]
			reason := "未知错误"
			if r, ok := firstError["reason"].(string); ok {
				reason = r
			}
			response := ""
			if resp, ok := firstError["response"].(string); ok {
				response = resp
			}
			errorMessage := ""
			if msg, ok := firstError["errorMessage"].(string); ok {
				errorMessage = msg
			}
			
			// 检查是否是后台登录失败的错误
			if strings.Contains(reason, "后台登录失败") || strings.Contains(reason, "Backend account not exists") {
				return nil, fmt.Errorf("租户 %s 后台登录失败", platform)
			}
			
			// 检查是否是验证方式未启用的错误
			if strings.Contains(errorMessage, "verification method is not enabled") || 
			   strings.Contains(response, "verification method is not enabled") {
				return nil, fmt.Errorf("verification method is not enabled")
			}
			
			if response != "" && response != "null" {
				return nil, fmt.Errorf("注册失败: %s, 响应: %s", reason, response)
			}
			return nil, fmt.Errorf("注册失败: %s", reason)
		}
		return nil, fmt.Errorf("K6注册失败")
	}
	
	if len(result.Accounts) == 0 {
		// 如果没有成功的账号，返回详细错误信息
		if len(result.Errors) > 0 {
			firstError := result.Errors[0]
			reason := "未知错误"
			if r, ok := firstError["reason"].(string); ok {
				reason = r
			}
			response := ""
			if resp, ok := firstError["response"].(string); ok {
				response = resp
			}
			errorMessage := ""
			if msg, ok := firstError["errorMessage"].(string); ok {
				errorMessage = msg
			}
			
			// 检查是否是后台登录失败的错误
			if strings.Contains(reason, "后台登录失败") || strings.Contains(reason, "Backend account not exists") {
				return nil, fmt.Errorf("租户 %s 后台登录失败", platform)
			}
			
			// 检查是否是验证方式未启用的错误
			if strings.Contains(errorMessage, "verification method is not enabled") || 
			   strings.Contains(response, "verification method is not enabled") {
				return nil, fmt.Errorf("verification method is not enabled")
			}
			
			if response != "" && response != "null" {
				return nil, fmt.Errorf("注册失败: %s, 响应: %s", reason, response)
			}
			return nil, fmt.Errorf("注册失败: %s", reason)
		}
		return nil, fmt.Errorf("K6注册失败，未返回账号")
	}

	log.Printf("[K6调用] 注册成功，返回 %d 个账号", len(result.Accounts))
	
	if len(result.Errors) > 0 {
		log.Printf("[K6调用] 有 %d 个账号注册失败", len(result.Errors))
		for _, err := range result.Errors {
			log.Printf("[K6调用] 错误详情: %v", err)
		}
	}

	// 返回第一个账号
	return &result.Accounts[0], nil
}

// QueryBalance 查询账号余额
//
// ⭐ AI识别到 intent=query_balance 时会调用这个函数
func (s *AccountService) QueryBalance(account string) (string, error) {
	log.Printf("[业务] QueryBalance 被调用: account=%s", account)

	// TODO: 替换成你的真实逻辑
	balance := "1000"

	return balance, nil
}

// Recharge 充值
//
// ⭐ AI识别到 intent=recharge 时会调用这个函数
func (s *AccountService) Recharge(platform string, amount string) error {
	log.Printf("[业务] Recharge 被调用: platform=%s, amount=%s", platform, amount)

	// TODO: 替换成你的真实逻辑
	// err := s.doRecharge(platform, amount)

	return nil
}

// ListAccounts 查看可用账号列表
//
// ⭐ AI识别到 intent=list_accounts 时会调用这个函数
func (s *AccountService) ListAccounts(platform string) ([]model.AccountInfo, error) {
	log.Printf("[业务] ListAccounts 被调用: platform=%s", platform)

	// TODO: 替换成你的真实逻辑
	accounts := []model.AccountInfo{
		{Username: "user_001", Password: "***", Platform: platform, Amount: "500"},
		{Username: "user_002", Password: "***", Platform: platform, Amount: "1000"},
		{Username: "user_003", Password: "***", Platform: platform, Amount: "200"},
	}

	return accounts, nil
}
