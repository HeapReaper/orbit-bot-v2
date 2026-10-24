import Redis from 'ioredis';
import { Logging } from './logging';

let redis: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (redis === null) {
    const url =
      process.env.REDIS_URL || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;

    redis = new Redis(url, {
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redis.on('connect', () => Logging.info('Redis connected'));
    redis.on('error', (err) => Logging.error(`Redis error: ${err.message}`));
  }
  return redis;
};

export const disconnectRedis = async () => {
  if (redis) {
    await redis.quit();
    redis = null;
  }
};
