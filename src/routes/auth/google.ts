// src/routes/auth/google.ts
import { Google, generateState, generateCodeVerifier } from "arctic";
import type { HandlerFn } from "../../router.ts";

/** Lazy-initialized Google client (avoids crash if env vars missing in dev) */
let _google: Google | null = null;
export function getGoogleClient(): Google {
  if (!_google) {
    _google = new Google(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!,
    );
  }
  return _google;
}

/**
 * GET /auth/google — Redirect to Google OAuth consent screen
 */
export const GET: HandlerFn = async (req, _ctx) => {
  const url = new URL(req.url);
  const inviteToken = url.searchParams.get("invite") || "";

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const google = getGoogleClient();

  const authUrl = google.createAuthorizationURL(state, codeVerifier, [
    "openid",
    "profile",
    "email",
  ]);

  // Store state + codeVerifier + invite token in short-lived cookies (10 min)
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookieOpts = `HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`;
  const headers = new Headers({
    Location: authUrl.toString(),
  });
  headers.append("Set-Cookie", `oauth_state=${state}; ${cookieOpts}`);
  headers.append("Set-Cookie", `oauth_verifier=${codeVerifier}; ${cookieOpts}`);
  if (inviteToken) {
    headers.append("Set-Cookie", `oauth_invite=${inviteToken}; ${cookieOpts}`);
  }

  return new Response(null, { status: 302, headers });
};
