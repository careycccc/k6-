/**
 * 请求构建器
 */
export class RequestBuilder {
    constructor() {
      this.request = {
        method: 'GET',
        headers: {},
        params: {},
        data: null,
        timeout: 30000,
        tags: {},
        validate: true
      };
    }
  
    setMethod(method) {
      this.request.method = method.toUpperCase();
      return this;
    }
  
    setUrl(url) {
      this.request.url = url;
      return this;
    }
  
    setEndpoint(endpoint) {
      this.request.endpoint = endpoint;
      return this;
    }
  
    setHeaders(headers) {
      this.request.headers = { ...this.request.headers, ...headers };
      return this;
    }
  
    setHeader(key, value) {
      this.request.headers[key] = value;
      return this;
    }
  
    setParams(params) {
      this.request.params = { ...this.request.params, ...params };
      return this;
    }
  
    setParam(key, value) {
      this.request.params[key] = value;
      return this;
    }
  
    setData(data) {
      this.request.data = data;
      return this;
    }
  
    setTimeout(timeout) {
      this.request.timeout = timeout;
      return this;
    }
  
    setTags(tags) {
      this.request.tags = { ...this.request.tags, ...tags };
      return this;
    }
  
    setTag(key, value) {
      this.request.tags[key] = value;
      return this;
    }
  
    setValidate(validate) {
      this.request.validate = validate;
      return this;
    }
  
    setSchema(schema) {
      this.request.schema = schema;
      return this;
    }
  
    build() {
      return { ...this.request };
    }
  
    /**
     * 快速构建GET请求
     */
    static get(endpoint) {
      return new RequestBuilder()
        .setMethod('GET')
        .setEndpoint(endpoint);
    }
  
    /**
     * 快速构建POST请求
     */
    static post(endpoint, data) {
      return new RequestBuilder()
        .setMethod('POST')
        .setEndpoint(endpoint)
        .setData(data);
    }
  
    /**
     * 快速构建PUT请求
     */
    static put(endpoint, data) {
      return new RequestBuilder()
        .setMethod('PUT')
        .setEndpoint(endpoint)
        .setData(data);
    }
  
    /**
     * 快速构建DELETE请求
     */
    static delete(endpoint) {
      return new RequestBuilder()
        .setMethod('DELETE')
        .setEndpoint(endpoint);
    }
  }
  
  export default RequestBuilder;
  