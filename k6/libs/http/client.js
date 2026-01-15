// client.js
import http from 'k6/http';
import { getApiUrl } from '../../config/environment.js';
import { getLogger } from '../utils/logger.js';
import { SignedHttpClient } from '../utils/signature.js';
import { loadConfigFromFile } from '../../config/load.js';

const logger = getLogger();
const loader = loadConfigFromFile();

export class HttpClient extends SignedHttpClient {
  constructor(baseConfig = {}) {
    super(baseConfig);
    this.logger = logger;

    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
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

  // 最简请求：直接返回 k6 原生 response

  request(method, endpoint, data = null, config = {}, isDesk = true) {
    const url = config.fullUrl || getApiUrl(endpoint, isDesk);
    //logger.info(`请求的url:  ${url}`);
    // 为前后端请求的时候添加不同的heades
    const deskUrl = loader.local.API_BASE_URL;
    const adminUrl = loader.local.API_ADMIN_URL;
    if (isDesk) {
      config.headers = generateRequestBody(config, deskUrl);
    } else {
      config.headers = generateRequestBody(config, adminUrl);
    }
    // 添加默认 headers
    const headers = { ...this.defaultHeaders, ...config.headers };

    let body = null;
    if (data) {
      const signedData = this._signIfNeeded(data, config);
      // 检查数据类型，如果已经是字符串则不再序列化
      body = typeof signedData === 'string' ? signedData : JSON.stringify(signedData);
    }

    const params = ['GET', 'DELETE'].includes(method.toUpperCase())
      ? this._signIfNeeded(config.params || {}, config)
      : {};

    const options = {
      headers,
      timeout: `${this.timeout}ms`,
      tags: config.tags || {},
      // Only include body if it's not null
      ...(body !== null && { body })
    };

    // 根据请求方法确定是否需要 body 参数
    let response;
    if (['GET', 'DELETE'].includes(method.toUpperCase())) {
      // GET/DELETE 请求不需要 body
      response = http.request(method.toUpperCase(), url, params, options);
    } else {
      // POST/PUT/PATCH 请求需要 body
      if (body) {
        response = http.request(method.toUpperCase(), url, body, options);
      } else {
        response = http.request(method.toUpperCase(), url, null, options);
      }
    }

    if (response.error) {
      logger.error('HTTP请求错误', {
        error: response.error,
        url: url,
        status: response.status
      });
    }

    // 只做 check，不修改 response
    //check(response, checks);
    // 直接返回原生 response（安全）
    return response;
  }
  /**
   * @param url — 请求URL
    @param data — 请求数据
    @param options — 请求选项
    @param isDesk — 是否是前台登录
    @returns — 响应对象
   * **/
  get(endpoint, params = {}, config = {}, isDesk = true) {
    return this.request('GET', endpoint, null, { ...config, params }, isDesk);
  }
  /**
   * @param url — 请求URL
    @param data — 请求数据
    @param options — 请求选项
    @param isDesk — 是否是前台登录
    @returns — 响应对象
   * **/
  post(endpoint, data = {}, config = {}, isDesk = true) {
    return this.request('POST', endpoint, data, config, isDesk);
  }
  /**
   * @param url — 请求URL
    @param data — 请求数据
    @param options — 请求选项
    @param isDesk — 是否是前台登录
    @returns — 响应对象
   * **/
  put(endpoint, data = {}, config = {}, isDesk = true) {
    return this.request('PUT', endpoint, data, config, isDesk);
  }
  patch(endpoint, data = {}, config = {}) {
    return this.request('PATCH', endpoint, data, config);
  }
  delete(endpoint, config = {}) {
    return this.request('DELETE', endpoint, null, config);
  }
}

// 辅助函数负责生成请求体中的 Domainurl 和 Referrer
function generateRequestBody(config = {}, url) {
  return {
    ...config.headers,
    Domainurl: url,
    Referrer: url
  };
}

export const httpClient = new HttpClient();

export default { HttpClient, httpClient };
