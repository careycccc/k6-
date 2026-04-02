#!/bin/bash

# ============================================
# 3001租户 - 创建系统活动（多语言支持）
# ============================================
# 
# 语言配置：中文（zh）、英语（en）、印地语（hi）
#
# 使用方法：
#   ./run_3001_systemActive.sh
#
# 说明：
#   系统活动会自动为所有激活语言创建
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

# 租户ID
TENANT_ID="3001"

# 语言配置（默认：中文、英语、印地语）
LANGUAGES="${LANGUAGES:-zh,en,hi}"

print_info "=========================================="
print_info "3001租户 - 创建系统活动"
print_info "=========================================="
print_info "租户ID: $TENANT_ID"
print_info "语言配置: $LANGUAGES"
print_info "=========================================="

# 执行K6测试
print_info "开始创建系统活动..."

k6 run \
  -e TENANT_ID="$TENANT_ID" \
  -e LANGUAGES="$LANGUAGES" \
  -e ACTIVITIES="systemActive" \
  k6/tests/api/script/testActive_3001_multilang.js

# 检查执行结果
if [ $? -eq 0 ]; then
    print_success "系统活动创建完成"
else
    print_error "系统活动创建过程中出现错误"
fi

print_info "=========================================="
