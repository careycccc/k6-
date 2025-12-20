import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl } from '../../config/environment.js';
import { logger } from '../utils/logger.js';
import { validateResponse } from './responseValidator.js';
import { SignedHttpClient } from '../utils/signature.js';

/**
 * HTTP客户端封装类（增强版，支持签名）
 */
export class HttpClient extends SignedHttpClient {
  constructor(baseConfig = {}) {
    // 调用父类构造函数
    super(baseConfig);
    
    // 初始化 HTTP 配置
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      'Accept':'application/json, text/plain, */*',
      'Connection':'keep-alive',
      ...baseConfig.headers
    };
    
/**
 * 配置参数初始化
 * 设置超时时间、重试次数和重试延迟时间
 */
    this.timeout = baseConfig.timeout || 30000;    // 设置超时时间，默认为30000毫秒
    this.retryAttempts = baseConfig.retryAttempts || 3;    // 设置重试次数，默认为3次
    this.retryDelay = baseConfig.retryDelay || 1000;    // 设置重试延迟时间，默认为1000毫秒
    this.autoSign = baseConfig.autoSign !== false; // 默认启用自动签名
  }

  /**
   * 设置认证token
   */
  setAuthToken(token) {
    this.defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  /**
   * 设置签名密钥
   */
  setVerifyPwd(verifyPwd) {
    this.verifyPwd = verifyPwd;
    this.defaultSignOptions.verifyPwd = verifyPwd;
  }

  /**
   * 启用/禁用自动签名
   */
  setAutoSign(enabled) {
    this.autoSign = enabled;
  }

  /**
   * 处理请求数据（添加签名）
   */
  processRequestData(data, config = {}) {
    // 如果禁用自动签名，直接返回原始数据
    if (!this.autoSign) {
      return data;
    }
    
    // 检查是否需要签名
    const shouldSign = config.sign !== false;
    if (!shouldSign) {
      return data;
    }
    
    // 获取签名选项
    const signOptions = {
      ...this.defaultSignOptions,
      ...config.signOptions
    };
    
    // 添加签名
    try {
      return this.signData(data, signOptions);
    } catch (error) {
      logger.error('请求数据签名失败', {
        error: error.message,
        data,
        options: signOptions
      });
      throw error;
    }
  }

  /**
   * 重试机制
   */
  async retryRequest(requestFn, attempts = this.retryAttempts) {
    let lastError;
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        logger.warn(`请求失败，第${i + 1}次重试`, error.message);
        
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, i)));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * GET请求
   */
  async get(endpoint, params = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    // 处理参数签名
    let finalParams = params;
    if (this.autoSign && config.sign !== false) {
      const signOptions = {
        ...this.defaultSignOptions,
        ...config.signOptions
      };
      finalParams = this.signData(params, signOptions);
    }
    
    const requestFn = () => {
      const response = http.get(url, {
        headers,
        params: { ...finalParams, ...config.params },
        timeout: config.timeout || this.timeout,
        tags: config.tags || {}
      });
      
      return this.handleResponse(response, config);
    };
    
    return this.retryRequest(requestFn);
  }

  /**
   * POST请求
   */
  async post(endpoint, data = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    // 处理数据签名
    let finalData = this.processRequestData(data, config);
    
    /**
     * 定义一个发送HTTP请求的函数
     * 该函数使用http模块发送POST请求，并对响应进行处理
     * @returns {Promise} 返回处理后的响应结果
     */
    const requestFn = () => {
      // 使用http模块发送POST请求
      // 将finalData对象转换为JSON字符串作为请求体
      const response = http.post(url, JSON.stringify(finalData), {
        headers,
        timeout: config.timeout || this.timeout,
        tags: config.tags || {}
      });
      
      return this.handleResponse(response, config);
    };
    
    return this.retryRequest(requestFn);
  }

  /**
   * PUT请求
   */
  async put(endpoint, data = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    // 处理数据签名
    let finalData = this.processRequestData(data, config);
    
    const requestFn = () => {
      const response = http.put(url, JSON.stringify(finalData), {
        headers,
        timeout: config.timeout || this.timeout,
        tags: config.tags || {}
      });
      
      return this.handleResponse(response, config);
    };
    
    return this.retryRequest(requestFn);
  }

  /**
   * DELETE请求
   */
  async delete(endpoint, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    // 处理参数签名（如果有参数）
    let params = {};
    if (config.params && this.autoSign && config.sign !== false) {
      const signOptions = {
        ...this.defaultSignOptions,
        ...config.signOptions
      };
      params = this.signData(config.params, signOptions);
    }
    
    const requestFn = () => {
      const response = http.del(url, null, {
        headers,
        params,
        timeout: config.timeout || this.timeout,
        tags: config.tags || {}
      });
      
      return this.handleResponse(response, config);
    };
    
    return this.retryRequest(requestFn);
  }

  /**
   * PATCH请求
   */
  async patch(endpoint, data = {}, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };
    
    // 处理数据签名
    let finalData = this.processRequestData(data, config);
    
    const requestFn = () => {
      const response = http.patch(url, JSON.stringify(finalData), {
        headers,
        timeout: config.timeout || this.timeout,
        tags: config.tags || {}
      });
      
      return this.handleResponse(response, config);
    };
    
    return this.retryRequest(requestFn);
  }

  /**
   * 处理响应
   */
  async handleResponse(response, config) {
    const { validate = true, schema, customChecks = [], verifyResponseSignature = false } = config;
    
    // 基础检查
    const baseChecks = {
      '状态码为2xx或3xx': (r) => r.status >= 200 && r.status < 400,
      '响应时间小于5s': (r) => r.timings.duration < 5000
    };
    
    // 合并检查
    const allChecks = { ...baseChecks, ...customChecks };
    
    const checkResult = check(response, allChecks);
    
    if (!checkResult) {
      logger.error('响应检查失败', {
        status: response.status,
        url: response.url,
        duration: response.timings.duration,
        body: response.body
      });
    }
    
    // 验证响应签名（如果需要）
    let responseData = null;
    if (response.body) {
      try {
        responseData = response.json();
        
        if (verifyResponseSignature && this.verifyPwd) {
          const signatureValid = this.verifyData(responseData);
          if (!signatureValid) {
            logger.error('响应签名验证失败', {
              url: response.url,
              response: responseData
            });
            return {
              success: false,
              status: response.status,
              error: '响应签名验证失败'
            };
          }
        }
      } catch (error) {
        logger.warn('响应体解析失败', { error: error.message });
      }
    }
    
    // 验证响应数据
    if (validate && responseData) {
      await validateResponse(response, schema);
    }
    
    return {
      success: checkResult,
      status: response.status,
      headers: response.headers,
      body: responseData,
      timings: response.timings,
      request: {
        url: response.url,
        method: response.request.method
      }
    };
  }

  /**
   * 批量请求
   */
  async batch(requests, config = {}) {
    const batchRequests = requests.map(req => {
      const url = req.fullUrl || getApiUrl(req.endpoint);
      const method = req.method.toUpperCase();
      
      // 处理数据签名
      let body = null;
      if (req.body) {
        const reqConfig = {
          sign: req.sign !== false,
          signOptions: req.signOptions
        };
        const signedData = this.processRequestData(req.body, reqConfig);
        body = JSON.stringify(signedData);
      }
      
      const params = req.params || {};
      
      // 处理参数签名（GET/DELETE 等方法）
      let finalParams = params;
      if (['GET', 'DELETE'].includes(method) && this.autoSign && req.sign !== false) {
        finalParams = this.signData(params, req.signOptions);
      }
      
      return {
        method,
        url,
        body,
        params: finalParams
      };
    });
    
    const responses = http.batch(batchRequests);
    
    return responses.map((response, index) => {
      return this.handleResponse(response, {
        validate: config.validate,
        schema: requests[index].schema,
        verifyResponseSignature: requests[index].verifyResponseSignature
      });
    });
  }
}

// 创建默认客户端实例
export const httpClient = new HttpClient();

export default {
  HttpClient,
  httpClient
};
