import { check } from 'k6';
import { signatureUtil } from '../../libs/utils/signature.js';
import { logger } from '../../libs/utils/logger.js';

/**
 * 签名逻辑单元测试
 * 这个文件专门测试签名算法的正确性
 */

// 测试选项 - 只运行一次验证逻辑
export const options = {
  vus: 1,
  iterations: 1,
  duration: '30s',

  thresholds: {
    checks: ['rate>0.99'] // 检查通过率
  },

  tags: {
    test_type: 'unit',
    module: 'signature',
    purpose: 'algorithm_validation'
  }
};

// 测试数据
const testCases = [
  {
    name: '基本数据',
    data: {
      userId: 1001,
      userName: 'test_user',
      amount: 100.50,
      orderNo: 'ORDER_001'
    },
    verifyPwd: 'test_secret_123'
  },
  {
    name: '包含空值和数组',
    data: {
      userId: 1002,
      userName: 'user2',
      amount: 200.00,
      nullField: null,
      emptyField: '',
      arrayField: [1, 2, 3],
      nested: { key: 'value' }
    },
    verifyPwd: 'test_secret_456'
  },
  {
    name: '排除字段测试',
    data: {
      userId: 1003,
      signature: 'should_be_excluded',
      timestamp: 1234567890,
      track: 'tracking_id',
      amount: 300.75
    },
    verifyPwd: 'test_secret_789'
  },
  {
    name: '特殊字符',
    data: {
      userId: 1004,
      userName: 'user&name',
      description: 'test & "quotes" <html>',
      amount: 400.25
    },
    verifyPwd: 'test_secret_abc'
  }
];

// 用于验证的已知 MD5 值
const knownMd5Values = {
  'hello': '5d41402abc4b2a76b9719d911017c592',
  'test123': 'cc03e747a6afbbcbf8be7668acfebee5',
  '': 'd41d8cd98f00b204e9800998ecf8427e'
};

// 主测试函数
export default function () {
  // 在 K6 中，这些变量可以在 default 函数中访问
  const vu = __VU || 1;      // 当前虚拟用户 ID
  const iter = __ITER || 0;  // 当前迭代次数

  logger.info(`开始签名逻辑测试 (VU: ${vu}, Iter: ${iter})`);

  // 测试 1: 签名生成一致性
  testSignatureConsistency();

  // 测试 2: 字段过滤逻辑
  testFieldFiltering();

  // 测试 3: JSON 序列化
  testJsonSerialization();

  // 测试 4: MD5 计算
  testMd5Calculation();

  // 测试 5: 完整工作流程
  testCompleteWorkflow();

  logger.info('签名逻辑测试完成');
}

/**
 * 测试 1: 签名生成一致性
 * 相同数据应该生成相同签名
 */
function testSignatureConsistency() {
  logger.info('\n🔍 测试 1: 签名生成一致性');

  const testData = {
    userId: 999,
    userName: 'consistency_test',
    amount: 123.45
  };

  const verifyPwd = 'consistency_secret';

  // 第一次生成签名
  const signature1 = signatureUtil.getSignature(testData, verifyPwd);

  // 第二次生成签名（应该相同）
  const signature2 = signatureUtil.getSignature(testData, verifyPwd);

  // 第三次生成签名（使用 signRequest）
  const signedData = signatureUtil.signRequest(testData, { verifyPwd });
  const signature3 = signedData.signature;

  check(null, {
    '相同数据生成相同签名 (直接调用)': () => signature1 === signature2,
    '相同数据生成相同签名 (signRequest)': () => signature1 === signature3,
    '签名格式正确 (32位十六进制)': () => /^[A-F0-9]{32}$/.test(signature1),
    '签名为大写': () => signature1 === signature1.toUpperCase()
  });

  logger.info(`  签名1: ${signature1}`);
  logger.info(`  签名2: ${signature2}`);
  logger.info(`  签名3: ${signature3}`);
}

/**
 * 测试 2: 字段过滤逻辑
 * 确保排除字段被正确过滤
 */
function testFieldFiltering() {
  logger.info('\n🔍 测试 2: 字段过滤逻辑');

  const data = {
    userId: 1001,
    signature: 'should_be_excluded',
    timestamp: 1234567890,
    track: 'track_123',
    amount: 100.50,
    nullField: null,
    emptyField: '',
    validField: 'keep_this'
  };

  const filtered = signatureUtil.filterObject(data);

  check(null, {
    '排除 signature 字段': () => filtered.signature === undefined,
    '排除 timestamp 字段': () => filtered.timestamp === undefined,
    '排除 track 字段': () => filtered.track === undefined,
    '排除 null 值': () => filtered.nullField === undefined,
    '排除空字符串': () => filtered.emptyField === undefined,
    '保留有效字段': () => filtered.userId === 1001,
    '保留有效字段2': () => filtered.validField === 'keep_this'
  });

  logger.info('  原始数据字段:', Object.keys(data).join(', '));
  logger.info('  过滤后字段:', Object.keys(filtered).join(', '));
}

/**
 * 测试 3: JSON 序列化
 * 测试 JSON 字符串生成是否正确
 */
function testJsonSerialization() {
  logger.info('\n🔍 测试 3: JSON 序列化');

  const testData = {
    userId: 1001,
    userName: 'test&user',
    description: 'test "quotes" & <html> tags',
    amount: 123.45
  };

  const jsonString = signatureUtil.stringifyWithoutEscape(testData);

  check(null, {
    'JSON 字符串包含所有字段': () =>
      jsonString.includes('"userId":1001') &&
      jsonString.includes('"userName":"test&user"'),
    '不转义 HTML 字符': () => jsonString.includes('test&user'),
    '不转义引号': () => jsonString.includes('"quotes"'),
    '格式正确': () => jsonString.startsWith('{') && jsonString.endsWith('}')
  });

  logger.info('  生成的 JSON:', jsonString);

  // 测试标准 JSON.stringify 对比
  const standardJson = JSON.stringify(testData);
  logger.info('  标准 JSON.stringify:', standardJson.substring(0, 100) + '...');
}

/**
 * 测试 4: MD5 计算
 * 测试 MD5 哈希计算是否正确
 */
function testMd5Calculation() {
  logger.info('\n🔍 测试 4: MD5 计算');

  // 测试已知的 MD5 值
  const testData = [
    { input: 'hello', uppercase: false, expected: '5d41402abc4b2a76b9719d911017c592' },
    { input: 'hello', uppercase: true, expected: '5D41402ABC4B2A76B9719D911017C592' },
    { input: 'test123', uppercase: false, expected: 'cc03e747a6afbbcbf8be7668acfebee5' },
    { input: '', uppercase: false, expected: 'd41d8cd98f00b204e9800998ecf8427e' }
  ];

  testData.forEach((testCase, index) => {
    const result = signatureUtil.md5Info(testCase.input, testCase.uppercase);

    const testName = `MD5 测试 ${index + 1}: ${testCase.input} (${testCase.uppercase ? '大写' : '小写'})`;

    check(null, {
      [testName]: () => result === testCase.expected
    });

    logger.info(`  ${testCase.input} -> ${result} (期望: ${testCase.expected})`);
  });
}

/**
 * 测试 5: 完整工作流程
 * 测试从数据到签名的完整流程
 */
function testCompleteWorkflow() {
  logger.info('\n🔍 测试 5: 完整工作流程');

  // 运行所有测试用例
  testCases.forEach((testCase, index) => {
    logger.info(`\n  测试用例 ${index + 1}: ${testCase.name}`);

    try {
      // 生成签名
      const signature = signatureUtil.getSignature(testCase.data, testCase.verifyPwd);

      // 使用 signRequest 生成带签名的数据
      const signedData = signatureUtil.signRequest(testCase.data, {
        verifyPwd: testCase.verifyPwd,
        includeTimestamp: true
      });

      // 验证签名
      const isValid = signatureUtil.verifySignature(signedData, testCase.verifyPwd);

      check(null, {
        [`${testCase.name} - 签名生成成功`]: () => signature !== undefined && signature !== '',
        [`${testCase.name} - 签名验证通过`]: () => isValid === true,
        [`${testCase.name} - 签名字段已添加`]: () => signedData.signature === signature,
        [`${testCase.name} - 时间戳已添加`]: () => signedData.timestamp !== undefined
      });

      logger.info(`    数据:`, JSON.stringify(testCase.data, null, 2));
      logger.info(`    签名: ${signature}`);
      logger.info(`    验证: ${isValid ? '✅ 通过' : '❌ 失败'}`);

      // 测试篡改数据
      if (signedData.amount || signedData.userId) {
        const tamperedData = { ...signedData };

        // 篡改一个字段
        if (tamperedData.amount) {
          tamperedData.amount = tamperedData.amount + 100;
        } else if (tamperedData.userId) {
          tamperedData.userId = tamperedData.userId + 1000;
        }

        const tamperedValid = signatureUtil.verifySignature(tamperedData, testCase.verifyPwd);

        check(null, {
          [`${testCase.name} - 篡改后签名失效`]: () => tamperedValid === false
        });

        logger.info(`    篡改测试: ${tamperedValid ? '❌ 应该失败' : '✅ 正确失败'}`);
      }

    } catch (error) {
      logger.error(`    错误: ${error.message}`);
      check(null, {
        [`${testCase.name} - 无异常`]: () => false
      });
    }
  });
}
