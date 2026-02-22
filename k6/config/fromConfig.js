import { Dashboardtag, queryDashboardFunc } from '../tests/api/formdata/Dashboard/Dashboard.test.js';
import { Statisticstag, queryStatisticsFunc } from '../tests/api/formdata/Statistics/Statistics.test.js';
import { DailySummaryTag, queryDailySummaryReportFunc } from '../tests/api/formdata/DailySummaryReport/DailySummaryReport.test.js';
import { memberTag, queryMemberReportFunc } from '../tests/api/formdata/memberReport/memberReport.test.js';
import { activityGuideTag, queryActivityGuide } from '../tests/api/activity/activityGuide/activityGuide.test.js';
import { championTag, queryChampion } from '../tests/api/activity/champion/champion.test.js';
import { codeWashingTag, queryCodeWashing } from '../tests/api/activity/codeWashing/codeWashing.test.js';
import { couponTag, queryCoupon } from '../tests/api/activity/coupon/querycoupon.test.js';
import { dailyTasksTag, queryDailyTasks } from '../tests/api/activity/dailyTasks/dailyTasks.test.js';
import { giftCodesTag, queryGiftcodes } from '../tests/api/activity/GiftCodes/giftCodes.test.js';
import { giftPackTag, queryGiftPack } from '../tests/api/activity/giftPack/giftPack.test.js';
import { inviteTurntableTag, queryInviteTurntable } from '../tests/api/activity/inviteTurntable/inviteTurntable.test.js';
import { megaJackpotTag, queryMegaJackpot } from '../tests/api/activity/MegaJackpot/megaJackpot.test.js';
import { newagentTag, queryNewagent } from '../tests/api/activity/newagent/newagent.test.js';
import { newagentRankTag, queryNewagentRank } from '../tests/api/activity/newagent/newagentRank.test.js';
import { rankingTag, queryRanking } from '../tests/api/activity/ranking/ranking.test.js';
import { rechargeGiftPackTag, queryRechargeGiftPack } from '../tests/api/activity/rechargeGiftPack/rechargeGiftPack.test.js'
import { rechargeWheelTag, queryRechargeWheel } from '../tests/api/activity/rechargeWheel/rechargeWheel.test.js';
import { redRainActivityTag, queryRedRainActivity } from '../tests/api/activity/RedRainActivity/redRainActivity.test.js';
import { rescueTag, queryRescue } from '../tests/api/activity/rescue/rescue.test.js';
import { signinTag, querySignin } from '../tests/api/activity/signin/signin.test.js';
import { weekCardTag, queryWeekCard } from '../tests/api/activity/weekCard/weekCard.test.js';
import { withdrawalTimeoutTag, querywithdrawalTimeout } from '../tests/api/activity/withdrawalTimeout/withdrawalTimeout.test.js';
import {
    queryVipinfo,
    queryRechargeGift,
    accountChangesTag
} from '../tests/api/formdata/accountChanges/accountChanges.test.js';
import {
    queryBonusToup, manualRechargeTag,
    queryBonusReduce
} from '../tests/api/formdata/manualRecharge/manualRecharge.test.js';

import { queryMessageManage, messageManageTag } from '../tests/api/formdata/messageManage/messageManage.test.js';


export const reportConfigs = [
    {
        title: '报表管理->仪表盘',
        name: 'Dashboard',
        tag: Dashboardtag,
        func: queryDashboardFunc,
        priority: 1,
        description: '查询商户后台仪表盘的数据'
    },
    {
        title: '报表管理->数据统计',
        name: 'Statistics',
        tag: Statisticstag,
        func: queryStatisticsFunc,
        priority: 2,
        description: '查询商户后台数据统计的数据'
    },
    {
        title: '报表管理->平台报表',
        name: 'DailySummaryReport',
        tag: DailySummaryTag,
        func: queryDailySummaryReportFunc,
        priority: 3,
        description: '查询商户后台平台报表的数据'
    },
    {
        title: '报表管理->会员报表',
        name: 'MemberReport',
        tag: memberTag,
        func: queryMemberReportFunc,
        priority: 4,
        description: '查询商户后台会员报表的数据'
    },
    {
        title: '活动管理->引导活动',
        name: 'ActivityGuideReward',
        tag: activityGuideTag,
        func: queryActivityGuide,
        priority: 5,
        description: '查询引导活动报表的数据'
    },
    {
        title: '活动管理->锦标赛活动',
        name: 'Champion',
        tag: championTag,
        func: queryChampion,
        priority: 6,
        description: '查询锦标赛报表的数据'
    },
    {
        title: '活动管理->洗码活动',
        name: 'CodeWashing',
        tag: codeWashingTag,
        func: queryCodeWashing,
        priority: 7,
        description: '查询洗码报表的数据'
    },
    {
        title: '活动管理->优惠券活动',
        name: 'Coupon',
        tag: couponTag,
        func: queryCoupon,
        priority: 8,
        description: '查询优惠券报表的数据'
    },
    {
        title: '活动管理->每日每周活动',
        name: 'DailyTasks',
        tag: dailyTasksTag,
        func: queryDailyTasks,
        priority: 9,
        description: '查询每日每周报表的数据'
    },
    {
        title: '活动管理->礼品码活动',
        tag: giftCodesTag,
        name: 'GiftCode',
        func: queryGiftcodes,
        priority: 10,
        description: '查询礼品码报表的数据'
    },
    {
        title: '活动管理->活动礼包活动',
        tag: giftPackTag,
        name: 'GiftPackReward',
        func: queryGiftPack,
        priority: 11,
        description: '查询活动礼包报表的数据'
    },
    {
        title: '活动管理->邀请转盘活动',
        tag: inviteTurntableTag,
        name: 'InvitedWheel',
        func: queryInviteTurntable,
        priority: 12,
        description: '查询邀请转盘报表的数据'
    },
    {
        title: '活动管理->超级大奖活动',
        name: 'BigJackpotReward',
        tag: megaJackpotTag,
        func: queryMegaJackpot,
        priority: 13,
        description: '查询超级大奖盘报表的数据'
    },
    {
        title: '活动管理->新版返佣活动',
        name: 'L3SendCommission',
        tag: newagentTag,
        func: queryNewagent,
        priority: 14,
        description: '查询新版返佣报表的数据'
    },
    {
        title: '活动管理-> 新版返佣的排行榜活动',
        name: 'NewAgentRank',
        tag: newagentRankTag,
        func: queryNewagentRank,
        priority: 15,
        description: '查询 新版返佣的排行榜报表的数据'
    },
    {
        title: '活动管理-> 会员排行榜活动',
        name: 'Ranking',
        tag: rankingTag,
        func: queryRanking,
        priority: 16,
        description: '查询会员排行榜报表的数据'
    },
    {
        title: '活动管理-> 充值礼包活动',
        name: 'RechargeGiftPack',
        tag: rechargeGiftPackTag,
        func: queryRechargeGiftPack,
        priority: 17,
        description: '查询充值礼包报表的数据'
    },
    {
        title: '活动管理-> 充值转盘活动',
        name: 'RechargeWheelSpin',
        tag: rechargeWheelTag,
        func: queryRechargeWheel,
        priority: 18,
        description: '查询充值转盘报表的数据'
    },
    {
        title: '活动管理-> 红包雨活动',
        name: 'RedRainActivity',
        tag: redRainActivityTag,
        func: queryRedRainActivity,
        priority: 19,
        description: '查询红包雨报表的数据'
    },
    {
        title: '活动管理-> 亏损救援金活动',
        name: 'Rescue',
        tag: rescueTag,
        func: queryRescue,
        priority: 20,
        description: '查询亏损救援金报表的数据'
    },
    {
        title: '活动管理-> 每日签到活动',
        name: 'Signin',
        tag: signinTag,
        func: querySignin,
        priority: 21,
        description: '查询每日签到报表的数据'
    },
    {
        title: '活动管理-> 周卡月卡活动',
        name: 'WeekCard',
        tag: weekCardTag,
        func: queryWeekCard,
        priority: 22,
        description: '查询周卡月卡报表的数据'
    },
    {
        title: '活动管理-> 超时提现赔付活动',
        name: 'WithdrawalTimeout',
        tag: withdrawalTimeoutTag,
        func: querywithdrawalTimeout,
        priority: 23,
        description: '查询超时提现赔付报表的数据'
    },
    {
        title: '报表管理->账变-vip',
        name: 'VIPReward',
        tag: accountChangesTag,
        func: queryVipinfo,
        priority: 24,
        description: '查询账变-vip报表的数据'
    },
    {
        title: '财务管理->人工充值-彩金充值',
        name: 'BonusRecharge',
        tag: manualRechargeTag,
        func: queryBonusToup,
        priority: 25,
        description: '彩金充值报表的数据'
    },
    {
        title: '报表管理->账变-充值赠送',
        name: 'RechargeGift',
        tag: accountChangesTag,
        func: queryRechargeGift,
        priority: 26,
        description: '查询账变-充值赠送报表的数据'
    },
    {
        title: '财务管理->人工充值-彩金扣减',
        name: 'BonusReduce',
        tag: manualRechargeTag,
        func: queryBonusReduce,
        priority: 27,
        description: '彩金扣减报表的数据'
    },
    {
        title: '运营管理->消息管-站内信领取记录',
        name: 'InmailReward',
        tag: messageManageTag,
        func: queryMessageManage,
        priority: 28,
        description: '站内信领取记录报表的数据'
    },
];