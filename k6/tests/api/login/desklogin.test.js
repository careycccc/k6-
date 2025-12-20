import { group, check } from 'k6';
import { Rate } from 'k6/metrics';
import { httpClient } from '../../../libs/http/client.js';
import { baseObject } from '../../utils/utils.js'
import { getEnvironment } from '../../../config/environment.js';
import { ApiChecks } from '../../../libs/checks/apiChecks.js';
import { responseRules } from '../../../tests/utils/utils.js';


// 前台登录
const loginObject = {
    userName: { type: 'string' },
    password: { type: 'string' },
    loginType: { type: 'string' },
    deviceId: { type: 'string' },
    browserId: { type: 'string' },
    packageName: { type: 'string' },
}



loginObject = Object.assign(loginObject, baseObject);


// 自定义指标
const failureRate = new Rate('failed_requests');

const userLoginSchema = {
    type: 'object',
    required: ['userName', 'password'],
    properties: loginObject,
}

// 测试选项
export const options = {
    scenarios: {
      create_user_load: {
        // 执行器配置
        // 执行器类型设置为恒定虚拟用户数
        executor: 'constant-vus',
        startVUs: 1,
        stages: [
          { duration: '1s', target: 1 },
        //   { duration: '1m', target: 50 },
        //   { duration: '30s', target: 10 }
        ],
// 优雅关闭的降级时间设置为30秒
        gracefulRampDown: '5s',
        exec: 'testLoginteUser'
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
      service: 'userLogin',
      // 设置测试操作为创建操作
      operation: 'login'
    }
};

export function setup() {
    logger.info('测试初始化开始');
    
    const env = getEnvironment();
    logger.info(`测试环境: ${env.name}`);
}

export function testLoginteUser(data){
    // 如果data不是一个对象就直接结束
    if (typeof data !== 'object') {
        return;
    }
    // const {userName,password,loginType} = data
    group('用户登录流程', () => {
        const testUserLogin = {
            ...data
        }
    
        const response = httpClient.post(`/api/Home/Login`, testUserLogin, {
            tags: { type: 'login' },
            schema: userLoginSchema
        })
        // 记录失败
        failureRate.add(!response.success)
        // 执行检查
        const checks = ApiChecks.httpChecks(response, {
    /**
     * 预期状态码和最大持续时间配置
     * 这两个参数通常用于API测试或请求验证
     */
            expectedStatus: 200,  // 预期的HTTP状态码为200（表示资源创建成功）
            maxDuration: 2000    // 请求的最大允许持续时间（毫秒），超过此时间则判定为超时
        });
        // 响应逻辑检查
        if (response.success && response.body) {
            const businessChecks = ApiChecks.businessChecks(response, responseRules);
            if (!businessChecks) {
                logger.error('响应逻辑检查失败', {
                request: testUser,
                response: response.body
                });
            }
        }
        // 验证响应数据
        if (response.success) {
            check(response, {
            '用户登录成功': () => response.status === 200,
            });
        }
    })
}



