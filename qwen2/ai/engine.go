package ai

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
	"time"
)

// Engine AI意图识别引擎
type Engine struct {
	ollamaURL string
	modelName string
	client    *http.Client
}

// NewEngine 创建引擎实例
func NewEngine() *Engine {
	return &Engine{
		ollamaURL: config.OllamaURL,
		modelName: config.ModelName,
		client: &http.Client{
			Timeout: 120 * time.Second, // M2 8GB 给足时间
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

// Parse 解析用户输入，返回意图和参数
func (e *Engine) Parse(userInput string) (*model.ParseResult, error) {
	start := time.Now()

	// 构建请求
	reqBody := model.OllamaRequest{
		Model:  e.modelName,
		Prompt: fmt.Sprintf("用户输入：%s", userInput),
		System: config.SystemPrompt,
		Stream: false,
		Options: model.OllamaOptions{
			Temperature: 0.1, // 低温度 = 输出稳定
			NumPredict:  150, // 限制输出长度
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

	log.Printf("[AI引擎] 原始输出: %s", rawText)
	log.Printf("[AI引擎] 耗时: %v", elapsed)

	// 从模型输出中提取 JSON
	result, err := extractJSON(rawText)
	if err != nil {
		log.Printf("[AI引擎] JSON提取失败，返回unknown: %v", err)
		return &model.ParseResult{
			Intent: "unknown",
			Params: map[string]string{},
		}, nil
	}

	return result, nil
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
		// 处理嵌套JSON的情况
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
