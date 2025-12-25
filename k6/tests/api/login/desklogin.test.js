// desklogin.test.js - 简单稳定压测版（不收集 token）
import { group } from 'k6';
import { Rate } from 'k6/metrics';
import { httpClient } from '../../../libs/http/client.js';
import { getEnvironment } from '../../../config/environment.js';
import { ApiChecks } from '../../../libs/checks/apiChecks.js';
import { logger } from '../../../libs/utils/logger.js';

// 自定义指标：登录成功率（add(true) 表示成功）
const loginSuccessRate = new Rate('login_success_requests');

let checkCounter = 0;

export function setup() {
  const env = getEnvironment();
  logger.info(`测试环境: ${env.name} (${env.baseUrl})`);
}

export function testLoginteUser(data) {
  logger.info('本次登录测试数据:', data);

  checkCounter = 0;

  group('用户登录流程 - 单次请求', () => {
    const startTime = Date.now();

    try {
      logger.info('正在发送登录请求...');

      const response = httpClient.post('/api/Home/Login', data, {
        tags: { type: 'login' }
      });

      const duration = Date.now() - startTime;
      logger.info(`请求完成，耗时: ${duration}ms`);

      // === 安全访问响应信息 ===
      console.log('=== 响应基础信息 ===');
      console.log('status:', response?.status || '无');
      console.log('has body:', !!response?.body);

      let businessSuccess = false;

      if (response?.body && typeof response.body === 'string') {
        try {
          const parsedBody = JSON.parse(response.body);

          // console.log('业务 code:', parsedBody.code ?? '无');
          // console.log('业务 msg:', parsedBody.msg || '无');
          // console.log('data 字段存在:', !!parsedBody.data);
          // console.log('token 字段存在:', !!parsedBody.data?.token);

          if (parsedBody.code === 0 && parsedBody.data?.token) {
            businessSuccess = true;
            console.log('token 前30位:', parsedBody.data.token.substring(0, 30) + '...');
            logger.info('登录成功！');
          } else {
            logger.warn('业务响应成功但缺少 token 或 code 不为 0');
          }
        } catch (parseError) {
          console.log('JSON 解析失败:', parseError.message);
          logger.error('响应体无法解析为 JSON');
        }
      } else {
        logger.warn('响应体为空或非字符串');
      }

      // 执行 ApiChecks
      let checkPassed = false;
      try {
        checkPassed = ApiChecks.loginChecks(response);
        checkCounter++;
      } catch (checkError) {
        console.log('ApiChecks 执行异常:', checkError.message);
      }

      const httpSuccess = response?.status >= 200 && response?.status < 300;
      const overallSuccess = httpSuccess && businessSuccess && checkPassed;

      // 记录成功率指标
      loginSuccessRate.add(overallSuccess);

      if (overallSuccess) {
        logger.info('登录完全成功（HTTP + 业务 + 检查）');
      } else {
        logger.error('登录失败', { httpSuccess, businessSuccess, checkPassed });
      }

      // 响应体预览（调试用）
      if (response?.body && typeof response.body === 'string') {
        const preview = response.body.substring(0, 500);
        console.log('响应体预览:', preview + (response.body.length > 500 ? '...' : ''));
      }
    } catch (error) {
      console.log('请求异常:', String(error));
      loginSuccessRate.add(false);
      logger.error('登录请求异常');
    }
  });

  logger.info('=== 本次登录迭代结束 ===');
}

export function teardown() {
  logger.info(`=== 测试清理完成，共执行了 ${checkCounter} 次检查 ===`);
}
