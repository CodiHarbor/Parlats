import { sql } from "../db/client.ts";
import { hashToken } from "./session.ts";
import { sendEmail } from "./email.ts";
import { nunjucks } from "./templates.ts";

const VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Generate a verification token, store hash, send email. */
export async function sendVerificationEmail(
  userId: string,
  email: string,
): Promise<void> {
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MS);

  // Delete any existing verification for this user
  await sql`DELETE FROM email_verifications WHERE user_id = ${userId}`;

  await sql`
    INSERT INTO email_verifications (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
  `;

  const APP_URL = Bun.env.APP_URL || "http://localhost:3100";
  const verifyLink = `${APP_URL}/auth/verify-email?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your email — Parlats",
    html: nunjucks.render("emails/verify-email.njk", { verifyLink }),
  });
}

/** Verify a token. Returns userId if valid, null otherwise. */
export async function verifyEmailToken(token: string): Promise<string | null> {
  const tokenHash = await hashToken(token);

  const [row] = await sql`
    SELECT id, user_id, expires_at FROM email_verifications
    WHERE token_hash = ${tokenHash}
  `;

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await sql`DELETE FROM email_verifications WHERE id = ${row.id}`;
    return null;
  }

  // Mark user as verified
  await sql`UPDATE users SET email_verified = true WHERE id = ${row.user_id}`;
  // Clean up
  await sql`DELETE FROM email_verifications WHERE user_id = ${row.user_id}`;

  return row.user_id;
}
