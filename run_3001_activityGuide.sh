#!/bin/bash

# ============================================
# 3001租户 - 创建活动资讯（引导活动）
# ============================================
# 
# 使用方法：
#   ./run_3001_activityGuide.sh
#
# 说明：
#   活动资讯（引导活动）是系统级配置，不区分语言
#   主要用于引导用户观看充值教程视频
#   观看指定时长后发放奖励
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

print_info "=========================================="
print_info "3001租户 - 创建活动资讯"
print_info "=========================================="
print_info "租户ID: $TENANT_ID"
print_info "活动类型: 充值视频观看引导"
print_info "=========================================="

print_info "开始创建活动资讯..."

k6 run \
  -e TENANT_ID="$TENANT_ID" \
  -e ACTIVITIES="systemActive" \
  k6/tests/api/script/testActive_3001_multilang.js

if [ $? -eq 0 ]; then
    print_success "活动资讯创建完成"
else
    print_error "活动资讯创建失败"
fi

print_info "=========================================="
