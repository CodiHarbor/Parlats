// src/routes/auth/logout.ts
import type { HandlerFn } from "../../router.ts";
import { destroySession, getSessionToken, clearSessionCookieHeader } from "../../lib/session.ts";
import { captureAuthEvent } from "../../lib/observability/capture.ts";

export const POST: HandlerFn = async (req, _ctx) => {
  captureAuthEvent("user_logout", { user_id: "unknown" });
  const token = getSessionToken(req);
  if (token) {
    await destroySession(token);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearSessionCookieHeader(),
    },
  });
};
