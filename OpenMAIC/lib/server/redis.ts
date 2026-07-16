/** Shared ioredis client (singleton across dev hot-reloads). REDIS_URL from env. */
import Redis from 'ioredis';

const g = globalThis as unknown as { _redis?: Redis };

export function getRedis(): Redis {
  if (!g._redis) {
    g._redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
    });
  }
  return g._redis;
}
