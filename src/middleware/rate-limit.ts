import type { MiddlewareFn } from "../router.ts";
import { apiError, withRateLimitHeaders } from "../lib/api-helpers.ts";
import { captureRateLimitHit } from "../lib/observability/capture.ts";

const WINDOW_MS = 60_000; // 1 minute
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const MAX_ENTRIES = 10_000;

export class SlidingWindowLimiter {
  private store = new Map<string, number[]>();

  check(keyId: string, limit: number): {
    allowed: boolean;
    remaining: number;
    retryAfter: number;
    resetAt: number;
  } {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    let timestamps = this.store.get(keyId) || [];

    // Filter to current window
    timestamps = timestamps.filter((t) => t > cutoff);

    const resetAt = Math.ceil((now + WINDOW_MS) / 1000);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
      this.store.set(keyId, timestamps);
      return { allowed: false, remaining: 0, retryAfter, resetAt };
    }

    timestamps.push(now);
    this.store.set(keyId, timestamps);
    return {
      allowed: true,
      remaining: limit - timestamps.length,
      retryAfter: 0,
      resetAt,
    };
  }

  cleanup(): void {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, timestamps] of this.store) {
      const active = timestamps.filter((t) => t > cutoff);
      if (active.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, active);
      }
    }

    // Cap max entries
    if (this.store.size > MAX_ENTRIES) {
      const entries = [...this.store.entries()];
      entries.sort((a, b) => {
        const lastA = a[1][a[1].length - 1] || 0;
        const lastB = b[1][b[1].length - 1] || 0;
        return lastA - lastB;
      });
      const toRemove = entries.slice(0, entries.length - MAX_ENTRIES);
      for (const [key] of toRemove) {
        this.store.delete(key);
      }
    }
  }
}

// Singleton limiter instance
const limiter = new SlidingWindowLimiter();

// Periodic cleanup
setInterval(() => limiter.cleanup(), CLEANUP_INTERVAL_MS);

/**
 * Rate limiting middleware for API routes.
 * Must run after apiAuth (needs ctx.apiKey).
 */
export const rateLimit: MiddlewareFn = async (_req, ctx, next) => {
  if (!ctx.apiKey) {
    return apiError("UNAUTHORIZED", "API key required", 401);
  }

  const { allowed, remaining, retryAfter, resetAt } = limiter.check(
    ctx.apiKey.id,
    ctx.apiKey.rateLimit,
  );

  if (!allowed) {
    captureRateLimitHit({
      ip: ctx.apiKey.id,
      route: new URL(_req.url).pathname,
      limit: ctx.apiKey.rateLimit,
      window_ms: 60_000,
    });
    const res = apiError(
      "RATE_LIMITED",
      `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      429,
    );
    const headers = new Headers(res.headers);
    headers.set("Retry-After", String(retryAfter));
    headers.set("X-RateLimit-Limit", String(ctx.apiKey.rateLimit));
    headers.set("X-RateLimit-Remaining", "0");
    headers.set("X-RateLimit-Reset", String(resetAt));
    return new Response(res.body, { status: 429, headers });
  }

  const response = await next();
  return withRateLimitHeaders(response, ctx.apiKey.rateLimit, remaining, resetAt);
};
