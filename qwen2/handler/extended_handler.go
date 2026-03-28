package handler

import (
	"fmt"
	"log"
	"smart-qa/service"
	"strings"
)

// ExtendedHandler 扩展处理器
// 用于处理新增的验证意图
type ExtendedHandler struct {
	extendedValidationService *service.ExtendedValidationService
}

// NewExtendedHandler 创建扩展处理器实例
func NewExtendedHandler() *ExtendedHandler {
	return &ExtendedHandler{
		extendedValidationService: service.NewExtendedValidationService(),
	}
}

// HandleValidateSignIn 处理每日签到验证
// 支持的参数：
//   - platform: 平台编号（3001/3002/3003/3004）
//   - mode: 验证模式（"random" 或 "specified"）
//   - user_count: 随机用户数量（random模式）
//   - accounts: 指定账号列表（specified模式）
//   - manual_receive_rate: 手动领取比例
func (h *ExtendedHandler) HandleValidateSignIn(params map[string]string) string {
	platform := params["platform"]
	mode := params["mode"]
	userCount := params["user_count"]
	accounts := params["accounts"]
	manualReceiveRate := params["manual_receive_rate"]

	// 验证平台编号
	if platform == "" {
		return "请告诉我你要验证哪个平台的每日签到活动？\n例如：3004平台每日签到活动验证"
	}

	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	log.Printf("[每日签到验证] 开始验证: platform=%s, mode=%s, userCount=%s, accounts=%s, manualReceiveRate=%s",
		platform, mode, userCount, accounts, manualReceiveRate)

	// 调用扩展验证服务
	result, err := h.extendedValidationService.ValidateSignIn(platform, mode, userCount, accounts, manualReceiveRate)
	if err != nil {
		log.Printf("[每日签到验证] 验证失败: %v", err)
		return fmt.Sprintf("❌ 验证失败：%v", err)
	}

	return result
}

// HandleValidateAgentL3 处理3级代理验证
// 支持的参数：
//   - platform: 平台编号（3001/3002/3003/3004）
//   - target_uid: 总代UID（5-8位数字）
func (h *ExtendedHandler) HandleValidateAgentL3(params map[string]string) string {
	platform := params["platform"]
	targetUid := params["target_uid"]

	// 验证平台编号
	if platform == "" {
		return "请告诉我你要验证哪个平台的3级代理？\n例如：3004平台3级代理验证136139"
	}

	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	// 检查是否提供了target_uid
	if targetUid == "" {
		return fmt.Sprintf("请提供总代的会员ID（5-8位数字）\n例如：3004平台3级代理验证136139")
	}

	log.Printf("[3级代理验证] 开始验证: platform=%s, targetUid=%s", platform, targetUid)

	// 调用扩展验证服务
	result, err := h.extendedValidationService.ValidateAgentL3(platform, targetUid)
	if err != nil {
		log.Printf("[3级代理验证] 验证失败: %v", err)
		return fmt.Sprintf("❌ 验证失败：%v", err)
	}

	return result
}

// HandleValidateNewCommission 处理新版返佣验证（与3级代理验证相同）
// 支持的参数：
//   - platform: 平台编号（3001/3002/3003/3004）
//   - target_uid: 总代UID（5-8位数字）
func (h *ExtendedHandler) HandleValidateNewCommission(params map[string]string) string {
	// 新版返佣验证与3级代理验证使用相同的逻辑
	return h.HandleValidateAgentL3(params)
}

// ParseSignInParams 解析每日签到验证的用户输入
// 从用户输入中提取参数
func ParseSignInParams(userMessage string) map[string]string {
	params := make(map[string]string)

	// 提取平台编号
	platforms := []string{"3001", "3002", "3003", "3004"}
	for _, p := range platforms {
		if strings.Contains(userMessage, p) {
			params["platform"] = p
			break
		}
	}

	// 提取模式
	if strings.Contains(userMessage, "指定") || strings.Contains(userMessage, "账号") {
		params["mode"] = "specified"
	} else {
		params["mode"] = "random"
	}

	// 提取用户数量（由AI引擎解析）
	// params["user_count"] = ...

	// 提取账号列表
	if strings.Contains(userMessage, ",") {
		// 提取逗号分隔的账号
		parts := strings.Split(userMessage, ",")
		var accounts []string
		for _, part := range parts {
			// 提取数字
			account := strings.TrimSpace(part)
			if account != "" {
				accounts = append(accounts, account)
			}
		}
		if len(accounts) > 0 {
			params["accounts"] = strings.Join(accounts, ",")
		}
	}

	return params
}

// HandleValidateInviteTurntable 处理邀请转盘验证
// 支持的参数：
//   - platform: 平台编号（3001/3002/3003/3004）
//   - general_agent_count: 总代数量（默认1）
//   - wheel_number: 轮次数量（默认1）
//   - sub_min_number: 最小下级数量（默认2）
//   - sub_max_number: 最大下级数量（默认5）
//   - sub_concurrent: 下级并发数（默认3）
//   - min_money: 最小充值金额（默认1000）
//   - max_money: 最大充值金额（默认5000）
func (h *ExtendedHandler) HandleValidateInviteTurntable(params map[string]string) string {
	platform := params["platform"]
	generalAgentCount := params["general_agent_count"]
	wheelNumber := params["wheel_number"]
	subMinNumber := params["sub_min_number"]
	subMaxNumber := params["sub_max_number"]
	subConcurrent := params["sub_concurrent"]
	minMoney := params["min_money"]
	maxMoney := params["max_money"]

	// 验证平台编号
	if platform == "" {
		return "请告诉我你要验证哪个平台的邀请转盘？\n例如：3004平台邀请转盘验证"
	}

	validPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}
	if !validPlatforms[platform] {
		return fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)
	}

	log.Printf("[邀请转盘验证] 开始验证: platform=%s, generalAgentCount=%s, wheelNumber=%s, subMinNumber=%s, subMaxNumber=%s, subConcurrent=%s, minMoney=%s, maxMoney=%s",
		platform, generalAgentCount, wheelNumber, subMinNumber, subMaxNumber, subConcurrent, minMoney, maxMoney)

	// 调用扩展验证服务
	result, err := h.extendedValidationService.ValidateInviteTurntable(platform, generalAgentCount, wheelNumber, subMinNumber, subMaxNumber, subConcurrent, minMoney, maxMoney)
	if err != nil {
		log.Printf("[邀请转盘验证] 验证失败: %v", err)
		return fmt.Sprintf("❌ 验证失败：%v", err)
	}

	return result
}

// ParseAgentL3Params 解析3级代理验证的用户输入
// 从用户输入中提取参数
func ParseAgentL3Params(userMessage string) map[string]string {
	params := make(map[string]string)

	// 提取平台编号
	platforms := []string{"3001", "3002", "3003", "3004"}
	for _, p := range platforms {
		if strings.Contains(userMessage, p) {
			params["platform"] = p
			break
		}
	}

	// 提取target_uid（5-8位数字）
	// 这里只是示例，实际应该由AI引擎解析
	// params["target_uid"] = ...

	return params
}
