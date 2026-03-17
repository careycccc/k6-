#!/bin/bash

# ==============================================================================
# AI Multi-Turn & K6 Activity Integration Update Script
# 
# This script applies the necessary changes to enable multi-turn platform 
# prompting for AI activity creation and correctly executes the K6 scripts.
# ==============================================================================

echo "🚀 Starting AI Activity Flow Update..."

# 1. Update config.go to fix SystemPrompt
echo "📄 Updating qwen2/config/config.go..."
CONFIG_FILE="qwen2/config/config.go"
if [ -f "$CONFIG_FILE" ]; then
    # Replace default 3004 logic with empty string
    sed -i 's/如果用户提到的不是这4个平台编号，默认使用 3004/如果用户没有提到这4个平台编号，请保持该字段为空 ""/g' "$CONFIG_FILE"
    sed -i 's/platform：平台编号（必须是 3001\/3002\/3003\/3004），如果未指定则为空/platform：平台编号（必须是 3001\/3002\/3003\/3004），如果未指定则必须为空 ""/g' "$CONFIG_FILE"
    
    # Add new examples for empty platforms if not exists
    if ! awk 'index($0, "用户：每日签到"){f=1} END{if(!f)exit 1}' "$CONFIG_FILE"; then
        sed -i '/用户：创建3004的每日签到活动/i 用户：每日签到\n{"intent":"create_activity","params":{"platform":"","activities":"每日签到"}}\n' "$CONFIG_FILE"
    fi
    echo "✅ qwen2/config/config.go updated."
else
    echo "⚠️ Warning: $CONFIG_FILE not found. Make sure you run this script from the project root."
fi

# 2. Update dispatcher.go to execute K6 scripts asynchronously
echo "📄 Updating qwen2/handler/dispatcher.go..."
DISPATCHER_FILE="qwen2/handler/dispatcher.go"
if [ -f "$DISPATCHER_FILE" ]; then
    # Ensure os and os/exec are imported
    if ! awk 'index($0, "\"os/exec\""){f=1} END{if(!f)exit 1}' "$DISPATCHER_FILE"; then
        sed -i '/"log"/a \t"os"\n\t"os/exec"' "$DISPATCHER_FILE"
    fi

    # Check if executeK6ActivityScript is already added
    if ! awk 'index($0, "func (d *Dispatcher) executeK6ActivityScript"){f=1} END{if(!f)exit 1}' "$DISPATCHER_FILE"; then
        # Insert the executeK6ActivityScript function just before handleCreateActivity
        sed -i '/func (d \*Dispatcher) handleCreateActivity/i \
// executeK6ActivityScript 执行K6活动创建脚本\
func (d *Dispatcher) executeK6ActivityScript(platform string, activities []string) {\
\t// 在后台异步执行，避免阻塞主线程\
\tgo func() {\
\t\tlog.Printf("[活动创建] 准备执行 k6 脚本，平台: %s, 活动: %v", platform, activities)\
\
\t\tfor _, act := range activities {\
\t\t\tact = strings.TrimSpace(act)\
\t\t\tif act == "每日签到" {\
\t\t\t\tlog.Printf("[活动创建] 匹配到'"'"'每日签到'"'"'，开始执行 k6 脚本...")\
\t\t\t\t\n\t\t\t\t// 构造命令，在 K6 脚本同级目录下执行以避免路径问题\
\t\t\t\tcmd := exec.Command("k6", "run", "createSignin_dispatch.js")\
\t\t\t\tcmd.Dir = "../k6/tests/api/activity/signin"\
\t\t\t\t\n\t\t\t\t// 设置环境变量\
\t\t\t\tenv := os.Environ()\
\t\t\t\tenv = append(env, fmt.Sprintf("TARGET_PLATFORM=%s", platform))\
\t\t\t\tenv = append(env, "K6_TOKEN=backend_dispatched_token") // 模拟 Token\
\t\t\t\tcmd.Env = env\
\n\t\t\t\t// 捕获输出\
\t\t\t\toutput, err := cmd.CombinedOutput()\
\t\t\t\tif err != nil {\
\t\t\t\t\tlog.Printf("[活动创建] ❌ 执行 k6 脚本失败: %v\\n输出内容: %s", err, string(output))\
\t\t\t\t} else {\
\t\t\t\t\tlog.Printf("[活动创建] ✅ 每日签到 k6 脚本执行成功\\n输出内容: %s", string(output))\
\t\t\t\t}\
\t\t\t} else {\
\t\t\t\tlog.Printf("[活动创建] ℹ️ '"'"'%s'"'"' 暂无对应的自动化脚本，跳过执行。", act)\
\t\t\t}\
\t\t}\
\t}()\
}\n' "$DISPATCHER_FILE"
    fi

    # Trigger executeK6ActivityScript inside handleCreateActivity
    if ! awk 'index($0, "d.executeK6ActivityScript"){f=1} END{if(!f)exit 1}' "$DISPATCHER_FILE"; then
        sed -i '/activities := strings.Split(activitiesStr, ",")/a \t\n\t// 触发 K6 脚本执行\n\td.executeK6ActivityScript(platform, activities)\n' "$DISPATCHER_FILE"
    fi
    
    echo "✅ qwen2/handler/dispatcher.go updated."
else
    echo "⚠️ Warning: $DISPATCHER_FILE not found."
fi

# 3. Create the dedicated K6 dispatch script
echo "📄 Creating k6/tests/api/activity/signin/createSignin_dispatch.js..."
K6_DIR="k6/tests/api/activity/signin"
if [ -d "$K6_DIR" ]; then
    cat << 'JSEOF' > "$K6_DIR/createSignin_dispatch.js"
import { createSignin } from './createSignin.js';
import { logger } from '../../../../libs/utils/logger.js';

export default function () {
    // K6 requires a default function. We wrap the existing createSignin logic.
    // Assuming the API requires an auth token, in a real scenario this might be fetched
    // before calling createSignin, or passed via environment variables.

    // If there is any required data, we can mock or construct it here.
    const token = __ENV.K6_TOKEN || 'test-token-for-dispatch';
    
    logger.info(`[createSignin_dispatch] Executing createSignin flow for platform: ${__ENV.TARGET_PLATFORM || 'default'}`);

    const result = createSignin({ token: token });
    
    logger.info(`[createSignin_dispatch] Result: ${JSON.stringify(result)}`);
}
JSEOF
    echo "✅ $K6_DIR/createSignin_dispatch.js created."
else
    echo "⚠️ Warning: Directory $K6_DIR not found. Please ensure k6 directory structure is correct."
fi

echo "🎉 Update completed successfully!"
echo "▶️  Next steps:"
echo "   1. Compile the backend: cd qwen2 && go build -o bin/qwen2 main.go"
echo "   2. Run the updated binary: ./bin/qwen2"