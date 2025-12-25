// 基础类型
export const baseObject = {
  random: { type: 'int' },
  language: { type: 'string' },
  signature: { type: 'string' },
  timestamp: { type: 'int' }
};

// 响应规则
export const responseRules = {
  expectedCode: 0, // 预期的业务字段
  expectedMessage: 'Succeed', // 预期的业务字段值
  customChecks: {
    data: (data) => {
      // 判断有没有data字段，如果没有就直接通过
      if (!data) {
        return true;
      }
      // 主要是检测这个data字段是不是一个对象并且还必须要有值
      return typeof data === 'object' && Object.keys(data).length > 0;
    }
  }
};

/**
 * 生成加密安全的随机字符串（类似浏览器指纹的一部分）
 * @param {number} length - 要生成的字符串长度
 * @returns {string} 随机字符串
 */
export function generateCryptoRandomString(length) {
  const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charsetLength = charset.length;

  // 创建一个长度为 length 的 Uint8Array 来存放随机字节
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);

  // 将每个随机字节映射到字符集中的字符
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomBytes[i] % charsetLength];
  }

  return result;
}

/**
 * 生成一个 12 位的随机整数（范围：100000000 ~ 999999999）
 * @returns {number} 12 位随机数
 */
export function randomTwelveK6() {
  // k6 中 Math.random() 足够处理 12 位数（JS 安全整数上限为 15 位）
  return Math.floor(Math.random() * 900000000000) + 100000000000;
}

/**
 * 返回当前时间戳（秒）、9位随机数、语言
 * @returns {{timestamp: number, random: number, language: string}}
 */
export function getTimeRandom() {
  const LANGUAGE = 'en'; // 根据你的实际配置修改，例如从 config 中读取

  const timestamp = Math.floor(Date.now() / 1000); // 当前时间戳（秒级），与 Go 的 time.Now().Unix() 等价
  const random = randomTwelveK6();

  return {
    timestamp,
    random,
    language: LANGUAGE
  };
}
