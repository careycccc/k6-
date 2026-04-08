#!/bin/bash

# ============================================
# 3002租户 - 创建锦标赛活动（多语言支持）
# ============================================
# 
# 语言配置：中文（zh）、英语（en）、印地语（hi）
#
# 使用方法：
#   ./run_3002_champion.sh
#
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

TENANT_ID="3002"
LANGUAGES="${LANGUAGES:-zh,en,hi}"

print_info "=========================================="
print_info "3002租户 - 创建锦标赛活动"
print_info "=========================================="
print_info "租户ID: $TENANT_ID"
print_info "语言配置: $LANGUAGES"
print_info "=========================================="

print_info "开始创建锦标赛..."

k6 run \
  -e TENANT_ID="$TENANT_ID" \
  -e LANGUAGES="$LANGUAGES" \
  -e ACTIVITIES="champion" \
  k6/tests/api/script/testActive_3002_multilang.js

if [ $? -eq 0 ]; then
    print_success "锦标赛创建完成"
else
    print_error "锦标赛创建失败"
fi

print_info "=========================================="
