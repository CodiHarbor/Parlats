// src/routes/auth/register.ts
import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { createSession, sessionCookieHeader } from "../../lib/session.ts";
import { processInvitation, checkPendingInviteByEmail, createPersonalOrg } from "../../lib/auth-helpers.ts";
import { captureAuthEvent, hashEmail } from "../../lib/observability/capture.ts";
import { sendVerificationEmail } from "../../lib/email-verification.ts";

/** GET /register — show registration form */
export const GET: HandlerFn = async (req, ctx) => {
  const url = new URL(req.url);
  return render("pages/register.njk", {
    ctx,
    error: "",
    invite: url.searchParams.get("invite") || "",
  });
};

/** POST /register — create account with email/password */
export const POST: HandlerFn = async (req, ctx) => {
  const form = await req.formData();
  const name = (form.get("name") as string || "").trim();
  const email = (form.get("email") as string || "").trim().toLowerCase();
  const password = form.get("password") as string || "";
  const invite = form.get("invite") as string || "";

  // Validation
  if (!name || !email || !password) {
    return render("pages/register.njk", {
      ctx,
      error: "all_fields_required",
      invite,
      name,
      email,
    });
  }

  if (password.length < 8) {
    return render("pages/register.njk", {
      ctx,
      error: "password_too_short",
      invite,
      name,
      email,
    });
  }

  if (password.length > 1024) {
    return render("pages/register.njk", {
      ctx,
      error: "password_too_long",
      invite,
      name,
      email,
    });
  }

  // Basic email format check
  if (!email.includes("@") || email.length > 254) {
    return render("pages/register.njk", {
      ctx,
      error: "invalid_email",
      invite,
      name,
      email,
    });
  }

  // Check if email is already taken
  const [existing] = await sql`
    SELECT id FROM users WHERE email = ${email}
  `;
  if (existing) {
    return render("pages/register.njk", {
      ctx,
      error: "email_taken",
      invite,
      name,
      email,
    });
  }

  // Hash password and create user + org in a transaction
  const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });

  const { userId, activeOrgId } = await sql.begin(async (tx) => {
    const [newUser] = await tx`
      INSERT INTO users (email, name, password_hash)
      VALUES (${email}, ${name}, ${passwordHash})
      RETURNING id
    `;
    const uid = newUser.id;

    // Resolve org: invitation or create personal
    let orgId: string | undefined;

    if (invite) {
      const joinedOrgId = await processInvitation(uid, email, invite, tx);
      orgId = joinedOrgId || undefined;
    }

    if (!orgId) {
      const inviteOrgId = await checkPendingInviteByEmail(uid, email, tx);
      orgId = inviteOrgId || await createPersonalOrg(uid, name, tx);
    }

    return { userId: uid, activeOrgId: orgId };
  });

  const sessionToken = await createSession(userId, activeOrgId);

  captureAuthEvent("user_registered", {
    user_id: userId,
    email_hash: await hashEmail(email),
    ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown",
  });

  // Send verification email (non-blocking — don't fail registration if email fails)
  sendVerificationEmail(userId, email).catch((err) =>
    console.error("[register] Failed to send verification email:", err),
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/auth/verify-email?sent=1",
      "Set-Cookie": sessionCookieHeader(sessionToken),
    },
  });
};
