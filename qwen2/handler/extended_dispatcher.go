package handler

import (
	"log"
	"smart-qa/model"
	"strings"
)

// ExtendedDispatcher 扩展调度器
// 包装原有的 Dispatcher，添加新的意图处理逻辑
type ExtendedDispatcher struct {
	dispatcher      *Dispatcher
	extendedHandler *ExtendedHandler
}

// NewExtendedDispatcher 创建扩展调度器实例
func NewExtendedDispatcher() *ExtendedDispatcher {
	return &ExtendedDispatcher{
		dispatcher:      NewDispatcher(),
		extendedHandler: NewExtendedHandler(),
	}
}

// HandleMessage 处理用户消息的完整流程（扩展版）
// 先检查是否是新的意图，如果不是则委托给原有的 Dispatcher
func (ed *ExtendedDispatcher) HandleMessage(userMessage string) *model.ChatResponse {
	log.Printf("========================================")
	log.Printf("[扩展调度] 收到消息: %s", userMessage)

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
			reply := ed.dispatcher.handleCreateActivity(params)
			return &model.ChatResponse{
				Reply:        reply,
				Intent:       "create_activity",
				Params:       params,
				ResponseTime: 0, // 简化处理
			}
		} else {
			globalSession.RetryCount++
			if globalSession.RetryCount >= 3 {
				globalSession = nil
				return &model.ChatResponse{
					Reply:        "您已连续 3 次未提供有效的租户编号(3001/3002/3003/3004)，本次会话结束。如果需要创建活动，请重新告诉我。",
					ResponseTime: 0,
				}
			}
			return &model.ChatResponse{
				Reply:        "❌ 平台编号无效，请使用 3001/3002/3003/3004。",
				ResponseTime: 0,
			}
		}
	}

	// ===== 第1步：AI 意图识别 =====
	parseResult, err := ed.dispatcher.engine.Parse(userMessage)
	if err != nil {
		log.Printf("[扩展调度] AI解析失败: %v", err)
		return &model.ChatResponse{
			Reply:        "⚠️ AI 服务暂时不可用，请稍后再试。",
			ResponseTime: 0,
		}
	}

	intent := parseResult.Intent
	params := parseResult.Params

	log.Printf("[扩展调度] 识别结果: intent=%s, params=%v", intent, params)

	// ===== 第2步：根据意图调用对应的业务函数 =====
	var reply string

	switch intent {

	// ===== 新增的意图处理 =====
	case "validate_signin":
		reply = ed.extendedHandler.HandleValidateSignIn(params)

	case "validate_agent_l3":
		reply = ed.extendedHandler.HandleValidateAgentL3(params)

	case "validate_new_commission":
		reply = ed.extendedHandler.HandleValidateNewCommission(params)

	case "validate_invite_turntable":
		reply = ed.extendedHandler.HandleValidateInviteTurntable(params)

	// ===== 原有的意图处理（委托给原有 Dispatcher）=====
	case "get_account":
		reply = ed.dispatcher.handleGetAccount(params)

	case "ask_platform":
		reply = ed.dispatcher.handleAskPlatform()

	case "query_balance":
		reply = ed.dispatcher.handleQueryBalance(params)

	case "recharge":
		reply = ed.dispatcher.handleRecharge(params)

	case "create_activity":
		reply = ed.dispatcher.handleCreateActivity(params)

	case "validate_activity":
		reply = ed.dispatcher.handleValidateActivity(params)

	case "list_accounts":
		reply = ed.dispatcher.handleListAccounts(params)

	case "unknown":
		reply = ed.dispatcher.handleUnknown()

	default:
		reply = ed.dispatcher.handleUnknown()
	}

	log.Printf("[扩展调度] 回复内容: %s", truncate(reply, 100))
	log.Printf("========================================")

	return &model.ChatResponse{
		Reply:        reply,
		Intent:       intent,
		Params:       params,
		ResponseTime: 0, // 简化处理
	}
}

// CheckAI 检查AI服务是否正常
func (ed *ExtendedDispatcher) CheckAI() bool {
	return ed.dispatcher.CheckAI()
}
