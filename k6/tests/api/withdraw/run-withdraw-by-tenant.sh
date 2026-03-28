#!/bin/bash

# 多租户提现测试脚本
# 用法: ./run-withdraw-by-tenant.sh [租户ID] [账号(可选)] [是否启用后台审核(可选)]
# 示例: 
#   ./run-withdraw-by-tenant.sh 3003
#   ./run-withdraw-by-tenant.sh 3004 917022905803
#   ./run-withdraw-by-tenant.sh 3003 "" true  # 启用后台审核

TENANT_ID=${1:-3004}
TARGET_USER=${2:-""}
ENABLE_BACKEND_APPROVAL=${3:-"false"}

echo "=========================================="
echo "🎯 开始为租户 ${TENANT_ID} 执行提现测试"
if [ -n "$TARGET_USER" ]; then
    echo "📱 指定账号: ${TARGET_USER}"
else
    echo "📱 将自动生成随机账号"
fi
if [ "$ENABLE_BACKEND_APPROVAL" = "true" ]; then
    echo "✅ 后台审核: 启用"
else
    echo "⏭️  后台审核: 跳过"
fi
echo "=========================================="

# 构建 K6 命令
K6_CMD="k6 run -e TENANT=${TENANT_ID}"

if [ -n "$TARGET_USER" ]; then
    K6_CMD="${K6_CMD} -e TARGET_USER=${TARGET_USER}"
fi

if [ "$ENABLE_BACKEND_APPROVAL" = "true" ]; then
    K6_CMD="${K6_CMD} -e ENABLE_BACKEND_APPROVAL=true"
fi

K6_CMD="${K6_CMD} k6/tests/api/withdraw/withdraw.test.js"

# 执行测试
eval $K6_CMD

echo ""
echo "=========================================="
echo "✅ 租户 ${TENANT_ID} 提现测试完成"
echo "=========================================="
