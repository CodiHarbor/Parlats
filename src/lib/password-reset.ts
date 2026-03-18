import { sql } from "../db/client.ts";
import { hashToken, destroyAllUserSessions } from "./session.ts";
import { sendEmail } from "./email.ts";
import { nunjucks } from "./templates.ts";

const RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/** Send a password reset email. Always succeeds (no email enumeration). */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  const [user] = await sql`
    SELECT id FROM users WHERE email = ${email}
  `;

  // Don't reveal whether user exists
  if (!user) return;

  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS);

  // Invalidate any existing resets for this user
  await sql`
    UPDATE password_resets SET used = true WHERE user_id = ${user.id} AND used = false
  `;

  await sql`
    INSERT INTO password_resets (user_id, token_hash, expires_at)
    VALUES (${user.id}, ${tokenHash}, ${expiresAt})
  `;

  const APP_URL = Bun.env.APP_URL || "http://localhost:3100";
  const resetLink = `${APP_URL}/auth/reset-password?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Reset your password — Parlats",
    html: nunjucks.render("emails/password-reset.njk", { resetLink }),
  });
}

/** Validate a reset token. Returns userId if valid. */
export async function validateResetToken(token: string): Promise<string | null> {
  const tokenHash = await hashToken(token);

  const [row] = await sql`
    SELECT id, user_id, expires_at FROM password_resets
    WHERE token_hash = ${tokenHash} AND used = false
  `;

  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  return row.user_id;
}

/** Consume a reset token and update the password. */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = await hashToken(token);

  const [row] = await sql`
    SELECT id, user_id, expires_at FROM password_resets
    WHERE token_hash = ${tokenHash} AND used = false
  `;

  if (!row || new Date(row.expires_at) < new Date()) return false;

  const passwordHash = await Bun.password.hash(newPassword, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });

  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${row.user_id}`;
  await sql`UPDATE password_resets SET used = true WHERE id = ${row.id}`;

  // Destroy all sessions for this user (force re-login)
  await destroyAllUserSessions(row.user_id);

  return true;
}
