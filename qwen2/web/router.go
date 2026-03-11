package web

import (
	"net/http"
	"smart-qa/handler"

	"github.com/gin-gonic/gin"
)

// SetupRouter 配置路由
func SetupRouter(dispatcher *handler.Dispatcher) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// 加载 HTML 模板
	r.LoadHTMLGlob("templates/*")

	// 首页
	r.GET("/", func(c *gin.Context) {
		c.HTML(http.StatusOK, "index.html", nil)
	})

	// 聊天接口
	r.POST("/chat", func(c *gin.Context) {
		var req struct {
			Message string `json:"message"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"reply": "请输入你的问题",
			})
			return
		}

		// 调用调度器处理
		result := dispatcher.HandleMessage(req.Message)
		c.JSON(http.StatusOK, result)
	})

	// 健康检查
	r.GET("/health", func(c *gin.Context) {
		isOk := dispatcher.CheckAI()
		status := "ok"
		if !isOk {
			status = "error"
		}
		c.JSON(http.StatusOK, gin.H{
			"status": status,
			"model":  "qwen2.5:3b",
		})
	})

	// ===== 给 k6 或其他外部调用的纯 API =====
	api := r.Group("/api")
	{
		// 纯意图识别（不执行业务逻辑）
		api.POST("/parse", func(c *gin.Context) {
			var req struct {
				Text string `json:"text"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || req.Text == "" {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "text不能为空"})
				return
			}

			result := dispatcher.HandleMessage(req.Text)
			c.JSON(http.StatusOK, gin.H{
				"success":          true,
				"intent":           result.Intent,
				"params":           result.Params,
				"reply":            result.Reply,
				"response_time_ms": result.ResponseTime,
			})
		})
	}

	return r
}
