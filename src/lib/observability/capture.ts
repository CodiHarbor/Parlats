import { loadObservabilityConfig } from "./config.ts";
import { getPostHogClient } from "./client.ts";

/** SHA-256 hash an email for privacy */
export async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function capture(event: string, distinctId: string, properties?: Record<string, any>): void {
  const client = getPostHogClient();
  client.capture({ distinctId, event, properties });
}

/** Capture an HTTP request event */
export function captureRequest(props: {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  user_id?: string;
  org_id?: string;
  ip: string;
}): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.http_requests) return;
  capture("http_request", props.user_id || "anonymous", props);
}

/** Capture a server error (5xx or uncaught) */
export function captureError(event: string, err: Error, extra?: Record<string, any>): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled) return;
  capture(event, extra?.user_id || "anonymous", {
    error_message: err.message,
    error_stack: err.stack,
    ...extra,
  });
}

/** Capture a slow request event */
export function captureSlowRequest(props: {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  user_id?: string;
  org_id?: string;
}): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.http_requests) return;
  capture("slow_request", props.user_id || "anonymous", props);
}

/** Capture an auth event (login, register, logout) */
export function captureAuthEvent(event: string, props: Record<string, any>): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.auth_events) return;
  capture(event, props.user_id || "anonymous", props);
}

/** Capture a business event (project created, import completed, etc.) */
export function captureBusinessEvent(
  event: string,
  ctx: { user?: { id: string }; org?: { id: string } },
  extra?: Record<string, any>,
): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.business_events) return;
  capture(event, ctx.user?.id || "anonymous", {
    user_id: ctx.user?.id,
    org_id: ctx.org?.id,
    ...extra,
  });
}

/** Capture a rate limit hit */
export function captureRateLimitHit(props: {
  ip: string;
  route: string;
  limit: number;
  window_ms: number;
}): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.rate_limit_hits) return;
  capture("rate_limit_hit", "anonymous", props);
}

/** Capture a background job completion */
export function captureBackgroundJob(event: string, props: Record<string, any>): void {
  const config = loadObservabilityConfig();
  if (!config.isEnabled || !config.logging.background_jobs) return;
  capture(event, "system", props);
}
