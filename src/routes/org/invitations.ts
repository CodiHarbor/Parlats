import type { AuthenticatedContext } from "../../types/index.ts";
import { render, nunjucks } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { z } from "zod/v4";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";
import { sendEmail } from "../../lib/email.ts";
import { hashToken } from "../../lib/session.ts";

const CreateInvitation = z.object({
  email: z.email("Invalid email address"),
  role: z.enum(["admin", "dev", "translator"]),
});

/** POST /org/invitations — create a new invitation */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const formData = await req.formData();
  const result = CreateInvitation.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!result.success) {
    return redirectToMembers(ctx, result.error.format().email?._errors[0] || "Invalid input");
  }

  const { email, role } = result.data;

  // Check if email is already a member
  const existingMember = await sql`
    SELECT u.id FROM users u
    JOIN org_members om ON om.user_id = u.id
    WHERE u.email = ${email} AND om.org_id = ${ctx.org.id}
  `;

  if (existingMember.length > 0) {
    return redirectToMembers(ctx, "This user is already a member");
  }

  // Check for existing pending invitation
  const existingInvite = await sql`
    SELECT id FROM invitations
    WHERE org_id = ${ctx.org.id} AND email = ${email}
      AND accepted = false AND expires_at > NOW()
  `;

  if (existingInvite.length > 0) {
    return redirectToMembers(ctx, "An invitation is already pending for this email");
  }

  // Generate invitation token (store only the hash)
  const token = crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await sql`
    INSERT INTO invitations (org_id, email, role, token_hash, expires_at, invited_by)
    VALUES (${ctx.org.id}, ${email}, ${role}, ${tokenHash}, ${expiresAt}, ${ctx.user.id})
  `;

  const APP_URL = Bun.env.APP_URL || "http://localhost:3100";
  const acceptLink = `${APP_URL}/invitations/accept?token=${token}`;

  await sendEmail({
    to: email,
    subject: `You've been invited to ${ctx.org.name} on Parlats`,
    html: nunjucks.render("emails/invitation.njk", {
      inviterName: ctx.user.name,
      orgName: ctx.org.name,
      role,
      acceptLink,
    }),
  });

  captureBusinessEvent("member_invited", ctx, { role });

  // Redirect back to members page (PRG pattern)
  return Response.redirect("/org/members", 303);
}

async function redirectToMembers(ctx: AuthenticatedContext, error: string): Promise<Response> {
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
    error,
    ctx,
    activePage: "members",
  }, 422);
}
