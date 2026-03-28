# K6与Go集成模式文档

## 概述
本文档记录K6测试脚本与Go后端的标准集成模式，用于自动化账号注册、充值、投注等业务流程。

## 核心流程

### 1. K6脚本端（JavaScript）

#### 标准输出格式
```javascript
// 在脚本最后输出JSON结果
const result = {
    account: session.userName,      // 账号（必须）
    password: session.password,     // 密码（必须）
    userId: session.userId,         // 用户ID（必须）
    status: '完成' | '充值失败' | '注册失败'  // 状态（必须）
};

console.log(`__RECHARGE_RESULT_JSON__${JSON.stringify(result)}__END__`);
```

#### 关键规则
1. **账号密码必须返回**：无论业务逻辑成功或失败，只要注册成功就必须返回账号和密码
2. **使用标记包裹JSON**：`__RECHARGE_RESULT_JSON__` 和 `__END__` 作为边界标记
3. **状态字段说明**：
   - `完成`：注册+业务逻辑都成功
   - `充值失败`/`投注失败`：注册成功但业务逻辑失败
   - `注册失败`：注册失败

### 2. Go程序端

#### 执行K6脚本
```go
cmd := exec.Command("k6", args...)
var stdout, stderr bytes.Buffer
cmd.Stdout = &stdout
cmd.Stderr = &stderr

err := cmd.Run()

// 关键：K6的console.log输出在stderr（带时间戳），必须合并
output := stdout.String() + "\n" + stderr.String()
```

#### 解析JSON结果
```go
func parseRechargeSummary(k6Output string) map[string]string {
    result := make(map[string]string)
    
    startMarker := "__RECHARGE_RESULT_JSON__"
    endMarker := "__END__"
    
    startIdx := strings.Index(k6Output, startMarker)
    if startIdx == -1 {
        return result
    }
    
    startIdx += len(startMarker)
    endIdx := strings.Index(k6Output[startIdx:], endMarker)
    if endIdx == -1 {
        return result
    }
    
    jsonStr := k6Output[startIdx : startIdx+endIdx]
    
    // 清理k6日志格式：找最后一个}
    lastBrace := strings.LastIndex(jsonStr, "}")
    if lastBrace != -1 {
        jsonStr = jsonStr[:lastBrace+1]
    }
    
    // 解析JSON
    var data map[string]interface{}
    json.Unmarshal([]byte(jsonStr), &data)
    
    // 转换为string map
    if account, ok := data["account"].(string); ok {
        result["account"] = account
    }
    if password, ok := data["password"].(string); ok {
        result["password"] = password
    }
    if userId, ok := data["userId"].(float64); ok {
        result["userId"] = fmt.Sprintf("%.0f", userId)
    }
    if status, ok := data["status"].(string); ok {
        result["status"] = status
    }
    
    return result
}
```

## 现有实现

### 充值流程
- **K6脚本**: `k6/tests/api/recharge/frontendRecharge.test.js`
- **Go处理**: `qwen2/handler/dispatcher.go` 的 `handleRecharge()` 函数
- **功能**: 注册账号 → 充值 → 返回账号密码和充值状态

## 扩展模式（未来）

### 投注流程（待实现）
```javascript
// k6/tests/api/bet/bet.test.js
export default function () {
    // 1. 注册账号
    const session = getTestSession(userName, isRegister);
    
    // 2. 充值
    const rechargeSuccess = runFrontendRechargeFlow(session, targetAmount);
    
    // 3. 投注
    const betSuccess = runBetFlow(session, betAmount);
    
    // 4. 输出结果
    const result = {
        account: session.userName,
        password: session.password,
        userId: session.userId,
        rechargeAmount: targetAmount,
        betAmount: betAmount,
        status: betSuccess ? '完成' : '投注失败'
    };
    
    console.log(`__BET_RESULT_JSON__${JSON.stringify(result)}__END__`);
}
```

### 提现流程（待实现）
```javascript
// k6/tests/api/withdraw/withdraw.test.js
export default function () {
    // 1. 注册账号
    const session = getTestSession(userName, isRegister);
    
    // 2. 充值
    const rechargeSuccess = runFrontendRechargeFlow(session, rechargeAmount);
    
    // 3. 提现
    const withdrawSuccess = runWithdrawFlow(session, withdrawAmount);
    
    // 4. 输出结果
    const result = {
        account: session.userName,
        password: session.password,
        userId: session.userId,
        withdrawAmount: withdrawAmount,
        status: withdrawSuccess ? '完成' : '提现失败'
    };
    
    console.log(`__WITHDRAW_RESULT_JSON__${JSON.stringify(result)}__END__`);
}
```

## 关键经验教训

1. **K6输出位置**：console.log在stderr，不在stdout，必须合并读取
2. **JSON清理**：k6日志格式会在JSON后添加 `" source=console`，需要找最后一个`}`截断
3. **账号密码必返回**：这是用户的核心需求，无论业务逻辑成功失败都要返回
4. **状态字段区分**：用status字段明确告知用户哪个环节失败了

## 通用封装建议

### Go端通用函数
```go
// 执行K6脚本并解析JSON结果
func executeK6WithJSONResult(scriptPath string, envVars map[string]string, jsonMarker string) (map[string]string, error) {
    args := []string{"run"}
    for k, v := range envVars {
        args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
    }
    args = append(args, scriptPath)
    
    cmd := exec.Command("k6", args...)
    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr
    
    err := cmd.Run()
    output := stdout.String() + "\n" + stderr.String()
    
    return parseJSONResult(output, jsonMarker), err
}

// 通用JSON解析
func parseJSONResult(k6Output string, marker string) map[string]string {
    // 使用自定义marker，如 __RECHARGE_RESULT_JSON__、__BET_RESULT_JSON__ 等
    // 解析逻辑同上
}
```

## 文件位置
- K6脚本目录: `k6/tests/api/`
- Go处理器: `qwen2/handler/dispatcher.go`
- 会话管理: `k6/tests/api/common/session.js`
- 注册逻辑: `k6/tests/api/login/register.test.js`
