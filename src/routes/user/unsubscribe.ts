import { sql } from "../../db/client.ts";
import { render } from "../../lib/templates.ts";

const SECRET = Bun.env.SESSION_SECRET || "parlats-dev-secret";

/** Generate an HMAC token for unsubscribe links (no auth needed) */
export async function generateUnsubscribeToken(userId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(userId));
  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${userId}.${hex}`;
}

/** Verify an unsubscribe token */
async function verifyToken(token: string): Promise<string | null> {
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;

  const userId = token.slice(0, dotIndex);
  const expected = await generateUnsubscribeToken(userId);
  if (token !== expected) return null;

  return userId;
}

/** GET /user/unsubscribe?token=... — one-click email unsubscribe */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  const userId = await verifyToken(token);
  if (!userId) {
    return render("pages/unsubscribe.njk", {
      error: "Invalid or expired unsubscribe link.",
      requestPath: "/user/unsubscribe",
    });
  }

  // Opt out
  await sql`UPDATE users SET digest_optout = true WHERE id = ${userId}`;

  return render("pages/unsubscribe.njk", {
    success: true,
    requestPath: "/user/unsubscribe",
  });
}
