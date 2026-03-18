import { sql } from "../db/client.ts";
import { hashToken } from "./session.ts";

/** A queryable interface — either the root sql client or a transaction. */
type Queryable = typeof sql;

/** Process a pending invitation for a user. Returns org_id if accepted, null otherwise. */
export async function processInvitation(
  userId: string,
  email: string,
  inviteToken: string,
  db: Queryable = sql,
): Promise<string | null> {
  const tokenHash = await hashToken(inviteToken);
  const [invite] = await db`
    SELECT id, org_id, role FROM invitations
    WHERE token_hash = ${tokenHash}
      AND email = ${email}
      AND accepted = false
      AND expires_at > NOW()
  `;
  if (!invite) return null;

  await db`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${invite.org_id}, ${userId}, ${invite.role})
    ON CONFLICT (org_id, user_id) DO NOTHING
  `;
  await db`
    UPDATE invitations SET accepted = true WHERE id = ${invite.id}
  `;
  return invite.org_id;
}

/**
 * Accept ALL pending invitations for a user by email (no token).
 * Returns the most recent invitation's org_id, or null if none found.
 */
export async function checkPendingInviteByEmail(
  userId: string,
  email: string,
  db: Queryable = sql,
): Promise<string | null> {
  const pendingInvites = await db`
    SELECT id, org_id, role FROM invitations
    WHERE email = ${email} AND accepted = false AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  if (pendingInvites.length === 0) return null;

  for (const invite of pendingInvites) {
    await db`
      INSERT INTO org_members (org_id, user_id, role)
      VALUES (${invite.org_id}, ${userId}, ${invite.role})
      ON CONFLICT (org_id, user_id) DO NOTHING
    `;
    await db`
      UPDATE invitations SET accepted = true WHERE id = ${invite.id}
    `;
  }

  // Return the most recent invitation's org as the active one
  return pendingInvites[0].org_id;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "my-org";
}

/** Create a personal org for a new user. Returns org_id. */
export async function createPersonalOrg(
  userId: string,
  userName: string,
  db: Queryable = sql,
): Promise<string> {
  const orgName = `${userName}'s Workspace`;
  const baseSlug = slugify(userName);
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

  const [org] = await db`
    INSERT INTO organizations (name, slug) VALUES (${orgName}, ${slug})
    RETURNING id
  `;
  await db`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${org.id}, ${userId}, 'owner')
  `;
  return org.id;
}
