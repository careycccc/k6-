import { logger } from '../../libs/utils/logger.js';

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
 * 生成 Facebook Fbp 参数（浏览器/设备级追踪ID，标识"这次访问"本身，和有没有
 * 点过广告无关——哪怕是自然流量/直接打开，Fbp 也会生成）。
 * 格式：fb.1.<毫秒时间戳>.<随机整数>
 * 参考：https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc
 * 2026-10-27从 facebookRegister.js 提取成共享工具，供 guestRegister 等场景复用，
 * 避免同一段逻辑在多处重复定义。
 */
export function generateFbp() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e18);
  return `fb.1.${ts}.${rand}`;
}

/**
 * 生成 Facebook Fbc 参数（点击ID，承载"用户点击了哪条广告"这个具体事件，
 * 和 Fbp 不同——没有真实点击来源就不该有 Fbc，所以 fbclid 必须由调用方传入，
 * 本函数不会凭空编造一个假的 fbclid）。
 * 格式：fb.1.<毫秒时间戳>.<fbclid>
 * 2026-10-27用3003真实落地页URL(indexpt1?...&fbclid=...)和真实抓包的Fbc字段
 * 逐项核对过这个拼接规则，不是猜测。
 * @param {string} fbclid - 从广告落地页URL的fbclid参数拿到的原始值
 * @returns {string}
 */
export function generateFbc(fbclid) {
  const ts = Date.now();
  return `fb.1.${ts}.${fbclid}`;
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
  // 优先从环境变量读取语言
  let LANGUAGE = __ENV.LANGUAGE;

  if (!LANGUAGE) {
    // 根据租户ID从 tenantLanguageConfig 动态获取主语言（数组第一个）
    const tenantId = __ENV.TENANT || __ENV.TENANT_ID || '3004';
    if (tenantId === '3003') {
      LANGUAGE = 'es';
    } else if (tenantId === '3006' || tenantId === '3007') {
      LANGUAGE = 'bn';
    } else {
      LANGUAGE = 'en';
    }
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const random = randomTwelveK6();

  //console.log(`[TimeRandom] 生成参数: timestamp=${timestamp}, random=${random}, language=${LANGUAGE}`);

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


/**
 * 获取本周一和今日此时的时间戳
 * @returns {Object} 包含两个时间戳的对象
 *   - weekMonday: 本周一00:00:00的时间戳（毫秒）
 *   - todayEnd: 今日23:00:00的时间戳（毫秒）
 */
export function getWeekMondayAndTodayEnd() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 获取今天是周几（0-6，0表示周日）
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // 计算到周一的日期差

  // 获取本周一的时间
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0); // 设置为周一的00:00:00

  // 获取当前时间
  const currentTime = new Date();

  return {
    weekMonday: monday.getTime(),
    todayEnd: currentTime.getTime()
  };
}



