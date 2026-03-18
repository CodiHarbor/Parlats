import type { MiddlewareFn } from "../router.ts";
import { sql } from "../db/client.ts";
import { apiError } from "../lib/api-helpers.ts";

// Pre-computed dummy hash for timing attack mitigation.
// Generated once at startup so failed prefix lookups still run verify().
const DUMMY_HASH = await Bun.password.hash("dummy-timing-attack-prevention", {
  algorithm: "argon2id",
  memoryCost: 19456,
  timeCost: 2,
});

/**
 * API key authentication middleware.
 * Expects: Authorization: Bearer trad_<8-char-prefix>_<32-char-secret>
 * Populates ctx.user, ctx.org, ctx.apiKey on success.
 * Returns 401 JSON on failure.
 */
export const apiAuth: MiddlewareFn = async (req, ctx, next) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer trad_")) {
    return apiError("UNAUTHORIZED", "Missing or invalid API key", 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "
  // Format: trad_<8 prefix>_<32 secret>
  const parts = token.split("_");
  if (parts.length !== 3 || parts[0] !== "trad" || parts[1].length !== 8) {
    return apiError("UNAUTHORIZED", "Invalid API key format", 401);
  }

  const prefix = parts[1];

  // Look up key by prefix, join user + org
  const rows = await sql`
    SELECT
      ak.id, ak.key_hash, ak.scopes, ak.rate_limit, ak.last_used_at,
      ak.org_id, ak.role,
      u.id AS user_id, u.email AS user_email, u.name AS user_name, u.avatar_url,
      o.name AS org_name, o.slug AS org_slug, o.subscription_status AS org_subscription_status
    FROM api_keys ak
    LEFT JOIN users u ON u.id = ak.created_by
    JOIN organizations o ON o.id = ak.org_id
    WHERE ak.key_prefix = ${prefix}
      AND ak.revoked_at IS NULL
      AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
    LIMIT 1
  `;

  if (rows.length === 0) {
    // Timing attack mitigation: run verify even when no key found
    await Bun.password.verify("dummy", DUMMY_HASH);
    return apiError("UNAUTHORIZED", "Invalid API key", 401);
  }

  const row = rows[0];
  const valid = await Bun.password.verify(token, row.key_hash);
  if (!valid) {
    return apiError("UNAUTHORIZED", "Invalid API key", 401);
  }

  // Populate context
  ctx.user = {
    id: row.user_id || "00000000-0000-0000-0000-000000000000",
    email: row.user_email || "api-key@system",
    name: row.user_name || "API Key",
    avatarUrl: row.avatar_url || null,
  };

  ctx.org = {
    id: row.org_id,
    name: row.org_name,
    slug: row.org_slug,
    role: row.role as "owner" | "admin" | "dev" | "translator",
    subscriptionStatus: row.org_subscription_status ?? undefined,
  };

  let scopes: any;
  try {
    scopes = typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes;
  } catch {
    return apiError("UNAUTHORIZED", "Invalid API key configuration", 401);
  }
  ctx.apiKey = {
    id: row.id,
    scopes,
    rateLimit: row.rate_limit,
  };

  // Debounced last_used_at update (only if older than 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  if (!row.last_used_at || new Date(row.last_used_at) < fiveMinAgo) {
    sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`.catch(() => {});
  }

  return next();
};

/**
 * Factory: create scope-checking middleware for a specific permission.
 * Must run after apiAuth.
 */
export function requireApiScope(permission: string): MiddlewareFn {
  return async (_req, ctx, next) => {
    if (!ctx.apiKey) {
      return apiError("UNAUTHORIZED", "API key required", 401);
    }
    if (!ctx.apiKey.scopes.permissions.includes(permission)) {
      return apiError("FORBIDDEN", `API key lacks '${permission}' permission`, 403);
    }
    return next();
  };
}

/**
 * Middleware: check project scope on API key.
 * For routes with :id param, verifies the project is in the key's allowed projects.
 */
export const checkProjectScope: MiddlewareFn = async (_req, ctx, next) => {
  if (!ctx.apiKey) {
    return apiError("UNAUTHORIZED", "API key required", 401);
  }
  const projectId = ctx.params.id;
  if (projectId && !ctx.apiKey.scopes.projects.includes("*")) {
    if (!ctx.apiKey.scopes.projects.includes(projectId)) {
      return apiError("FORBIDDEN", "API key does not have access to this project", 403);
    }
  }
  return next();
};
