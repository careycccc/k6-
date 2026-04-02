#!/bin/bash

# ============================================
# 3001租户 - 批量创建所有活动（多语言支持）
# ============================================
# 
# 语言配置：中文（zh）、英语（en）、印地语（hi）
#
# 使用方法：
#   1. 创建所有活动：
#      ./run_3001_all_activities.sh
#
#   2. 创建指定活动（逗号分隔）：
#      ./run_3001_all_activities.sh coupon,signin,rescue
#
#   3. 使用自定义语言：
#      LANGUAGES=zh,en,hi ./run_3001_all_activities.sh rescue
#
# 支持的活动类型：
#   coupon, signin, redRain, champion, luckyDoubleBonus, giftCodes,
#   megaJackpot, activityGuide, banner, codeWashing, customizePopup,
#   dailyTasks, giftPack, inmail, inviteTurntable, loginPopup,
#   newagent, newagentRank, order, ranking, rechargeGiftPack,
#   rechargeWheel, rescue, systemActive, tag, weekCard, withdrawalTimeout
# ============================================

# 设置脚本在遇到错误时继续执行
set +e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 默认活动列表（如果没有指定参数）
DEFAULT_ACTIVITIES="coupon,signin,rescue,dailyTasks,weekCard,newagent,order"

# 从命令行参数获取活动列表，如果没有则使用默认值
ACTIVITIES="${1:-$DEFAULT_ACTIVITIES}"

# 租户ID
TENANT_ID="3001"

# 语言配置（默认：中文、英语、印地语）
LANGUAGES="${LANGUAGES:-zh,en,hi}"

print_info "=========================================="
print_info "3001租户 - 批量创建活动"
print_info "=========================================="
print_info "租户ID: $TENANT_ID"
print_info "语言配置: $LANGUAGES"
print_info "活动列表: $ACTIVITIES"
print_info "=========================================="

# 执行K6测试
print_info "开始创建活动..."

k6 run \
  -e TENANT_ID="$TENANT_ID" \
  -e LANGUAGES="$LANGUAGES" \
  -e ACTIVITIES="$ACTIVITIES" \
  k6/tests/api/script/testActive_3001_multilang.js

# 检查执行结果
if [ $? -eq 0 ]; then
    print_success "活动创建完成"
else
    print_error "活动创建过程中出现错误"
fi

print_info "=========================================="
