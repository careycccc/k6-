import { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';
import { validateResponse } from '../zodValidator.js';
import { logger } from '../utils/logger.js';
import { thresholds } from '../../config/thresholds.js';

/**
 * 使用 Chai BDD 风格的 API 检查工具类
 */
export class ApiChecks {
  /**
   * 安全的响应时间检查（返回布尔值）
   */
  static safeDurationCheck(response, maxDuration = 2000) {
    if (!response || !response.timings || typeof response.timings.duration === 'undefined') {
      logger.warn('无法获取响应时间', {
        hasResponse: !!response,
        hasTimings: !!response?.timings,
        duration: response?.timings?.duration
      });
      return true; // 不阻塞整体测试
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
      if (response.success !== undefined) {
        return response.success === true;
      }
      const status = response.status || 0;
      return status >= 200 && status < 400;
    } catch (error) {
      logger.error('检查success属性时出错:', error.message);
      return false;
    }
  }

  /**
   * 使用 Chai 进行全面响应检查
   * 返回 true 表示所有断言通过，false 表示有失败
   */
  static ResponseChecks(response, tag) {
    let allPassed = true;

    describe('API 响应全面检查', () => {
      // 1. 基础对象有效性
      try {
        expect(response, 'response 应为对象').to.be.an('object');
      } catch (e) {
        allPassed = false;
        logger.warn('基础对象检查失败:', e.message);
      }

      // 2. HTTP 基础检查
      describe('HTTP 基础状态', () => {
        try {
          expect(this.safeStatusCodeCheck(response, 200), 'HTTP 状态码应为 200').to.be.true;
        } catch (e) {
          allPassed = false;
          logger.warn('状态码检查失败:', e.message);
        }

        // try {
        //   expect(
        //     this.safeSuccessCheck(response),
        //     '请求应标记为成功（success === true 或 2xx 状态码）'
        //   ).to.be.true;
        // } catch (e) {
        //   allPassed = false;
        //   logger.warn('请求成功检查失败:', e.message);
        // }

        try {
          const maxDur = thresholds.THRESHOLD_REQUEST_DURATION;
          expect(this.safeDurationCheck(response, maxDur), '响应时间应在阈值内').to.be.true;
        } catch (e) {
          allPassed = false;
          logger.warn('响应时间检查失败:', e.message);
        }
        // 额外：若传入 tag，则执行结构化校验
        try {
          if (tag) {
            let parsedBody = null;
            if (response?.body) {
              try {
                parsedBody =
                  typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
              } catch {
                parsedBody = null;
              }
            }
            if (parsedBody) {
              const valid = validateResponse(tag, parsedBody);
              if (!valid) allPassed = false;
            }
          }
        } catch (err) {
          allPassed = false;
          logger.warn('额外的 zod 校验失败:', err.message);
        }
      });

      // 3. 响应体检查
      describe('响应体结构与内容', () => {
        if (!response.body) {
          allPassed = false;
          try {
            expect(response.body, '响应体不应为空').to.exist;
          } catch (e) {
            allPassed = false;
            logger.warn('响应体为空:', e.message);
          }
          return;
        }

        try {
          expect(response.body, '响应体存在').to.exist;
        } catch (e) {
          allPassed = false;
          logger.warn('响应体存在性检查失败:', e.message);
        }

        let parsedBody = null;

        // 解析 body（字符串或已解析对象）
        if (typeof response.body === 'string') {
          try {
            parsedBody = JSON.parse(response.body);
            //logger.info('成功解析 JSON 响应体');
          } catch (e) {
            allPassed = false;
            try {
              expect.fail('响应体应为有效 JSON 格式');
            } catch (ex) {
              allPassed = false;
              logger.warn('JSON解析失败:', e.message);
            }
          }
        } else if (typeof response.body === 'object') {
          parsedBody = response.body;
        } else {
          allPassed = false;
          try {
            expect(response.body, '响应体应为字符串或对象').to.satisfy(
              (val) => typeof val === 'string' || typeof val === 'object'
            );
          } catch (e) {
            allPassed = false;
            logger.warn('响应体类型检查失败:', e.message);
          }
        }

        if (!parsedBody || typeof parsedBody !== 'object') {
          return;
        }

        // 4. 业务字段检查
        // 4. 业务字段检查
        describe('业务返回字段', () => {
          // 检查code字段
          if ('code' in parsedBody) {
            try {
              expect(parsedBody.code, '业务 code 应为 0（成功）').to.equal(0);
            } catch (e) {
              allPassed = false;
              logger.warn('业务code检查失败:', {
                expected: 0,
                actual: parsedBody.code,
                message: e.message
              });
            }
          } else {
            allPassed = false;
            try {
              expect(parsedBody, '响应中应包含 code 字段').to.have.property('code');
            } catch (e) {
              allPassed = false;
              logger.warn('缺少code字段:', e.message);
            }
          }

          // 检查msg字段（可选，不是必需的）
          if ('msg' in parsedBody) {
            try {
              expect(parsedBody.msg, 'msg 字段应为 "Succeed"').to.equal('Succeed');
            } catch (e) {
              allPassed = false;
              logger.warn('msg字段检查失败:', {
                expected: 'Succeed',
                actual: parsedBody.msg,
                message: e.message
              });
            }
          }

          // 检查msgcode字段（可选，不是必需的）
          if ('msgCode' in parsedBody) {
            try {
              expect(parsedBody.msgCode, 'msgCode 应为数字').to.be.a('number');
            } catch (e) {
              allPassed = false;
              logger.warn('msgCode字段检查失败:', e.message);
            }
          }

          // 检查data字段（如果存在）
          if ('data' in parsedBody) {
            try {
              expect(parsedBody.data, 'data 字段不应为空').to.not.be.oneOf([null, undefined, '']);
            } catch (e) {
              allPassed = false;
              logger.warn('data字段检查失败:', e.message);
            }

            // 如果data是数组，检查数组不为空
            if (Array.isArray(parsedBody.data)) {
              try {
                expect(parsedBody.data, 'data 数组不应为空').to.have.lengthOf.above(0);
              } catch (e) {
                allPassed = false;
                logger.warn('data数组长度检查失败:', e.message);
              }
            }
            // 如果data是对象且包含token，检查token
            else if (
              typeof parsedBody.data === 'object' &&
              parsedBody.data !== null &&
              'token' in parsedBody.data
            ) {
              try {
                expect(parsedBody.data.token, 'token 应为非空字符串').to.be.a('string').and.to.not
                  .be.empty;
              } catch (e) {
                allPassed = false;
                logger.warn('token检查失败:', e.message);
              }
            }
          }
        });
      });
    });

    // 记录最终结果
    logger.info(`Chai 检查总体结果: ${allPassed ? '全部通过' : '存在失败项'}`);

    return allPassed;
  }
}

export default ApiChecks;
