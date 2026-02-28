/**
 * 日期时间工具函数
 * 统一管理所有活动创建中使用的时间相关函数
 */

/**
 * 格式化日期为 "YYYY-MM-DD" 格式
 * @param {Date} date - 日期对象
 * @returns {string} YYYY-MM-DD 格式的日期字符串
 */
export function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 格式化日期时间为 "YYYY-MM-DD HH:mm:ss" 格式
 * @param {Date} date - 日期对象
 * @returns {string} YYYY-MM-DD HH:mm:ss 格式的日期时间字符串
 */
export function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化日期时间为指定时间的格式 "YYYY-MM-DD HH:mm:ss"
 * @param {Date} date - 日期对象
 * @param {string} time - 时间字符串，如 "00:00:00" 或 "23:59:59"
 * @returns {string} YYYY-MM-DD HH:mm:ss 格式的日期时间字符串
 */
export function formatDateTimeWithTime(date, time) {
    return `${formatDate(date)} ${time}`;
}

/**
 * 获取当前日期
 * @returns {Date} 当前日期对象
 */
export function getToday() {
    return new Date();
}

/**
 * 获取明天的日期
 * @returns {Date} 明天的日期对象
 */
export function getTomorrow() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
}

/**
 * 获取明天的日期字符串（YYYY-MM-DD格式）
 * @returns {string} YYYY-MM-DD 格式
 */
export function getTomorrowDate() {
    return formatDate(getTomorrow());
}

/**
 * 获取明天的日期时间字符串（YYYY-MM-DD 00:00:00格式）
 * @returns {string} YYYY-MM-DD 00:00:00 格式
 */
export function getTomorrowDateTime() {
    const tomorrow = getTomorrow();
    tomorrow.setHours(0, 0, 0, 0);
    return formatDateTime(tomorrow);
}

/**
 * 计算活动开始时间（第二天00:00:00）
 * @returns {Date} 开始时间
 */
export function calculateStartTime() {
    const tomorrow = getTomorrow();
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
}

/**
 * 计算活动开始时间（当前时间后N小时的整点）
 * @param {number} hoursToAdd - 要添加的小时数，默认为1
 * @returns {Date} 开始时间
 */
export function calculateStartTimeWithHours(hoursToAdd = 1) {
    const now = new Date();
    const currentHour = now.getHours();
    const targetHour = (currentHour + hoursToAdd) % 24;

    const startTime = new Date(now);
    startTime.setHours(targetHour, 0, 0, 0);

    // 如果目标小时小于当前小时，说明跨天了
    if (targetHour < currentHour) {
        startTime.setDate(startTime.getDate() + 1);
    }

    return startTime;
}

/**
 * 计算活动结束时间（开始时间后N天的23:59:59）
 * @param {Date} startTime - 开始时间
 * @param {number} days - 持续天数，默认为5天
 * @returns {Date} 结束时间
 */
export function calculateEndTime(startTime, days = 5) {
    const endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + days);
    endTime.setHours(23, 59, 59, 0);
    return endTime;
}

/**
 * 计算活动结束时间（开始时间后N小时）
 * @param {Date} startTime - 开始时间
 * @param {number} hours - 持续小时数
 * @returns {Date} 结束时间
 */
export function calculateEndTimeWithHours(startTime, hours) {
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + hours);
    return endTime;
}

/**
 * 获取今天的开始和结束时间
 * @returns {Object} { beginTime, endTime } - 格式为 "YYYY-MM-DD HH:mm:ss"
 */
export function getTodayTimeRange() {
    const today = new Date();
    return {
        beginTime: formatDateTimeWithTime(today, '00:00:00'),
        endTime: formatDateTimeWithTime(today, '23:59:59')
    };
}

/**
 * 获取指定日期的开始和结束时间
 * @param {Date} date - 日期对象
 * @returns {Object} { beginTime, endTime } - 格式为 "YYYY-MM-DD HH:mm:ss"
 */
export function getDateTimeRange(date) {
    return {
        beginTime: formatDateTimeWithTime(date, '00:00:00'),
        endTime: formatDateTimeWithTime(date, '23:59:59')
    };
}

/**
 * 计算周期轮次时间戳（毫秒）
 * @param {Date} startTime - 开始时间
 * @param {Date} endTime - 结束时间
 * @returns {Array<number>} [开始时间戳, 结束时间戳]
 */
export function calculateCycleRounds(startTime, endTime) {
    return [startTime.getTime(), endTime.getTime()];
}

/**
 * 添加天数到指定日期
 * @param {Date} date - 基准日期
 * @param {number} days - 要添加的天数
 * @returns {Date} 新日期
 */
export function addDays(date, days) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + days);
    return newDate;
}

/**
 * 添加小时到指定日期
 * @param {Date} date - 基准日期
 * @param {number} hours - 要添加的小时数
 * @returns {Date} 新日期
 */
export function addHours(date, hours) {
    const newDate = new Date(date);
    newDate.setHours(newDate.getHours() + hours);
    return newDate;
}

/**
 * 设置日期时间为当天的指定时间
 * @param {Date} date - 日期对象
 * @param {number} hours - 小时（0-23）
 * @param {number} minutes - 分钟（0-59）
 * @param {number} seconds - 秒（0-59）
 * @returns {Date} 新日期
 */
export function setTime(date, hours = 0, minutes = 0, seconds = 0) {
    const newDate = new Date(date);
    newDate.setHours(hours, minutes, seconds, 0);
    return newDate;
}
