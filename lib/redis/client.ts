import Redis from "ioredis";

import { env, requireValue } from "@/lib/utils/env";

declare global {
  var redisGlobal: Redis | undefined;
}

// created on first use so a build never opens a connection
export function getRedis() {
  return (globalThis.redisGlobal ??= new Redis(requireValue("REDIS_URL", env.redisUrl), {
    commandTimeout: 1000,
  }));
}
