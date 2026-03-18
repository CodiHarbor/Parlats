import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { sendEmail } from "../../lib/email.ts";
import { clearSessionCookieHeader } from "../../lib/session.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";
import nunjucks from "nunjucks";

/** GET /user/delete-account — show confirmation page */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const soleOwnerOrgs = await getSoleOwnerOrgs(ctx.user.id);
  const hasPassword = await userHasPassword(ctx.user.id);

  return render("pages/delete-account.njk", {
    ctx,
    soleOwnerOrgs,
    hasPassword,
    activePage: "",
  });
}

/** POST /user/delete-account — delete the user's account */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const form = await req.formData();
  const confirmation = (form.get("confirmation") as string || "").trim();
  const password = (form.get("password") as string || "").trim();

  const soleOwnerOrgs = await getSoleOwnerOrgs(ctx.user.id);
  const hasPassword = await userHasPassword(ctx.user.id);

  // Must type "DELETE" to confirm
  if (confirmation !== "DELETE") {
    return render("pages/delete-account.njk", {
      ctx,
      soleOwnerOrgs,
      hasPassword,
      activePage: "",
      error: 'Please type "DELETE" to confirm account deletion.',
    });
  }

  // Verify password if user has one (OAuth-only users don't)
  if (hasPassword) {
    if (!password) {
      return render("pages/delete-account.njk", {
        ctx,
        soleOwnerOrgs,
        hasPassword,
        activePage: "",
        error: "Please enter your password to confirm.",
      });
    }

    const [user] = await sql`SELECT password_hash FROM users WHERE id = ${ctx.user.id}`;
    if (!user?.password_hash) {
      return render("pages/delete-account.njk", {
        ctx,
        soleOwnerOrgs,
        hasPassword,
        activePage: "",
        error: "Could not verify your identity.",
      });
    }

    const valid = await Bun.password.verify(password, user.password_hash);
    if (!valid) {
      return render("pages/delete-account.njk", {
        ctx,
        soleOwnerOrgs,
        hasPassword,
        activePage: "",
        error: "Incorrect password.",
      });
    }
  }

  // Block if user is sole owner of any org
  if (soleOwnerOrgs.length > 0) {
    return render("pages/delete-account.njk", {
      ctx,
      soleOwnerOrgs,
      hasPassword,
      activePage: "",
      error: "You must transfer ownership of your organizations before deleting your account.",
    });
  }

  // Send confirmation email before deletion
  try {
    const html = nunjucks.render("emails/account-deleted.njk", {
      name: ctx.user.name || ctx.user.email,
    });
    await sendEmail({
      to: ctx.user.email,
      subject: "Your Parlats account has been deleted",
      html,
    });
  } catch {
    // Don't block deletion if email fails
  }

  // Delete the user — cascades handle sessions, org_members, notifications, etc.
  // SET NULL handles comments.user_id, invitations.invited_by, translations.updated_by,
  // api_keys.created_by, change_operations.user_id
  await sql`DELETE FROM users WHERE id = ${ctx.user.id}`;

  captureBusinessEvent("account_deleted", ctx);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/?deleted=1",
      "Set-Cookie": clearSessionCookieHeader(),
    },
  });
}

/** Find orgs where user is the only owner */
async function getSoleOwnerOrgs(userId: string) {
  return await sql`
    SELECT o.id, o.name
    FROM organizations o
    JOIN org_members om ON om.org_id = o.id AND om.user_id = ${userId} AND om.role = 'owner'
    WHERE NOT EXISTS (
      SELECT 1 FROM org_members om2
      WHERE om2.org_id = o.id AND om2.role = 'owner' AND om2.user_id != ${userId}
    )
  `;
}

/** Check if user has a password (vs OAuth-only) */
async function userHasPassword(userId: string): Promise<boolean> {
  const [row] = await sql`
    SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ${userId}
  `;
  return row?.has_password ?? false;
}
