#!/bin/bash

# 多租户活动创建脚本
# 用法: ./run-activity-by-tenant.sh [租户ID]
# 示例: ./run-activity-by-tenant.sh 3003

TENANT_ID=${1:-3003}

echo "=========================================="
echo "🎯 开始为租户 ${TENANT_ID} 创建活动"
echo "=========================================="

# 运行 K6 测试，传入租户ID
k6 run \
  -e TENANT=${TENANT_ID} \
  k6/tests/api/script/testActive.js

echo ""
echo "=========================================="
echo "✅ 租户 ${TENANT_ID} 活动创建完成"
echo "=========================================="
