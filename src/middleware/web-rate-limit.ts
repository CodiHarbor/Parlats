import type { MiddlewareFn } from "../router.ts";
import { captureRateLimitHit } from "../lib/observability/capture.ts";

export class WebRateLimiter {
  private store = new Map<string, number[]>();

  check(
    ip: string,
    route: string,
    limit: number,
    windowMs: number,
  ): { allowed: boolean; remaining: number; retryAfter: number } {
    const key = `${ip}:${route}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    let timestamps = this.store.get(key) || [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
      this.store.set(key, timestamps);
      return { allowed: false, remaining: 0, retryAfter };
    }

    timestamps.push(now);
    this.store.set(key, timestamps);
    return { allowed: true, remaining: limit - timestamps.length, retryAfter: 0 };
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 5 * 60_000;
    for (const [key, timestamps] of this.store) {
      const active = timestamps.filter((t) => t > now - maxAge);
      if (active.length === 0) this.store.delete(key);
      else this.store.set(key, active);
    }
  }
}

const limiter = new WebRateLimiter();
setInterval(() => limiter.cleanup(), 5 * 60_000);

/**
 * Extract client IP from request.
 * IMPORTANT: X-Forwarded-For is trusted here. In production, ensure your
 * reverse proxy strips and re-sets this header.
 */
function getClientIp(req: Request): string {
  return (
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    req.headers.get("X-Real-IP") ||
    "unknown"
  );
}

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

const ROUTE_LIMITS: Record<string, RateLimitConfig> = {
  "/login": { limit: 10, windowMs: 60_000 },
  "/register": { limit: 5, windowMs: 300_000 },
  "/invitations/accept": { limit: 10, windowMs: 300_000 },
  "/auth/forgot-password": { limit: 3, windowMs: 300_000 },
  "/auth/reset-password": { limit: 5, windowMs: 300_000 },
};

export const webRateLimit: MiddlewareFn = async (req, ctx, next) => {
  if (process.env.DISABLE_RATE_LIMIT === "1") return next();
  if (req.method !== "POST") return next();

  const url = new URL(req.url);
  const config = ROUTE_LIMITS[url.pathname];
  if (!config) return next();

  const ip = getClientIp(req);
  const { allowed, retryAfter } = limiter.check(ip, url.pathname, config.limit, config.windowMs);

  if (!allowed) {
    captureRateLimitHit({
      ip,
      route: url.pathname,
      limit: config.limit,
      window_ms: config.windowMs,
    });
    return new Response("Too many requests. Please try again later.", {
      status: 429,
      headers: { "Content-Type": "text/html", "Retry-After": String(retryAfter) },
    });
  }

  return next();
};
