#!/bin/bash

# 活动列表和对应的脚本路径
declare -A activities=(
    ["礼品"]="k6/tests/api/activity/GiftCodes/createGiftCodes.js"
    ["超级大奖"]="k6/tests/api/activity/MegaJackpot/createMegaJackpot.js"
    ["红包雨"]="k6/tests/api/activity/RedRainActivity/createRedRainActivity.js"
    ["活动指南"]="k6/tests/api/activity/activityGuide/createActivityGuide.js"
    ["横幅"]="k6/tests/api/activity/banner/createBanner.js"
    ["锦标赛"]="k6/tests/api/activity/champion/createChampion.js"
    ["洗码"]="k6/tests/api/activity/codeWashing/createCodeWashing.js"
    ["优惠券"]="k6/tests/api/activity/coupon/createCoupon.js"
    ["自定义弹窗"]="k6/tests/api/activity/customizePopup/createCustomizePopup.js"
    ["每日任务"]="k6/tests/api/activity/dailyTasks/createDailyTasks.js"
    ["礼包"]="k6/tests/api/activity/giftPack/createGiftPack.js"
    ["站内信"]="k6/tests/api/activity/inmail/createInmail.js"
    ["邀请转盘"]="k6/tests/api/activity/inviteTurntable/createInviteTurntable.js"
    ["登录弹窗"]="k6/tests/api/activity/loginPopup/createLoginPopup.js"
    ["幸运礼包"]="k6/tests/api/activity/luckyDoubleBonus/createluckyDoubleBonus.js"
    ["新代理"]="k6/tests/api/activity/newagent/createNewagent.js"
    ["订单系统"]="k6/tests/api/activity/orderSystem/createOrder.js"
    ["排行榜"]="k6/tests/api/activity/ranking/createRanking.js"
    ["充值礼包"]="k6/tests/api/activity/rechargeGiftPack/createRechargeGiftPack.js"
    ["充值转盘"]="k6/tests/api/activity/rechargeWheel/createRechargeWheel.js"
    ["救援金"]="k6/tests/api/activity/rescue/createRescue.js"
    ["每日签到"]="k6/tests/api/activity/signin/createSignin.js"
    ["系统活动"]="k6/tests/api/activity/systemActive/createSystemActive.js"
    ["标签"]="k6/tests/api/activity/tag/createTag.js"
    ["周卡"]="k6/tests/api/activity/weekCard/createWeekCard.js"
    ["提现超时"]="k6/tests/api/activity/withdrawalTimeout/createWithdrawalTimeout.js"
)

# 输出 Go 代码格式的 map
echo "scriptMap := map[string]string{"
for key in "${!activities[@]}"; do
    echo "    \"$key\": \"${activities[$key]}\","
done
echo "}"
