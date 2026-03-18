/** Wrap a single object in the standard API success envelope */
export function apiSuccess(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

/** Wrap an array in the standard API list envelope with pagination meta */
export function apiList(
  data: unknown[],
  meta: { total: number; page: number; perPage: number },
): Response {
  return Response.json({ data, meta });
}

/** Standard API error response */
export function apiError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Parse pagination from query params. Returns { page, perPage, offset }. */
export function parsePagination(query: URLSearchParams): {
  page: number;
  perPage: number;
  offset: number;
} {
  const page = Math.min(10000, Math.max(1, parseInt(query.get("page") || "1", 10) || 1));
  const perPage = Math.min(200, Math.max(1, parseInt(query.get("perPage") || "50", 10) || 50));
  return { page, perPage, offset: (page - 1) * perPage };
}

/** Add rate limit headers to an existing Response */
export function withRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number,
): Response {
  const headers = new Headers(res.headers);
  headers.set("X-RateLimit-Limit", String(limit));
  headers.set("X-RateLimit-Remaining", String(remaining));
  headers.set("X-RateLimit-Reset", String(resetAt));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
