/**
 * 日志级别
 */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

/**
 * 日志工具类
 */
export class Logger {
  constructor(config = {}) {
    this.level =
      config.level || (__ENV.LOG_LEVEL ? LogLevel[__ENV.LOG_LEVEL.toUpperCase()] : LogLevel.INFO);
    this.prefix = config.prefix || 'K6';
    this.enableColors = config.enableColors !== false;
    // 不要在这里访问 __VU 和 __ITER
    // 它们将在日志方法中被动态获取
  }

  /**
   * 获取当前 VU 和 ITER
   */
  getCurrentContext() {
    try {
      return {
        vuId: typeof __VU !== 'undefined' ? __VU : 0,
        iterId: typeof __ITER !== 'undefined' ? __ITER : 0
      };
    } catch (error) {
      return { vuId: 0, iterId: 0 };
    }
  }

  /**
   * 格式化消息
   */
  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    // 动态获取当前上下文
    const { vuId, iterId } = this.getCurrentContext();
    const prefix = `[${timestamp}] [${levelStr}] [VU${vuId.toString().padStart(3, '0')}-ITER${iterId}] ${this.prefix}:`;

    let formatted = `${prefix} ${message}`;

    if (data) {
      if (typeof data === 'object') {
        try {
          formatted += ` ${JSON.stringify(data, null, 0)}`;
        } catch {
          formatted += ` ${String(data)}`;
        }
      } else {
        formatted += ` ${data}`;
      }
    }

    return formatted;
  }

  /**
   * 添加颜色
   */
  addColor(level, message) {
    if (!this.enableColors) return message;

    const colors = {
      debug: '\x1b[36m', // 青色
      info: '\x1b[32m', // 绿色
      warn: '\x1b[33m', // 黄色
      error: '\x1b[31m' // 红色
    };

    const reset = '\x1b[0m';
    return `${colors[level]}${message}${reset}`;
  }

  /**
   * 调试日志
   */
  debug(message, data) {
    if (this.level <= LogLevel.DEBUG) {
      const formatted = this.formatMessage('debug', message, data);
      logger.info(this.addColor('debug', formatted));
    }
  }

  /**
   * 信息日志
   */
  info(message, data) {
    if (this.level <= LogLevel.INFO) {
      const formatted = this.formatMessage('info', message, data);
      logger.info(this.addColor('info', formatted));
    }
  }

  /**
   * 警告日志
   */
  warn(message, data) {
    if (this.level <= LogLevel.WARN) {
      const formatted = this.formatMessage('warn', message, data);
      logger.info(this.addColor('warn', formatted));
    }
  }

  /**
   * 错误日志
   */
  error(message, data) {
    if (this.level <= LogLevel.ERROR) {
      const formatted = this.formatMessage('error', message, data);
      logger.info(this.addColor('error', formatted));
    }
  }

  /**
   * 性能日志
   */
  performance(operation, duration, threshold = 1000) {
    const level = duration > threshold ? 'warn' : 'info';
    const message = `${operation} 耗时: ${duration}ms`;

    if (level === 'warn') {
      this.warn(message, { threshold, duration });
    } else {
      this.info(message);
    }
  }

  /**
   * 创建子日志器
   */
  child(prefix) {
    return new Logger({
      level: this.level,
      prefix: `${this.prefix}.${prefix}`,
      enableColors: this.enableColors
    });
  }
}

// 重要：延迟实例化 logger，避免在导入时立即执行构造函数
let _loggerInstance = null;

// 获取 logger 实例的函数
export function getLogger() {
  if (!_loggerInstance) {
    _loggerInstance = new Logger();
  }
  return _loggerInstance;
}

// 兼容性导出（但避免在模块顶部实例化）
export const logger = getLogger();

export default {
  LogLevel,
  Logger,
  logger,
  getLogger
};
