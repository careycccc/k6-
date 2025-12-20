import { group, check } from 'k6';
import { Rate } from 'k6/metrics';
import { httpClient } from '../../libs/http/client.js';
import { signatureUtil } from '../../libs/utils/signature.js';
import { logger } from '../../libs/utils/logger.js';
import { getSignatureConfig } from '../../config/signature.js';

// 自定义指标
const signatureFailureRate = new Rate('signature_failures');
const requestFailureRate = new Rate('request_failures');

// 测试选项
export const options = {
  scenarios: {
    signature_validation: {
      executor: 'shared-iterations',
      vus: 5,
      iterations: 100,
      maxDuration: '10m',
      gracefulStop: '30s',
      exec: 'testSignatureLogic'
    },
    api_with_signature: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 10 }
      ],
      gracefulRampDown: '30s',
      exec: 'testApiWithSignature'
    }
  },
  
  thresholds: {
    'http_req_duration{type:signature}': ['p(95)<1000'],
    'signature_failures': ['rate<0.01'],
    'request_failures': ['rate<0.05'],
    'checks': ['rate>0.95']
  },
  
  tags: {
    test_type: 'signature',
    feature: 'authentication'
  }
};

// 签名测试数据准备
const testData = [
  {
    userId: 1001,
    userName: 'user1',
    amount: 100.00,
    orderNo: 'ORDER_001'
  },
  {
    userId: 1002,
    userName: 'user2',
    amount: 200.50,
    orderNo: 'ORDER_002',
    extraField: 'extra_value'
  },
  {
    userId: 1003,
    userName: 'user3',
    amount: 300.75,
    orderNo: 'ORDER_003',
    nullField: null,
    emptyField: '',
    arrayField: [1, 2, 3]
  }
];

export function setup() {
  logger.info('签名测试初始化开始');
  
  // 获取签名配置
  const signatureConfig = getSignatureConfig();
  logger.info('签名配置', signatureConfig);
  
  // 设置 HTTP 客户端的签名密钥
  httpClient.setVerifyPwd(signatureConfig.verifyPwd);
  
  logger.info('签名测试初始化完成');
  return { signatureConfig, testData };
}

// 测试签名逻辑
export function testSignatureLogic(data) {
  const { signatureConfig, testData } = data;
  const testCase = testData[__ITER % testData.length];
  
  group('签名逻辑测试', () => {
    // 测试 1: 基本签名生成
    const signedData = signatureUtil.signRequest(testCase, {
      verifyPwd: signatureConfig.verifyPwd
    });
    
    check(signedData, {
      '签名字段存在': () => signedData.signature !== undefined,
      '签名字段不为空': () => signedData.signature !== '',
      '时间戳字段存在': () => signedData.timestamp !== undefined,
      '排除字段被过滤': () => 
        signedData.nullField === undefined && 
        signedData.emptyField === undefined &&
        signedData.arrayField === undefined
    });
    
    // 测试 2: 签名验证
    const isValid = signatureUtil.verifySignature(
      signedData, 
      signatureConfig.verifyPwd
    );
    
    check(null, {
      '签名验证通过': () => isValid === true
    });
    
    if (!isValid) {
      signatureFailureRate.add(1);
      logger.error('签名验证失败', { data: signedData });
    }
    
    // 测试 3: 篡改数据后签名失效
    const tamperedData = { ...signedData, amount: 999.99 };
    const tamperedValid = signatureUtil.verifySignature(
      tamperedData,
      signatureConfig.verifyPwd
    );
    
    check(null, {
      '篡改数据后签名失效': () => tamperedValid === false
    });
    
    // 测试 4: 相同数据生成相同签名
    const signedData2 = signatureUtil.signRequest(testCase, {
      verifyPwd: signatureConfig.verifyPwd
    });
    
    check(null, {
      '相同数据生成相同签名': () => signedData.signature === signedData2.signature
    });
  });
}

// 测试带签名的 API 请求
export function testApiWithSignature(data) {
  const { signatureConfig } = data;
  
  group('带签名的 API 测试', () => {
    // 生成测试数据
    const requestData = {
      userId: __VU * 1000 + __ITER,
      userName: `test_user_${__VU}_${__ITER}`,
      amount: 100 + (__ITER % 100),
      orderNo: `ORDER_${Date.now()}_${__VU}_${__ITER}`,
      productId: `PROD_${__ITER % 10 + 1}`
    };
    
    // 测试 POST 请求（自动签名）
    const postResponse = httpClient.post('/api/orders', requestData, {
      tags: { type: 'signature', method: 'POST' },
      sign: true, // 启用签名
      signOptions: {
        verifyPwd: signatureConfig.verifyPwd
      }
    });
    
    check(postResponse, {
      'POST 请求成功': () => postResponse.success === true,
      '响应状态码为 200': () => postResponse.status === 200
    });
    
    if (!postResponse.success) {
      requestFailureRate.add(1);
    }
    
    // 测试 GET 请求带参数签名
    const getParams = {
      userId: requestData.userId,
      orderNo: requestData.orderNo,
      timestamp: Date.now()
    };
    
    const getResponse = httpClient.get('/api/orders', getParams, {
      tags: { type: 'signature', method: 'GET' },
      sign: true,
      signOptions: {
        verifyPwd: signatureConfig.verifyPwd
      }
    });
    
    check(getResponse, {
      'GET 请求成功': () => getResponse.success === true
    });
    
    // 测试批量请求
    const batchRequests = [
      {
        method: 'POST',
        endpoint: '/api/users',
        body: {
          name: `batch_user_${__VU}_${__ITER}_1`,
          email: `batch1_${__VU}_${__ITER}@test.com`
        },
        sign: true
      },
      {
        method: 'POST',
        endpoint: '/api/products',
        body: {
          name: `batch_product_${__VU}_${__ITER}_1`,
          price: 99.99
        },
        sign: true
      }
    ];
    
    const batchResponses = httpClient.batch(batchRequests, {
      signOptions: {
        verifyPwd: signatureConfig.verifyPwd
      }
    });
    
    check(null, {
      '批量请求完成': () => batchResponses.length === 2,
      '批量请求全部成功': () => batchResponses.every(r => r.success)
    });
  });
}

// 默认导出函数
export default function(data) {
  // 根据场景执行不同的测试
  if (__ENV.TEST_SCENARIO === 'signature_logic') {
    testSignatureLogic(data);
  } else {
    testApiWithSignature(data);
  }
}
