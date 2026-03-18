import { resolve } from "node:path";
import type { RequestContext } from "./types/index.ts";
import { addSecurityHeaders, generateNonce } from "./middleware/security-headers.ts";
import { captureRequest, captureError, captureSlowRequest } from "./lib/observability/capture.ts";
import { loadObservabilityConfig } from "./lib/observability/config.ts";

/** Route handler function */
export type HandlerFn = (
  req: Request,
  ctx: RequestContext,
) => Response | Promise<Response>;

/** Route module — exports named HTTP method handlers (GET, POST, etc.) */
export interface RouteModule {
  GET?: HandlerFn;
  POST?: HandlerFn;
  PUT?: HandlerFn;
  DELETE?: HandlerFn;
  PATCH?: HandlerFn;
}

/** Middleware function — modify ctx or return early */
export type MiddlewareFn = (
  req: Request,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

interface CompiledRoute {
  pattern: string;
  segments: string[];
  module: RouteModule;
  middlewareNames: string[];
}

const routes: CompiledRoute[] = [];
const middlewareRegistry = new Map<string, MiddlewareFn>();

/** Register a named middleware that routes can reference */
export function registerMiddleware(name: string, fn: MiddlewareFn): void {
  middlewareRegistry.set(name, fn);
}

/** Register a route with its handler module and middleware chain */
export function addRoute(
  pattern: string,
  module: RouteModule,
  middleware: string[] = [],
): void {
  routes.push({
    pattern,
    segments: pattern === "/" ? [] : pattern.split("/").filter(Boolean),
    module,
    middlewareNames: middleware,
  });
}

/** Match a URL pathname against registered routes */
function matchRoute(pathname: string): {
  route: CompiledRoute;
  params: Record<string, string>;
} | null {
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  const pathSegments =
    normalized === "/" ? [] : normalized.split("/").filter(Boolean);

  for (const route of routes) {
    if (route.segments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let i = 0; i < route.segments.length; i++) {
      if (route.segments[i].startsWith(":")) {
        params[route.segments[i].slice(1)] = decodeURIComponent(
          pathSegments[i],
        );
      } else if (route.segments[i] !== pathSegments[i]) {
        matched = false;
        break;
      }
    }

    if (!matched) continue;
    return { route, params };
  }

  return null;
}

/** Execute middleware chain then handler */
function runMiddlewareChain(
  middlewareNames: string[],
  req: Request,
  ctx: RequestContext,
  handler: HandlerFn,
): Promise<Response> {
  const middlewares = middlewareNames.map((name) => {
    const mw = middlewareRegistry.get(name);
    if (!mw) throw new Error(`Unknown middleware: ${name}`);
    return mw;
  });

  let index = 0;

  function next(): Promise<Response> {
    if (index >= middlewares.length) {
      return Promise.resolve(handler(req, ctx));
    }
    const mw = middlewares[index++];
    return Promise.resolve(mw(req, ctx, next));
  }

  return next();
}

/** Serve a static file from public/ — with path traversal protection */
async function serveStaticFile(pathname: string): Promise<Response> {
  const relativePath = pathname.slice("/public/".length);
  const publicDir = resolve("./public");
  const resolved = resolve("./public", relativePath);

  // Block any path that escapes the public directory
  if (!resolved.startsWith(publicDir + "/") && resolved !== publicDir) {
    return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
  }

  const file = Bun.file(resolved);
  if (await file.exists()) {
    return addSecurityHeaders(new Response(file));
  }
  return addSecurityHeaders(new Response("Not Found", { status: 404 }));
}

/** Main request handler — wire this into Bun.serve() */
export async function handleRequest(req: Request): Promise<Response> {
  const start = performance.now();
  const url = new URL(req.url);

  // Static files — no logging
  if (url.pathname.startsWith("/public/")) {
    return serveStaticFile(url.pathname);
  }

  // Browsers auto-request /favicon.ico — serve the PNG favicon
  if (url.pathname === "/favicon.ico") {
    return serveStaticFile("/public/favicon-32x32.png");
  }

  // Match route
  const match = matchRoute(url.pathname);

  if (!match) {
    return addSecurityHeaders(new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    }));
  }

  const { route, params } = match;
  const method = req.method as keyof RouteModule;
  const handler = route.module[method];

  if (!handler) {
    const allowed = HTTP_METHODS.filter((m) => route.module[m]).join(", ");
    return addSecurityHeaders(new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: allowed, "Content-Type": "text/html" },
    }));
  }

  // Build context — middleware fills in user/org
  const nonce = generateNonce();
  const ctx: RequestContext = {
    params,
    query: url.searchParams,
    nonce,
  };

  let response: Response;
  try {
    response = addSecurityHeaders(await runMiddlewareChain(route.middlewareNames, req, ctx, handler), nonce);
  } catch (err) {
    const duration_ms = Math.round(performance.now() - start);
    console.error("Request error:", err);
    captureError("http_error", err instanceof Error ? err : new Error(String(err)), {
      method: req.method,
      path: url.pathname,
      status: 500,
      duration_ms,
      user_id: ctx.user?.id,
      org_id: ctx.org?.id,
    });
    return addSecurityHeaders(new Response("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/html" },
    }), nonce);
  }

  // Capture request metrics
  const duration_ms = Math.round(performance.now() - start);
  const ip = req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || req.headers.get("X-Real-IP")
    || "unknown";

  captureRequest({
    method: req.method,
    path: url.pathname,
    status: response.status,
    duration_ms,
    user_id: ctx.user?.id,
    org_id: ctx.org?.id,
    ip,
  });

  // Capture 5xx errors
  const config = loadObservabilityConfig();
  if (response.status >= 500 && config.logging.http_errors) {
    captureError("http_error", new Error(`HTTP ${response.status}`), {
      method: req.method,
      path: url.pathname,
      status: response.status,
      duration_ms,
      user_id: ctx.user?.id,
      org_id: ctx.org?.id,
    });
  }

  // Capture slow requests
  if (duration_ms > config.logging.slow_request_threshold_ms) {
    captureSlowRequest({
      method: req.method,
      path: url.pathname,
      status: response.status,
      duration_ms,
      user_id: ctx.user?.id,
      org_id: ctx.org?.id,
    });
  }

  return response;
}
