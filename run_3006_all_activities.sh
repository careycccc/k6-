#!/bin/bash

# 为3006租户创建所有活动（孟加拉语、英语、中文）

echo "=========================================="
echo "  创建3006租户所有活动"
echo "  语言：孟加拉语(bn)、英语(en)、中文(zh)"
echo "=========================================="

cd k6

k6 run \
  -e LANGUAGE=zh \
  -e LANGUAGES=bn,zh,en \
  -e ACTIVITIES=coupon,signin,redRain,champion,luckyDoubleBonus,giftCodes,megaJackpot,activityGuide,banner,codeWashing,customizePopup,dailyTasks,giftPack,inmail,inviteTurntable,loginPopup,newagent,newagentRank,order,ranking,rechargeGiftPack,rechargeWheel,rescue,tag,weekCard,withdrawalTimeout \
  tests/api/script/testActive_3006_multilang.js

echo ""
echo "=========================================="
echo "  执行完成"
echo "=========================================="
