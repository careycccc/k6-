// client.js
import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl } from '../../config/environment.js';
import { getLogger } from '../utils/logger.js';
import { SignedHttpClient } from '../utils/signature.js';

const logger = getLogger();

export class HttpClient extends SignedHttpClient {
  constructor(baseConfig = {}) {
    super(baseConfig);
    this.logger = logger;

    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-test-client/1.0',
      ...baseConfig.headers
    };

    this.timeout = baseConfig.timeout || 30000;
    this.retryAttempts = baseConfig.retryAttempts ?? 0; // 先关闭重试，避免复杂
    this.retryDelayMs = baseConfig.retryDelay ?? 1000;
    this.autoSign = baseConfig.autoSign !== false;
  }

  setAuthToken(token) {
    if (token) {
      this.defaultHeaders['Authorization'] = `Bearer ${token}`;
    } else {
      delete this.defaultHeaders['Authorization'];
    }
  }

  setAutoSign(enabled) {
    this.autoSign = !!enabled;
  }

  _signIfNeeded(data, config = {}) {
    if (!this.autoSign || config.sign === false) return data;
    const opts = { ...this.defaultSignOptions, ...config.signOptions };
    try {
      return this.signData(data, opts);
    } catch (err) {
      this.logger.error('签名失败', err);
      throw err;
    }
  }

  // 最简请求：不包装、不添加属性，直接返回 k6 原生 response

  request(method, endpoint, data = null, config = {}) {
    const url = config.fullUrl || getApiUrl(endpoint);
    const headers = { ...this.defaultHeaders, ...config.headers };

    const body = data ? JSON.stringify(this._signIfNeeded(data, config)) : null;
    const params = ['GET', 'DELETE'].includes(method.toUpperCase())
      ? this._signIfNeeded(config.params || {}, config)
      : {};

    // 执行 check（影响内置指标）
    const checks = config.customChecks || {
      'status 2xx': (r) => r.status >= 200 && r.status < 300
    };

    const response = http.request(method.toUpperCase(), url, body, {
      headers,
      params,
      timeout: `${this.timeout}ms`,
      tags: config.tags || {}
    });

    // 只做 check，不修改 response
    check(response, checks);
    console.log('=== HttpClient 返回 response 前 ===');
    console.log('response status:', response.status);
    // 直接返回原生 response（安全）
    return response;
  }

  get(endpoint, params = {}, config = {}) {
    return this.request('GET', endpoint, null, { ...config, params });
  }
  post(endpoint, data = {}, config = {}) {
    return this.request('POST', endpoint, data, config);
  }
  put(endpoint, data = {}, config = {}) {
    return this.request('PUT', endpoint, data, config);
  }
  patch(endpoint, data = {}, config = {}) {
    return this.request('PATCH', endpoint, data, config);
  }
  delete(endpoint, config = {}) {
    return this.request('DELETE', endpoint, null, config);
  }
}

export const httpClient = new HttpClient();

export default { HttpClient, httpClient };
