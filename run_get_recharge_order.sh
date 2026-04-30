#!/bin/bash

# GetRechargeOrderPageList 接口测试脚本
# 
# 功能：查询指定用户的充值订单列表（默认查询昨天的数据）
# 
# 使用方法：
# 1. 基本用法（使用默认用户ID 110655）
#    ./run_get_recharge_order.sh
# 
# 2. 指定用户ID
#    ./run_get_recharge_order.sh 110655
# 
# 3. 指定租户ID和用户ID
#    TENANT_ID=3004 ./run_get_recharge_order.sh 110655

# 默认配置
DEFAULT_TENANT_ID="3004"
DEFAULT_USER_ID="110655"

# 从环境变量或参数获取配置
TENANT_ID=${TENANT_ID:-$DEFAULT_TENANT_ID}
USER_ID=${1:-$DEFAULT_USER_ID}

echo "=========================================="
echo "GetRechargeOrderPageList 接口测试"
echo "=========================================="
echo "租户ID: $TENANT_ID"
echo "用户ID: $USER_ID"
echo "=========================================="
echo ""

# 运行测试
k6 run \
  -e TENANT_ID=$TENANT_ID \
  -e USER_ID=$USER_ID \
  k6/tests/api/recharge/getRechargeOrderPageList.test.js

echo ""
echo "=========================================="
echo "测试完成"
echo "=========================================="
