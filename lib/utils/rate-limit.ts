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

export function checkRateLimit(key: string, maxRequests: number, windowMs: number) {
  ensurePruner(windowMs);
  const now = Date.now();
  const timestamps = (store.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    store.set(key, timestamps);
    return { success: false, remaining: 0 };
  }

  timestamps.push(now);
  store.set(key, timestamps);

  return { success: true, remaining: maxRequests - timestamps.length };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}
