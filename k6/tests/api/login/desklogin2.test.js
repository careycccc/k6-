// desklogin.test.js - 彻底稳定版
import http from 'k6/http';
import { group } from 'k6';
import { Rate } from 'k6/metrics';
import { getEnvironment } from '../../../config/environment.js';
import { logger } from '../../../libs/utils/logger.js';

import { getSignature } from '../../../libs/utils/signature2.js';

// 自定义指标：登录成功率
const loginFailureRate = new Rate('login_success_requests');

export function setup() {
  const env = getEnvironment();
  logger.info(`测试环境: ${env.name} (${env.baseUrl})`);
}

export function testLoginteUser(data) {
  group('用户登录', () => {
    const url = 'https://arplatsaassit1.club/api/Home/Login'; // 替换成真实 URL
    const dataObj = { ...data }; // 创建数据对象的副本
    // payload进行签名
    const requestPayload = getSignature(dataObj, '');
    // 添加签名到数据对象
    dataObj.signature = requestPayload;
    const payload = JSON.stringify(dataObj); // 最后转换为字符串

    console.log('requestPayload:++++++++', payload);
    const params = {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'login' }
    };

    const response = http.post(url, payload, params);
    const status = response.status;
    const body = JSON.parse(response.body);

    console.log('status:', status);
    console.log('code:', body.code);
    console.log('body:', body);

    const success = status === 200 && body.code === 0;

    if (success) {
      logger.info('登录成功！（原生 http）');
      loginFailureRate.add(true);
    } else {
      logger.error('登录失败');
      loginFailureRate.add(false);
    }
  });
}

export default function (data) {
  testLoginUser(data);
}

export function teardown() {
  logger.info('=== 测试清理完成 ===');
}
