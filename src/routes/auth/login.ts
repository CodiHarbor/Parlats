// src/routes/auth/login.ts
import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { createSession, sessionCookieHeader } from "../../lib/session.ts";
import { createPersonalOrg } from "../../lib/auth-helpers.ts";
import { captureAuthEvent, hashEmail } from "../../lib/observability/capture.ts";
import { loginLockout } from "../../lib/login-lockout.ts";

/** GET /login — show login form */
export const GET: HandlerFn = async (req, ctx) => {
  const url = new URL(req.url);
  return render("pages/login.njk", {
    ctx,
    error: url.searchParams.get("error") || "",
    invite: url.searchParams.get("invite") || "",
  });
};

/** POST /login — email/password authentication */
export const POST: HandlerFn = async (req, ctx) => {
  const form = await req.formData();
  const email = (form.get("email") as string || "").trim().toLowerCase();
  const password = form.get("password") as string || "";
  const invite = form.get("invite") as string || "";

  // Check account lockout
  const lockResult = loginLockout.check(email);
  if (lockResult.locked) {
    return render("pages/login.njk", {
      ctx,
      error: "account_locked",
      lockoutSeconds: lockResult.retryAfterSec,
      invite,
      email,
    });
  }

  if (!email || !password || !email.includes("@") || email.length > 254) {
    return render("pages/login.njk", {
      ctx,
      error: !email || !password ? "email_password_required" : "invalid_credentials",
      invite,
      email,
    });
  }

  // Find user by email
  const [user] = await sql`
    SELECT id, name, password_hash FROM users WHERE email = ${email}
  `;

  if (!user || !user.password_hash) {
    loginLockout.recordFailure(email);
    captureAuthEvent("user_login_failed", {
      email_hash: await hashEmail(email),
      ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown",
      reason: "user_not_found",
    });
    return render("pages/login.njk", {
      ctx,
      error: "invalid_credentials",
      invite,
      email,
    });
  }

  // Verify password
  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) {
    loginLockout.recordFailure(email);
    captureAuthEvent("user_login_failed", {
      email_hash: await hashEmail(email),
      ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown",
      reason: "invalid_password",
    });
    return render("pages/login.njk", {
      ctx,
      error: "invalid_credentials",
      invite,
      email,
    });
  }

  // Find their active org — create personal org if none exists
  const [membership] = await sql`
    SELECT org_id FROM org_members WHERE user_id = ${user.id} LIMIT 1
  `;

  const activeOrgId = membership?.org_id || await createPersonalOrg(user.id, user.name || email);

  loginLockout.recordSuccess(email);
  const sessionToken = await createSession(user.id, activeOrgId);

  captureAuthEvent("user_login", {
    user_id: user.id,
    email_hash: await hashEmail(email),
    provider: "password",
    ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown",
  });

  const redirectTo = invite
    ? `/invitations/accept?token=${encodeURIComponent(invite)}`
    : "/";

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo,
      "Set-Cookie": sessionCookieHeader(sessionToken),
    },
  });
};
