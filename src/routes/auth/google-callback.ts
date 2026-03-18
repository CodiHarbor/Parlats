// src/routes/auth/google-callback.ts
import { decodeIdToken } from "arctic";
import { sql } from "../../db/client.ts";
import { createSession, sessionCookieHeader } from "../../lib/session.ts";
import { processInvitation, checkPendingInviteByEmail, createPersonalOrg } from "../../lib/auth-helpers.ts";
import { getGoogleClient } from "./google.ts";
import type { HandlerFn } from "../../router.ts";
import { captureAuthEvent, hashEmail } from "../../lib/observability/capture.ts";

/**
 * GET /auth/google/callback — Exchange code, resolve user, create session
 */
export const GET: HandlerFn = async (req, _ctx) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  // Parse cookies
  const cookies = parseCookies(req);
  const storedState = cookies.oauth_state;
  const codeVerifier = cookies.oauth_verifier;
  const inviteToken = cookies.oauth_invite;

  // Clear OAuth cookies
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const clearCookies = [
    `oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    `oauth_verifier=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    `oauth_invite=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  ];

  // Validate state
  if (!code || !stateParam || !storedState || stateParam !== storedState || !codeVerifier) {
    return redirectWithCookies("/login?error=invalid_state", clearCookies);
  }

  try {
    // Exchange code for tokens
    const google = getGoogleClient();
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);

    // Decode ID token and validate required fields
    const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
    const email = claims.email as string | undefined;
    const googleId = claims.sub as string | undefined;
    const name = (claims.name as string) || "";
    const picture = (claims.picture as string) || null;

    if (!email || !googleId) {
      return redirectWithCookies("/login?error=auth_failed", clearCookies);
    }

    // --- User Resolution (transactional) ---
    let userId: string;
    let activeOrgId: string;

    const result = await sql.begin(async (tx) => {
      const [existingUser] = await tx`
        SELECT id FROM users WHERE email = ${email}
      `;

      if (existingUser) {
        const uid = existingUser.id;

        // Link Google provider if not already linked
        await tx`
          INSERT INTO user_providers (user_id, provider, provider_id)
          VALUES (${uid}, 'google', ${googleId})
          ON CONFLICT (provider, provider_id) DO NOTHING
        `;

        // Update avatar from Google + mark email as verified (Google verifies emails)
        await tx`
          UPDATE users SET avatar_url = ${picture}, email_verified = true, updated_at = NOW()
          WHERE id = ${uid}
        `;

        // Find their active org (first org they belong to)
        const [membership] = await tx`
          SELECT org_id FROM org_members WHERE user_id = ${uid} LIMIT 1
        `;
        let orgId = membership?.org_id;

        // If they have a pending invitation, process it
        if (inviteToken) {
          const joinedOrgId = await processInvitation(uid, email, inviteToken, tx);
          if (joinedOrgId) orgId = joinedOrgId;
        }

        // Edge case: user exists but has no org
        if (!orgId) {
          orgId = await createPersonalOrg(uid, name, tx);
        }

        return { userId: uid, activeOrgId: orgId };
      } else {
        // New user — Google verifies emails, so mark as verified
        const [newUser] = await tx`
          INSERT INTO users (email, name, avatar_url, email_verified)
          VALUES (${email}, ${name}, ${picture}, true)
          RETURNING id
        `;
        const uid = newUser.id;

        // Link Google provider
        await tx`
          INSERT INTO user_providers (user_id, provider, provider_id)
          VALUES (${uid}, 'google', ${googleId})
        `;

        // Check for pending invitation
        let orgId: string;
        if (inviteToken) {
          const joinedOrgId = await processInvitation(uid, email, inviteToken, tx);
          orgId = joinedOrgId || await createPersonalOrg(uid, name, tx);
        } else {
          const inviteOrgId = await checkPendingInviteByEmail(uid, email, tx);
          orgId = inviteOrgId || await createPersonalOrg(uid, name, tx);
        }

        return { userId: uid, activeOrgId: orgId };
      }
    });

    userId = result.userId;
    activeOrgId = result.activeOrgId;

    // Create session
    const sessionToken = await createSession(userId, activeOrgId);

    captureAuthEvent("oauth_login", {
      user_id: userId,
      email_hash: await hashEmail(email),
      provider: "google",
      ip: req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown",
    });

    const headers = new Headers({ Location: "/dashboard" });
    headers.append("Set-Cookie", sessionCookieHeader(sessionToken));
    for (const c of clearCookies) headers.append("Set-Cookie", c);

    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error("OAuth callback error:", err);
    return redirectWithCookies("/login?error=auth_failed", clearCookies);
  }
};

// --- Helpers ---

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("Cookie") || "";
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) cookies[name] = rest.join("=");
  }
  return cookies;
}

function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
