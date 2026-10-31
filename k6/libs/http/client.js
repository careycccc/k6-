import http from 'k6/http';
import { resolveApiRoute } from '../../config/environment.js';
import { getLogger } from '../utils/logger.js';
import { SignedHttpClient } from '../utils/signature.js';
import { getBaseUrl } from './core.js';

const logger = getLogger();

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

  setVerifyPwd(verifyPwd) {
    this.defaultSignOptions.verifyPwd = verifyPwd;
  }

  _signIfNeeded(data, config = {}) {
    if (!this.autoSign || config.sign === false) return data;
    const opts = { ...this.defaultSignOptions, ...config.signOptions };
    try {
      const signedData = this.signData(data, opts);
      // 调试：检查签名后的 random
      if (signedData.random) {
        //console.log(`[HttpClient] Debug - 签名后 random: ${signedData.random}, 类型: ${typeof signedData.random}, 长度: ${String(signedData.random).length}`);
      }
      return signedData;
    } catch (err) {
      this.logger.error('签名失败', err);
      throw err;
    }
  }

  // 最简请求：直接返回 k6 原生 response

  request(method, endpoint, data = null, config = {}, isDesk = true) {
    // 租户/域名规则与 tenantRequest 一致（libs/http/core.js）：以前这里只认 TENANT_ID，与 URL 用的 TENANT 不一致
    // 2026-10-30：默认优先走集团查询，集团登录失败时自动降级为商户自己的域名（见
    // config/environment.js 的 resolveApiRoute / libs/http/groupRouting.js）。
    // config.fullUrl 是调用方明确指定域名的逃生舱口——这种场景不套集团的 tenantId
    // 头，调用方既然手动指定了域名，就不该被自动画蛇添足。
    let url, domainUrl, extraHeaders = {};
    if (config.fullUrl) {
      url = config.fullUrl;
      const match = config.fullUrl.match(/^(https?:\/\/[^\/]+)/);
      domainUrl = match ? match[1] : getBaseUrl(isDesk);
    } else {
      // config.forceTenant：强制走商户自己的域名，不套集团路由（2026-10-30 新增）。
      // 给已经用商户 token 登录的调用方用，否则 token 和路由会不同步，报 "Account
      // type does not match the admin site"（已实测踩坑，见 resolveQueryRoute 注释）。
      const route = resolveApiRoute(endpoint, isDesk, config.forceTenant === true);
      url = route.url;
      domainUrl = route.baseUrl;
      extraHeaders = route.extraHeaders;
    }
    //logger.info(`请求的url:  ${url}`);

    config.headers = generateRequestBody(config, domainUrl);

    // 添加默认 headers；extraHeaders（集团模式下的 tenantId 头）放最后，确保不会
    // 被 defaultHeaders / config.headers 意外覆盖
    const headers = { ...this.defaultHeaders, ...config.headers, ...extraHeaders };

    let body = null;
    if (data) {
      const signedData = this._signIfNeeded(data, config);
      // 检查数据类型，如果已经是字符串则不再序列化
      body = typeof signedData === 'string' ? signedData : JSON.stringify(signedData);
    }

    const params = ['GET', 'DELETE'].includes(method.toUpperCase())
      ? this._signIfNeeded(config.params || {}, config)
      : {};

    // 2026-10-29发现：项目里20多处调用点(signinApi.js/rechargeWheelExecution.js/
    // rptDashboardApi.js/各性能测试脚本等)都把tags错塞进了 config.params.tags，
    // 但config.params只在GET/DELETE分支才会被读取(见上面的params变量)，POST场景
    // 下从未被用到——这些tags从来没有真正传给k6底层，一直在空转。这里做兼容读取，
    // 不改调用点(改动面太大)，只在底层统一打一个补丁：优先取规范的顶层config.tags，
    // 没有就退回历史上这种错误但被广泛复制的config.params.tags写法。
    const tags = config.tags || (config.params && config.params.tags) || {};

    const options = {
      headers,
      timeout: `${this.timeout}ms`,
      tags,
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
    // console.log(`[HttpClient.post] ========== POST请求 ==========`);
    // console.log(`[HttpClient.post] endpoint: ${endpoint}`);
    // console.log(`[HttpClient.post] isDesk: ${isDesk}`);
    // console.log(`[HttpClient.post] data: ${JSON.stringify(data, null, 2)}`);
    // console.log(`[HttpClient.post] config: ${JSON.stringify(config, null, 2)}`);

    const response = this.request('POST', endpoint, data, config, isDesk);

    //console.log(`[HttpClient.post] ========== POST响应 ==========`);
    //console.log(`[HttpClient.post] 响应状态: ${response.status}`);
    //console.log(`[HttpClient.post] 响应体: ${response.body}`);
    //console.log(`[HttpClient.post] 响应Headers: ${JSON.stringify(response.headers, null, 2)}`);

    return response;
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
