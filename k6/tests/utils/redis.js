// k6/tests/utils/redis.js
import redis from 'k6/experimental/redis';

// 直接使用 Redis URL 字符串实例化客户端（官方推荐，最简洁）
export const redisClient = new redis.Client('redis://localhost:6379');

// 可选：如果有密码、特定 DB
// export const redisClient = new redis.Client('redis://:password@localhost:6379/0');

// 可选：如果需要多个客户端或函数封装
export function getRedisClient() {
  return redisClient;
}

// teardown 中关闭连接（很重要，避免连接泄漏）
export function teardown() {
  redisClient.close();
}
