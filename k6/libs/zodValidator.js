import { Schemas } from '../config/zodSchemas.js';
import { z } from '../vendor/zod.bundle.js';

// 通用接口响应校验入口
export function validateResponse(tag, body) {
  const schema = Schemas?.[tag];
  if (!schema) return true; // 未定义 schema 时不强制校验
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    schema.parse(data);
    return true;
  } catch (err) {
    // 直接输出错误，避免中断测试流程
    console.error(`[zod] Validation failed for ${tag}: ${err?.message ?? err}`);
    return false;
  }
}
