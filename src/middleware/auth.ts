import type { MiddlewareFn } from "../router.ts";
import { sql } from "../db/client.ts";
import { getSessionToken, validateSession } from "../lib/session.ts";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
let devAuthWarned = false;

/**
 * Auth middleware — validates session and injects ctx.user.
 * In development, injects a hardcoded dev user (no real OAuth needed).
 */
export const auth: MiddlewareFn = async (req, ctx, next) => {
  if (process.env.NODE_ENV === "development") {
    if (!devAuthWarned) {
      console.warn("⚠ Dev auth active — all requests use hardcoded dev user. Set NODE_ENV=production to disable.");
      devAuthWarned = true;
    }
    // Dev mode: read dev user from DB to pick up locale changes
    const [dbUser] = await sql`SELECT id, email, name, avatar_url, locale, email_verified FROM users WHERE id = ${DEV_USER_ID}`;
    ctx.user = dbUser
      ? { id: dbUser.id, email: dbUser.email, name: dbUser.name, avatarUrl: dbUser.avatar_url, locale: dbUser.locale, emailVerified: dbUser.email_verified ?? true }
      : { id: DEV_USER_ID, email: "dev@parlats.local", name: "Dev User", avatarUrl: null, locale: null, emailVerified: true };
    return next();
  }

  // Production: validate session cookie
  const token = getSessionToken(req);
  if (!token) {
    return redirectToLogin(req);
  }

  const session = await validateSession(token);
  if (!session) {
    return redirectToLogin(req);
  }

  // Populate ctx.user from DB
  const [user] = await sql`
    SELECT id, email, name, avatar_url, locale, email_verified FROM users WHERE id = ${session.userId}
  `;
  if (!user) {
    return redirectToLogin(req);
  }

  ctx.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url,
    locale: user.locale,
    emailVerified: user.email_verified ?? false,
  };

  // Stash session data for org-context middleware
  (ctx as any)._session = session;

  return next();
};

/** Redirect HTML requests to landing page, return 401 for HTMX/fetch */
function redirectToLogin(req: Request): Response {
  const isHtmx = req.headers.get("HX-Request") === "true";
  const accept = req.headers.get("Accept") || "";
  const isJson = accept.includes("application/json");

  if (isHtmx) {
    // HTMX: use HX-Redirect to trigger a full page navigation
    return new Response(null, {
      status: 200,
      headers: { "HX-Redirect": "/" },
    });
  }

  if (isJson) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: "/login" },
  });
}
