/**
 * 公共工具统一入口：import { randInt, fetchAllPages, getTzOffset, extractToken } from '<相对路径>/libs/common/index.js'
 *
 *   random.js   随机整数/随机取元素/随机数字串/随机字符串
 *   paging.js   extractList / extractTotalPage / extractTotalCount / fetchAllPages 翻页取全量
 *   time.js     租户时区偏移、自然日起止时间戳、时间戳格式化
 *   response.js extractToken 从登录/注册响应取 token、toNum
 *
 * Node runner（CommonJS）用 libs/node/args.js 的 parseArgs，不能走这里。
 */

export * from './random.js';
export * from './paging.js';
export * from './time.js';
export * from './response.js';
