# K6-Go集成快速参考

## 新增业务流程模板

### 1. 创建K6脚本（例如：投注）

```javascript
// k6/tests/api/bet/bet.test.js
import { getTestSession } from '../common/session.js';
import { runFrontendRechargeFlow } from '../recharge/frontendRecharge.test.js';
// 导入你的业务API函数

export default function () {
    // 获取环境变量
    const userName = __ENV.TARGET_USER;
    const isRegister = __ENV.IS_REGISTER === 'true';
    const rechargeAmount = parseInt(__ENV.RECHARGE_AMOUNT) || 1200;
    const betAmount = parseInt(__ENV.BET_AMOUNT) || 700;

    console.log(`\n=================== 投注测试开始 ===================`);

    // 1. 注册/登录
    const session = getTestSession(userName, isRegister);
    if (!session) {
        const errorResult = {
            account: userName || '',
            password: 'qwer1234',
            userId: 0,
            status: '注册失败'
        };
        console.log(`__BET_RESULT_JSON__${JSON.stringify(errorResult)}__END__`);
        return;
    }

    // 2. 充值
    const rechargeSuccess = runFrontendRechargeFlow(session, rechargeAmount);
    if (!rechargeSuccess) {
        const result = {
            account: session.userName,
            password: session.password || 'qwer1234',
            userId: session.userId,
            status: '充值失败'
        };
        console.log(`__BET_RESULT_JSON__${JSON.stringify(result)}__END__`);
        return;
    }

    // 3. 执行投注逻辑
    const betSuccess = yourBetFunction(session, betAmount);

    console.log(`=================== 投注测试结束 ===================\n`);

    // 4. 输出结果（关键！）
    const password = session.password || 'qwer1234';
    const result = {
        account: session.userName,
        password: password,
        userId: session.userId,
        rechargeAmount: rechargeAmount,
        betAmount: betAmount,
        status: betSuccess ? '完成' : '投注失败'
    };

    console.log(`__BET_RESULT_JSON__${JSON.stringify(result)}__END__`);
}
```

### 2. Go端处理函数

```go
// 在 dispatcher.go 中添加
func (d *Dispatcher) handleBet(params map[string]string) string {
    platform := params["platform"]
    rechargeAmount := params["recharge_amount"]
    betAmount := params["bet_amount"]

    // 验证参数...

    // 构建K6命令
    language := "en"
    if platform == "3003" {
        language = "es"
    }

    args := []string{
        "run",
        "-e", fmt.Sprintf("TENANT_ID=%s", platform),
        "-e", fmt.Sprintf("LANGUAGE=%s", language),
        "-e", "IS_REGISTER=true",
        "-e", fmt.Sprintf("RECHARGE_AMOUNT=%s", rechargeAmount),
        "-e", fmt.Sprintf("BET_AMOUNT=%s", betAmount),
        "../k6/tests/api/bet/bet.test.js",
    }

    cmd := exec.Command("k6", args...)
    var stdout, stderr bytes.Buffer
    cmd.Stdout = &stdout
    cmd.Stderr = &stderr

    err := cmd.Run()
    
    // ⭐ 关键：合并stdout和stderr
    output := stdout.String() + "\n" + stderr.String()

    // 解析结果（使用新的marker）
    summary := parseBetSummary(output)  // 复制parseRechargeSummary并修改marker

    if len(summary) > 0 && summary["account"] != "" {
        frontUrls := map[string]string{
            "3001": "https://arplatsaassit1.club",
            "3002": "https://arplatsaassit2.club",
            "3003": "https://arplatsaassit3.club",
            "3004": "https://arplatsaassit4.club",
        }
        frontUrl := frontUrls[platform]

        password := summary["password"]
        if password == "" {
            password = "qwer1234"
        }

        return fmt.Sprintf("✅ 投注任务完成！\n\n📱 账号: %s\n🔑 密码: %s\n👤 用户ID: %s\n💰 充值金额: %s 元\n🎲 投注金额: %s 元\n📊 状态: %s\n\n🌐 前台地址: %s",
            summary["account"],
            password,
            summary["userId"],
            rechargeAmount,
            betAmount,
            summary["status"],
            frontUrl)
    }

    return "⚠️ 任务执行遇到问题，请检查日志"
}

// 解析投注结果（复制parseRechargeSummary并修改marker）
func parseBetSummary(k6Output string) map[string]string {
    result := make(map[string]string)

    startMarker := "__BET_RESULT_JSON__"  // 修改这里
    endMarker := "__END__"
    
    // ... 其余逻辑完全相同 ...
    
    return result
}
```

### 3. AI意图识别（可选）

在AI的prompt中添加新意图：
```
- bet: 用户想要投注
  参数: platform, recharge_amount, bet_amount
  示例: "3004账号充值1200投注700"
```

## 核心要点检查清单

- [ ] K6脚本最后输出JSON（带标记）
- [ ] JSON包含：account, password, userId, status（必须）
- [ ] Go端合并stdout+stderr读取输出
- [ ] Go端解析JSON使用正确的marker
- [ ] 无论业务成功失败，只要注册成功就返回账号密码
- [ ] status字段清晰说明哪个环节失败

## 常见问题

**Q: 为什么Go收不到账号密码？**
A: 检查是否合并了stdout和stderr。K6的console.log在stderr。

**Q: JSON解析失败？**
A: K6日志格式会在JSON后添加 `" source=console`，需要找最后一个`}`截断。

**Q: 如何调试？**
A: 在parseXXXSummary函数中添加日志：
```go
log.Printf("[解析] 提取的原始字符串: %s", jsonStr)
log.Printf("[解析] 清理后的JSON: %s", jsonStr)
```

## 相关文件

- 详细文档: `docs/k6-go-integration-pattern.md`
- 充值示例: `k6/tests/api/recharge/frontendRecharge.test.js`
- Go处理器: `qwen2/handler/dispatcher.go`
