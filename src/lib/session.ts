// src/lib/session.ts
import { sql } from "../db/client.ts";

const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = "parlats_session";

/** Hash a session token using SHA-256 for DB storage */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a cryptographically random session token */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create a new session and return the token */
export async function createSession(
  userId: string,
  activeOrgId: string,
): Promise<string> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);

  await sql`
    INSERT INTO sessions (user_id, active_org_id, token, token_hash, expires_at)
    VALUES (${userId}, ${activeOrgId}, ${null}, ${tokenHash}, ${expiresAt})
  `;

  return token;
}

/** Validate a session token. Returns session data or null. */
export async function validateSession(
  token: string,
): Promise<{
  userId: string;
  activeOrgId: string | null;
  sessionId: string;
} | null> {
  const tokenHash = await hashToken(token);

  // Try lookup by hash first (new sessions)
  let [row] = await sql`
    SELECT id, user_id, active_org_id, expires_at
    FROM sessions
    WHERE token_hash = ${tokenHash}
  `;

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    // Expired — clean up
    await sql`DELETE FROM sessions WHERE id = ${row.id}`;
    return null;
  }

  // Sliding window: refresh expiry
  const newExpiry = new Date(Date.now() + SESSION_EXPIRY_MS);
  await sql`
    UPDATE sessions SET expires_at = ${newExpiry} WHERE id = ${row.id}
  `;

  return {
    userId: row.user_id,
    activeOrgId: row.active_org_id,
    sessionId: row.id,
  };
}

/** Destroy a session by token */
export async function destroySession(token: string): Promise<void> {
  const tokenHash = await hashToken(token);
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

/** Destroy all sessions for a user (e.g., after password change, account compromise) */
export async function destroyAllUserSessions(userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

/** Extract session token from request cookies */
export function getSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

/** Whether to set the Secure flag on cookies */
const isSecure = process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";

/** Build a Set-Cookie header value for the session */
export function sessionCookieHeader(token: string): string {
  const maxAge = SESSION_EXPIRY_MS / 1000;
  const secure = isSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

/** Build a Set-Cookie header that clears the session cookie */
export function clearSessionCookieHeader(): string {
  const secure = isSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
