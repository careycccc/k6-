// 导入所有活动创建函数和tag
import { createActivityGuideTag, createActivityGuide } from '../tests/api/activity/activityGuide/createActivityGuide.js';
import { createChampionTag, createChampion } from '../tests/api/activity/champion/createChampion.js';
import { createCodeWashingTag, createCodeWashing } from '../tests/api/activity/codeWashing/createCodeWashing.js';
import { createCouponTag, createCoupon } from '../tests/api/activity/coupon/createCoupon.js';
import { createDailyTasksTag, createDailyTasks } from '../tests/api/activity/dailyTasks/createDailyTasks.js';
import { createGiftCodesTag, createGiftCodes } from '../tests/api/activity/GiftCodes/createGiftCodes.js';
import { createGiftPackTag, createGiftPack } from '../tests/api/activity/giftPack/createGiftPack.js';
import { createInviteTurntableTag, createInviteTurntable } from '../tests/api/activity/inviteTurntable/createInviteTurntable.js';
import { createMegaJackpotTag, createMegaJackpot } from '../tests/api/activity/MegaJackpot/createMegaJackpot.js';
import { createNewagentTag, createNewagent } from '../tests/api/activity/newagent/createNewagent.js';
import { createNewagentRankTag, createNewagentRank } from '../tests/api/activity/newagent/createNewagentRank.js';
import { createRankingTag, createRanking } from '../tests/api/activity/ranking/createRanking.js';
import { createRechargeGiftPackTag, createRechargeGiftPack } from '../tests/api/activity/rechargeGiftPack/createRechargeGiftPack.js';
import { createRechargeWheelTag, createRechargeWheel } from '../tests/api/activity/rechargeWheel/createRechargeWheel.js';
import { createRedRainActivityTag, createRedRainActivity } from '../tests/api/activity/RedRainActivity/createRedRainActivity.js';
import { createRescueTag, createRescue } from '../tests/api/activity/rescue/createRescue.js';
import { createSigninTag, createSignin } from '../tests/api/activity/signin/createSignin.js';
import { createWeekCardTag, createWeekCard } from '../tests/api/activity/weekCard/createWeekCard.js';
import { createWithdrawalTimeoutTag, createWithdrawalTimeout } from '../tests/api/activity/withdrawalTimeout/createWithdrawalTimeout.js';
import { createSystemActiveTag, createSystemActive } from '../tests/api/activity/systemActive/createSystemActive.js';
import { createTagTag, createTagfunc } from '../tests/api/activity/tag/createTag.js';
import { createSigninActivityTag, createSigninActivity } from '../tests/api/activity/signinActivity/createSigninActivity.js';
import { createLotteryActivityTag, createLotteryActivity } from '../tests/api/activity/lotteryActivity/createLotteryActivity.js';
import { createInmailTag, createInmail } from '../tests/api/activity/inmail/createInmail.js';

/**
 * 活动创建配置列表
 * 每个配置包含活动的基本信息和创建函数
 * priority 值越小，优先级越高（先执行）
 */
export const createActivityConfigs = [
  {
    title: '会员管理->标签管理',
    name: 'TagMangent',
    tag: createTagTag,
    func: createTagfunc,
    priority: 0,
    description: '创建标签（最高优先级，其他活动依赖标签）'
  },
  {
    title: '活动管理->优惠券活动',
    name: 'Coupon',
    tag: createCouponTag,
    func: createCoupon,
    priority: 1,
    description: '创建优惠券活动'
  },
  {
    title: '活动管理->引导活动',
    name: 'ActivityGuideReward',
    tag: createActivityGuideTag,
    func: createActivityGuide,
    priority: 2,
    description: '创建引导活动'
  },
  {
    title: '活动管理->锦标赛活动',
    name: 'Champion',
    tag: createChampionTag,
    func: createChampion,
    priority: 3,
    description: '创建锦标赛活动'
  },
  {
    title: '活动管理->洗码活动',
    name: 'CodeWashing',
    tag: createCodeWashingTag,
    func: createCodeWashing,
    priority: 4,
    description: '创建洗码活动'
  },
  {
    title: '活动管理->每日每周活动',
    name: 'DailyTasks',
    tag: createDailyTasksTag,
    func: createDailyTasks,
    priority: 5,
    description: '创建每日每周任务活动'
  },
  {
    title: '活动管理->礼品码活动',
    name: 'GiftCode',
    tag: createGiftCodesTag,
    func: createGiftCodes,
    priority: 6,
    description: '创建礼品码活动'
  },
  {
    title: '活动管理->活动礼包活动',
    name: 'GiftPackReward',
    tag: createGiftPackTag,
    func: createGiftPack,
    priority: 7,
    description: '创建活动礼包活动'
  },
  {
    title: '活动管理->邀请转盘活动',
    name: 'InvitedWheel',
    tag: createInviteTurntableTag,
    func: createInviteTurntable,
    priority: 8,
    description: '创建邀请转盘活动'
  },
  {
    title: '活动管理->超级大奖活动',
    name: 'BigJackpotReward',
    tag: createMegaJackpotTag,
    func: createMegaJackpot,
    priority: 9,
    description: '创建超级大奖活动'
  },
  {
    title: '活动管理->新版返佣活动',
    name: 'L3SendCommission',
    tag: createNewagentTag,
    func: createNewagent,
    priority: 10,
    description: '创建新版返佣活动'
  },
  {
    title: '活动管理->新版返佣排行榜活动',
    name: 'NewAgentRank',
    tag: createNewagentRankTag,
    func: createNewagentRank,
    priority: 11,
    description: '创建新版返佣排行榜活动'
  },
  {
    title: '活动管理->会员排行榜活动',
    name: 'Ranking',
    tag: createRankingTag,
    func: createRanking,
    priority: 12,
    description: '创建会员排行榜活动'
  },
  {
    title: '活动管理->充值礼包活动',
    name: 'RechargeGiftPack',
    tag: createRechargeGiftPackTag,
    func: createRechargeGiftPack,
    priority: 13,
    description: '创建充值礼包活动'
  },
  {
    title: '活动管理->充值转盘活动',
    name: 'RechargeWheelSpin',
    tag: createRechargeWheelTag,
    func: createRechargeWheel,
    priority: 14,
    description: '创建充值转盘活动'
  },
  {
    title: '活动管理->红包雨活动',
    name: 'RedRainActivity',
    tag: createRedRainActivityTag,
    func: createRedRainActivity,
    priority: 15,
    description: '创建红包雨活动'
  },
  {
    title: '活动管理->亏损救援金活动',
    name: 'Rescue',
    tag: createRescueTag,
    func: createRescue,
    priority: 16,
    description: '创建亏损救援金活动'
  },
  {
    title: '活动管理->每日签到活动',
    name: 'Signin',
    tag: createSigninTag,
    func: createSignin,
    priority: 17,
    description: '创建每日签到活动'
  },
  {
    title: '活动管理->周卡月卡活动',
    name: 'WeekCard',
    tag: createWeekCardTag,
    func: createWeekCard,
    priority: 18,
    description: '创建周卡月卡活动'
  },
  {
    title: '活动管理->超时提现赔付活动',
    name: 'WithdrawalTimeout',
    tag: createWithdrawalTimeoutTag,
    func: createWithdrawalTimeout,
    priority: 19,
    description: '创建超时提现赔付活动'
  },
  {
    title: '活动管理->系统活动',
    name: 'SystemActive',
    tag: createSystemActiveTag,
    func: createSystemActive,
    priority: 20,
    description: '创建系统活动'
  },
  {
    title: '活动管理->签到活动',
    name: 'SigninActivity',
    tag: createSigninActivityTag,
    func: createSigninActivity,
    priority: 21,
    description: '创建签到活动'
  },
  {
    title: '活动管理->抽奖活动',
    name: 'LotteryActivity',
    tag: createLotteryActivityTag,
    func: createLotteryActivity,
    priority: 22,
    description: '创建抽奖活动'
  },
  {
    title: '运营管理->站内信活动',
    name: 'Inmail',
    tag: createInmailTag,
    func: createInmail,
    priority: 23,
    description: '创建站内信活动'
  }
];
