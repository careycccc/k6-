
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


/**
 * 将日期字符串转换为毫秒级时间戳
 * @param {string} dateString - 日期字符串，格式如 "2025-12-19 00:00:00"
 * @returns {number} - 毫秒级时间戳
 */
export function dateStringToTimestamp(dateString) {
  try {
    // 创建Date对象
    const date = new Date(dateString);

    // 验证日期是否有效
    if (isNaN(date.getTime())) {
      throw new Error('无效的日期字符串');
    }

    // 返回毫秒级时间戳
    return date.getTime();
  } catch (error) {
    logger.error('日期转换失败:', error.message);
    throw error;
  }
}

/**
 * 将毫秒级时间戳转换为日期字符串
 * @param {number} timestamp - 毫秒级时间戳
 * @returns {string} - 日期字符串，格式 "YYYY-MM-DD HH:mm:ss"
 */
export function timestampToDateString(timestamp) {
  try {
    const date = new Date(timestamp);

    // 格式化日期
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    logger.error('时间戳转换失败:', error.message);
    throw error;
  }
}


/**
 * 检查参数是否为非空数组
 * @param {*} value - 要检查的值
 * @returns {boolean} - 如果是非空数组返回true，否则返回false
 */
export function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}


