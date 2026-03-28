#!/bin/bash

###############################################################################
# 批量充值投注提现测试脚本
# 
# 功能：随机生成多个账号，进行充值、投注和提现操作
# 
# 使用方法：
#   ./run-batch-with-bet.sh <TENANT_ID> [ACCOUNT_COUNT] [OPTIONS]
# 
# 参数：
#   TENANT_ID       租户ID（必需）
#   ACCOUNT_COUNT   账号数量（可选，默认10）
# 
# 选项：
#   --min-recharge=N        最小充值金额（默认1000）
#   --max-recharge=N        最大充值金额（默认5000）
#   --bet-rounds=N          投注轮数（默认5）
#   --withdraw-ratio=N      提现比例 0-1（默认0.8）
#   --enable-approval       启用后台审核
#   --concurrent=N          并发数（默认5）
# 
# 示例：
#   # 基础用法：10个账号，每个投注5轮
#   ./run-batch-with-bet.sh 3004
# 
#   # 指定账号数量和投注轮数
#   ./run-batch-with-bet.sh 3004 20 --bet-rounds=10
# 
#   # 自定义充值金额范围和投注轮数
#   ./run-batch-with-bet.sh 3004 10 --min-recharge=2000 --max-recharge=10000 --bet-rounds=8
# 
#   # 启用后台审核
#   ./run-batch-with-bet.sh 3004 10 --enable-approval
# 
#   # 完整配置
#   ./run-batch-with-bet.sh 3004 20 --min-recharge=2000 --max-recharge=8000 --bet-rounds=10 --withdraw-ratio=0.9 --enable-approval
###############################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_FILE="$SCRIPT_DIR/batchRechargeWithdrawWithBet.test.js"

# 显示帮助信息
show_help() {
    echo ""
    echo "批量充值投注提现测试脚本"
    echo ""
    echo "使用方法:"
    echo "  ./run-batch-with-bet.sh <TENANT_ID> [ACCOUNT_COUNT] [OPTIONS]"
    echo ""
    echo "参数:"
    echo "  TENANT_ID       租户ID（必需）"
    echo "  ACCOUNT_COUNT   账号数量（可选，默认10）"
    echo ""
    echo "选项:"
    echo "  --min-recharge=N        最小充值金额（默认1000）"
    echo "  --max-recharge=N        最大充值金额（默认5000）"
    echo "  --bet-rounds=N          投注轮数（默认5）"
    echo "  --withdraw-ratio=N      提现比例 0-1（默认0.8）"
    echo "  --enable-approval       启用后台审核"
    echo "  --concurrent=N          并发数（默认5）"
    echo ""
    echo "示例:"
    echo "  # 基础用法：10个账号，每个投注5轮"
    echo "  ./run-batch-with-bet.sh 3004"
    echo ""
    echo "  # 指定账号数量和投注轮数"
    echo "  ./run-batch-with-bet.sh 3004 20 --bet-rounds=10"
    echo ""
    echo "  # 自定义充值金额范围和投注轮数"
    echo "  ./run-batch-with-bet.sh 3004 10 --min-recharge=2000 --max-recharge=10000 --bet-rounds=8"
    echo ""
}

# 检查参数
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]] || [[ -z "$1" ]]; then
    show_help
    exit 0
fi

# 解析参数
TENANT_ID="$1"
ACCOUNT_COUNT="${2:-10}"

# 默认值
MIN_RECHARGE=1000
MAX_RECHARGE=5000
BET_ROUNDS=5
WITHDRAW_RATIO=0.8
ENABLE_APPROVAL="false"
CONCURRENT=5

# 解析选项
shift 2 2>/dev/null || shift 1

for arg in "$@"; do
    case $arg in
        --min-recharge=*)
            MIN_RECHARGE="${arg#*=}"
            ;;
        --max-recharge=*)
            MAX_RECHARGE="${arg#*=}"
            ;;
        --bet-rounds=*)
            BET_ROUNDS="${arg#*=}"
            ;;
        --withdraw-ratio=*)
            WITHDRAW_RATIO="${arg#*=}"
            ;;
        --enable-approval)
            ENABLE_APPROVAL="true"
            ;;
        --concurrent=*)
            CONCURRENT="${arg#*=}"
            ;;
        *)
            echo -e "${RED}未知选项: $arg${NC}"
            show_help
            exit 1
            ;;
    esac
done

# 显示配置
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}批量充值投注提现测试${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${BLUE}配置信息:${NC}"
echo "  租户ID: $TENANT_ID"
echo "  账号数量: $ACCOUNT_COUNT"
echo "  充值金额范围: $MIN_RECHARGE - $MAX_RECHARGE"
echo "  投注轮数: $BET_ROUNDS"
echo "  提现比例: $(echo "$WITHDRAW_RATIO * 100" | bc)%"
echo "  后台审核: $ENABLE_APPROVAL"
echo "  并发数: $CONCURRENT"
echo ""

# 检查测试文件
if [[ ! -f "$TEST_FILE" ]]; then
    echo -e "${RED}错误: 找不到测试文件 $TEST_FILE${NC}"
    exit 1
fi

# 执行测试
echo -e "${GREEN}开始执行测试...${NC}"
echo ""

k6 run \
    -e TENANT_ID="$TENANT_ID" \
    -e ACCOUNT_COUNT="$ACCOUNT_COUNT" \
    -e MIN_RECHARGE="$MIN_RECHARGE" \
    -e MAX_RECHARGE="$MAX_RECHARGE" \
    -e BET_ROUNDS="$BET_ROUNDS" \
    -e WITHDRAW_RATIO="$WITHDRAW_RATIO" \
    -e ENABLE_BACKEND_APPROVAL="$ENABLE_APPROVAL" \
    -e CONCURRENT_SIZE="$CONCURRENT" \
    "$TEST_FILE"

echo ""
echo -e "${GREEN}测试完成！${NC}"
