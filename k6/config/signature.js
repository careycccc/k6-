/**
 * 签名配置管理
 */
export const signatureConfig = {
  // 默认签名配置
  default: {
    verifyPwd: process.env.SIGNATURE_SECRET || 'default_secret',
    includeTimestamp: true,
    timestampField: 'timestamp',
    signatureField: 'signature',
    excludeFields: ['signature', 'timestamp', 'track'],
    md5Uppercase: true
  },

  // 不同环境的签名配置
  environments: {
    local: {
      verifyPwd: process.env.LOCAL_SIGNATURE_SECRET || 'local_secret'
    },
    dev: {
      verifyPwd: process.env.DEV_SIGNATURE_SECRET || 'dev_secret'
    },
    staging: {
      verifyPwd: process.env.STAGING_SIGNATURE_SECRET || 'staging_secret'
    },
    production: {
      verifyPwd: process.env.PRODUCTION_SIGNATURE_SECRET || 'production_secret'
    }
  },

  // API 特定的签名配置
  apis: {
    user: {
      verifyPwd: process.env.USER_API_SECRET || 'user_secret',
      timestampField: 'requestTime'
    },
    payment: {
      verifyPwd: process.env.PAYMENT_API_SECRET || 'payment_secret',
      includeTimestamp: false
    },
    order: {
      verifyPwd: process.env.ORDER_API_SECRET || 'order_secret'
    }
  }
};

/**
 * 获取签名配置
 */
export function getSignatureConfig(apiName = null, environment = null) {
  const env = environment || __ENV.ENVIRONMENT || 'local';

  // 基础配置
  let config = { ...signatureConfig.default };

  // 合并环境特定配置
  if (signatureConfig.environments[env]) {
    config = {
      ...config,
      ...signatureConfig.environments[env]
    };
  }

  // 合并 API 特定配置
  if (apiName && signatureConfig.apis[apiName]) {
    config = {
      ...config,
      ...signatureConfig.apis[apiName]
    };
  }

  return config;
}

/**
 * 验证签名配置
 */
export function validateSignatureConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config.verifyPwd) {
    errors.push('verifyPwd 不能为空');
  }

  if (typeof config.includeTimestamp !== 'boolean') {
    warnings.push('includeTimestamp 应该是布尔值');
  }

  if (typeof config.md5Uppercase !== 'boolean') {
    warnings.push('md5Uppercase 应该是布尔值');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 生成测试签名数据
 */
export function generateTestSignatureData(overrides = {}) {
  const timestamp = Date.now();

  const baseData = {
    userId: 123456,
    userName: 'test_user',
    amount: 100.5,
    orderNo: `ORDER_${timestamp}`,
    timestamp: timestamp,
    signature: '' // 这个字段将由签名工具填充
  };

  return { ...baseData, ...overrides };
}

export default {
  signatureConfig,
  getSignatureConfig,
  validateSignatureConfig,
  generateTestSignatureData
};
