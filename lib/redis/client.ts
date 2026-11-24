import Redis from "ioredis";

import { env } from "@/lib/utils/env";

declare global {
  var redisGlobal: Redis | null | undefined;
}

function createRedis() {
  if (!env.redisUrl) return null;

  const client = new Redis(env.redisUrl, {
    // fail at once while disconnected so callers can fall back instead of waiting
    enableOfflineQueue: false,
    commandTimeout: 500,
  });

  // ioredis reconnects by itself, a listener just stops it printing every failed attempt
  client.on("error", () => {});

  return client;
}

// kept on globalThis so dev hot reloads reuse one connection
export const redis = (globalThis.redisGlobal ??= createRedis());
