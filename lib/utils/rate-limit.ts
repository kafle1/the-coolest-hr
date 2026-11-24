import { getRedis } from "@/lib/redis/client";
import { AppError } from "@/lib/utils/errors";

// runs as one step inside redis, so two requests at once can't both take the last slot.
// returns 0 when the request is allowed, otherwise the ms until a slot frees up.
const SLIDING_WINDOW = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return 0
end
return redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')[2] + window - now
`;

export async function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  const retryAfterMs = await getRedis()
    .eval(SLIDING_WINDOW, 1, `rl:${key}`, maxRequests, windowMs, crypto.randomUUID())
    .catch((error) => {
      console.error("[rate-limit] redis failed", error);
      throw new AppError(
        "The service is temporarily unavailable. Please try again shortly.",
        503,
        "rate_limit_unavailable",
      );
    });

  return {
    success: retryAfterMs === 0,
    retryAfterSeconds: Math.ceil(Number(retryAfterMs) / 1000),
  };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
