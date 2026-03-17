const fs = require('fs');
let lines = fs.readFileSync('qwen2/handler/dispatcher.go', 'utf8').split('\n');

let out = [];
let skip = false;
let sessionAdded = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.includes('// SessionState') || line.includes('var globalSession')) continue;
    if (line.includes('type SessionState struct {')) { skip = true; continue; }
    if (skip && line === '}') { skip = false; continue; }
    if (skip) continue;

    if (line.includes('type Dispatcher struct {') && !sessionAdded) {
        out.push('// SessionState 用于保存用户的上下文状态');
        out.push('type SessionState struct {');
        out.push('\tPendingIntent string');
        out.push('\tPendingParams map[string]string');
        out.push('\tRetryCount    int');
        out.push('}');
        out.push('');
        out.push('var globalSession *SessionState');
        out.push('');
        out.push('// Dispatcher 意图调度器');
        out.push('type Dispatcher struct {');
        sessionAdded = true;
        continue;
    }

    if (line.includes('// ====== 检查是否处于会话上下文中 ======')) {
        while(i < lines.length) {
            i++;
            if (lines[i] && lines[i].includes('// ===== 第1步：AI 意图识别 =====')) { i--; break; }
        }
        continue;
    }

    if (line.includes('// ===== 第1步：AI 意图识别 =====')) {
        if (lines[i+1] && lines[i+1].includes('parseResult, err := d.engine.Parse(userMessage)')) {
            out.push('\t// ====== 检查是否处于会话上下文中 ======');
            out.push('\tif globalSession != nil && globalSession.PendingIntent == "create_activity" {');
            out.push('\t\tplatform := strings.TrimSpace(userMessage)');
            out.push('\t\tvalidPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}');
            out.push('\t\tmatchedPlatform := ""');
            out.push('\t\tfor p := range validPlatforms {');
            out.push('\t\t\tif strings.Contains(platform, p) {');
            out.push('\t\t\t\tmatchedPlatform = p');
            out.push('\t\t\t\tbreak');
            out.push('\t\t\t}');
            out.push('\t\t}');
            out.push('\t\tif matchedPlatform != "" {');
            out.push('\t\t\tglobalSession.PendingParams["platform"] = matchedPlatform');
            out.push('\t\t\tparams := globalSession.PendingParams');
            out.push('\t\t\tglobalSession = nil');
            out.push('\t\t\treply := d.handleCreateActivity(params)');
            out.push('\t\t\treturn &model.ChatResponse{');
            out.push('\t\t\t\tReply:        reply,');
            out.push('\t\t\t\tIntent:       "create_activity",');
            out.push('\t\t\t\tParams:       params,');
            out.push('\t\t\t\tResponseTime: time.Since(start).Milliseconds(),');
            out.push('\t\t\t}');
            out.push('\t\t} else {');
            out.push('\t\t\tglobalSession.RetryCount++');
            out.push('\t\t\tif globalSession.RetryCount >= 3 {');
            out.push('\t\t\t\tglobalSession = nil');
            out.push('\t\t\t\treturn &model.ChatResponse{');
            out.push('\t\t\t\t\tReply:        "您已连续 3 次未提供有效的租户编号(3001/3002/3003/3004)，本次会话结束。如果需要创建活动，请重新告诉我。",');
            out.push('\t\t\t\t\tResponseTime: time.Since(start).Milliseconds(),');
            out.push('\t\t\t\t}');
            out.push('\t\t\t}');
            out.push('\t\t\treturn &model.ChatResponse{');
            out.push('\t\t\t\tReply:        fmt.Sprintf("❌ 平台编号无效，请使用 3001/3002/3003/3004。\\n(剩余重试次数: %d)", 3-globalSession.RetryCount),');
            out.push('\t\t\t\tResponseTime: time.Since(start).Milliseconds(),');
            out.push('\t\t\t}');
            out.push('\t\t}');
            out.push('\t}');
            out.push('');
            out.push(line); 
            out.push(lines[i+1]);
            i++; 
            continue;
        }
    }

    if (line.includes('func (d *Dispatcher) handleCreateActivity')) {
        out.push(line);
        out.push('\tplatform := params["platform"]');
        out.push('\tactivitiesStr := params["activities"]');
        out.push('');
        out.push('\tif platform == "" {');
        out.push('\t\tglobalSession = &SessionState{');
        out.push('\t\t\tPendingIntent: "create_activity",');
        out.push('\t\t\tPendingParams: params,');
        out.push('\t\t\tRetryCount:    0,');
        out.push('\t\t}');
        out.push('\t\treturn fmt.Sprintf("请告诉我你要在哪个租户(3001、3002、3003、3004)创建【%s】活动？\\n例如回答: 在3001平台", activitiesStr)');
        out.push('\t}');
        out.push('\t');
        out.push('\tvalidPlatforms := map[string]bool{"3001": true, "3002": true, "3003": true, "3004": true}');
        out.push('\tif !validPlatforms[platform] {');
        out.push('\t\treturn fmt.Sprintf("❌ 平台编号 %s 无效，请使用 3001/3002/3003/3004", platform)');
        out.push('\t}');
        out.push('');
        out.push('\tif activitiesStr == "" {');
        out.push('\t\treturn "请告诉我你需要创建什么活动？(如: 每日签到、红包雨等)"');
        out.push('\t}');
        out.push('');
        out.push('\tactivities := strings.Split(activitiesStr, ",")');
        out.push('\tvar successList []string');
        out.push('\t');
        out.push('\tfor _, act := range activities {');
        out.push('\t\tact = strings.TrimSpace(act)');
        out.push('\t\tif act == "" { continue }');
        out.push('\t\t');
        out.push('\t\tscriptMap := map[string]string{');
        out.push('\t\t\t"每日签到": "../k6/tests/api/activity/signin/createSignin.js",');
        out.push('\t\t\t"红包雨":   "../k6/tests/api/activity/RedRainActivity/createRedRainActivity.js",');
        out.push('\t\t\t"锦标赛":   "../k6/tests/api/activity/champion/createChampion.js",');
        out.push('\t\t\t"幸运礼包": "../k6/tests/api/activity/luckyDoubleBonus/createluckyDoubleBonus.js",');
        out.push('\t\t\t"活动":     "../k6/tests/api/activity/systemActive/createSystemActive.js",');
        out.push('\t\t}');
        out.push('\t\t');
        out.push('\t\tmatchedScript := ""');
        out.push('\t\tfor key, script := range scriptMap {');
        out.push('\t\t\tif strings.Contains(act, key) {');
        out.push('\t\t\t\tmatchedScript = script');
        out.push('\t\t\t\tbreak');
        out.push('\t\t\t}');
        out.push('\t\t}');
        out.push('');
        out.push('\t\tif matchedScript != "" {');
        out.push('\t\t\tlog.Printf("[活动创建] 正在 %s 平台创建活动: %s (%s)", platform, act, matchedScript)');
        out.push('\t\t\targs := []string{"run", "-e", fmt.Sprintf("TENANT_ID=%s", platform), matchedScript}');
        out.push('\t\t\tcmd := exec.Command("k6", args...)');
        out.push('\t\t\terr := cmd.Run()');
        out.push('\t\t\tif err != nil {');
        out.push('\t\t\t\tlog.Printf("[活动创建] k6 执行失败: %v", err)');
        out.push('\t\t\t\tsuccessList = append(successList, fmt.Sprintf("⚠️ 【%s】(创建执行失败)", act))');
        out.push('\t\t\t} else {');
        out.push('\t\t\t\tsuccessList = append(successList, fmt.Sprintf("✅ 【%s】(创建成功)", act))');
        out.push('\t\t\t}');
        out.push('\t\t} else {');
        out.push('\t\t\tsuccessList = append(successList, fmt.Sprintf("❌ 目前还没有实现【%s】活动的新建", act))');
        out.push('\t\t}');
        out.push('\t}');
        out.push('');
        out.push('\tvar reply strings.Builder');
        out.push('\treply.WriteString(fmt.Sprintf("活动已调度完毕！\\n\\n租户：%s\\n\\n创建结果如下：\\n", platform))');
        out.push('\treply.WriteString(strings.Join(successList, "\\n"))');
        out.push('');
        out.push('\treturn reply.String()');
        out.push('}');
        
        while(i < lines.length) {
            i++;
            if (lines[i] === '}') break;
        }
        continue;
    }

    out.push(line);
}

fs.writeFileSync('qwen2/handler/dispatcher.go', out.join('\n'));
