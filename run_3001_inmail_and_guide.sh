#!/bin/bash

# ============================================
# 3001租户 - 创建站内信和活动资讯
# ============================================
# 
# 语言配置：中文（zh）、英语（en）、印地语（hi）
#
# 使用方法：
#   ./run_3001_inmail_and_guide.sh
#
# 说明：
#   1. 站内信：为每种语言创建多语言版本
#   2. 活动资讯：系统级配置，不区分语言
# ============================================

set +e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

TENANT_ID="3001"
LANGUAGES="${LANGUAGES:-zh,en,hi}"

print_info "=========================================="
print_info "3001租户 - 创建站内信和活动资讯"
print_info "=========================================="
print_info "租户ID: $TENANT_ID"
print_info "语言配置: $LANGUAGES"
print_info "=========================================="

print_info "开始创建活动..."

k6 run \
  -e TENANT_ID="$TENANT_ID" \
  -e LANGUAGES="$LANGUAGES" \
  -e ACTIVITIES="inmail,activityGuide" \
  k6/tests/api/script/testActive_3001_multilang.js

if [ $? -eq 0 ]; then
    print_success "活动创建完成"
    print_info ""
    print_info "创建结果："
    print_info "  ✓ 站内信：已为 $LANGUAGES 创建多语言版本"
    print_info "  ✓ 活动资讯：已更新系统配置"
else
    print_error "活动创建过程中出现错误"
fi

print_info "=========================================="
