import crypto from 'k6/crypto';

// MD5 计算函数（返回大写或小写）
function md5Info(data, uppercase = false) {
  // k6 crypto.createHash 返回 Hash 对象
  const hash = crypto.createHash('md5');
  hash.update(data); // 默认 utf8
  const hex = hash.digest('hex'); // 返回小写 hex 字符串
  return uppercase ? hex.toUpperCase() : hex;
}

/**
 * 生成签名（完全对应你的 Go 版逻辑）
 * @param {object} body - 请求体对象（map[string]interface{} 对应 JS object）
 * @param {string|null} verifyPwd - 验证密码，可为 null 或 undefined
 * @returns {string} 大写 MD5 签名
 */
export function getSignature(body, verifyPwd = null) {
  if (!body || typeof body !== 'object') {
    return '';
  }

  // 1. 过滤字段 + 收集并排序 key
  const filteredObj = {};
  const keys = Object.keys(body).sort(); // 字典序排序

  for (const key of keys) {
    const value = body[key];

    // 排除条件：
    // - value 为 null/undefined/空字符串
    // - key 是 signature、timestamp、track
    // - value 是数组
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      key !== 'signature' &&
      key !== 'timestamp' &&
      key !== 'track' &&
      !Array.isArray(value)
    ) {
      filteredObj[key] = value;
    }
  }

  // 2. 转成 JSON 字符串
  // k6 的 JSON.stringify 行为和标准 JS 一致，不会对 / 等字符转义
  // 且不会在末尾加换行符（对应 Go 中去掉 \n 的处理）
  let encoder = JSON.stringify(filteredObj);

  // 3. 如果有 verifyPwd，拼接在后面
  if (verifyPwd !== null && verifyPwd !== undefined) {
    encoder += verifyPwd;
  }

  // 4. 计算大写 MD5 并返回
  return md5Info(encoder, true);
}
