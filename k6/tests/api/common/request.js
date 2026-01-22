import { group } from 'k6';
import { Rate } from 'k6/metrics';
import { httpClient } from '../../../libs/http/client.js';
import { getEnvironment } from '../../../config/environment.js';
import { ApiChecks } from '../../../libs/checks/apiChecks.js';
import { logger } from '../../../libs/utils/logger.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { getTimeRandom } from '../../utils/utils.js';
import { ENV_CONFIG } from '../../../config/envconfig.js';

let checkCounter = 0;
const ResponseSuccessRate = new Rate('Response_success_rate');

export function setup() {
  const env = getEnvironment();
  logger.info(`测试环境: ${env.name} (${env.baseUrl})`);
}
// 登录成功的token
let Token = '';
// 返回数据
let ResponseData = null;
// 响应结果
let ResponseResult = null;

/***
 * data  请求的数据
 * api 请求的接口
 * tag 请求的标签
 * CustomMetrics 自定义指标名称
 */
export function testCommonRequest(data, api, tag, isDesk = true, token = '') {
  // logger.info('本次请求测试数据:', data);
  checkCounter = 0;

  group('请求流程', () => {
    const startTime = Date.now();

    try {
      // logger.info('正在发送请求...', {
      //   api: api,
      //   requestData: data,
      //   isDesk: isDesk
      // });
      if (token) {
        httpClient.setAuthToken(token);
      }
      const response = httpClient.post(
        api,
        data,
        {
          params: {
            tags: { type: tag, name: `${tag}_request` }
          }
        },
        isDesk
      );
      const duration = Date.now() - startTime;
      //logger.info(`请求完成，耗时: ${duration}ms`);
      // 🔥 添加防御性检查
      if (!response) {
        ResponseSuccessRate.add(false);
        logger.error(`${api} 响应检查: response为空`);
        return;
      }
      // 添加响应体检查
      if (!response.body) {
        ResponseSuccessRate.add(false);
        logger.error(`${api} 响应体为空`, {
          status: response.status,
          statusText: response.status_text
        });
        return;
      }
      // 执行 ApiChecks
      let checkPassed = false;
      try {
        checkPassed = ApiChecks.ResponseChecks(response);
        checkCounter++;
      } catch (checkError) {
        logger.error(`${api} ApiChecks.ResponseChecks 执行异常`, checkError.message);
      }
      // 记录成功率指标
      ResponseSuccessRate.add(checkPassed);

      const overallSuccess = checkPassed && response.status >= 200 && response.status < 300;

      if (overallSuccess) {
        //logger.info('响应完全成功(HTTP + 业务 + 检查)');
      } else {
        logger.error(`${api} 响应失败`, {
          status: response.status,
          checkPassed
        });
      }
      // console.log('请求结果', response)
      // 响应体预览（调试用）
      if (response?.body && typeof response.body === 'string') {
        try {
          // 检查响应是否为 JSON
          if (response.body.startsWith('{') || response.body.startsWith('[')) {
            const parsedBody = JSON.parse(response.body);
            ResponseResult = parsedBody || null;
            console.log('----------', parsedBody.data)
            Token = parsedBody.data?.token || '';
            ResponseData = parsedBody.data || null;
          } else {
            // 非 JSON 响应的处理
            logger.info('非 JSON 响应:', response.body.substring(0, 100));
          }
        } catch (parseError) {
          logger.error('响应解析失败:', parseError.message);
          logger.info('原始响应:', response.body.substring(0, 100));
        }
      }
    } catch (error) {
      // 修复错误日志显示 [object Object] 的问题
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object'
            ? JSON.stringify(error)
            : String(error);
      logger.error(`${api} 请求异常`, errorMessage);
      ResponseSuccessRate.add(false);
    }
  });
  //logger.info('=== 本次迭代结束 ===');
  // return Token;
  if (Token) {
    return Token;
  } else if (ResponseData) {
    return ResponseData;
  } else {
    return ResponseResult;
  }
}

/*
@param {string} api - 请求的API地址
@param {object} payload - 请求的参数
@param {string} tag - 请求的标签
@param {string} token - 请求体的token
**/
export function sendRequest(payload, api, tag, isDesk, token) {
  const timeData = getTimeRandom();
  const data = {
    random: timeData.random,
    language: timeData.language,
    signature: '',
    timestamp: timeData.timestamp,
    ...payload
  };
  console.log('请求的data', data)
  const Reponsetoken = testCommonRequest(data, api, tag, isDesk, token);
  return Reponsetoken;
}

/*
发送查询请求
@param {string} api - 请求的API地址
@param {object} payload - 请求的参数
@param {string} tag - 请求的标签
@param {string} token - 请求体的token
**/
export function sendQueryRequest(payload, api, tag, isDesk, token) {
  const timeData = getTimeRandom();
  const data = {
    pageNo: ENV_CONFIG.PAGENO,
    pageSize: ENV_CONFIG.PAGESIZE,
    orderBy: 'Desc',
    random: timeData.random,
    language: timeData.language,
    signature: '',
    timestamp: timeData.timestamp,
    ...payload
  };
  const Reponsetoken = testCommonRequest(data, api, tag, isDesk, token);
  return Reponsetoken;
}

export function teardown() {
  logger.info(`=== 测试清理完成，共执行了 ${checkCounter} 次检查 ===`);
}

// ============ 报告生成 ============
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testName = '压测';
  const environment = __ENV.ENVIRONMENT || 'local';
  return {
    // 使用textSummary函数处理data数据，并输出格式化后的结果
    // textSummary函数接受两个参数：原始数据data和配置选项对象
    // 配置选项对象包含以下属性：
    //   - indent: 设置缩进为空格字符
    //   - enableColors: 启用颜色显示，使输出更加直观
    stdout: textSummary(data, { indent: ' ', enableColors: true }),

    [`reports/${testName}-${environment}-${timestamp}-report.html`]: htmlReport(data, {
      title: `${testName} - ${environment}`
    })
  };
}
