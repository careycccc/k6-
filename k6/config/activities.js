import { createCouponActivity } from '../tests/api/activity/coupon.test.js';

export const activityConfigs = [
  {
    name: '优惠券活动',
    tag: 'coupon_activity',
    func: createCouponActivity,
    priority: 1,
    description: '创建优惠券活动',
    category: 'promotion'
  },
  {
    name: '系统活动',
    tag: 'system_activity',
    func: () => createSystemActivity(),
    priority: 2,
    description: '创建系统活动',
    category: 'system'
  },
  {
    name: '充值活动',
    tag: 'recharge_activity',
    func: () => createRechargeActivity(),
    priority: 3,
    description: '创建充值活动',
    category: 'finance'
  },
  {
    name: '签到活动',
    tag: 'signin_activity',
    func: () => createSigninActivity(),
    priority: 4,
    description: '创建签到活动',
    category: 'daily'
  },
  {
    name: '抽奖活动',
    tag: 'lottery_activity',
    func: () => createLotteryActivity(),
    priority: 5,
    description: '创建抽奖活动',
    category: 'game'
  }
];

/**
 * 根据优先级获取活动配置列表
 * @returns {Array} 返回按优先级排序后的活动配置数组
 */
export function getActivitiesByPriority() {
  return activityConfigs.sort((a, b) => a.priority - b.priority);
}

/**
 * 根据标签获取对应的活动配置
 * @param {string} tag - 活动的标签标识
 * @returns {Object|null} 返回匹配标签的活动配置对象，如果未找到则返回null
 */
export function getActivityByTag(tag) {
  return activityConfigs.find((a) => a.tag === tag);
}

/**
 * 根据分类获取活动配置
 * @param {string} category - 活动分类名称
 * @returns {Array} 返回匹配的活动配置数组
 */
export function getActivitiesByCategory(category) {
  const categories = {
    promotion: ['coupon_activity', 'system_activity'],
    finance: ['recharge_activity'],
    daily: ['signin_activity'],
    game: ['lottery_activity']
  };

  const tags = categories[category] || [];
  return activityConfigs.filter((a) => tags.includes(a.tag));
}

/**
 * 获取所有活动分类
 * @returns {Array} 返回所有活动分类名称
 */
export function getAllCategories() {
  return [...new Set(activityConfigs.map((a) => a.category))];
}

// 模拟活动创建函数
function createSystemActivity() {
  return {
    activityId: 'SYS_' + Date.now(),
    name: '系统活动_' + Date.now(),
    type: 'system',
    status: 'created',
    createTime: new Date().toISOString()
  };
}

function createRechargeActivity() {
  return {
    activityId: 'RECHARGE_' + Date.now(),
    name: '充值活动_' + Date.now(),
    type: 'recharge',
    bonusRate: 0.1,
    status: 'created',
    createTime: new Date().toISOString()
  };
}

function createSigninActivity() {
  return {
    activityId: 'SIGNIN_' + Date.now(),
    name: '签到活动_' + Date.now(),
    type: 'signin',
    rewardDays: 7,
    status: 'created',
    createTime: new Date().toISOString()
  };
}

function createLotteryActivity() {
  return {
    activityId: 'LOTTERY_' + Date.now(),
    name: '抽奖活动_' + Date.now(),
    type: 'lottery',
    prizePool: 10000,
    status: 'created',
    createTime: new Date().toISOString()
  };
}
