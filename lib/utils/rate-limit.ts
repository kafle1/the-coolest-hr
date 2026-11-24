import type { Result } from "ioredis";

import { redis } from "@/lib/redis/client";

type RateLimitResult = {
  success: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

declare module "ioredis" {
  interface RedisCommander<Context> {
    rateLimit(
      key: string,
      maxRequests: number,
      windowMs: number,
      member: string,
    ): Result<[number, number, number], Context>;
  }
}

// one script per check, so two requests at once can't both take the last slot.
// uses redis time so servers with different clocks agree.
const RATE_LIMIT_SCRIPT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < max then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, max - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, (tonumber(oldest[2]) or now) + window - now}
`;

redis?.defineCommand("rateLimit", { numberOfKeys: 1, lua: RATE_LIMIT_SCRIPT });

// the first request after boot can arrive before the socket is up, so give it a moment once
const redisBooted = new Promise<void>((resolve) => {
  if (!redis || redis.status === "ready") return resolve();
  redis.once("ready", () => resolve());
  setTimeout(resolve, 500).unref();
});

let redisDown = false;

function retryAfter(ms: number) {
  return Math.max(1, Math.ceil(ms / 1000) || 1);
}

const store = new Map<string, number[]>();

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function ensurePruner(windowMs: number) {
  if (pruneTimer) return;

  pruneTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, timestamps] of store) {
      const filtered = timestamps.filter((t) => now - t < windowMs);

      if (filtered.length === 0) {
        store.delete(key);
      } else {
        store.set(key, filtered);
      }
    }
  }, windowMs * 2);

  if (typeof pruneTimer === "object" && "unref" in pruneTimer) {
    pruneTimer.unref();
  }
}

function checkMemory(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  ensurePruner(windowMs);
  const now = Date.now();
  const timestamps = (store.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    store.set(key, timestamps);
    return {
      success: false,
      remaining: 0,
      retryAfterSeconds: retryAfter(timestamps[0] + windowMs - now),
    };
  }

  timestamps.push(now);
  store.set(key, timestamps);

  return {
    success: true,
    remaining: maxRequests - timestamps.length,
    retryAfterSeconds: 0,
  };
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  // a broken limit blocks instead of letting everything through
  if (
    !Number.isSafeInteger(maxRequests) ||
    !Number.isSafeInteger(windowMs) ||
    maxRequests < 1 ||
    windowMs < 1
  ) {
    return { success: false, remaining: 0, retryAfterSeconds: 1 };
  }

  if (redis) {
    await redisBooted;

    if (redis.status === "ready") {
      try {
        const [allowed, remaining, retryMs] = await redis.rateLimit(
          `rl:${key}`,
          maxRequests,
          windowMs,
          crypto.randomUUID(),
        );

        if (redisDown) {
          redisDown = false;
          console.info("[rate-limit] redis is back, counting there again");
        }

        return allowed === 1
          ? { success: true, remaining, retryAfterSeconds: 0 }
          : { success: false, remaining: 0, retryAfterSeconds: retryAfter(retryMs) };
      } catch {
        // falls through to the in-memory count below
      }
    }

    if (!redisDown) {
      redisDown = true;
      console.warn("[rate-limit] redis unavailable, counting in memory until it is back");
    }
  }

  return checkMemory(key, maxRequests, windowMs);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
