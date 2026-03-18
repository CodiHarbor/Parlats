import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /org/members — list all members and pending invitations */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const members = await sql`
    SELECT u.id, u.email, u.name, u.avatar_url, om.role, om.created_at
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ${ctx.org.id}
    ORDER BY
      CASE om.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'dev' THEN 2
        WHEN 'translator' THEN 3
      END,
      u.name ASC
  `;

  const invitations = await sql`
    SELECT i.id, i.email, i.role, i.created_at, i.expires_at, u.name AS invited_by_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    WHERE i.org_id = ${ctx.org.id}
      AND i.accepted = false
      AND i.expires_at > NOW()
    ORDER BY i.created_at DESC
  `;

  return render("pages/members.njk", {
    members,
    invitations,
    ctx,
    activePage: "members",
  });
}
