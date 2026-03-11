package model

// ParseResult AI解析结果
type ParseResult struct {
	Intent string            `json:"intent"`
	Params map[string]string `json:"params"`
}

// ChatRequest 前端发来的聊天请求
type ChatRequest struct {
	Message string `json:"message"`
}

// ChatResponse 返回给前端的回复
type ChatResponse struct {
	Reply        string `json:"reply"`
	Intent       string `json:"intent,omitempty"`
	Params       any    `json:"params,omitempty"`
	ResponseTime int64  `json:"response_time_ms"`
}

// AccountInfo 账号信息
type AccountInfo struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Platform string `json:"platform"`
	Amount   string `json:"amount"`
	Token    string `json:"token"`    // 登录 token
	Type     string `json:"type"`     // 账号类型：phone 或 email
}

// OllamaRequest Ollama API 请求
type OllamaRequest struct {
	Model   string        `json:"model"`
	Prompt  string        `json:"prompt"`
	System  string        `json:"system"`
	Stream  bool          `json:"stream"`
	Options OllamaOptions `json:"options"`
}

// OllamaOptions Ollama 参数
type OllamaOptions struct {
	Temperature float64 `json:"temperature"`
	NumPredict  int     `json:"num_predict"`
}

// OllamaResponse Ollama API 返回
type OllamaResponse struct {
	Response string `json:"response"`
}
