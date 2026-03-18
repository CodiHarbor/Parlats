import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /org/members/:userId/remove — remove a member from the org */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const userId = ctx.params.userId;

  // Can't remove yourself
  if (userId === ctx.user.id) {
    return new Response("Cannot remove yourself", { status: 400 });
  }

  // Check target exists and is not the owner
  const [target] = await sql`
    SELECT role FROM org_members
    WHERE org_id = ${ctx.org.id} AND user_id = ${userId}
  `;

  if (!target) {
    return new Response("Member not found", { status: 404 });
  }

  if (target.role === "owner") {
    return new Response("Cannot remove the owner", { status: 403 });
  }

  // Admins cannot remove other admins
  if (ctx.org.role === "admin" && target.role === "admin") {
    return new Response("Admins cannot remove other admins", { status: 403 });
  }

  await sql`
    DELETE FROM org_members
    WHERE org_id = ${ctx.org.id} AND user_id = ${userId}
  `;

  captureBusinessEvent("member_removed", ctx);

  // Return updated members table
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

  return render("partials/members-table.njk", { members, ctx });
}
