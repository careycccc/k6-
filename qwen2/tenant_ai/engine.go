package tenant_ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"smart-qa/config"
	"smart-qa/model"
	"strings"
	"time"
)

// Engine 租户扩展AI意图识别引擎
type Engine struct {
	ollamaURL string
	modelName string
	client    *http.Client
}

// NewEngine 创建租户引擎实例
func NewEngine() *Engine {
	return &Engine{
		ollamaURL: config.OllamaURL,
		modelName: config.ModelName,
		client: &http.Client{
			Timeout: 180 * time.Second, // deepseek-r1:8b 推理较慢，给足时间
		},
	}
}

// CheckConnection 检查 Ollama 是否正常
func (e *Engine) CheckConnection() bool {
	resp, err := e.client.Get(e.ollamaURL + "/api/tags")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// Parse 解析用户输入，返回意图和参数（使用租户扩展系统提示词）
func (e *Engine) Parse(userInput string) (*model.ParseResult, error) {
	start := time.Now()

	// ⚡ 先走规则匹配（快速准确，防止 DeepSeek R1 幻觉）
	if result := tryRuleBased(userInput); result != nil {
		log.Printf("[租户AI引擎] ✅ 规则命中: intent=%s, params=%v", result.Intent, result.Params)
		return result, nil
	}

	// 构建请求，使用租户扩展系统提示词
	reqBody := model.OllamaRequest{
		Model:  e.modelName,
		Prompt: fmt.Sprintf("用户输入：%s", userInput),
		System: config.GetTenantSystemPrompt(),
		Stream: false,
		Options: model.OllamaOptions{
			Temperature: 0.1, // 低温度 = 输出稳定
			NumPredict:  512, // deepseek-r1 需要更多 token（含 <think> 推理块）
		},
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("JSON序列化失败: %w", err)
	}

	// 调用 Ollama
	resp, err := e.client.Post(
		e.ollamaURL+"/api/generate",
		"application/json",
		bytes.NewBuffer(jsonData),
	)
	if err != nil {
		return nil, fmt.Errorf("调用Ollama失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 解析 Ollama 返回
	var ollamaResp model.OllamaResponse
	if err := json.Unmarshal(body, &ollamaResp); err != nil {
		return nil, fmt.Errorf("解析Ollama响应失败: %w", err)
	}

	elapsed := time.Since(start)
	rawText := ollamaResp.Response

	log.Printf("[租户AI引擎] 原始输出: %s", rawText)
	log.Printf("[租户AI引擎] 耗时: %v", elapsed)

	// 剥离 DeepSeek R1 的 <think>...</think> 推理块
	rawText = stripThinkTags(rawText)
	// 剥离 markdown 代码块（```json...``` 或 ```...```）
	rawText = stripMarkdownCodeBlock(rawText)

	log.Printf("[租户AI引擎] 处理后输出: %s", rawText)

	// 从模型输出中提取 JSON
	result, err := extractJSON(rawText)
	if err != nil {
		log.Printf("[租户AI引擎] JSON提取失败，返回unknown: %v", err)
		return &model.ParseResult{
			Intent: "unknown",
			Params: map[string]string{},
		}, nil
	}

	return result, nil
}

// stripThinkTags 剥离 DeepSeek R1 输出中的 <think>...</think> 推理内容
func stripThinkTags(text string) string {
	re := regexp.MustCompile(`(?s)<think>.*?</think>`)
	result := re.ReplaceAllString(text, "")
	return strings.TrimSpace(result)
}

// stripMarkdownCodeBlock 剥离 markdown 代码块包裹（```json...``` 或 ```...```）
func stripMarkdownCodeBlock(text string) string {
	re := regexp.MustCompile("(?s)^```(?:json)?\\s*\\n?(.*?)\\n?```$")
	if match := re.FindStringSubmatch(strings.TrimSpace(text)); len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return text
}

// tryRuleBased 规则优先匹配：简单明确的输入直接返回，无需调用 AI
// 防止 DeepSeek R1 大模型对短文本产生幻觉
func tryRuleBased(input string) *model.ParseResult {
	s := strings.TrimSpace(input)

	validPlatforms := []string{"3001", "3002", "3003", "3004", "3006", "3007"}

	for _, platform := range validPlatforms {
		// 规则1: "3004账号" / "3004 账号" / "3004账号2"（可带数量）
		re1 := regexp.MustCompile(`^` + platform + `\s*账号\s*(\d+)?$`)
		if m := re1.FindStringSubmatch(s); m != nil {
			count := "1"
			if m[1] != "" {
				count = m[1]
			}
			return &model.ParseResult{
				Intent: "get_account",
				Params: map[string]string{"platform": platform, "count": count, "type": "phone"},
			}
		}

		// 规则2: "来2个3004账号" / "给我3个3004的账号"
		re2 := regexp.MustCompile(`(?:来|给我?)(\d+)[个]?\s*` + platform + `\s*(?:的)?账号`)
		if m := re2.FindStringSubmatch(s); m != nil {
			return &model.ParseResult{
				Intent: "get_account",
				Params: map[string]string{"platform": platform, "count": m[1], "type": "phone"},
			}
		}

		// 规则3: "3004邮箱账号" / "3004邮箱"
		re3 := regexp.MustCompile(`^` + platform + `\s*(?:邮箱|email)(?:账号)?$`)
		if re3.MatchString(s) {
			return &model.ParseResult{
				Intent: "get_account",
				Params: map[string]string{"platform": platform, "count": "1", "type": "email"},
			}
		}
	}

	// 规则4: 纯"账号"或"给我账号" → 需要询问平台
	re4 := regexp.MustCompile(`^(?:给我?)?(?:一个)?\s*账号\s*$`)
	if re4.MatchString(s) {
		return &model.ParseResult{
			Intent: "ask_platform",
			Params: map[string]string{},
		}
	}

	return nil // 无规则命中，走 AI
}

// extractJSON 从模型输出文本中提取 JSON
func extractJSON(text string) (*model.ParseResult, error) {
	// 尝试1：直接解析
	var result model.ParseResult
	if err := json.Unmarshal([]byte(text), &result); err == nil {
		if result.Params == nil {
			result.Params = map[string]string{}
		}
		return &result, nil
	}

	// 尝试2：正则提取 {...}
	re := regexp.MustCompile(`\{[^{}]*"intent"[^{}]*\}`)
	match := re.FindString(text)
	if match != "" {
		if err := json.Unmarshal([]byte(match), &result); err == nil {
			if result.Params == nil {
				result.Params = map[string]string{}
			}
			return &result, nil
		}
	}

	// 尝试3：更宽松的正则
	re2 := regexp.MustCompile(`(?s)\{.*\}`)
	match2 := re2.FindString(text)
	if match2 != "" {
		var rawMap map[string]interface{}
		if err := json.Unmarshal([]byte(match2), &rawMap); err == nil {
			result.Intent, _ = rawMap["intent"].(string)
			result.Params = map[string]string{}
			if params, ok := rawMap["params"].(map[string]interface{}); ok {
				for k, v := range params {
					result.Params[k] = fmt.Sprintf("%v", v)
				}
			}
			return &result, nil
		}
	}

	return nil, fmt.Errorf("无法从文本中提取JSON: %s", text)
}
