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
      this.level = config.level || (__ENV.LOG_LEVEL ? 
        LogLevel[__ENV.LOG_LEVEL.toUpperCase()] : LogLevel.INFO);
      this.prefix = config.prefix || 'K6';
      this.enableColors = config.enableColors !== false;
      this.vuId = __VU || 0;
      this.iterId = __ITER || 0;
    }
  
    /**
     * 格式化消息
     */
    formatMessage(level, message, data) {
      const timestamp = new Date().toISOString();
      const levelStr = level.toUpperCase().padEnd(5);
      const prefix = `[${timestamp}] [${levelStr}] [VU${this.vuId.toString().padStart(3, '0')}-ITER${this.iterId}] ${this.prefix}:`;
      
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
        info: '\x1b[32m',  // 绿色
        warn: '\x1b[33m',  // 黄色
        error: '\x1b[31m'  // 红色
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
        console.log(this.addColor('debug', formatted));
      }
    }
  
    /**
     * 信息日志
     */
    info(message, data) {
      if (this.level <= LogLevel.INFO) {
        const formatted = this.formatMessage('info', message, data);
        console.log(this.addColor('info', formatted));
      }
    }
  
    /**
     * 警告日志
     */
    warn(message, data) {
      if (this.level <= LogLevel.WARN) {
        const formatted = this.formatMessage('warn', message, data);
        console.log(this.addColor('warn', formatted));
      }
    }
  
    /**
     * 错误日志
     */
    error(message, data) {
      if (this.level <= LogLevel.ERROR) {
        const formatted = this.formatMessage('error', message, data);
        console.log(this.addColor('error', formatted));
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
  
  // 创建默认日志器实例
  export const logger = new Logger();
  
  export default {
    LogLevel,
    Logger,
    logger
  };
  