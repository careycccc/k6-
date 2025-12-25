import crypto from 'k6/crypto';

/**
 * 签名工具类
 */
export class SignatureUtil {
  /**
   * 过滤对象中的字段
   * @param {Object} obj - 原始对象
   * @returns {Object} 过滤后的对象
   */
  static filterObject(obj) {
    const excludeFields = ['signature', 'timestamp', 'track'];
    const filtered = {};

    for (const key in obj) {
      if (
        !excludeFields.includes(key) &&
        obj[key] !== null &&
        obj[key] !== undefined &&
        obj[key] !== ''
      ) {
        filtered[key] = obj[key];
      }
    }

    return filtered;
  }

  /**
   * 按键排序对象
   * @param {Object} obj - 原始对象
   * @returns {Object} 排序后的对象
   */
  static sortObject(obj) {
    const sorted = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = obj[key];
      });
    return sorted;
  }

  /**
   * 计算签名
   * @param {Object} data - 数据对象
   * @param {string} secret - 密钥
   * @returns {string} 签名字符串
   */
  static calculateSignature(data, secret = '') {
    // 过滤字段
    const filtered = this.filterObject(data);

    // 按键排序
    const sorted = this.sortObject(filtered);

    // 转换为JSON
    const jsonString = JSON.stringify(sorted);

    // 添加密钥
    const fullString = jsonString + secret;

    // 计算MD5并转为大写
    return crypto.md5(fullString, 'hex').toUpperCase();
  }

  /**
   * 为请求对象添加签名
   * @param {Object} requestData - 请求数据
   * @param {string} secret - 密钥
   * @returns {Object} 添加签名后的数据
   */
  static signRequest(requestData, secret = '') {
    // 添加时间戳
    const dataWithTimestamp = {
      ...requestData,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // 计算签名
    const signature = this.calculateSignature(dataWithTimestamp, secret);

    // 返回带签名的数据
    return {
      ...dataWithTimestamp,
      signature
    };
  }
}

/**
 * 带签名的HTTP客户端
 */
export class SignedHttpClient {
  constructor(baseConfig = {}) {
    this.secret = baseConfig.secret || '';
    this.signatureUtil = SignatureUtil;
    this.defaultSignOptions = {
      verifyPwd: baseConfig.verifyPwd || '',
      ...baseConfig.signOptions
    };
  }

  /**
   * 签名数据
   * @param {Object} data - 要签名的数据
   * @param {Object} options - 签名选项
   * @returns {Object} 签名后的数据
   */
  signData(data, options = {}) {
    const signOptions = {
      ...this.defaultSignOptions,
      ...options
    };

    return this.signatureUtil.signRequest(data, signOptions.verifyPwd);
  }

  /**
   * 验证数据签名
   * @param {Object} data - 包含签名的数据
   * @param {Object} options - 验证选项
   * @returns {boolean} 签名是否有效
   */
  verifyData(data, options = {}) {
    if (!data || !data.signature) {
      return false;
    }

    const signOptions = {
      ...this.defaultSignOptions,
      ...options
    };

    // 提取签名
    const receivedSignature = data.signature;

    // 创建不带签名的副本
    const dataWithoutSignature = { ...data };
    delete dataWithoutSignature.signature;

    // 重新计算签名
    const calculatedSignature = this.signatureUtil.calculateSignature(
      dataWithoutSignature,
      signOptions.verifyPwd
    );

    return receivedSignature === calculatedSignature;
  }

  /**
   * 发送POST请求
   * @param {string} url - 请求URL
   * @param {Object} data - 请求数据
   * @param {Object} options - 请求选项
   * @returns {Object} 响应对象
   */
  post(url, data, options = {}) {
    // 为数据添加签名
    const signedData = this.signData(data, options);

    console.log(`📤 POST ${url}`);
    console.log('请求数据:', JSON.stringify(signedData));

    // 模拟HTTP请求
    return this._mockRequest('POST', url, signedData, options);
  }

  /**
   * 发送GET请求
   * @param {string} url - 请求URL
   * @param {Object} params - 查询参数
   * @param {Object} options - 请求选项
   * @returns {Object} 响应对象
   */
  get(url, params = {}, options = {}) {
    // 为参数添加签名
    const signedParams = this.signData(params, options);

    console.log(`📤 GET ${url}`);
    console.log('请求参数:', JSON.stringify(signedParams));

    // 模拟HTTP请求
    return this._mockRequest('GET', url, signedParams, options);
  }

  /**
   * 模拟HTTP请求
   * @private
   */
  _mockRequest(method, url, data, options) {
    // 创建模拟响应
    const response = {
      success: true,
      status: 200,
      body: {
        code: 0,
        message: 'success',
        data: {
          token: `mock-token-${Date.now()}`,
          userId: Math.floor(Math.random() * 10000),
          timestamp: Math.floor(Date.now() / 1000)
        }
      },
      headers: {},
      timings: {
        duration: Math.random() * 100 + 50
      }
    };

    // 根据请求类型设置不同的响应
    if (url.includes('/api/Home/Login')) {
      response.body.data.userName = data.userName || 'unknown';
    }

    return response;
  }
}

// 导出默认实例（可选）
export default SignedHttpClient;

// 导出工具函数
export const signatureUtil = SignatureUtil;
