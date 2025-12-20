import { check } from 'k6';
import { logger } from '../utils/logger.js';

/**
 * 响应验证器
 */
export class ResponseValidator {
  /**
   * 验证JSON Schema
   */
  static validateJsonSchema(response, schema) {
    if (!schema) return true;
    
    try {
      const json = response.json();
      return this.validateAgainstSchema(json, schema);
    } catch (error) {
      logger.error('JSON解析失败', error.message);
      return false;
    }
  }

  /**
   * 根据Schema验证数据
   */
  static validateAgainstSchema(data, schema) {
    // 基础类型验证
    if (schema.type) {
      if (schema.type === 'string' && typeof data !== 'string') {
        return false;
      }
      if (schema.type === 'number' && typeof data !== 'number') {
        return false;
      }
      if (schema.type === 'boolean' && typeof data !== 'boolean') {
        return false;
      }
      if (schema.type === 'object' && (typeof data !== 'object' || Array.isArray(data))) {
        return false;
      }
      if (schema.type === 'array' && !Array.isArray(data)) {
        return false;
      }
    }

    // 必填字段验证
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (data[field] === undefined) {
          return false;
        }
      }
    }

    // 属性验证
    if (schema.properties && typeof data === 'object') {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] !== undefined) {
          if (!this.validateAgainstSchema(data[key], propSchema)) {
            return false;
          }
        }
      }
    }

    // 数组项验证
    if (schema.items && Array.isArray(data)) {
      for (const item of data) {
        if (!this.validateAgainstSchema(item, schema.items)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 验证状态码
   */
  static validateStatusCode(response, expectedStatus) {
    if (Array.isArray(expectedStatus)) {
      return expectedStatus.includes(response.status);
    }
    return response.status === expectedStatus;
  }

  /**
   * 验证响应头
   */
  static validateHeaders(response, headerRules) {
    for (const [header, rule] of Object.entries(headerRules)) {
      const value = response.headers[header];
      
      if (typeof rule === 'string') {
        if (value !== rule) return false;
      } else if (rule instanceof RegExp) {
        if (!rule.test(value)) return false;
      } else if (typeof rule === 'function') {
        if (!rule(value)) return false;
      }
    }
    return true;
  }

  /**
   * 验证响应体包含特定内容
   */
  static validateBodyContains(response, expectedContent) {
    if (typeof expectedContent === 'string') {
      return response.body.includes(expectedContent);
    } else if (expectedContent instanceof RegExp) {
      return expectedContent.test(response.body);
    }
    return false;
  }

  /**
   * 验证JSON路径
   */
  static validateJsonPath(response, jsonPath, expectedValue) {
    try {
      const json = response.json();
      const value = this.getJsonPathValue(json, jsonPath);
      
      if (typeof expectedValue === 'function') {
        return expectedValue(value);
      }
      return value === expectedValue;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取JSON路径值
   */
  static getJsonPathValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    return current;
  }
}

/**
 * 验证响应
 */
export async function validateResponse(response, schema = null) {
  const validations = [];

  // 基本验证
  validations.push({
    name: '状态码为2xx',
    result: response.status >= 200 && response.status < 300
  });

  // JSON Schema验证
  if (schema) {
    validations.push({
      name: 'JSON Schema验证',
      result: ResponseValidator.validateJsonSchema(response, schema)
    });
  }

  // 响应时间验证
  validations.push({
    name: '响应时间小于5秒',
    result: response.timings.duration < 5000
  });

  // 执行检查
  const checkResults = validations.map(v => ({
    [v.name]: v.result
  }));

  const allPassed = validations.every(v => v.result);
  
  if (!allPassed) {
    logger.warn('响应验证失败', {
      url: response.url,
      status: response.status,
      validations: validations.filter(v => !v.result).map(v => v.name)
    });
  }

  return {
    passed: allPassed,
    validations: validations
  };
}

export default {
  ResponseValidator,
  validateResponse
};
