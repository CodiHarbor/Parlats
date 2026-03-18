import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { z } from "zod/v4";

const RoleUpdate = z.object({
  role: z.enum(["admin", "dev", "translator"]),
});

/** POST /org/members/:userId/role — change a member's role */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const userId = ctx.params.userId;

  // Can't change your own role
  if (userId === ctx.user.id) {
    return new Response("Cannot change your own role", { status: 400 });
  }

  // Check target is a member and not the owner
  const [target] = await sql`
    SELECT om.role, u.id, u.email, u.name, u.avatar_url, om.created_at
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ${ctx.org.id} AND om.user_id = ${userId}
  `;

  if (!target) {
    return new Response("Member not found", { status: 404 });
  }

  if (target.role === "owner") {
    return new Response("Cannot change the owner's role", { status: 403 });
  }

  // Roles assignable up to own level (admins can assign admin, owners can assign admin/dev/translator)
  const formData = await req.formData();
  const result = RoleUpdate.safeParse({ role: formData.get("role") });

  if (!result.success) {
    return new Response("Invalid role", { status: 422 });
  }

  const newRole = result.data.role;

  await sql`
    UPDATE org_members SET role = ${newRole}
    WHERE org_id = ${ctx.org.id} AND user_id = ${userId}
  `;

  // Return updated row partial
  const member = { ...target, role: newRole };
  return render("partials/member-row.njk", { member, ctx });
}
