import Redis, { type RedisOptions } from 'ioredis';
import { env } from './env.js';

const baseOpts: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

if (env.REDIS_URL.startsWith('rediss://')) {
  baseOpts.tls = {};
}

export const redisSession = new Redis(env.REDIS_URL, baseOpts);
export const redisPub = new Redis(env.REDIS_URL, baseOpts);
export const redisSub = new Redis(env.REDIS_URL, baseOpts);

for (const [name, client] of [
  ['session', redisSession],
  ['pub', redisPub],
  ['sub', redisSub],
] as const) {
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`[redis:${name}] error`, err.message);
  });
}
