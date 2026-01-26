import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { AdminLogin } from '../../tests/api/login/adminlogin.test.js';
import { logger } from '../utils/logger.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

/**
 * 批量操作基类 - 提供通用的批量执行功能
 */
export class BatchOperationBase {
  constructor(operationType = 'operation', metricPrefix = 'operation') {
    this.operationType = operationType;
    this.results = {
      token: '',
      items: {},
      summary: {},
      comparisons: {}
    };

    // 根据操作类型设置指标名称（只允许英文字母、数字、下划线）
    this.metricPrefix = metricPrefix;

    this.metrics = {
      duration: new Trend(`${this.metricPrefix}_duration`, true),
      success: new Rate(`${this.metricPrefix}_success`),
      count: new Counter(`${this.metricPrefix}_count`),
      dataSize: new Trend(`${this.metricPrefix}_data_size`, true)
    };
  }

  /**
   * 获取通用配置选项
   * @param {Object} customThresholds - 自定义阈值配置
   * @returns {Object} K6 options配置
   */
  getOptions(customThresholds = {}) {
    const defaultThresholds = {
      http_req_duration: ['p(95)<5000'],
      http_req_failed: ['rate<0.05'],
      [`${this.metricPrefix}_duration`]: ['avg<3000'],
      [`${this.metricPrefix}_success`]: ['rate>0.95']
    };

    return {
      vus: 1,
      iterations: 1,
      thresholds: { ...defaultThresholds, ...customThresholds },
      summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
      summaryTimeUnit: 'ms'
    };
  }

  /**
   * 通用setup函数
   * @returns {Object} 包含token的数据对象
   */
  setup() {
    try {
      console.log('');
      console.log('╔═══════════════════════════════════════════════════════════╗');
      console.log(`║          批量${this.operationType}系统 - 初始化                         ║`);
      console.log('╚═══════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('[1/2] 正在获取登录Token...');

      const token = AdminLogin();
      if (!token) {
        throw new Error('Token获取失败');
      }

      console.log('[1/2] ✓ Token获取成功');
      console.log('');

      this.results.token = token;
      return { token };
    } catch (error) {
      logger.error('Setup失败:', error.message);
      throw error;
    }
  }

  /**
   * 通用主执行函数
   * @param {Object} data - 包含token的数据对象
   * @param {Array} itemList - 要执行的项目列表
   * @param {Function} executeFunction - 执行函数
   * @returns {Array} 执行结果数组
   */
  execute(data, itemList, executeFunction) {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log(`║          批量${this.operationType}系统 - 开始执行                         ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  计划${this.operationType}数: ${itemList.length.toString().padEnd(40)}║`);
    console.log(`║  执行方式: 串行${this.operationType}（按优先级排序）${''.padEnd(27)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < itemList.length; i++) {
      const item = itemList[i];
      const result = this.executeItem(data, item, i + 1, itemList.length, executeFunction);
      results.push(result);

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }

      this.results.items[item.tag] = result;
    }

    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log(`║          批量${this.operationType}系统 - 执行完成                         ║`);
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  总${this.operationType}数: ${itemList.length.toString().padEnd(45)}║`);
    console.log(`║  成功: ${successCount.toString().padEnd(50)}║`);
    console.log(`║  失败: ${failCount.toString().padEnd(50)}║`);
    console.log(
      `║  成功率: ${((successCount / itemList.length) * 100).toFixed(2)}%${''.padEnd(45)}║`
    );
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    this.generateSummary(results);
    this.performComparison(results);

    return results;
  }

  /**
   * 执行单个项目
   * @param {Object} data - 包含token的数据对象
   * @param {Object} item - 项目配置对象
   * @param {number} current - 当前序号
   * @param {number} total - 总数
   * @param {Function} executeFunction - 执行函数
   * @returns {Object} 执行结果
   */
  executeItem(data, item, current, total, executeFunction) {
    const startTime = Date.now();
    const progressBar = this.generateProgressBar(current, total);

    console.log(`[${current}/${total}] ${progressBar} ${item.name}`);
    console.log('─'.repeat(60));

    try {
      let result;
      let dataSize = 0;

      if (item.func && typeof item.func === 'function') {
        result = executeFunction(item, data);
      } else {
        logger.info(`${this.operationType} ${item.tag} 没有配置函数，使用模拟数据`);
        result = this.generateMockData(item.tag);
      }

      const duration = Date.now() - startTime;
      dataSize = JSON.stringify(result).length;

      this.metrics.duration.add(duration, { [this.metricPrefix]: item.tag, status: 'success' });
      this.metrics.success.add(1, { [this.metricPrefix]: item.tag });
      this.metrics.count.add(1, { [this.metricPrefix]: item.tag });
      this.metrics.dataSize.add(dataSize, { [this.metricPrefix]: item.tag });

      console.log(`  ✓ 状态: ${this.operationType}成功`);
      console.log(`  ⏱ 耗时: ${duration}ms`);
      console.log(`  📦 数据量: ${this.formatBytes(dataSize)}`);
      console.log(`  📊 ${this.getItemDisplayInfo(result)}`);
      console.log('');

      return {
        tag: item.tag,
        name: item.name,
        category: item.category,
        success: true,
        duration: duration,
        dataSize: dataSize,
        data: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.metrics.duration.add(duration, { [this.metricPrefix]: item.tag, status: 'failed' });
      this.metrics.success.add(0, { [this.metricPrefix]: item.tag });
      this.metrics.count.add(1, { [this.metricPrefix]: item.tag });

      console.log(`  ✗ 状态: ${this.operationType}失败`);
      console.log(`  ⏱ 耗时: ${duration}ms`);
      console.log(`  ❌ 错误: ${error.message}`);
      console.log('');

      return {
        tag: item.tag,
        name: item.name,
        category: item.category,
        success: false,
        duration: duration,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 生成进度条
   * @param {number} current - 当前进度
   * @param {number} total - 总数
   * @param {number} width - 进度条宽度
   * @returns {string} 进度条字符串
   */
  generateProgressBar(current, total, width = 20) {
    const percentage = (current / total) * 100;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * 格式化字节数
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的字符串
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  /**
   * 格式化时间
   * @param {number} ms - 毫秒数
   * @returns {string} 格式化后的时间字符串
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  }

  /**
   * 生成汇总统计
   * @param {Array} results - 执行结果数组
   */
  generateSummary(results) {
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const avgDuration = totalDuration / results.length;
    const totalDataSize = results.reduce((sum, r) => sum + (r.dataSize || 0), 0);
    const minDuration = Math.min(...results.map((r) => r.duration));
    const maxDuration = Math.max(...results.map((r) => r.duration));

    this.results.summary = {
      totalItems: results.length,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success).length,
      totalDuration: totalDuration,
      avgDuration: avgDuration,
      minDuration: minDuration,
      maxDuration: maxDuration,
      totalDataSize: totalDataSize,
      timestamp: new Date().toISOString()
    };

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log(
      `║                    ${this.operationType}汇总统计                               ║`
    );
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  总耗时: ${this.formatDuration(totalDuration).padEnd(45)}║`);
    console.log(`║  平均耗时: ${this.formatDuration(avgDuration).padEnd(43)}║`);
    console.log(`║  最快: ${this.formatDuration(minDuration).padEnd(48)}║`);
    console.log(`║  最慢: ${this.formatDuration(maxDuration).padEnd(48)}║`);
    console.log(`║  总数据量: ${this.formatBytes(totalDataSize).padEnd(43)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
  }

  /**
   * 执行对比分析
   * @param {Array} results - 执行结果数组
   */
  performComparison(results) {
    const successItems = results.filter((r) => r.success && r.data);

    if (successItems.length < 2) {
      console.log(`💡 需要2个以上成功${this.operationType}才能进行数据对比分析`);
      return;
    }

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log(
      `║                    ${this.operationType}对比分析                               ║`
    );
    console.log('╠═══════════════════════════════════════════════════════════╣');

    const comparisons = [];

    for (let i = 0; i < successItems.length; i++) {
      for (let j = i + 1; j < successItems.length; j++) {
        const item1 = successItems[i];
        const item2 = successItems[j];

        const duration1 = item1.duration;
        const duration2 = item2.duration;
        const diff = duration1 - duration2;
        const diffPercent = duration2 > 0 ? ((diff / duration2) * 100).toFixed(2) : 'N/A';

        console.log(
          `║  ${item1.name.substring(0, 15).padEnd(15)} vs ${item2.name.substring(0, 15).padEnd(15)}║`
        );
        console.log(
          `║    耗时: ${duration1.toString().padEnd(10)}ms vs ${duration2.toString().padEnd(10)}ms     ║`
        );
        console.log(
          `║    差值: ${diff.toString().padEnd(10)}ms (${diffPercent}%)${''.padEnd(15)}║`
        );
        console.log(`║    ${this.getComparisonDisplayInfo(item1, item2)}`);
        console.log('║    ──────────────────────────────────────────────────────║');

        comparisons.push({
          item1: item1.name,
          item2: item2.name,
          duration1: duration1,
          duration2: duration2,
          diff: diff,
          diffPercent: diffPercent,
          ...this.getComparisonData(item1, item2)
        });
      }
    }

    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    this.results.comparisons = comparisons;
  }

  /**
   * 生成handleSummary函数
   * @param {Object} data - K6测试数据
   * @returns {Object} 报告配置对象
   */
  generateHandleSummary(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    return {
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
      [`reports/batch-${this.metricPrefix}-${timestamp}.html`]: htmlReport(data, {
        title: `批量${this.operationType}报告`
      }),
      [`reports/batch-${this.metricPrefix}-${timestamp}-summary.json`]: JSON.stringify(
        this.results,
        null,
        2
      )
    };
  }

  // 以下方法需要子类重写
  /**
   * 获取项目显示信息（子类重写）
   * @param {Object} result - 执行结果
   * @returns {string} 显示信息
   */
  getItemDisplayInfo(result) {
    return '记录数: ' + this.countRecords(result);
  }

  /**
   * 获取对比显示信息（子类重写）
   * @param {Object} item1 - 项目1
   * @param {Object} item2 - 项目2
   * @returns {string} 对比信息
   */
  getComparisonDisplayInfo(item1, item2) {
    return `类型: ${item1.data.type?.padEnd(10)} vs ${item2.data.type?.padEnd(10)}     ║`;
  }

  /**
   * 获取对比数据（子类重写）
   * @param {Object} item1 - 项目1
   * @param {Object} item2 - 项目2
   * @returns {Object} 对比数据
   */
  getComparisonData(item1, item2) {
    return {
      type1: item1.data.type,
      type2: item2.data.type
    };
  }

  /**
   * 生成模拟数据（子类重写）
   * @param {string} tag - 项目标签
   * @returns {Object} 模拟数据
   */
  generateMockData(tag) {
    return {
      mock: true,
      tag: tag,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 计算记录数（子类可重写）
   * @param {Object} data - 数据对象
   * @returns {number} 记录数
   */
  countRecords(data) {
    if (Array.isArray(data)) {
      return data.length;
    } else if (typeof data === 'object' && data !== null) {
      return data.list?.length || data.total || 1;
    }
    return 0;
  }
}

/**
 * 报表查询操作类
 */
export class BatchReportOperation extends BatchOperationBase {
  constructor() {
    super('报表查询', 'report');
  }

  getItemDisplayInfo(result) {
    return '记录数: ' + this.countRecords(result);
  }

  getComparisonDisplayInfo(item1, item2) {
    const records1 = this.countRecords(item1.data);
    const records2 = this.countRecords(item2.data);
    return `记录数: ${records1.toString().padEnd(10)} vs ${records2.toString().padEnd(10)}     ║`;
  }

  getComparisonData(item1, item2) {
    return {
      records1: this.countRecords(item1.data),
      records2: this.countRecords(item2.data)
    };
  }

  /**
   * 根据标签生成模拟数据
   * @param {string} tag - 数据标签，用于指定要返回的模拟数据类型
   * @returns {Object} 返回对应的模拟数据对象
   */
  generateMockData(tag) {
    // 定义模拟数据对象，包含两种类型的模拟数据：queryDashboard 和 querySubAccounts
    const mockData = {
      // 仪表板查询的模拟数据，包含统计日期和统计数据
      queryDashboard: {
        list: [
          {
            statisticDataRsp: { totalUsers: 100, activeUsers: 80 }, // 统计数据响应，包含总用户数和活跃用户数
            statisticDate: '2026-01-22' // 统计日期
          }
        ]
      },
      // 子账户查询的模拟数据，包含用户列表和总数
      querySubAccounts: {
        list: Array.from({ length: 10 }, (_, i) => ({ // 生成一个包含10个用户对象的数组
          userId: 1000 + i, // 用户ID，从1000开始递增
          userName: `user${i}`, // 用户名，格式为user加索引
          hierarchy: 1 // 用户层级
        })),
        total: 10 // 用户总数
      }
    };

    // 返回对应标签的模拟数据，如果没有匹配的标签则返回一个包含mock属性的对象
    return mockData[tag] || { mock: true };
  }
}

/**
 * 活动创建操作类
 */
export class BatchActivityOperation extends BatchOperationBase {
  constructor() {
    super('活动创建', 'activity');
  }

  getItemDisplayInfo(result) {
    return `活动ID: ${result.activityId || 'N/A'}`;
  }

  getComparisonDisplayInfo(item1, item2) {
    return `类型: ${item1.data.type?.padEnd(10)} vs ${item2.data.type?.padEnd(10)}     ║`;
  }

  getComparisonData(item1, item2) {
    return {
      type1: item1.data.type,
      type2: item2.data.type
    };
  }

  /**
   * 根据标签生成模拟活动数据
   * @param {string} tag - 活动类型标签，可以是 'coupon_activity' 或 'system_activity'
   * @returns {Object} 返回对应类型的活动数据对象，如果标签不匹配则返回默认的模拟活动数据
   */
  generateMockData(tag) {
    // 定义模拟数据对象，包含优惠券活动和系统活动两种类型的数据模板
    const mockData = {
      // 优惠券活动数据模板
      coupon_activity: {
        activityId: 'COUPON_' + Date.now(), // 活动ID，使用时间戳确保唯一性
        name: '优惠券活动_' + Date.now(),   // 活动名称，使用时间戳确保唯一性
        type: 'coupon',                    // 活动类型标识为优惠券
        couponCount: 100,                  // 优惠券数量
        status: 'created',                 // 活动状态
        createTime: new Date().toISOString() // 创建时间，使用ISO格式
      },
      // 系统活动数据模板
      system_activity: {
        activityId: 'SYS_' + Date.now(),    // 活动ID，使用时间戳确保唯一性
        name: '系统活动_' + Date.now(),     // 活动名称，使用时间戳确保唯一性
        type: 'system',                    // 活动类型标识为系统活动
        status: 'created',                 // 活动状态
        createTime: new Date().toISOString() // 创建时间，使用ISO格式
      }
    };

    // 返回对应标签的数据，如果标签不存在则返回默认的模拟活动数据
    return (
      mockData[tag] || {
        activityId: 'MOCK_' + Date.now(),  // 默认活动ID，使用时间戳确保唯一性
        name: '模拟活动_' + Date.now(),     // 默认活动名称，使用时间戳确保唯一性
        type: 'mock',                      // 默认活动类型标识为模拟
        status: 'created',                 // 默认活动状态
        createTime: new Date().toISOString() // 默认创建时间，使用ISO格式
      }
    );
  }

  /**
   * 显示活动详情
   * @param {Array} results - 执行结果数组
   */
  displayActivityDetails(results) {
    const successActivities = results.filter((r) => r.success && r.data);

    if (successActivities.length === 0) {
      console.log('💡 没有成功创建的活动，跳过详情显示');
      return;
    }

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    活动详情展示                               ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');

    successActivities.forEach((activity) => {
      const data = activity.data;
      console.log(`║  🎯 ${activity.name}                                      ║`);
      console.log(`║     ID: ${data.activityId?.padEnd(40)}║`);
      console.log(`║     类型: ${data.type?.padEnd(37)}║`);
      console.log(`║     状态: ${data.status?.padEnd(37)}║`);
      console.log(`║     创建时间: ${data.createTime?.substring(0, 19).padEnd(30)}║`);

      // 显示特定类型的详细信息
      if (data.type === 'coupon' && data.couponCount) {
        console.log(`║     优惠券数量: ${data.couponCount.toString().padEnd(30)}║`);
      } else if (data.type === 'recharge' && data.bonusRate) {
        console.log(`║     奖励比例: ${(data.bonusRate * 100).toString() + '%'.padEnd(30)}║`);
      } else if (data.type === 'signin' && data.rewardDays) {
        console.log(`║     奖励天数: ${data.rewardDays.toString().padEnd(30)}║`);
      } else if (data.type === 'lottery' && data.prizePool) {
        console.log(`║     奖池金额: ${data.prizePool.toString().padEnd(30)}║`);
      }

      console.log('║    ──────────────────────────────────────────────────────║');
    });

    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
  }
}
