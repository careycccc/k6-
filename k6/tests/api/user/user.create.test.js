import { group, check } from 'k6';
import { Rate } from 'k6/metrics';
import { httpClient } from '../../../libs/http/client.js';
import { tokenManager } from '../../../libs/auth/tokenManager.js';
import { dataGenerator } from '../../../libs/data/dataGenerator.js';
import { logger } from '../../../libs/utils/logger.js';
import { ApiChecks } from '../../../libs/checks/apiChecks.js';
import { getEnvironment } from '../../../config/environment.js';

// 自定义指标
const failureRate = new Rate('failed_requests');

// 用户Schema
const userSchema = {
/**
 * 定义一个JSON Schema对象，用于描述用户数据结构
 * 该Schema规定了用户对象必须包含的字段及其数据类型和约束条件
 */
  type: 'object',  // 指定此Schema描述的是一个对象类型
// 定义必填字段数组
  required: ['id', 'username', 'email', 'createdAt'],  // 这些字段是必须提供的，不能为空
  properties: {
    id: { type: 'number' },
    username: { type: 'string' },
    email: { type: 'string', format: 'email' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    age: { type: 'number', minimum: 0 },
    active: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' }
  }
};

// 测试选项
export const options = {
  scenarios: {
    create_user_load: {
// 执行器配置
// 指定使用渐进式虚拟用户执行器
// 这种执行器会随时间逐步增加虚拟用户数量，适合模拟真实用户场景的增长过程
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 10 }
      ],
      gracefulRampDown: '30s',
      exec: 'testCreateUser'
    }
  },
  
  thresholds: {
    'http_req_duration{type:create}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_failed{type:create}': ['rate<0.01'],
    'failed_requests': ['rate<0.05'],
    'checks': ['rate>0.95']
  },
  
  tags: {
    // 配置测试类型为API测试
    test_type: 'api',
    // 指定测试服务的名称为user
    service: 'user',
    // 设置测试操作为创建操作
    operation: 'create'
  }
};

// 测试数据准备
let testData = [];

export function setup() {
  logger.info('测试初始化开始');
  
  const env = getEnvironment();
  logger.info(`测试环境: ${env.name}`);
  
  // 生成测试数据
  testData = dataGenerator.generateBatch(
    dataGenerator.generateUser,
    1000
  );
  
  // 获取认证token
  const credentials = {
    username: __ENV.TEST_USER || 'admin',
    password: __ENV.TEST_PASSWORD || 'password'
  };
  
  let authToken;
  try {
    authToken = tokenManager.getToken(credentials);
    httpClient.setAuthToken(authToken);
  } catch (error) {
    logger.error('认证失败', error.message);
    throw error;
  }
  
  logger.info('测试初始化完成', { 
    dataCount: testData.length,
    environment: env.name 
  });
  
  return { authToken, testData };
}

// 清理函数
export function teardown(data) {
  logger.info('测试清理开始');
  // 清理测试数据等操作
  logger.info('测试清理完成');
}

// 主要测试函数
export function testCreateUser(data) {
  const { testData } = data;
// 从测试数据数组中获取当前迭代次数对应的数据
// 使用取模运算符(%)确保索引在数组范围内循环
  const userData = testData[__ITER % testData.length];
  
  group('用户创建流程', () => {
    // 生成唯一的测试数据
    const testUser = {
      ...userData,
      // 使用模板字符串生成唯一的用户名
      // 格式为: testuser_当前时间戳_虚拟用户ID_迭代次数
      // 生成唯一的用户名
      // 格式为：testuser_ + 时间戳 + VU ID + 迭代次数
      // Date.now() 获取当前时间戳
      // __VU 表示虚拟用户(Virtual User)的编号
      // __ITER 表示当前迭代次数
      username: `testuser_${Date.now()}_${__VU}_${__ITER}`,
      email: `test_${Date.now()}_${__VU}_${__ITER}@test.com`
    };
    
    // 发送创建用户请求
    const response = httpClient.post('/users', testUser, {
      tags: { type: 'create' },
      schema: userSchema
    });
    
    // 记录失败
    failureRate.add(!response.success);
    
    // 执行检查
    const checks = ApiChecks.httpChecks(response, {
      expectedStatus: 201,
      maxDuration: 2000
    });
    
    // 业务逻辑检查
    if (response.success && response.body) {
      const businessChecks = ApiChecks.businessChecks(response, {
        expectedCode: 0,
        requiredFields: ['id', 'username', 'email'],
        customChecks: {
          '用户ID为数字': (data) => typeof data.id === 'number',
          '用户名匹配': (data) => data.username === testUser.username,
          '邮箱匹配': (data) => data.email === testUser.email
        }
      });
      
      if (!businessChecks) {
        logger.error('业务检查失败', {
          request: testUser,
          response: response.body
        });
      }
    }
    
    // 验证响应数据
    if (response.success) {
      check(response, {
        '创建用户成功': () => response.status === 201,
        '返回用户ID': () => response.body && response.body.id !== undefined,
        '返回创建时间': () => response.body && response.body.createdAt !== undefined,
        '用户状态为激活': () => response.body && response.body.active === true
      });
    }
  });
}

// 默认导出
export default function(data) {
  testCreateUser(data);
}
