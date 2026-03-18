import type { MiddlewareFn } from "../router.ts";
import type { OrgRole } from "../types/index.ts";

/** Role hierarchy — higher index = more permissions */
const ROLE_LEVELS: Record<OrgRole, number> = {
  translator: 0,
  dev: 1,
  admin: 2,
  owner: 3,
};

/**
 * Create a permission middleware that requires a minimum role.
 * Must run after auth + orgContext middleware (needs ctx.org.role).
 */
export function requireRole(minimumRole: OrgRole): MiddlewareFn {
  const requiredLevel = ROLE_LEVELS[minimumRole];

  return async (_req, ctx, next) => {
    if (!ctx.org) {
      return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/html" } });
    }

    const userLevel = ROLE_LEVELS[ctx.org.role];
    if (userLevel < requiredLevel) {
      return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/html" } });
    }

    return next();
  };
}
