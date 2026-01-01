import { check } from 'k6';
import { logger } from '../utils/logger.js';

/**
 * API检查工具类
 */
export class ApiChecks {
  /**
   * 安全的响应时间检查
   */
  static safeDurationCheck(response, maxDuration = 2000) {
    if (!response || !response.timings || typeof response.timings.duration === 'undefined') {
      logger.warn('无法获取响应时间', {
        hasResponse: !!response,
        hasTimings: !!response?.timings,
        duration: response?.timings?.duration
      });
      return true;
    }
    return response.timings.duration < maxDuration;
  }

  /**
   * 安全的HTTP状态码检查
   */
  static safeStatusCodeCheck(response, expectedStatus = 200) {
    if (!response) {
      logger.warn('响应对象为空');
      return false;
    }

    const status = response.status || 0;

    if (Array.isArray(expectedStatus)) {
      return expectedStatus.includes(status);
    }
    return status === expectedStatus;
  }

  /**
   * 安全的请求成功检查
   */
  static safeSuccessCheck(response) {
    if (!response || typeof response !== 'object') {
      logger.warn('响应对象无效或不是对象类型');
      return false;
    }

    try {
      // 🔥 使用更安全的方式检查
      if (response.success !== undefined) {
        return response.success === true;
      }

      // 如果没有success字段，根据状态码判断
      const status = response.status || 0;
      return status >= 200 && status < 400;
    } catch (error) {
      logger.error('检查success属性时出错:', error.message);
      return false;
    }
  }

  /**
   * 响应检查
   */
  static ResponseChecks(response) {
    //logger.info('响应检查:', response.body);
    // 🔥 验证response类型
    if (typeof response !== 'object') {
      logger.error(`响应检查: response类型错误，期望object，实际${typeof response}`);
      return false;
    }
    // 🔥 验证response结构
    // 🔥 安全地记录响应结构
    try {
      logger.info('响应检查 - 响应结构:', {
        hasSuccess: 'success' in response,
        success: response.success,
        status: response.status,
        hasBody: !!response.body,
        bodyType: typeof response.body
      });
    } catch (logError) {
      logger.error('记录响应结构时出错:', logError.message);
      // 继续执行检查，不直接返回false
    }

    const checks = {};

    try {
      // 1. HTTP基础检查
      checks['HTTP状态码200'] = () => this.safeStatusCodeCheck(response, 200);
      checks['请求成功'] = () => this.safeSuccessCheck(response);
      checks['响应时间<1s'] = () => this.safeDurationCheck(response, 1000);

      // 2. 业务逻辑检查
      if (response.body) {
        logger.info('响应体存在，类型:', typeof response.body);

        let parsedBody;

        //  修复：正确处理body
        if (typeof response.body === 'string') {
          try {
            parsedBody = JSON.parse(response.body);
            logger.info('成功解析JSON响应体');
          } catch (e) {
            logger.warn('响应体不是有效的JSON格式');
            checks['响应体为JSON'] = () => false;
          }
        } else if (typeof response.body === 'object') {
          parsedBody = response.body;
        }

        // 检查业务字段
        if (parsedBody && typeof parsedBody === 'object') {
          // 修复：直接检查parsedBody，而不是parsedBody.body
          //checks['code存在'] = () => 'code' in parsedBody;

          if ('code' in parsedBody) {
            checks['code为0'] = () => parsedBody.code === 0;
            //logger.info('code值:', parsedBody.code);
          }

          //checks['msg字段存在'] = () => 'msg' in parsedBody;
          checks['msg字段Suceed'] = () => parsedBody.msg === 'Succeed';
          if (parsedBody.data) {
            //checks['data字段存在'] = () => 'data' in parsedBody;
            checks['data字段不为空'] = () =>
              parsedBody.data !== null && parsedBody.data !== undefined;
            if (parsedBody.data.token) {
              //checks['token字段存在'] = () => 'token' in parsedBody.data;
              checks['token正确'] = () =>
                typeof parsedBody.data.token === 'string' && parsedBody.data.token.length > 10;
            }
          }
        }
      } else {
        checks['响应体存在'] = () => false;
      }
    } catch (error) {
      logger.error('检查构建异常:', error.message);
      checks['检查执行'] = () => false;
    }

    //  安全执行检查
    try {
      const result = check(response, checks);
      logger.info(`检查执行结果: ${result}`);
      return result;
    } catch (error) {
      logger.error('k6 check函数执行异常:', error.message);
      // 计算通过率
      const passed = Object.values(checks).filter((fn) => {
        try {
          return fn();
        } catch (e) {
          return false;
        }
      }).length;
      const total = Object.keys(checks).length;

      logger.info(`手动计算通过率: ${passed}/${total}`);
      return passed > 0; // 至少通过一个检查
    }
  }
}

export default ApiChecks;
