import {
  Dashboardtag,
  queryDashboardFunc
} from '../tests/api/formdata/Dashboard/Dashboard.test.js';
import {
  Statisticstag,
  queryStatisticsFunc
} from '../tests/api/formdata/Statistics/Statistics.test.js';



export const reportConfigs = [
  // {
  //   name: '报表管理->仪表盘',
  //   tag: Dashboardtag,
  //   func: queryDashboardFunc,
  //   priority: 1,
  //   description: '查询商户后台仪表盘的数据'
  // },
  {
    name: '报表管理->数据统计',
    tag: Statisticstag,
    func: queryStatisticsFunc,
    priority: 2,
    description: '查询商户后台数据统计的数据'
  }
];

/**
 * 根据优先级获取报告配置列表
 * 该函数会按照优先级对报告配置进行排序并返回排序后的结果
 * @returns {Array} 返回按优先级排序后的报告配置数组
 */
export function getReportsByPriority() {
  // 使用数组的sort方法，按照priority属性值进行升序排序
  return reportConfigs.sort((a, b) => a.priority - b.priority);
}

/**
 * 根据标签获取对应的报告配置
 * @param {string} tag - 报告的标签标识
 * @returns {Object|null} 返回匹配标签的报告配置对象，如果未找到则返回null
 */
export function getReportByTag(tag) {
  // 使用数组的find方法查找与给定标签匹配的报告配置
  return reportConfigs.find((r) => r.tag === tag);
}

/**
 * 根据分类获取报告配置
 * @param {string} category - 报告分类名称
 * @returns {Array} 返回匹配的报告配置数组
 */
export function getReportsByCategory(category) {
  // 定义各类别对应的标签
  const categories = {
    rebate: ['querySubAccounts', 'rebateLevel'], // 返利相关标签
    finance: ['rechargeOrder', 'withdrawOrder'], // 财务相关标签
    game: ['betRecord'], // 游戏相关标签
    member: ['memberReport', 'teamReport'], // 会员相关标签
    activity: ['coupon', 'systemActive'] // 活动相关标签
  };

  // 获取对应分类的标签数组，如果分类不存在则返回空数组
  const tags = categories[category] || [];
  // 过滤出标签匹配的报告配置
  return reportConfigs.filter((r) => tags.includes(r.tag));
}
