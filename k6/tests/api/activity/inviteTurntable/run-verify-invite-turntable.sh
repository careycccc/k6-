#!/bin/bash

# 邀请转盘验证测试运行脚本
# 使用方法: ./run-verify-invite-turntable.sh [TENANT_ID] [GENERAL_AGENT_COUNT] [WHEEL_NUMBER]

# 默认参数
TENANT_ID=${1:-3004}
GENERAL_AGENT_COUNT=${2:-1}
WHEEL_NUMBER=${3:-1}
SUB_MIN_NUMBER=${4:-2}
SUB_MAX_NUMBER=${5:-5}
SUB_CONCURRENT=${6:-3}
MIN_MONEY=${7:-1000}
MAX_MONEY=${8:-5000}

# 根据租户ID设置语言
if [ "$TENANT_ID" == "3003" ]; then
    LANGUAGE="es"
else
    LANGUAGE="en"
fi

echo "========================================="
echo "邀请转盘验证测试"
echo "========================================="
echo "租户ID: $TENANT_ID"
echo "语言: $LANGUAGE"
echo "总代数量: $GENERAL_AGENT_COUNT"
echo "轮次数量: $WHEEL_NUMBER"
echo "下级数量范围: $SUB_MIN_NUMBER-$SUB_MAX_NUMBER"
echo "下级并发数: $SUB_CONCURRENT"
echo "充值金额范围: $MIN_MONEY-$MAX_MONEY"
echo "========================================="
echo ""

# 执行K6测试
k6 run \
  -e TENANT_ID=$TENANT_ID \
  -e LANGUAGE=$LANGUAGE \
  -e GENERAL_AGENT_COUNT=$GENERAL_AGENT_COUNT \
  -e WHEEL_NUMBER=$WHEEL_NUMBER \
  -e SUB_MIN_NUMBER=$SUB_MIN_NUMBER \
  -e SUB_MAX_NUMBER=$SUB_MAX_NUMBER \
  -e SUB_CONCURRENT=$SUB_CONCURRENT \
  -e MIN_MONEY=$MIN_MONEY \
  -e MAX_MONEY=$MAX_MONEY \
  verifyInviteTurntable.test.js

echo ""
echo "========================================="
echo "测试完成"
echo "========================================="
